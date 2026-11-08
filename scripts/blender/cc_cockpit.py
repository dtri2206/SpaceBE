"""capsuleCockpit.py internals: per-craft table, cabin shell with window openings, frames, glass, hatches, docking tunnel, cupola; checks, export, preview renders."""
import bpy, bmesh, math, os, json
import numpy as np
from mathutils import Vector, Matrix
from cc_core import *
import cc_core as C

# ---------------------------------------------------------------- per craft table
# crew, head = azimuth (deg, capsule frame as in Role 1's exterior models) of the crew's heads, cmd = commander seat index (left to right as the commander sees it),
# ez = eye height above the heat shield, hull = linear colour of the cabin lining, panel = 'analog' | 'glass' | 'minimal'
CRAFT = {
    'vostok':    dict(crew=1, head=-56,  cmd=0, ez=0.88, hull=(0.30, 0.32, 0.27), panel='analog',  suit='orange', couch=(0.10, 0.10, 0.11), hs=0.84, hatch_default='side'),
    'mercury':   dict(crew=1, head=-55,  cmd=0, ez=0.40, hull=(0.07, 0.075, 0.08), panel='analog', suit='silver', couch=(0.08, 0.08, 0.09), hs=0.84, hatch_default='side'),
    'gemini':    dict(crew=2, head=-56,  cmd=0, ez=0.47, hull=(0.10, 0.105, 0.11), panel='analog', suit='white',  couch=(0.06, 0.06, 0.07), hs=0.88, hatch_default='side'),
    'apollo':    dict(crew=3, head=-56,  cmd=0, ez=0.55, hull=(0.55, 0.50, 0.40), panel='analog',  suit='white',  couch=(0.66, 0.60, 0.46), hs=1.0, hatch_default='side'),
    'soyuz':     dict(crew=3, head=-76,  cmd=1, ez=0.44, hull=(0.20, 0.23, 0.26), panel='analog',  suit='white',  couch=(0.10, 0.11, 0.16), hs=0.9, hatch_default='top'),
    'shenzhou':  dict(crew=3, head=-90,  cmd=1, ez=0.40, hull=(0.20, 0.22, 0.20), panel='glass',   suit='white',  couch=(0.12, 0.12, 0.14), hs=0.9, hatch_default='top'),
    'orion':     dict(crew=4, head=-56,  cmd=1, ez=0.56, hull=(0.28, 0.28, 0.29), panel='glass',   suit='orange', couch=(0.10, 0.10, 0.12), hs=1.0, hatch_default='side'),
    'dragon':    dict(crew=4, head=-56,  cmd=1, ez=0.50, hull=(0.30, 0.31, 0.32), panel='glass',   suit='white',  couch=(0.07, 0.07, 0.08), hs=1.0, hatch_default='side'),
    'starliner': dict(crew=4, head=34,   cmd=1, ez=0.55, hull=(0.24, 0.27, 0.32), panel='glass',   suit='blue',   couch=(0.08, 0.10, 0.16), hs=1.0, hatch_default='side'),
    'gaganyaan': dict(crew=3, head=-56,  cmd=1, ez=0.42, hull=(0.22, 0.24, 0.26), panel='glass',   suit='orange', couch=(0.12, 0.12, 0.13), hs=0.92, hatch_default='side'),
    'newshepard':dict(crew=6, head=-86,  cmd=0, ez=0.46, hull=(0.34, 0.34, 0.33), panel='minimal', suit='blue',   couch=(0.09, 0.10, 0.12), hs=0.62, hatch_default='side', ring=True),
    'mengzhou':  dict(crew=3, head=-56,  cmd=1, ez=0.52, hull=(0.26, 0.27, 0.30), panel='glass',   suit='white',  couch=(0.10, 0.11, 0.14), hs=1.0, hatch_default='side'),
}
STYLES = ['small', 'panoramic', 'cupola']
HATCHES = ['side', 'inward', 'top']
SKIN = 0.07   # inner skin sits this far inside the exterior surface


class Ctx:
    """Everything about one craft: frame conversion capsule -> game, the inner-skin radius function, windows and hatches in capsule coordinates."""
    def __init__(self, cid, lay):
        self.cid, self.lay, self.p = cid, lay, dict(CRAFT[cid])
        p = self.p
        self.H = lay['height']
        prof = sorted((z, r) for z, r in lay['profile'])
        zs = np.array([z for z, r in prof]); rs = np.array([r for z, r in prof])
        k = 2
        rm = np.array([np.median(rs[max(0, i - k):i + k + 1]) for i in range(len(rs))])
        self.zs, self.rs = zs, rm
        a = math.radians(p['head'])
        self.hv = Vector((math.cos(a), math.sin(a), 0))             # head direction (capsule frame)
        self.rv = Vector((-math.sin(a), math.cos(a), 0))            # the commander's right
        self.ring = p.get('ring', False)
        self.compute_layout()

    def rin(self, z):
        z = min(max(z, self.zs[0]), self.zs[-1])
        return float(np.interp(z, self.zs, self.rs)) - SKIN

    def compute_layout(self):
        p = self.p
        n = p['crew']
        ez = p['ez']
        r0 = self.rin(ez)
        k = p['hs']
        self.kl = p.get('kl', min(1.0, k))
        if self.ring:
            hd = r0 * 0.74
            sp = 0.0
            self.seat_ang = [-86 + 60 * i for i in range(6)]
        else:
            hd = min(0.52, max(0.22, r0 * 0.56))
            chord = math.sqrt(max(0.05, r0 * r0 - hd * hd))
            sp = 0.0 if n == 1 else min(0.52 * k + 0.02, (chord - 0.22 * k) / ((n - 1) / 2.0))
        self.hd, self.sp, self.k = hd, sp, k
        # commander eye (capsule frame)
        lat = 0.0 if n == 1 or self.ring else (p['cmd'] - (n - 1) / 2.0) * sp
        if self.ring:
            a = math.radians(self.seat_ang[p['cmd']])
            self.hv = Vector((math.cos(a), math.sin(a), 0)); self.rv = Vector((-math.sin(a), math.cos(a), 0))
            self.e = Vector((hd * self.hv.x, hd * self.hv.y, ez))
        else:
            self.e = self.hv * hd + self.rv * lat + Vector((0, 0, ez))
        # game <- capsule
        self.A = Matrix((tuple(self.rv), tuple(self.hv), (0, 0, -1)))

    def g(self, p):
        """capsule point -> game point"""
        return self.A @ (Vector(p) - self.e)
    def gv(self, v):
        return self.A @ Vector(v)
    def cap_of_game(self, q):
        return self.A.inverted() @ Vector(q) + self.e

    def skin_point(self, c, n):
        """Point where the line c + s*n meets the inner skin (capsule frame)."""
        n = Vector(n).normalized()
        best = None
        prev = None
        s_ = -0.7
        while s_ <= 0.5:
            q = c + n * s_
            f = math.hypot(q.x, q.y) - self.rin(q.z)
            if prev is not None and prev[1] * f <= 0:
                return c + n * (prev[0] + (s_ - prev[0]) * (abs(prev[1]) / (abs(prev[1]) + abs(f) + 1e-9)))
            prev = (s_, f)
            s_ += 0.005
        return c - n * 0.07

    # openings of one window style, capsule frame: dict(c, n, t, b, w, h, round)
    def windows(self, style):
        key = {'small': 'slot_windows', 'panoramic': 'slot_windows__panoramic', 'cupola': 'slot_windows__cupola'}[style]
        out = []
        for isl in self.lay[key]:
            c = Vector(isl['centre']); nrm = Vector(isl['normal'])
            if style == 'cupola':
                continue
            t = Vector((0, 0, 1)).cross(nrm).normalized()
            b = nrm.cross(t)
            w, h = isl['ext'][0], isl['ext'][1]
            c = self.skin_point(c, nrm)
            out.append(dict(c=c, n=nrm, t=t, b=b, w=w * 0.80, h=h * 0.80, fw=w, fh=h, round=(abs(w - h) < 0.25 * max(w, h) and max(w, h) < 0.36)))
        return out

    def hatch(self, kind):
        key = {'side': 'slot_hatch', 'inward': 'slot_hatch__inward', 'top': 'slot_hatch__top'}[kind]
        isl = max(self.lay[key], key=lambda i: i['ext'][0] * i['ext'][1])
        c = Vector(isl['centre']); nrm = Vector(isl['normal'])
        if kind == 'top':
            return dict(c=c, n=Vector((0, 0, 1)), t=Vector((1, 0, 0)), b=Vector((0, 1, 0)), w=isl['ext'][0], h=isl['ext'][1])
        t = Vector((0, 0, 1)).cross(nrm).normalized()
        b = nrm.cross(t)
        return dict(c=self.skin_point(c, nrm), n=nrm, t=t, b=b, w=isl['ext'][0], h=isl['ext'][1])


# ---------------------------------------------------------------- shell
def shell_profile(ctx, style):
    """[(r, z)] of the inner skin from the floor to the tunnel throat (or the cupola ring)."""
    z0 = 0.04
    rt = 0.34
    pts = [(ctx.rin(z0), z0)]
    z = z0
    top = None
    limit = 0.46 if style == 'cupola' else rt
    while z < ctx.H - 0.05:
        z = min(z + 0.08, ctx.H - 0.05)
        r = ctx.rin(z)
        if r <= limit + 0.01:
            top = z
            break
        pts.append((r, z))
    if top is None:
        top = pts[-1][1]
    r_top = min(ctx.rin(top), limit if style != 'cupola' else 0.42)
    pts.append((r_top, top))
    return pts, top, r_top


def lathe_bm(profile, seg=56):
    bm = bmesh.new()
    rows = []
    for r, z in profile:
        rows.append([bm.verts.new((r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg), z)) for i in range(seg)])
    for j in range(len(profile) - 1):
        for i in range(seg):
            # inward facing normals
            bm.faces.new((rows[j][i], rows[j + 1][i], rows[j + 1][(i + 1) % seg], rows[j][(i + 1) % seg]))
    return bm, rows


def rrect_outline(w, h, rad, n=4, circle=False, nc=20):
    if circle:
        return [(0.5 * w * math.cos(2 * math.pi * i / nc), 0.5 * h * math.sin(2 * math.pi * i / nc)) for i in range(nc)]
    return rrect_pts(w, h, rad, n)


def prism_bm(pts2, origin, t, b, n, d0, d1):
    """Extrude a 2D outline (t, b plane) along n from d0 to d1 (capsule frame)."""
    bm = bmesh.new()
    k = len(pts2)
    ring0 = [bm.verts.new(origin + t * x + b * y + n * d0) for x, y in pts2]
    ring1 = [bm.verts.new(origin + t * x + b * y + n * d1) for x, y in pts2]
    for i in range(k):
        bm.faces.new((ring0[i], ring0[(i + 1) % k], ring1[(i + 1) % k], ring1[i]))
    bm.faces.new(ring0[::-1]); bm.faces.new(ring1)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def cut_shell(ctx, style, hull_mat, grp):
    """Build the inner skin of one window style: lathe, boolean-cut by every opening, floor, convert to game coords."""
    prof, top, r_top = shell_profile(ctx, style)
    bm, rows = lathe_bm(prof)
    # floor disc (faces the cabin)
    ctr = bm.verts.new((0, 0, prof[0][1]))
    for i in range(len(rows[0])):
        bm.faces.new((ctr, rows[0][(i + 1) % len(rows[0])], rows[0][i]))
    me = bpy.data.meshes.new('shell_tmp'); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('shell_tmp', me); C.col.objects.link(ob)
    cutters = []
    if style != 'cupola':
        for w in ctx.windows(style):
            pts = rrect_outline(w['w'], w['h'], 0.04, circle=w['round'])
            bmc = prism_bm(pts, w['c'], w['t'], w['b'], w['n'], -0.25, 0.25)
            cm = bpy.data.meshes.new('cut'); bmc.to_mesh(cm); bmc.free()
            co = bpy.data.objects.new('cut', cm); C.col.objects.link(co); cutters.append(co)
    if ctx.cid == 'apollo':
        import cc_aft
        ac, ar = cc_aft.cut_hole(ctx)
        bmc = prism_bm(rrect_outline(2 * ar, 2 * ar, 0.0, circle=True, nc=40), ac, Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)), -0.25, 0.25)
        cm = bpy.data.meshes.new('cut'); bmc.to_mesh(cm); bmc.free()
        co = bpy.data.objects.new('cut', cm); C.col.objects.link(co); cutters.append(co)
    for co in cutters:
        md = ob.modifiers.new('b', 'BOOLEAN'); md.object = co; md.operation = 'DIFFERENCE'; md.solver = 'EXACT'; md.use_hole_tolerant = True
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = ob.evaluated_get(dg)
        new = bpy.data.meshes.new_from_object(ev)
        ob.modifiers.remove(md)
        ob.data = new
    # export to lists, convert to game
    m = ob.data
    verts = [tuple(ctx.g(v.co)) for v in m.vertices]
    faces = [tuple(p.vertices) for p in m.polygons]
    for o in cutters + [ob]:
        bpy.data.objects.remove(o, do_unlink=True)
    part = Part('shell_' + style, parent=grp)
    part.add(hull_mat, (verts, faces))
    return part, top, r_top


def opening_geometry(ctx, w, parent, frame_mat, glass_mat, trim_mat, tag):
    """Liner tube + inner lip + gasket + glass for one window opening."""
    p = Part(f'frame_{tag}', parent=parent)
    pg = Part(f'glass_{tag}', parent=parent)
    n = ctx.gv(w['n']); t = ctx.gv(w['t']); b = ctx.gv(w['b'])
    c = ctx.g(w['c'])
    pts = rrect_outline(w['w'], w['h'], 0.04, circle=w['round'])
    pts_out = rrect_outline(w['w'] + 0.07, w['h'] + 0.07, 0.06, circle=w['round'])
    M = Matrix(((t.x, b.x, n.x), (t.y, b.y, n.y), (t.z, b.z, n.z)))
    def ring3(pts2, d):
        return [tuple(c + t * x + b * y + n * d) for x, y in pts2]
    k = len(pts)
    # liner: hole outline from the cabin side lip (-depth_in) to just behind the glass (-0.0)
    r_a = ring3(pts, -0.012); r_b = ring3(pts, 0.07)
    v = r_a + r_b
    f = [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)]      # inward facing (toward the opening axis)
    p.add(frame_mat, finish(v, f, 0, closed=False))
    # lip: flat ring between the hole outline and the larger outline, proud toward the cabin
    lip_in = ring3(pts, -0.024); lip_out = ring3(pts_out, -0.012)
    v = lip_in + lip_out + r_a
    f = []
    for i in range(k):
        j = (i + 1) % k
        f.append((i, k + i, k + j, j))               # front (cabin facing) of the lip: slanted bevel
        f.append((2 * k + i, 2 * k + j, j, i))       # inner face of the lip
    p.add(trim_mat, (v, f))
    # glass + gasket
    gl = ring3(pts, 0.05)
    pg.add(glass_mat, (gl, [tuple(range(k))]))
    pg.add(glass_mat, (gl[::-1], [tuple(range(k))]))
    return p, pg


def cupola_geometry(ctx, grp, top, r_top, frame_mat, glass_mat, trim_mat):
    H = ctx.H
    zb = top
    hgt = max(0.22, min(0.36, H - zb - 0.01))
    rr = r_top
    p = Part('frame_cupola', parent=grp); pg = Part('glass_cupola', parent=grp)
    seg = 24
    # dome: quarter ellipse from the ring up to the apex (capsule frame -> game)
    prof = []
    for k in range(0, 7):
        a = math.radians(90 * k / 6)
        prof.append((rr * math.cos(a) * 1.0, zb + hgt * math.sin(a)))
    verts = []; faces = []
    for (r, z) in prof:
        for i in range(seg):
            th = 2 * math.pi * i / seg
            verts.append(tuple(ctx.g((r * math.cos(th), r * math.sin(th), z))))
    for j in range(len(prof) - 1):
        for i in range(seg):
            i2 = (i + 1) % seg
            faces.append((j * seg + i, j * seg + i2, (j + 1) * seg + i2, (j + 1) * seg + i))
    pg.add(glass_mat, (verts, faces))
    pg.add(glass_mat, (verts, [f[::-1] for f in faces]))
    # ring and ribs
    ring = []
    for i in range(seg):
        th = 2 * math.pi * i / seg
        ring.append(tuple(ctx.g((rr * math.cos(th), rr * math.sin(th), zb))))
    for i in range(seg):
        p.strut(frame_mat, Vector(ring[i]), Vector(ring[(i + 1) % seg]), 0.025, n=6)
    for r_i in range(6):
        th = math.pi * 2 * r_i / 6
        pts = [ctx.g((rr * math.cos(a) * math.cos(th), rr * math.cos(a) * math.sin(th), zb + hgt * math.sin(a))) for a in [math.radians(90 * k / 6) for k in range(7)]]
        for i in range(6):
            p.strut(frame_mat, pts[i], pts[i + 1], 0.016, n=6)
    return p, pg


# ---------------------------------------------------------------- hatches and the docking tunnel
def door_part(ctx, kind, grp, mats, top=None, r_top=0.34, z_end=None):
    """Hinged door + rim + handle wheel (+ the empties the egress needs). Pivot at the hinge edge; local x along the door, y = hinge axis, z = outward."""
    h = ctx.hatch(kind)
    if kind == 'top':
        h['c'] = Vector((0, 0, z_end - 0.03))
    n = ctx.gv(h['n']); t = ctx.gv(h['t']); b = ctx.gv(h['b'])
    c = ctx.g(h['c'])
    inward = kind == 'inward'
    depth = 0.0 + (0.035 if inward else 0.0)
    if kind == 'top':
        r = r_top - 0.015
        hinge = c + t * r + n * 0.0
        rot = Matrix(((-t.x, b.x, n.x), (-t.y, b.y, n.y), (-t.z, b.z, n.z)))      # local x points from the hinge across the door
        w_, h_ = 2 * r, 2 * r
    else:
        w_, h_ = h['w'] * 0.86, h['h'] * 0.86
        hinge = c - t * (w_ / 2) + n * depth
        rot = Matrix(((t.x, b.x, n.x), (t.y, b.y, n.y), (t.z, b.z, n.z)))
    if rot.determinant() < 0:
        rot = Matrix(((-t.x, -b.x, n.x), (-t.y, -b.y, n.y), (-t.z, -b.z, n.z)))
    door = Part('door_' + kind, pos=hinge, rot=rot, parent=grp)
    fixed = Part('hatchframe_' + kind, parent=grp)
    m_door, m_rim, m_dark, m_steel = mats['door'], mats['trim'], mats['frame'], mats['steel']
    if kind == 'top':
        # round door: disc with a dished centre, rim, handle wheel
        r_in = r
        prof = [(0, 0.0), (r_in * 0.2, 0.0), (r_in * 0.2, 0.02), (r_in, 0.02), (r_in, -0.03), (0, -0.03)]
        g = lathe_geo([(a, bb) for a, bb in prof], 28)
        M = Matrix(((0, 0, 1), (0, 1, 0), (1, 0, 0)))
        door.add(m_door, xform(g, M, (r, 0, 0.0)))
        door.cyl(m_rim, r_in * 0.1, 0.05, r, 0, -0.045, n=14)
        rim = [(r + (r_in + 0.02) * math.cos(2 * math.pi * i / 28), (r_in + 0.02) * math.sin(2 * math.pi * i / 28), 0.01) for i in range(28)]
        fixed.add(m_rim, sweep([hinge + rot @ Vector(p) for p in rim], circle_profile(0.02, 6), closed=True))
        wheel_c = Vector((r, 0, -0.06))
        wheel_r = r_in * 0.35
    else:
        # door slab, rim, window cut-out when a small window sits in the door
        slab = [(x, y) for x, y in rrect_pts(w_, h_, 0.07, 3)]
        slab = [(x + w_ / 2, y) for x, y in slab]
        holes = []
        for win in ctx.windows('small'):
            cc = ctx.g(win['c'])
            d = cc - c
            if abs(d.dot(n)) < 0.3 and abs(d.dot(t)) < h['w'] / 2 and abs(d.dot(b)) < h['h'] / 2:
                hole = [(x * 1.12 + d.dot(t) + w_ / 2, y * 1.12 + d.dot(b)) for x, y in rrect_outline(win['w'], win['h'], 0.04, circle=win['round'])]
                holes.append(hole)
        door.add(m_door, plate_geo(slab, holes, 0.035))
        rim = [(x, y, 0.0) for x, y in slab]
        door.add(m_rim, sweep([Vector(p) for p in rim], circle_profile(0.017, 6), closed=True))
        wheel_c = Vector((w_ * 0.5, h_ * 0.08, -0.06))
        wheel_r = min(w_, h_) * 0.17
        # latches along the edge
        for i in range(4):
            door.box(m_steel, 0.05, 0.03, 0.045, w_ - 0.05, (i - 1.5) * h_ * 0.22, -0.03, bevel=0.006)
    # handle wheel + spokes on the cabin side
    door.cyl(m_steel, 0.025, 0.05, wheel_c.x, wheel_c.y, wheel_c.z + 0.02, n=10)
    wp = [Vector((wheel_c.x + wheel_r * math.cos(2 * math.pi * i / 16), wheel_c.y + wheel_r * math.sin(2 * math.pi * i / 16), wheel_c.z)) for i in range(16)]
    door.add(m_steel, sweep(wp, circle_profile(0.011, 5), closed=True))
    for i in range(3):
        a = 2 * math.pi * i / 3 + 0.5
        door.strut(m_steel, wheel_c + Vector((0, 0, 0.0)), wheel_c + Vector((wheel_r * math.cos(a), wheel_r * math.sin(a), 0)), 0.007, n=6)
    if ctx.cid == 'apollo' and kind != 'top':
        # unified crew hatch: ratchet gearbox with its pump handle, latch dogs round the rim
        door.box(m_steel, 0.12, 0.09, 0.06, wheel_c.x, wheel_c.y, wheel_c.z - 0.045, bevel=0.012)
        door.strut(m_steel, wheel_c + Vector((0, 0, -0.08)), wheel_c + Vector((0.2, 0.07, -0.1)), 0.011, 0.011, n=8)
        door.box(m_dark, 0.045, 0.028, 0.022, wheel_c.x + 0.2, wheel_c.y + 0.07, wheel_c.z - 0.1, bevel=0.005)
        door.box(m_dark, 0.07, 0.02, 0.012, wheel_c.x, wheel_c.y - 0.07, wheel_c.z - 0.078)
    # mounting: fixed frame ring on the wall around the opening
    if kind != 'top':
        ring = [(c + t * x + b * y + n * (depth - 0.02)) for x, y in rrect_pts(h['w'] * 0.96, h['h'] * 0.96, 0.08, 3)]
        fixed.add(m_rim, sweep(ring, circle_profile(0.02, 6), closed=True))
        # hinge blocks
        for sy in (-0.3, 0.3):
            hp = c - t * (w_ / 2) + b * (sy * h_) + n * (depth - 0.02)
            fixed.cyl(m_steel, 0.016, 0.07, hp.x, hp.y, hp.z, axis='z', n=8)
    # ladder-top empty: standing eye in front of the hatch, facing it; up = the capsule axis (apex)
    up_game = Vector((0, 0, -1))
    if kind == 'top':
        stand = ctx.g((h['c'].x, h['c'].y, h['c'].z)) + Vector((0, 0, 0.0))
        stand = ctx.g((0, 0, ctx.p['ez'] + 0.5))
        face = Vector((0, 0, -1)); up = Vector((0, 1, 0))   # not standing: looking up the tunnel; up = head
        zax = -face
        xax = up.cross(zax).normalized(); yax = zax.cross(xax)
    else:
        nh = Vector((n.x, n.y, 0)) if False else None
        # horizontal outward direction in capsule frame, back to game
        nc = Vector((h['n'].x, h['n'].y, 0)).normalized()
        ng = ctx.gv(nc)
        stand_c = Vector((h['c'].x, h['c'].y, h['c'].z + 0.2)) - nc * 0.55
        stand = ctx.g(stand_c)
        zax = -ng
        yax = up_game
        xax = yax.cross(zax).normalized(); yax = zax.cross(xax)
    plug = Part('plug_' + kind, parent=grp)
    if kind == 'top':
        pc = ctx.g((0, 0, z_end + 0.02))
        pn = ctx.gv((0, 0, 1))
        plug.add('sky', xform(lathe_geo([(0, 0), (r_top, 0)], 24), basis_from_dir(pn) @ Matrix(((0, 0, 1), (0, 1, 0), (1, 0, 0))), pc))
    else:
        pc = c + n * 0.03
        plug.quad('sky', h['w'] * 0.8, h['h'] * 0.8, 0, 0, 0, rot=Matrix(((t.x, b.x, n.x), (t.y, b.y, n.y), (t.z, b.z, n.z))))
        plug.pos = pc
        plug.m = {k_: v_ for k_, v_ in plug.m.items()}
    lad = Part('ladderTop_' + kind, pos=stand, rot=Matrix(((xax.x, yax.x, zax.x), (xax.y, yax.y, zax.y), (xax.z, yax.z, zax.z))), parent=grp)
    return door, fixed, lad


def plate_geo(outer, holes, thick):
    """Flat slab (in x,y) with holes: front (+z) and back faces and the outer side wall."""
    from mathutils.geometry import tessellate_polygon
    polys = [[Vector((x, y, 0)) for x, y in outer]] + [[Vector((x, y, 0)) for x, y in hl] for hl in holes]
    tris = tessellate_polygon(polys)
    pts = [p for poly in polys for p in poly]
    v, f = [], []
    for p in pts:
        v.append((p.x, p.y, thick * 0.5))
    for p in pts:
        v.append((p.x, p.y, -thick * 0.5))
    n = len(pts)
    for t in tris:
        f.append((t[0], t[1], t[2])); f.append((t[2] + n, t[1] + n, t[0] + n))
    k = len(outer)
    for i in range(k):
        j = (i + 1) % k
        f.append((i, i + n, j + n, j))
    off = k
    for hl in holes:
        m = len(hl)
        for i in range(m):
            j = (i + 1) % m
            f.append((off + j, off + j + n, off + i + n, off + i))
        off += m
    return v, f


def docking_tunnel(ctx, top, r_top, mats, hatch_kind_default):
    """Tunnel from the shell throat up to the apex plus its end cap (plain dock cap) and the top hatch."""
    z_end = min(ctx.H - 0.03, top + 0.42)
    z_end = max(z_end, top + 0.14)
    tun = Part('docking')
    prof = [(r_top, top), (r_top, z_end)]
    verts, faces = [], []
    seg = 28
    for r, z in prof:
        for i in range(seg):
            th = 2 * math.pi * i / seg
            verts.append(tuple(ctx.g((r * math.cos(th), r * math.sin(th), z))))
    for i in range(seg):
        i2 = (i + 1) % seg
        faces.append((i, seg + i, seg + i2, i2))
    tun.add(mats['hull'], (verts, faces))
    # ribs, handrails, lamp
    for zz in (top + 0.1, z_end - 0.06):
        ring = [ctx.g((r_top * 0.985 * math.cos(2 * math.pi * i / seg), r_top * 0.985 * math.sin(2 * math.pi * i / seg), zz)) for i in range(seg)]
        tun.add(mats['trim'], sweep(ring, circle_profile(0.013, 5), closed=True))
    for k in range(4):
        th = math.pi / 4 + k * math.pi / 2
        a = ctx.g((r_top * 0.97 * math.cos(th), r_top * 0.97 * math.sin(th), top + 0.04))
        b_ = ctx.g((r_top * 0.97 * math.cos(th), r_top * 0.97 * math.sin(th), z_end - 0.03))
        tun.strut(mats['steel'], a, b_, 0.008, n=6)
    cap = Part('dock_cap')
    c0 = ctx.g((0, 0, z_end))
    ax = ctx.gv((0, 0, 1))
    M = basis_from_dir(ax) @ Matrix(((0, 0, 1), (0, 1, 0), (1, 0, 0)))
    g = lathe_geo([(0, 0), (r_top, 0), (r_top, 0.0), (r_top * 0.92, -0.04), (r_top * 0.9, -0.04), (0, -0.04)][::-1] if False else [(0, -0.05), (r_top * 0.55, -0.05), (r_top * 0.62, -0.025), (r_top, 0.0), (0, 0.0)], 28)
    cap.add(mats['door'], xform(g, M, c0))
    cap.strut(mats['steel'], c0 - ax * 0.05, c0 - ax * 0.09, 0.05, 0.035, n=10)
    for i in range(6):
        th = 2 * math.pi * i / 6
        p_ = ctx.g((0.6 * r_top * math.cos(th), 0.6 * r_top * math.sin(th), z_end - 0.04))
        cap.cyl(mats['steel'], 0.012, 0.03, p_.x, p_.y, p_.z, axis='z', n=6)
    return tun, cap, z_end


# ---------------------------------------------------------------- orchestration
def define_mats(ctx):
    p = ctx.p
    hull = p['hull']
    material('hull', hull, 0.85, spec=0.2)
    material('trim', tuple(c * 0.5 + 0.05 for c in hull), 0.55, 0.3)
    material('door', tuple(min(1, c * 1.15 + 0.01) for c in hull), 0.6, 0.1)
    material('frame', (0.03, 0.03, 0.034), 0.5, 0.3)
    material('steel', (0.38, 0.38, 0.4), 0.35, 0.9)
    material('rubber', (0.012, 0.012, 0.014), 0.8)
    glass_material('glass', 0.10)
    material('sky', (0.35, 0.5, 0.65), 1.0, emit=(0.55, 0.75, 1.0), emit_strength=1.0)
    return dict(hull='hull', trim='trim', door='door', frame='frame', steel='steel', glass='glass')


def build_capsule(cid, lay, out):
    k_override = None
    for attempt in range(14):
        reset_scene()
        ctx = Ctx(cid, lay)
        if k_override:
            ctx.p['hs'], ctx.p['kl'] = k_override
            ctx.compute_layout()
        mats = define_mats(ctx)
        root = Part('cabin')     # empty root that carries the eye as the origin
        groups = {}
        tops = {}
        for style in STYLES:
            grp = Part('win_' + style, parent=root)
            groups[style] = grp
            shell, top, r_top = cut_shell(ctx, style, mats['hull'], grp)
            tops[style] = (top, r_top)
            if style == 'cupola':
                cupola_geometry(ctx, grp, top, r_top, mats['frame'], mats['glass'], mats['trim'])
            else:
                for k, w in enumerate(ctx.windows(style)):
                    opening_geometry(ctx, w, grp, mats['frame'], mats['glass'], mats['trim'], f'{style}{k}')
        top, r_top = tops['small']
        tun, cap, z_end = docking_tunnel(ctx, top, r_top, mats, None)
        tun.parent = cap.parent = 'cabin'
        for kind in HATCHES:
            grp = Part('hatch_' + kind, parent=root)
            door_part(ctx, kind, grp, mats, top, r_top, z_end)
        import cc_crew, cc_panel
        cc_crew.build(ctx, root, mats)
        cc_panel.build(ctx, root, mats)
        if cid == 'apollo':
            import cc_apollo
            cc_apollo.build(ctx, root, mats, groups, tops, z_end)
            import cc_aft
            cc_aft.build(ctx, root, mats)
        worst, bad = fit_check(ctx)
        C.log(f'attempt {attempt}: crew scale {ctx.k:.2f}, worst wall overshoot {worst * 100:.1f} cm in {bad}')
        if worst < 0.012 or (ctx.k <= 0.6 and ctx.kl <= 0.5):
            break
        k_override = (ctx.k, round(ctx.kl - 0.05, 3)) if ctx.kl > 0.5 else (round(ctx.k - 0.04, 3), ctx.kl)
    finish_export(ctx, out)


def fit_check(ctx):
    """Every vertex of the crew, couches and controllers must lie inside the inner skin (and above the floor)."""
    worst, bad = 0.0, ''
    for nm, p in PARTS.items():
        if not (nm.startswith(('seat', 'arm', 'glove')) or nm in ('stick', 'throttle')):
            continue
        for mat, d in p.m.items():
            for v in d['v']:
                w = p.pos + p.rot @ Vector(v)
                c = ctx.cap_of_game(w)
                over = math.hypot(c.x, c.y) - ctx.rin(c.z)
                if c.z < 0.04:
                    over = max(over, 0.04 - c.z)
                if c.z > ctx.H - 0.1:
                    over = max(over, c.z - (ctx.H - 0.1))
                if over > worst:
                    worst, bad = over, nm
    return worst, bad


def finish_export(ctx, out):
    C.log('parts', len(PARTS), 'triangles', sum(p.tris() for p in PARTS.values()))
    for nm, pp in sorted(PARTS.items(), key=lambda kv: -kv[1].tris())[:10]:
        C.log('   ', nm, pp.tris())
    objs = build_objects()
    scan_leaks(ctx, objs)
    if out:
        export_glb(out, objs, 'cabin')
    shots = arg('--shots')
    if shots:
        VIEWS = [('1-default', 0, 0, None), ('2-left', -65, 0, None), ('3-right', 65, 0, None), ('4-up', 0, 40, None), ('5-down', 0, -50, None), ('6-back', 0, 0, (0, 0, 0))]
        if arg('--views'):     # name,yaw,pitch,x,y,z;...  (game frame, eye = origin)
            vs = []
            for item in arg('--views').split(';'):
                f_ = item.split(',')
                vs.append((f_[0], float(f_[1]), float(f_[2]), tuple(float(q) for q in f_[3:6])))
            render_views(ctx, objs, os.path.join(shots, 'small'), vs, styles=['small'], hatch=ctx.p['hatch_default'])
        else:
            for st in STYLES:
                render_views(ctx, objs, os.path.join(shots, st), [(f'{st}_{v[0]}',) + v[1:] for v in VIEWS[:5]], styles=[st], hatch=ctx.p['hatch_default'])


# ---------------------------------------------------------------- preview renders (Eevee, from the commander's eye)
def render_views(ctx, objs, outdir, views, samples=24, styles=None, hatch='side'):
    os.makedirs(outdir, exist_ok=True)
    sc = bpy.context.scene
    try:
        sc.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x, sc.render.resolution_y = 1280, 800
    sc.render.image_settings.file_format = 'JPEG'
    if hasattr(sc.eevee, 'taa_render_samples'):
        sc.eevee.taa_render_samples = samples
    w = bpy.data.worlds.new('w'); w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.5, 0.7, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.25
    sc.world = w
    def light(name, pos, watts, color=(1, 0.95, 0.9), size=0.1):
        l = bpy.data.lights.new(name, 'POINT'); l.energy = watts; l.color = color; l.shadow_soft_size = size
        o = bpy.data.objects.new(name, l); C.col.objects.link(o); o.location = G(pos)
    light('l0', (0, 0.3, -0.3), 12); light('l1', (0, -0.4, -0.9), 8); light('l2', (0.5, 0.2, -0.5), 5)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); C.col.objects.link(cam); sc.camera = cam
    cam.data.angle_y = math.radians(65); cam.data.sensor_fit = 'VERTICAL'; cam.data.clip_start = 0.03
    def show(style, hk):
        for s_ in STYLES:
            for o in objs.values():
                pass
        for name, o in objs.items():
            vis = True
            for s_ in STYLES:
                if name == 'win_' + s_ or _under(o, 'win_' + s_):
                    vis = (s_ == style)
            for h_ in HATCHES:
                if name == 'hatch_' + h_ or _under(o, 'hatch_' + h_):
                    vis = (h_ == hk)
            if name == 'docking':
                vis = style != 'cupola'
            if name == 'dock_cap':
                vis = style != 'cupola' and hk != 'top'
            o.hide_render = not vis
    def _under(o, nm):
        while o.parent:
            o = o.parent
            if o.name == nm:
                return True
        return False
    style = styles[0] if styles else 'small'
    show(style, hatch)
    for name, yaw, pitch, pos in views:
        # yaw right, pitch up, game frame, looking along -Z by default
        y, p = math.radians(yaw), math.radians(pitch)
        d = Vector((math.sin(y) * math.cos(p), math.sin(p), -math.cos(y) * math.cos(p)))
        db = Vector(G(d))
        cam.location = Vector(G(pos or (0, 0, 0)))
        cam.rotation_euler = db.to_track_quat('-Z', 'Z').to_euler()
        sc.render.filepath = os.path.join(outdir, name + '.jpg')
        bpy.ops.render.render(write_still=True)
    C.log('rendered', len(views), 'views to', outdir)


def _under(o, nm):
    while o.parent:
        o = o.parent
        if o.name == nm:
            return True
    return False


def set_variant(objs, style, hatch):
    for name, o in objs.items():
        vis = True
        for s_ in STYLES:
            if name == 'win_' + s_ or _under(o, 'win_' + s_):
                vis = (s_ == style)
        for h_ in HATCHES:
            if name == 'hatch_' + h_ or _under(o, 'hatch_' + h_):
                vis = (h_ == hatch)
        if name == 'docking':
            vis = style != 'cupola'
        if name == 'dock_cap':
            vis = style != 'cupola' and hatch != 'top'
        if name.startswith('plug_'):
            vis = False
        o.hide_viewport = not vis
        o.hide_render = not vis
    bpy.context.view_layer.update()


def scan_leaks(ctx, objs):
    """Rays over the whole sphere from the commander's eye and head offsets: every ray must hit the cabin (glass counts as a hit)."""
    sc = bpy.context.scene
    total = 0
    for style in STYLES:
        set_variant(objs, style, 'side')
        dg = bpy.context.evaluated_depsgraph_get()
        leaks = 0
        offs = [(0, 0, 0)] + [(sx * 0.08, sy * 0.08, sz * 0.05) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
        for off in offs:
            o = Vector(G(off))
            for yaw in range(-180, 180, 6):
                for pitch in range(-88, 90, 6):
                    y, pi = math.radians(yaw), math.radians(pitch)
                    d = Vector(G((math.sin(y) * math.cos(pi), math.sin(pi), -math.cos(y) * math.cos(pi))))
                    ok = sc.ray_cast(dg, o, d, distance=50)[0]
                    if not ok:
                        leaks += 1
        C.log(f'LEAK SCAN {style}: {leaks} of {len(offs) * 60 * 30} rays escape')
        total += leaks
    set_variant(objs, 'small', 'side')
    for o in objs.values():
        o.hide_viewport = False; o.hide_render = False
    return total
