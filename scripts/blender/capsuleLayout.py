"""Extract the cockpit-relevant layout of every capsule exterior (Role 1 GLBs) into capsule_layout.json.
Run: Blender -b --factory-startup -P capsuleLayout.py -- <nose dir> <out.json>
Blender space: Z up = capsule axis toward the apex, z=0 = heat shield. Windows/hatches are mesh islands of one merged slot mesh."""
import bpy, bmesh, sys, json, math
from mathutils import Vector
nose, out = sys.argv[-2], sys.argv[-1]
IDS = ['vostok','mercury','gemini','apollo','soyuz','shenzhou','orion','dragon','starliner','gaganyaan','newshepard','mengzhou']
res = {}
def islands(obj):
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    bm.faces.ensure_lookup_table()
    seen, groups = set(), []
    for f in bm.faces:
        if f.index in seen: continue
        stack, grp = [f], []
        seen.add(f.index)
        while stack:
            c = stack.pop(); grp.append(c)
            for e in c.edges:
                for n in e.link_faces:
                    if n.index not in seen: seen.add(n.index); stack.append(n)
        groups.append(grp)
    out = []
    for g in groups:
        vs = {v.index: v.co.copy() for f in g for v in f.verts}
        pts = list(vs.values())
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        area = sum(f.calc_area() for f in g)
        n = sum((f.normal * f.calc_area() for f in g), Vector())
        nn = n.normalized() if n.length > 1e-6 else Vector((0, 0, 1))
        tt = Vector((0, 0, 1)).cross(nn)
        tt = tt.normalized() if tt.length > 1e-4 else Vector((1, 0, 0))
        bb = nn.cross(tt)
        ext = [round(max(p.dot(a) for p in pts) - min(p.dot(a) for p in pts), 4) for a in (tt, bb, nn)]
        out.append({'centre': [round(c, 4) for c in (lo + hi) / 2], 'size': [round(c, 4) for c in (hi - lo)],
                    'normal': [round(c, 4) for c in n.normalized()] if n.length > 1e-6 else [0, 0, 1], 'area': round(area, 4), 'faces': len(g), 'ext': ext, 'pts': [[round(c, 3) for c in p] for p in pts[::max(1, len(pts) // 60)]]})
    bm.free()
    # merge islands whose boxes overlap (frame ring + glass pane belong to one window)
    cl = True
    def box(i): return [Vector(i['centre']) - Vector(i['size']) / 2, Vector(i['centre']) + Vector(i['size']) / 2]
    while cl:
        cl = False
        for a in range(len(out)):
            for b in range(a + 1, len(out)):
                A, B = box(out[a]), box(out[b]); m = 0.0015
                if all(A[0][k] <= B[1][k] + m and B[0][k] <= A[1][k] + m for k in range(3)):
                    wa, wb = out[a]['area'], out[b]['area']
                    lo = Vector((min(A[0][k], B[0][k]) for k in range(3))); hi = Vector((max(A[1][k], B[1][k]) for k in range(3)))
                    nrm = Vector(out[a]['normal']) * wa + Vector(out[b]['normal']) * wb
                    out[a] = {'pts': out[a]['pts'] + out[b]['pts'], 'ext': [max(out[a]['ext'][k], out[b]['ext'][k]) for k in range(3)], **{'centre': [round(c, 4) for c in (lo + hi) / 2], 'size': [round(c, 4) for c in (hi - lo)],
                              'normal': [round(c, 4) for c in nrm.normalized()] if nrm.length > 1e-6 else out[a]['normal'], 'area': round(wa + wb, 4), 'faces': out[a]['faces'] + out[b]['faces']}}
                    del out[b]; cl = True; break
            if cl: break
    return out
for cid in IDS:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f'{nose}/capsule_{cid}.glb')
    O = {o.name: o for o in bpy.data.objects}
    body = O['body']
    prof = {}
    for v in body.data.vertices:
        zb = round(v.co.z / 0.05) * 0.05
        prof[zb] = max(prof.get(zb, 0), math.hypot(v.co.x, v.co.y))
    d = {'bbox_lo': [round(c, 3) for c in (min(v.co.x for v in body.data.vertices), min(v.co.y for v in body.data.vertices), 0)],
         'height': round(max(v.co.z for v in body.data.vertices), 3),
         'profile': [[round(z, 3), round(r, 3)] for z, r in sorted(prof.items())]}
    for name in ['slot_windows', 'slot_windows__panoramic', 'slot_windows__cupola', 'slot_hatch', 'slot_hatch__inward', 'slot_hatch__top',
                 'slot_docking__apas', 'slot_docking__nds', 'slot_docking__ssvp', 'slot_docking__probe_drogue']:
        if name in O: d[name] = islands(O[name])
    res[cid] = d
json.dump(res, open(out, 'w'))
print('OK', {k: {s: len(v) for s, v in d.items() if isinstance(v, list) and s.startswith('slot')} for k, d in res.items()})
