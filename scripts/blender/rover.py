"""
SpaceB&E crewed Mars rover (MR-01), modelled in Blender and exported to public/assets/models/rover.glb.

Regenerate (Blender 5.2, nothing else needed):

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/blender/rover.py -- \
      --out public/assets/models/rover.glb [--shots DIR] [--engine BLENDER_EEVEE|CYCLES] [--no-render]

Game contract (src/surface/roverModel.js drives the model): metres, +Y up, forward -Z, +X right, origin on the ground at
the centre of wheelbase (2.29) and track (1.83), wheels rest on y = 0, no root transform. Four pivots wheelFL/FR/RL/RR at
(+-0.915, 0.41, -+1.145); each pivot's FIRST child is the spinning wheel node (<pivot>_spin), symmetric around the X axle.

All geometry is written in GAME coordinates (x right, y up, z back) and converted once to Blender (x, -z, y), which the
glTF exporter (+Y up) maps back to the same game coordinates. Edges are bevelled (angle limited, 1-3 segments, same
algorithm as the Bevel modifier, applied through bmesh so no objects are needed), parts are merged into one mesh with one
slot per material, and image textures (tyre knit + normal map, solar cells, grille, dash screens) are generated here.
"""
import bpy, bmesh, math, os, sys, tempfile
import numpy as np
from mathutils import Vector, Matrix, Euler

# ------------------------------------------------------------------ args
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
OUT = os.path.abspath(arg('--out', 'public/assets/models/rover.glb'))
SHOTS = arg('--shots')
ENGINE = arg('--engine', 'BLENDER_EEVEE')
RENDER = '--no-render' not in argv and SHOTS is not None

WHEELBASE, TRACK, R = 2.29, 1.83, 0.41
HB, HT = WHEELBASE / 2, TRACK / 2
HW = 0.8
ZF, ZR = -1.65, 1.8
TMP = tempfile.mkdtemp(prefix='rover_tex_')

# ------------------------------------------------------------------ scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
col = bpy.data.collections.new('ROVER')
scene.collection.children.link(col)

def G(p):  # game (x, y, z) -> blender (x, -z, y)
    return (p[0], -p[2], p[1])

# ------------------------------------------------------------------ generated textures
def make_image(name, arr):
    """arr: float array (h, w, 4) in 0..1, saved as PNG and packed."""
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.pixels.foreach_set(np.flipud(arr).astype(np.float32).ravel())
    img.filepath_raw = os.path.join(TMP, name + '.png')
    img.file_format = 'PNG'
    img.save()
    img.pack()
    return img

def knit_height(n=256):
    """One 256 px tile: a fine knit of V stitches (16 x 8 px) with a chevron tread groove every 128 px."""
    yy, xx = np.mgrid[0:n, 0:n]
    xp, yp = (xx % 16).astype(float), (yy % 8).astype(float)
    line = 1 + 6 * (1 - np.abs(xp - 8) / 8)
    d = np.minimum.reduce([np.abs(yp - line), np.abs(yp - line + 8), np.abs(yp - line - 8)])
    knit = np.clip(1 - d / 2.4, 0, 1) ** 0.8
    # chevron grooves: lines y = 0.7 * |x - 128| (mod 128 in y), 7 px wide, across the tile
    g = np.abs(((yy - 0.55 * np.abs((xx % 256) - 128)) % 128) - 64)
    groove = np.clip((g - 52) / 6.0, 0, 1)   # 1 on the lug, 0 inside the groove
    groove = np.clip(1 - np.clip((5 - np.abs(((yy - 0.55 * np.abs((xx % 256) - 128)) % 128) - 0)) / 4.0, 0, 1), 0, 1)
    return knit * (0.6 + 0.4 * groove), groove

def tyre_textures():
    h, groove = knit_height()
    dark, light = 0.17, 0.74
    v = (dark + (light - dark) * h) * (0.75 + 0.25 * groove)
    albedo = np.stack([v * 0.97, v, v * 1.03, np.ones_like(v)], -1).clip(0, 1)
    gy, gx = np.gradient(h)
    nx, ny, nz = -gx * 5.0, gy * 5.0, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    normal = np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5, np.ones_like(h)], -1)
    return make_image('tyre_knit', albedo), make_image('tyre_knit_n', normal)

def carbon_normal(n=128):
    """2x2 twill carbon weave as a tangent-space normal map (tiles)."""
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    cell = 16
    flip = (((xx // cell) + (yy // cell)) % 2) == 0
    t = np.where(flip, xx + yy, xx - yy)
    h = 0.5 + 0.5 * np.sin(2 * np.pi * t / 8.0)
    h *= 0.8 + 0.2 * np.sin(2 * np.pi * np.where(flip, xx - yy, xx + yy) / cell)
    gy, gx = np.gradient(h)
    nx, ny, nz = -gx * 1.0, gy * 1.0, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return make_image('carbon_n', np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5, np.ones_like(h)], -1))

def solar_texture():
    w, h = 512, 256
    yy, xx = np.mgrid[0:h, 0:w]
    img = np.zeros((h, w, 4)); img[..., 3] = 1
    cell = (xx % 32 >= 2) & (xx % 32 < 30) & (yy % 32 >= 2) & (yy % 32 < 30)
    img[..., 0] = np.where(cell, 0.04, 0.45); img[..., 1] = np.where(cell, 0.09, 0.50); img[..., 2] = np.where(cell, 0.28, 0.58)
    bus = (xx % 128 < 3)
    img[bus] = (0.7, 0.75, 0.82, 1)
    return make_image('solar', img)

def grille_texture():
    n = 32
    img = np.zeros((n, n, 4)); img[..., 3] = 1
    img[..., :3] = (0.04, 0.05, 0.06)
    edge = np.zeros((n, n), bool); edge[:3, :] = edge[-3:, :] = edge[:, :3] = edge[:, -3:] = True
    img[edge] = (0.52, 0.57, 0.62, 1)
    return make_image('grille', img)

def screen_texture(kind):
    w, h = (512, 288) if kind == 'dash' else (256, 160)
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    img = np.zeros((h, w, 4)); img[..., :3] = (0.01, 0.05, 0.06); img[..., 3] = 1
    cyan, amber = np.array((0.35, 0.85, 0.93)), np.array((0.95, 0.65, 0.24))
    def ring(cx, cy, r, t=2.0, c=cyan):
        d = np.abs(np.hypot(xx - cx, yy - cy) - r) < t
        img[d, :3] = c
    def rect(x0, y0, x1, y1, c=cyan):
        img[int(y0):int(y1), int(x0):int(x1), :3] = c
    if kind == 'dash':
        # attitude ball: sky / ground halves, rings, tick bars
        m = np.hypot(xx - 110, yy - 140) < 82
        img[m & (yy < 140), :3] = (0.07, 0.38, 0.44); img[m & (yy >= 140), :3] = (0.42, 0.29, 0.10)
        ring(110, 140, 82); rect(40, 139, 180, 142); rect(109, 120, 112, 160)
        ring(300, 98, 50); rect(299, 54, 302, 98, amber)
        for i in range(4):
            rect(224, 196 + i * 18, 224 + 150 - i * 30, 202 + i * 18)
        rect(412, 72, 482, 92); rect(416, 76, 468, 88)
        rect(412, 182, 482, 202); rect(416, 186, 454, 198, amber)
    else:
        for i in range(2): rect(16, 24 + i * 26, 130 - i * 30, 32 + i * 26)
        for i in range(6): rect(16 + i * 38, 84, 46 + i * 38, 98)
        rect(16, 130, 120, 138, amber)
    return make_image('screen_' + kind, img)

# ------------------------------------------------------------------ materials (Principled BSDF only)
MATS = {}
def material(name, color, rough=0.5, metal=0.0, emit=None, emit_strength=1.0, coat=0.0, image=None, normal=None,
             emit_image=None, uv_scale=None):
    # colours below are written as sRGB (what you see); Blender's inputs are linear
    color = tuple(c ** 2.2 for c in color)
    emit = tuple(c ** 2.2 for c in emit) if emit else None
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if coat:
        bsdf.inputs['Coat Weight'].default_value = coat
        bsdf.inputs['Coat Roughness'].default_value = 0.08
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    def tex(img, srgb):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
        t.image.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        t.interpolation = 'Linear'; t.extension = 'REPEAT'
        return t
    if image:
        nt.links.new(tex(image, True).outputs['Color'], bsdf.inputs['Base Color'])
    if normal:
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tex(normal, False).outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if emit_image:
        bsdf.inputs['Emission Strength'].default_value = emit_strength
        nt.links.new(tex(emit_image, True).outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Base Color'].default_value = (0.01, 0.02, 0.025, 1)
    MATS[name] = m
    return m

tk_a, tk_n = tyre_textures()
material('white', (0.92, 0.94, 0.96), 0.3, 0.0, coat=0.7)
material('silver', (0.76, 0.79, 0.82), 0.3, 0.8)
material('frame', (0.23, 0.29, 0.37), 0.38, 0.5, normal=carbon_normal())
material('graphite', (0.13, 0.145, 0.17), 0.5, 0.35)
material('inset', (0.25, 0.28, 0.32), 0.5, 0.4)
material('liner', (0.04, 0.045, 0.05), 0.85, 0.1)
material('seat', (0.10, 0.11, 0.13), 0.85, 0.02)
material('strap', (0.22, 0.24, 0.27), 0.8, 0.0)
material('tyre', (1, 1, 1), 0.92, 0.0, image=tk_a, normal=tk_n)
material('dish', (0.07, 0.08, 0.10), 0.45, 0.6)
material('spoke', (0.14, 0.16, 0.20), 0.45, 0.5)
material('ring', (0.9, 0.92, 0.95), 0.14, 1.0)
material('gold', (0.72, 0.52, 0.16), 0.38, 0.85)
material('grille', (1, 1, 1), 0.5, 0.5, image=grille_texture())
material('solar', (1, 1, 1), 0.3, 0.4, image=solar_texture())
material('led', (0.02, 0.08, 0.10), 0.4, 0.0, emit=(0.40, 0.91, 0.98), emit_strength=1.0)
material('screen', (0.01, 0.02, 0.025), 0.35, 0.0, emit_image=screen_texture('dash'), emit_strength=0.9)
material('station', (0.01, 0.02, 0.025), 0.35, 0.0, emit_image=screen_texture('station'), emit_strength=0.85)
material('decal_dark', (0.075, 0.09, 0.11), 0.5, 0.0)
material('decal_cyan', (0.05, 0.65, 0.78), 0.4, 0.0)
material('decal_white', (0.96, 0.97, 0.98), 0.4, 0.0)
material('decal_gold', (1.0, 0.62, 0.15), 0.4, 0.0)

# ------------------------------------------------------------------ geometry accumulator (game coordinates)
class Acc:
    def __init__(self):
        self.m = {}
        self.parts = []  # every separate part as added: (material, verts, faces), used by the floating-part check
    def add(self, mat, geo, uv=None):
        verts, faces = geo
        self.parts.append((mat, [tuple(v) for v in verts], [tuple(f) for f in faces]))
        d = self.m.setdefault(mat, {'v': [], 'f': [], 'uv': []})
        o = len(d['v'])
        d['v'] += [tuple(v) for v in verts]
        d['f'] += [tuple(i + o for i in f) for f in faces]
        d['uv'] += uv if uv else [None] * len(faces)

def finish(verts, faces, bevel=0.0, segs=2, closed=True, angle=28):
    """Fix normals and bevel sharp edges. Returns (verts, faces)."""
    if not bevel and not closed:
        return verts, faces
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    for f in faces:
        try:
            bm.faces.new([vs[i] for i in f])
        except ValueError:
            pass
    bm.verts.index_update()
    if closed:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if bevel:
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > math.radians(angle)]
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, offset_type='OFFSET', segments=segs, profile=0.5,
                        affect='EDGES', clamp_overlap=True)
    bm.verts.index_update()
    out = ([tuple(v.co) for v in bm.verts], [tuple(v.index for v in f.verts) for f in bm.faces])
    bm.free()
    return out

def box_geo(w, h, d):
    x, y, z = w / 2, h / 2, d / 2
    v = [(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z), (-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]
    return v, f

def xform(geo, M=None, t=(0, 0, 0)):
    v, f = geo
    t = Vector(t)
    return [tuple((M @ Vector(p) if M is not None else Vector(p)) + t) for p in v], f

def basis_from_dir(d, side=Vector((1, 0, 0))):
    z = d.normalized()
    s = side if abs(z.dot(side)) < 0.98 else Vector((0, 1, 0))
    y = z.cross(s).normalized()
    x = y.cross(z)
    return Matrix(((x.x, y.x, z.x), (x.y, y.y, z.y), (x.z, y.z, z.z)))

def prism_geo(pts, mapf, t0, t1):
    n = len(pts)
    v = [mapf(p, t0) for p in pts] + [mapf(p, t1) for p in pts]
    f = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    f += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return v, f

def lathe_geo(profile, seg, loop=False, uv=None):
    """Revolve (radius, axial) points around the X axis. Returns verts, faces and per-face loop uvs if uv(i, j) is given."""
    verts, vid = [], {}
    def vert(i, j):
        r, a = profile[j]
        key = ('c', j) if r == 0 else (i % seg, j)
        if key not in vid:
            vid[key] = len(verts)
            th = 2 * math.pi * (i % seg) / seg
            verts.append((a, r * math.cos(th), r * math.sin(th)))
        return vid[key]
    faces, uvs = [], []
    n = len(profile)
    for j in range(n if loop else n - 1):
        j2 = (j + 1) % n
        for i in range(seg):
            q = [(i, j), (i + 1, j), (i + 1, j2), (i, j2)]
            idx = [vert(*c) for c in q]
            keep, uk = [], []
            for k, ix in enumerate(idx):
                if keep and keep[-1] == ix:
                    continue
                keep.append(ix)
                if uv:
                    uk.append(uv(*q[k]) if not (loop and q[k][1] == 0 and j == n - 1) else uv(q[k][0], n))
            if len(keep) > 1 and keep[0] == keep[-1]:
                keep.pop(); uk = uk[:len(keep)]
            if len(set(keep)) >= 3:
                faces.append(tuple(keep))
                uvs.append(uk if uv else None)
    return (verts, faces), (uvs if uv else None)

# ------------------------------------------------------------------ builder helpers
class B:
    def __init__(self):
        self.acc = Acc()
    def box(self, mat, w, h, d, x, y, z, rx=0, ry=0, rz=0, bevel=0.012, segs=2):
        if bevel == 0 and mat in ('led', 'liner') and min(w, h, d) < 0.02:
            dims = [w, h, d]; k = dims.index(min(dims)); dims[k] += 0.012; w, h, d = dims  # sinks into the surface it sits on
        M = Euler((rx, ry, rz), 'XYZ').to_matrix()
        self.acc.add(mat, xform(finish(*box_geo(w, h, d), bevel, segs), M, (x, y, z)))
    def rbox(self, mat, w, h, d, x, y, z, r, rx=0):
        self.box(mat, w, h, d, x, y, z, rx, bevel=r, segs=3)
    def bar(self, mat, a, b, width, t, bevel=0.012, segs=2):
        a, b = Vector(a), Vector(b)
        M = basis_from_dir(b - a)
        self.acc.add(mat, xform(finish(*box_geo(width, t, (b - a).length), bevel, segs), M, (a + b) / 2))
    def strut(self, mat, a, b, r, n=10):
        a, b = Vector(a), Vector(b)
        L = (b - a).length
        prof = [(0, -L / 2), (r, -L / 2), (r, L / 2), (0, L / 2)]
        geo, _ = lathe_geo(prof, n)
        # lathe axis is X; map X to the strut direction
        M = basis_from_dir(b - a) @ Matrix(((0, 0, 1), (0, 1, 0), (1, 0, 0)))
        self.acc.add(mat, xform(geo, M, (a + b) / 2))
    def side(self, mat, pts, x0, x1, bevel=0.012, segs=2):
        """Profile (z, y) extruded across x."""
        self.acc.add(mat, finish(*prism_geo(pts, lambda p, t: (t, p[1], p[0]), x0, x1), bevel, segs))
    def top(self, mat, pts, y0, h, bevel=0.012, segs=2):
        """Outline (x, z) extruded up from y0 by h."""
        self.acc.add(mat, finish(*prism_geo(pts, lambda p, t: (p[0], t, p[1]), y0, y0 + h), bevel, segs))
    def plane(self, mat, w, h, x, y, z, rx=0):
        v = [(-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0)]
        g = xform((v, [(0, 1, 2, 3)]), Euler((rx, 0, 0), 'XYZ').to_matrix(), (x, y, z))
        self.acc.add(mat, g, [[(0, 0), (1, 0), (1, 1), (0, 1)]])
    def plane_x(self, mat, w, h, x, y, z):
        """Vertical panel facing +x, w along z, h along y."""
        v = [(x, y - h / 2, z + w / 2), (x, y - h / 2, z - w / 2), (x, y + h / 2, z - w / 2), (x, y + h / 2, z + w / 2)]
        self.acc.add(mat, (v, [(0, 1, 2, 3)]), [[(0, 0), (1, 0), (1, 1), (0, 1)]])
    def bolt(self, x, y, z, dx, dy, dz, r=0.011, h=0.012):
        d = Vector((dx, dy, dz)).normalized()
        a = Vector((x, y, z)) - d * 0.03  # the stud sinks into the part it fastens, so it is attached
        self.strut('silver', a, Vector((x, y, z)) + d * h, r, 6)
    def sphere(self, mat, r, x, y, z):
        prof = [(r * math.sin(math.pi * k / 8), -r * math.cos(math.pi * k / 8)) for k in range(9)]
        geo, _ = lathe_geo(prof, 12)
        self.acc.add(mat, xform(geo, None, (x, y, z)))
    def led(self, x, y, z, w, h, d):
        self.box('led', w, h, d, x, y, z, bevel=0)
    def raw(self, mat, geo, uv=None):
        self.acc.add(mat, geo, uv)

def rrect(x0, x1, z0, z1, r, seg=4):
    pts = []
    def corner(cx, cz, a0):
        for i in range(seg + 1):
            a = a0 + (i / seg) * (math.pi / 2)
            pts.append((cx + math.cos(a) * r, cz + math.sin(a) * r))
    corner(x1 - r, z1 - r, 0); corner(x0 + r, z1 - r, math.pi / 2)
    corner(x0 + r, z0 + r, math.pi); corner(x1 - r, z0 + r, math.pi * 1.5)
    return pts

WORLD_UV = {}  # material name -> tiles per metre, box-projected in world space (carbon weave on the frame)

def mesh_from_acc(name, acc):
    mats = list(acc.m.keys())
    verts, faces, midx, uvs = [], [], [], []
    any_uv = any(any(u is not None for u in d['uv']) for d in acc.m.values())
    for k, m in enumerate(mats):
        d = acc.m[m]
        o = len(verts)
        verts += [G(v) for v in d['v']]
        for f, u in zip(d['f'], d['uv']):
            faces.append(tuple(i + o for i in f)); midx.append(k); uvs.append(u)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    for m in mats:
        me.materials.append(MATS[m])
    me.polygons.foreach_set('material_index', midx)
    if any_uv:
        layer = me.uv_layers.new(name='UVMap')
        for p, u in zip(me.polygons, uvs):
            for li, uv in zip(p.loop_indices, u or [(0, 0)] * p.loop_total):
                layer.data[li].uv = uv
    if WORLD_UV:
        layer = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
        for p in me.polygons:
            name = mats[p.material_index]
            if name not in WORLD_UV or name == 'tyre':
                continue
            k = WORLD_UV[name]
            n = p.normal
            for li, vi in zip(p.loop_indices, p.vertices):
                v = me.vertices[vi].co  # blender coords: x, y(=-z game), z(=y game)
                ax = max(range(3), key=lambda i: abs(n[i]))
                uv = (v.y * k, v.z * k) if ax == 0 else ((v.x * k, v.y * k) if ax == 2 else (v.x * k, v.z * k))
                layer.data[li].uv = uv
    me.update()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(60))
    tris = sum(len(f) - 2 for f in faces)
    return me, tris

# ------------------------------------------------------------------ wheel (symmetric around the X axle, local origin = hub)
def build_wheel():
    b = B()
    half = [(0.24, 0.165), (0.262, 0.182), (0.295, 0.196), (0.335, 0.2), (0.365, 0.192), (0.388, 0.17), (0.402, 0.137),
            (0.408, 0.09), (0.41, 0.045), (0.41, 0)]
    prof = [(r, -a) for r, a in half] + [(r, a) for r, a in reversed(half[:-1])]
    n = len(prof)
    SEG = 44
    arc = [0.0]
    for j in range(1, n):
        arc.append(arc[-1] + math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]))
    arc.append(arc[-1] + math.hypot(prof[0][0] - prof[-1][0], prof[0][1] - prof[-1][1]))
    TILE = 0.30  # one 256 px texture tile (knit + chevron tread) is 30 cm
    uvf = lambda i, j: (i / SEG * (2 * math.pi * 0.36 / TILE), arc[j] / TILE)
    geo, uv = lathe_geo(prof, SEG, loop=True, uv=uvf)
    b.raw('tyre', geo, uv)
    for sx in (-1, 1):
        d = [(0.258, -sx * 0.18), (0.25, -sx * 0.13), (0.222, -sx * 0.095), (0.15, -sx * 0.07), (0.07, -sx * 0.058), (0.0, -sx * 0.058)]
        b.raw('dish', lathe_geo(d, 32)[0])
        for i in range(8):  # thin, elegant spokes
            M = Euler((i / 8 * 2 * math.pi + 0.2, 0, 0), 'XYZ').to_matrix()
            sp = xform(finish(*box_geo(0.03, 0.17, 0.05), 0.0, 1), None, (sx * 0.1, 0.165, 0))
            b.acc.add('spoke', xform(sp, M))
        b.raw('spoke', lathe_geo([(0, sx * 0.13), (0.07, sx * 0.13), (0.07, sx * 0.06), (0, sx * 0.06)], 14)[0])
        # polished outer ring, and a bright centre cap with a small ring
        tor = [(0.262 + 0.02 * math.cos(k / 6 * 2 * math.pi), sx * 0.185 + 0.02 * math.sin(k / 6 * 2 * math.pi)) for k in range(6)]
        b.raw('ring', lathe_geo(tor, 40, loop=True)[0])
        tor2 = [(0.075 + 0.009 * math.cos(k / 6 * 2 * math.pi), sx * 0.132 + 0.009 * math.sin(k / 6 * 2 * math.pi)) for k in range(6)]
        b.raw('ring', lathe_geo(tor2, 16, loop=True)[0])
        b.raw('ring', lathe_geo([(0, sx * 0.14), (0.04, sx * 0.138), (0.05, sx * 0.13), (0, sx * 0.13)], 16)[0])
    b.raw('spoke', lathe_geo([(0.05, -0.15), (0.05, 0.15)], 12)[0])
    return b

# ------------------------------------------------------------------ polygon helpers for the white block facets
def clip_half(poly, p0, n, keep_pos):
    """Sutherland-Hodgman: keep the part of poly (z, y) on the +n (or -n) side of the line through p0."""
    def dist(p):
        d = (p[0] - p0[0]) * n[0] + (p[1] - p0[1]) * n[1]
        return d if keep_pos else -d
    out = []
    for i, a in enumerate(poly):
        b_ = poly[(i + 1) % len(poly)]
        da, db = dist(a), dist(b_)
        if da >= 0:
            out.append(a)
        if (da >= 0) != (db >= 0):
            t = da / (da - db)
            out.append((a[0] + (b_[0] - a[0]) * t, a[1] + (b_[1] - a[1]) * t))
    return out

def inset_poly(poly, d):
    cz = sum(p[0] for p in poly) / len(poly); cy = sum(p[1] for p in poly) / len(poly)
    out = []
    for p in poly:
        v = Vector((cz - p[0], cy - p[1])); L = v.length
        k = min(d / L, 0.4) if L else 0
        out.append((p[0] + v.x * k, p[1] + v.y * k))
    return out

XB = 0.82                                    # outer face of the flat white block shell
BLOCK = [(-0.5, 0.98), (-0.2, 1.72), (0.52, 1.72), (0.62, 1.0), (0.52, 0.62), (-0.38, 0.62)]
C0, C1 = (-0.4, 0.64), (0.56, 1.02)           # the big diagonal crease across the block
_cd = Vector((C1[0] - C0[0], C1[1] - C0[1])).normalized()
CN = (-_cd.y, _cd.x)                          # crease normal, pointing up/forward
def facet_out(z, y):
    """Outer face (distance from the centre plane) of the angled facets: a ridge along the crease, falling away on both sides."""
    d = (z - C0[0]) * CN[0] + (y - C0[1]) * CN[1]
    return XB + 0.05 - 0.055 * d if d >= 0 else XB + 0.05 + 0.12 * d

def facet_prism(b, mat, pts, sg, bevel=0.007):
    n = len(pts)
    v = [(sg * (XB - 0.01), p[1], p[0]) for p in pts] + [(sg * facet_out(p[0], p[1]), p[1], p[0]) for p in pts]
    f = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    b.raw(mat, finish(v, f, bevel, 2))

def hood_y(z):  # top of the low wedge nose: from the bumper up to the windscreen base
    return 0.66 + (z - (ZF + 0.04)) * (0.985 - 0.66) / (-0.95 - (ZF + 0.04))

# ------------------------------------------------------------------ body parts
def chassis(b):
    # angled tub and skid plates
    b.raw('graphite', finish(*prism_geo([(-0.4, 0.25), (0.4, 0.25), (0.5, 0.42), (-0.5, 0.42)], lambda p, t: (p[0], p[1], t), -1.45, 1.55), 0.015, 2))
    b.box('liner', 1.1, 0.03, 0.95, 0, 0.425, -0.44, bevel=0)
    b.box('inset', 0.9, 0.03, 0.5, 0, 0.235, 0.2, bevel=0.006, segs=1)
    b.box('inset', 0.7, 0.03, 0.5, 0, 0.235, -1.1, bevel=0.006, segs=1)
    for sx in (-1, 1):
        b.box('frame', 0.12, 0.04, 1.3, sx * 0.5, 0.245, 0, bevel=0.008, segs=1)
        b.box('graphite', 0.18, 0.3, 1.32, sx * 0.69, 0.43, 0, bevel=0)
        for i in (-1, 0, 1):  # battery modules: chamfered cross-section, not a slab
            z = i * 0.44
            xs = [(0.58, 0.27), (0.75, 0.27), (0.805, 0.33), (0.805, 0.55), (0.77, 0.6), (0.58, 0.6)]
            pts = [(sx * x, y) for x, y in xs]
            b.raw('graphite', finish(*prism_geo(pts, lambda p, t: (p[0], p[1], t), z - 0.2, z + 0.2), 0.012, 2))
            b.box('inset', 0.012, 0.05, 0.3, sx * 0.783, 0.575, z, bevel=0.005, segs=1)  # lighter top strip
            b.box('liner', 0.012, 0.2, 0.3, sx * 0.804, 0.43, z, bevel=0.003, segs=1)    # recessed face
            b.led(sx * 0.81, 0.46, z, 0.012, 0.026, 0.026)
            for k in (-1, 1):
                b.bolt(sx * 0.806, 0.57, z + k * 0.17, sx, 0, 0)
            b.box('inset', 0.008, 0.012, 0.14, sx * 0.808, 0.37, z, bevel=0)   # label bar
        b.box('decal_gold', 0.01, 0.02, 0.1, sx * 0.808, 0.32, 0.0, bevel=0)     # hazard label

def nose(b):
    # low wedge: thin bumper at ZF sloping up to the windscreen base, narrow so the steered tyres clear it
    wedge = [(ZF, 0.56), (ZF + 0.03, 0.52), (-1.2, 0.5), (-0.62, 0.5), (-0.62, 0.985), (-0.95, 0.985), (ZF + 0.04, 0.66), (ZF, 0.62)]
    b.side('white', wedge, -0.55, 0.55, 0.03, 3)
    crown = [(ZF + 0.12, 0.675), (-0.95, 1.0), (-0.78, 1.0), (-0.78, 0.9), (-1.2, 0.78)]
    b.side('white', crown, -0.3, 0.3, 0.02, 2)  # raised central crown
    # fender shelves above the front tyres (thin chamfered slabs)
    for sx in (-1, 1):
        b.top('white', rrect(sx * 0.7 - 0.2, sx * 0.7 + 0.2, -1.58, -0.72, 0.08, 4), 0.9, 0.09, 0.02, 2)
        b.top('frame', rrect(sx * 0.7 - 0.14, sx * 0.7 + 0.14, -1.5, -0.8, 0.06, 3), 0.99, 0.012, 0.004, 1)
        # panel seams and vents on the hood slope
        for z in (-1.38, -1.3, -1.22, -1.14):
            b.box('liner', 0.24, 0.006, 0.03, sx * 0.43, hood_y(z) + 0.003, z, -0.455, bevel=0)
        b.box('liner', 0.004, 0.02, 0.9, sx * 0.555, 0.78, -1.1, bevel=0)   # seam along the wedge side
        b.rbox('graphite', 0.02, 0.05, 0.1, sx * 0.555, 0.62, -1.0, 0.006)  # recessed handle
        b.box('liner', 0.004, 0.008, 0.5, sx * 0.555, 0.58, -1.2, bevel=0)
        b.top('frame', rrect(sx * 0.76 - 0.1, sx * 0.76 + 0.1, -0.72, -0.4, 0.03, 3), 0.935, 0.05, 0.014, 2)  # sill rails
        # C-shaped LED bracket at the lower front corner
        x, z = sx * 0.5, ZF - 0.03
        b.rbox('graphite', 0.1, 0.22, 0.05, x, 0.6, z + 0.03, 0.014)
        b.led(x + sx * 0.04, 0.6, z + 0.002, 0.016, 0.17, 0.014)
        for dy in (-0.085, 0.085):
            b.led(x, 0.6 + dy, z + 0.002, 0.085, 0.016, 0.014)
        # side marker and a small light on the fender corner
        b.led(sx * 0.552, 0.7, ZF + 0.35, 0.012, 0.03, 0.03)
        b.rbox('graphite', 0.05, 0.04, 0.05, sx * 0.84, 0.99, -1.52, 0.012)
        b.led(sx * 0.84, 0.99, -1.55, 0.03, 0.02, 0.01)
    b.rbox('frame', 1.1, 0.1, 0.1, 0, 0.55, ZF - 0.01, 0.025)           # dark bumper
    b.led(0, 0.58, ZF - 0.058, 0.62, 0.016, 0.01)                         # light blade on the nose edge
    b.box('liner', 0.5, 0.05, 0.01, 0, 0.5, ZF + 0.0, bevel=0)            # intake slot under the bumper
    b.box('liner', 0.7, 0.004, 0.012, 0, 0.6, ZF - 0.0, bevel=0)
    b.rbox('graphite', 1.4, 0.55, 0.03, 0, 0.72, -0.715, 0.008)           # dash face
    for sx in (-1, 1):
        b.box('liner', 0.012, 0.36, 0.5, sx * 0.694, 0.78, -0.5, bevel=0)

def sides_and_frame(b):
    upper = clip_half(BLOCK, C0, CN, True)
    lower = clip_half(BLOCK, C0, CN, False)
    for sx in (-1, 1):
        x0, x1 = (0.7, XB) if sx > 0 else (-XB, -0.7)
        b.side('white', BLOCK, x0, x1, 0.02, 3)
        facet_prism(b, 'white', inset_poly(upper, 0.02), sx)
        facet_prism(b, 'white', inset_poly(lower, 0.02), sx)
        # frame along the block's front edge, bottom rail and rear post
        b.bar('frame', (sx * 0.832, 0.98, -0.5), (sx * 0.832, 1.72, -0.2), 0.05, 0.07, 0.012, 2)
        b.box('frame', 0.05, 0.08, 0.95, sx * 0.84, 0.6, 0.07, bevel=0.015, segs=2)
        b.box('frame', 0.14, 0.76, 0.12, sx * 0.86, 1.36, 0.6, bevel=0.02, segs=2)
        # A-pillar: pushed outward and slim, so it stays out of the driver's view; thin inner member
        b.bar('frame', (sx * 0.9, 0.97, ZF + 0.16), (sx * 0.9, 1.74, -1.14), 0.12, 0.11, 0.018, 3)
        b.bar('frame', (sx * 0.8, 1.0, -1.34), (sx * 0.8, 1.72, -1.1), 0.04, 0.04, 0.006, 1)
        b.box('frame', 0.15, 0.1, 0.16, sx * 0.9, 0.99, ZF + 0.14, bevel=0.02, segs=2)
        # tail posts
        b.bar('frame', (sx * 0.9, 0.97, ZR + 0.06), (sx * 0.9, 1.7, ZR - 0.1), 0.12, 0.12, 0.018, 3)
        # fasteners, small lights and sensor pods on the frame corners
        for y, z in [(1.2, ZF + 0.3), (1.5, -1.3)]:
            b.led(sx * 0.96, y, z, 0.012, 0.03, 0.03)
        b.led(sx * (0.93), 1.7, 0.6, 0.012, 0.03, 0.03)
        b.led(sx * 0.9, 1.0, ZR + 0.1, 0.03, 0.03, 0.012)
        b.led(sx * 0.96, 1.2, 1.81, 0.012, 0.03, 0.03)
        for (y, z) in [(1.05, -1.45), (1.35, -1.32), (1.6, -1.2)]:
            b.bolt(sx * 0.962, y, z, sx, 0, 0)
        for (y, z) in [(1.0, 0.6), (1.4, 0.6), (1.7, 0.6)]:
            b.bolt(sx * 0.93, y, z, sx, 0, 0)
        for y in (1.05, 1.5):
            b.bolt(sx * 0.96, y, ZR - 0.02, sx, 0, 0)
        # wheel-arch flares: a solid half-ring arch over each tyre (radius clears the steered tyre)
        for sz in (-1, 1):
            zc = sz * HB
            ring_pts = [(zc + 0.53 * math.cos(math.radians(a)), 0.41 + 0.53 * math.sin(math.radians(a))) for a in range(10, 171, 10)]
            ring_in = [(zc + 0.47 * math.cos(math.radians(a)), 0.41 + 0.47 * math.sin(math.radians(a))) for a in range(170, 9, -10)]
            lo, hi = sorted((sx * 0.7, sx * 1.12))
            b.side('frame', ring_pts + ring_in, lo, hi, 0.012, 2)

def seats(b):
    dz = -0.67
    shell = [(0.05 + dz, 0.42), (0.05 + dz, 0.58), (0.34 + dz, 0.55), (0.5 + dz, 1.06), (0.6 + dz, 1.04), (0.62 + dz, 0.42)]
    for x in (-0.32, 0.32):
        b.side('seat', shell, x - 0.23, x + 0.23, 0.04, 3)
        for sx in (-1, 1):
            b.rbox('seat', 0.06, 0.2, 0.36, x + sx * 0.215, 0.66, 0.24 + dz, 0.025, rx=0.3)
        b.rbox('seat', 0.07, 0.38, 0.1, x - 0.2, 0.86, 0.52 + dz, 0.02, rx=0.3)
        b.rbox('seat', 0.07, 0.38, 0.1, x + 0.2, 0.86, 0.52 + dz, 0.02, rx=0.3)
        b.rbox('seat', 0.3, 0.2, 0.09, x, 1.2, 0.56 + dz, 0.035, rx=0.25)
        b.rbox('seat', 0.08, 0.2, 0.06, x, 1.12, 0.52 + dz, 0.02, rx=0.25)  # headrest post down to the seat back
        b.rbox('silver', 0.1, 0.06, 0.1, x, 1.0, 0.5 + dz, 0.02, rx=0.25)
        for ddx in (-0.1, 0.1):
            b.bar('strap', (x + ddx, 1.12, 0.5 + dz), (x + ddx * 1.6, 0.6, 0.2 + dz), 0.045, 0.024, 0, 1)
        b.bar('strap', (x - 0.22, 0.52, 0.45 + dz), (x - 0.04, 0.6, 0.18 + dz), 0.045, 0.024, 0, 1)
        b.bar('strap', (x + 0.22, 0.52, 0.45 + dz), (x + 0.04, 0.6, 0.18 + dz), 0.045, 0.024, 0, 1)
        b.box('silver', 0.07, 0.025, 0.05, x, 0.6, 0.17 + dz, bevel=0.006, segs=1)
        b.box('inset', 0.5, 0.04, 0.4, x, 0.44, 0.3 + dz, bevel=0.008, segs=1)
    b.box('graphite', 1.44, 0.9, 0.04, 0, 0.9, 0.02, bevel=0)
    b.rbox('inset', 0.2, 0.3, 0.5, 0, 0.57, -0.37, 0.03)  # centre console
    b.rbox('inset', 0.13, 0.04, 0.1, 0, 0.74, -0.57, 0.015)
    b.strut('silver', (0, 0.74, -0.57), (0, 0.94, -0.57), 0.014)  # joystick
    b.rbox('graphite', 0.05, 0.06, 0.07, 0, 0.96, -0.57, 0.015)

def dash(b):
    z0 = -0.86
    b.rbox('graphite', 1.3, 0.05, 0.28, 0, 1.03, z0, 0.015)
    tilt = -0.65
    for x, w, h, m in [(-0.32, 0.46, 0.1, 'screen'), (0.32, 0.4, 0.1, 'station')]:
        b.box('graphite', w + 0.03, h + 0.025, 0.03, x, 1.045, z0 - 0.01, tilt, bevel=0.006, segs=1)
        b.plane(m, w, h, x, 1.045 + 0.0165 * math.sin(-tilt), z0 - 0.01 + 0.0165 * math.cos(tilt), tilt)

def roof(b):
    y0 = 1.72
    # thin slab that tapers toward its edges: three stacked, chamfered layers
    b.top('frame', rrect(-0.95, 0.95, -1.22, 0.58, 0.26, 6), y0, 0.07, 0.03, 3)
    b.top('frame', rrect(-0.74, 0.74, -1.0, 0.4, 0.2, 6), y0 + 0.07, 0.03, 0.012, 2)
    b.top('frame', rrect(-0.46, 0.46, -0.72, 0.16, 0.12, 5), y0 + 0.1, 0.016, 0.006, 1)
    b.box('inset', 1.8, 0.012, 1.5, 0, y0 - 0.004, -0.3, bevel=0)
    for sx in (-1, 1):  # roof light bars, sensor pods, access seams
        b.rbox('graphite', 0.08, 0.045, 0.6, sx * 0.84, 1.8, -0.9, 0.012)
        b.led(sx * 0.84, 1.826, -0.9, 0.05, 0.02, 0.54)
        b.rbox('graphite', 0.07, 0.06, 0.07, sx * 0.9, 1.8, -1.12, 0.018)
        b.led(sx * 0.9, 1.8, -1.158, 0.03, 0.03, 0.012)
        b.box('liner', 0.006, 0.01, 0.9, sx * 0.3, y0 + 0.118, -0.3, bevel=0)
        for z in (-0.6, -0.1):
            b.bolt(sx * 0.62, y0 + 0.103, z, 0, 1, 0)
    # bay roof with the solar panel and a frame lip
    b.top('frame', rrect(-0.9, 0.9, 0.5, ZR + 0.04, 0.07, 3), 1.64, 0.07, 0.014, 2)
    x0, x1, z0, z1, y = -0.78, 0.78, 0.6, ZR - 0.04, 1.7115
    b.raw('solar', ([(x0, y, z0), (x0, y, z1), (x1, y, z1), (x1, y, z0)], [(0, 1, 2, 3)]), [[(0, 0), (0, 1), (1, 1), (1, 0)]])
    # dish on a short mast, camera mast and whip antenna above the white block
    b.strut('silver', (-0.2, 1.81, 0.02), (-0.2, 1.97, 0.02), 0.022)
    p = [(0.17 * i / 8, 1.4 * (0.17 * i / 8) ** 2) for i in range(9)]
    geo, _ = lathe_geo([(r, a) for r, a in p] + [(r * 0.97, a - 0.01) for r, a in reversed(p)], 22)
    M = Euler((-0.55, 0, 0), 'XYZ').to_matrix() @ Matrix(((0, 1, 0), (1, 0, 0), (0, 0, 1)))
    b.raw('silver', xform(geo, M, (-0.2, 1.995, 0.0)))
    b.strut('graphite', (-0.2, 1.97, 0.02), (-0.2, 2.01, 0.02), 0.03)
    b.strut('silver', (-0.2, 2.0, 0.02), (-0.2, 2.0 + math.cos(0.55) * 0.17, 0.02 - math.sin(0.55) * 0.17 - 0.02), 0.005, 6)
    b.strut('silver', (0.4, 1.81, 0.25), (0.4, 2.02, 0.25), 0.02)
    b.rbox('graphite', 0.12, 0.09, 0.12, 0.4, 2.05, 0.25, 0.025)
    b.led(0.4, 2.05, 0.19, 0.035, 0.035, 0.012)
    b.strut('graphite', (0.8, 1.71, ZR - 0.1), (0.8, 2.3, ZR - 0.1), 0.007, 6)

def case(b, x, y, z, w, h, d, face=1):
    """Equipment case with latches and a handle on its +x/-x face (face = +-1)."""
    b.rbox('graphite', w, h, d, x, y, z, 0.03)
    for dz in (-d * 0.3, d * 0.3):
        b.rbox('silver', 0.014, 0.04, 0.03, x + face * (w / 2 + 0.004), y + h * 0.18, z + dz, 0.004)
    b.rbox('inset', 0.016, 0.03, d * 0.4, x + face * (w / 2 + 0.006), y - h * 0.15, z, 0.006)
    b.led(x + face * (w / 2 + 0.004), y + h * 0.36, z, 0.008, 0.012, d * 0.35)

def cable(b, pts, r=0.01):
    for a, c in zip(pts, pts[1:]):
        b.strut('graphite', a, c, r, 6)
    for p in pts[1:-1]:
        b.sphere('graphite', r * 1.15, *p)

def bay(b):
    b.side('graphite', [(0.58, 0.5), (0.58, 0.9), (ZR, 0.9), (ZR, 0.5)], -0.5, 0.5, 0.02, 2)
    b.top('silver', rrect(-0.85, 0.85, 0.58, ZR + 0.2, 0.05, 3), 0.9, 0.09, 0.014, 2)  # shelf deck, tail overhang
    b.led(0, 0.7, ZR + 0.18, 0.5, 0.02, 0.012)
    for sx in (-1, 1):  # slate side sills behind the tyres (inside x 0.58: the rear wheels steer too), angled tail fairing
        b.rbox('frame', 0.1, 0.4, 1.2, sx * 0.49, 0.7, 1.2, 0.025)
        b.led(sx * 0.541, 0.74, 0.7, 0.012, 0.03, 0.03)
    b.raw('frame', finish(*prism_geo([(-0.5, 0.45), (0.5, 0.45), (0.5, 0.9), (-0.5, 0.9)], lambda p, t: (p[0], p[1], t), ZR, ZR + 0.18), 0.02, 2))
    b.box('frame', 1.8, 0.1, 0.1, 0, 1.02, ZR - 0.05, bevel=0.015, segs=2)
    b.box('frame', 1.8, 0.12, 0.12, 0, 1.6, ZR - 0.06, bevel=0.02, segs=2)
    b.box('frame', 1.8, 0.1, 0.1, 0, 1.6, 0.6, bevel=0.015, segs=2)
    # hazard stripe along the tail edge of the shelf
    for k in range(10):
        b.box('decal_gold' if k % 2 == 0 else 'decal_dark', 0.12, 0.012, 0.012, -0.54 + k * 0.12, 0.9, ZR + 0.205, bevel=0)
    # grille panel on the left (-x) side, open on the right with lit screens
    pts = [(0.95, 1.1), (1.75, 1.1), (1.75, 1.56), (1.3, 1.56)]
    for sx in (-1, 1):
        x = sx * 0.9
        if sx < 0:
            verts = [(x, y, z) for z, y in pts]
            b.raw('grille', (verts, [(0, 1, 2, 3)]), [[(z * 25, y * 25) for z, y in pts]])
            b.bar('frame', (x, 1.1, 0.95), (x, 1.56, 1.3), 0.04, 0.04, 0.006, 1)
        b.box('frame', 0.04, 0.04, 0.8, x, 1.1, 1.35, bevel=0.006, segs=1)
        b.box('frame', 0.04, 0.04, 0.5, x, 1.56, 1.55, bevel=0.006, segs=1)
        b.box('frame', 0.04, 0.5, 0.04, x, 1.33, ZR - 0.06, bevel=0.006, segs=1)
        b.led(sx * 0.45, 1.626, 1.2, 0.05, 0.018, 0.6)
        b.box('graphite', 0.08, 0.014, 0.64, sx * 0.45, 1.634, 1.2, bevel=0)
    # equipment on the shelf
    case(b, -0.42, 1.16, 0.95, 0.46, 0.34, 0.4, -1)
    case(b, -0.42, 1.16, 1.45, 0.46, 0.34, 0.4, -1)
    b.box('silver', 0.44, 0.02, 0.38, -0.42, 1.335, 0.95, bevel=0.006, segs=1)
    # control rack with two lit screens facing +x
    b.rbox('graphite', 0.4, 0.56, 0.5, 0.1, 1.27, 1.15, 0.03)
    b.plane_x('screen', 0.4, 0.2, 0.301, 1.40, 1.15)
    b.plane_x('station', 0.4, 0.18, 0.301, 1.17, 1.15)
    b.rbox('inset', 0.016, 0.04, 0.4, 0.304, 1.06, 1.15, 0.006)
    b.led(0.306, 1.02, 1.15, 0.01, 0.014, 0.3)
    # tool rack on the back wall: two rails with tools, a canister, and a silver tank
    for y in (1.3, 1.46):
        b.strut('silver', (0.0, y, ZR - 0.12), (0.85 - 0.12, y, ZR - 0.12), 0.012, 8)
    # mounting: two flat standoff posts bolted between the rear sill beam and the rear header, the rails are fixed to them
    for x in (0.0, 0.73):
        b.box('frame', 0.05, 0.5, 0.05, x, 1.3, ZR - 0.085, bevel=0.006, segs=1)
        for y in (1.3, 1.46):
            b.bolt(x, y, ZR - 0.11, 0, 0, -1, 0.014, 0.01)
    for k, x in enumerate((0.1, 0.22, 0.34, 0.46)):
        b.strut('silver', (x, 1.46, ZR - 0.12), (x, 1.2 + 0.03 * k, ZR - 0.12), 0.01, 6)
        b.rbox('graphite', 0.04, 0.07, 0.04, x, 1.18 + 0.03 * k, ZR - 0.12, 0.01)
    b.strut('silver', (0.5, 0.99, 0.8), (0.5, 1.5, 0.8), 0.07, 14)
    b.led(0.5, 1.2, 0.86, 0.1, 0.015, 0.012)
    case(b, -0.1, 1.07, 1.65, 0.3, 0.2, 0.3, 1)
    # cable runs between the units
    cable(b, [(0.0, 1.0, 1.35), (0.0, 0.95, 1.55), (-0.2, 0.95, 1.65), (-0.2, 1.2, 1.75)])
    cable(b, [(0.12, 1.55, 0.92), (0.12, 1.58, 0.75), (-0.3, 1.58, 0.75), (-0.42, 1.5, 0.8)], 0.008)
    # robotic arm at the rear right corner: turret, upper link, elbow, forearm folded back down, wrist and gripper
    ax, az = 0.66, ZR + 0.12
    b.rbox('graphite', 0.2, 0.2, 0.2, ax, 1.0, az, 0.03)
    b.strut('silver', (ax, 1.1, az), (ax, 1.16, az), 0.07, 14)                     # turret
    b.sphere('graphite', 0.055, ax, 1.2, az)                                       # shoulder
    b.bar('silver', (ax, 1.2, az), (ax, 1.84, az + 0.04), 0.07, 0.06, 0.02, 2)     # upper link
    b.led(ax + 0.036, 1.5, az + 0.02, 0.008, 0.18, 0.02)
    b.sphere('graphite', 0.06, ax, 1.88, az + 0.04)                                # elbow
    b.bar('silver', (ax, 1.88, az + 0.04), (ax, 1.52, az + 0.3), 0.055, 0.05, 0.016, 2)  # forearm folded down
    b.sphere('graphite', 0.04, ax, 1.52, az + 0.3)                                 # wrist
    b.rbox('graphite', 0.08, 0.08, 0.07, ax, 1.45, az + 0.3, 0.015)                # gripper body
    for dx in (-0.032, 0.032):
        b.box('silver', 0.014, 0.12, 0.04, ax + dx, 1.36, az + 0.3, bevel=0.003, segs=1)
    for y in (1.2, 1.88):
        b.bolt(ax + 0.05, y, az, 1, 0, 0)

def suspension(b):
    for sx in (-1, 1):
        for sz in (-1, 1):
            zc = sz * HB
            b.rbox('gold', 0.08, 0.15, 0.16, sx * 0.9, 1.0, zc, 0.03)
            b.box('graphite', 0.1, 0.03, 0.14, sx * 0.9, 0.915, zc, bevel=0.008, segs=1)
            b.bolt(sx * 0.945, 1.0, zc, sx, 0, 0)
            b.box('gold', 0.08, 0.2, 0.14, sx * 0.5, 0.7, zc, bevel=0.015, segs=2)
            for dz in (-0.08, 0.08):
                b.strut('gold', (sx * 0.52, 0.68, zc + dz), (sx * 0.4, 0.4, zc + dz * 1.5), 0.022)
                b.strut('gold', (sx * 0.54, 0.58, zc + dz), (sx * 0.38, 0.34, zc + dz * 1.2), 0.016)

# ------------------------------------------------------------------ decals as real geometry (text -> mesh)
def text_geo(body, width):
    cu = bpy.data.curves.new('txt', 'FONT')
    cu.body = body; cu.extrude = 0.004; cu.resolution_u = 2; cu.bevel_depth = 0.002; cu.bevel_resolution = 0
    cu.align_x = 'LEFT'; cu.align_y = 'BOTTOM'
    ob = bpy.data.objects.new('txt', cu)
    scene.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    v = [tuple(p.co) for p in me.vertices]
    f = [tuple(p.vertices) for p in me.polygons]
    xs = [p[0] for p in v]
    k = width / (max(xs) - min(xs))
    ymin = min(p[1] for p in v)
    v = [((p[0] - min(xs)) * k, (p[1] - ymin) * k, p[2] + 0.004) for p in v]
    bpy.data.objects.remove(ob); bpy.data.curves.remove(cu); bpy.data.meshes.remove(me)
    return v, f

def decals(b):
    for sx in (1, -1):
        sg = 1 if sx > 0 else -1
        # right side reads toward the front (-z), left side toward the rear (+z); lying on the tilted upper facet
        def put(v, u0, y0):
            out = []
            for p in v:
                z = (u0 - p[0]) if sx > 0 else (u0 + p[0])
                y = y0 + p[1]
                out.append((sg * (facet_out(z, y) - 0.003 + p[2]), y, z))
            return out
        zs = 0.38 if sx > 0 else -0.2
        v, f = text_geo('SPACEB&E', 0.5)
        b.raw('decal_dark', finish(put(v, zs, 1.16), f, 0, 1))
        v, f = text_geo('MR-01', 0.24)
        b.raw('decal_dark', finish(put(v, zs, 1.05), f, 0, 1))
        zc = zs - 0.25 if sx > 0 else zs + 0.25
        xo = facet_out(zc, 1.02)
        b.box('decal_cyan', 0.008, 0.012, 0.5, sg * (xo + 0.001), 1.02, zc, bevel=0)
        # emblem: cyan disc with a small white rocket and a dark porthole, at the start of the text
        ez = zs + 0.075 if sx > 0 else zs - 0.075
        ey = 1.2
        xe = facet_out(ez, ey)
        ring = [(ez + 0.058 * math.cos(a), ey + 0.058 * math.sin(a)) for a in [k / 24 * 2 * math.pi for k in range(24)]]
        xa, xb = sorted((sg * (xe - 0.004), sg * (xe + 0.002)))
        b.side('decal_cyan', ring, xa, xb, 0, 1)
        tilt = math.radians(40)
        def rp(a, p):
            zz = a * math.sin(tilt) + p * math.cos(tilt)
            yy = a * math.cos(tilt) - p * math.sin(tilt)
            return (ez + (-zz if sx > 0 else zz), ey + yy)
        body_ = [(-0.034, 0.0), (-0.03, 0.014), (0.0, 0.021), (0.032, 0.012), (0.046, 0.0), (0.032, -0.012), (0.0, -0.021), (-0.03, -0.014)]
        xa2, xb2 = sorted((sg * (xe + 0.002), sg * (xe + 0.005)))
        b.side('decal_white', [rp(a, p) for a, p in body_], xa2, xb2, 0, 1)
        b.side('decal_white', [rp(-0.034, 0.0), rp(-0.044, 0.024), rp(-0.016, 0.014)], xa2, xb2, 0, 1)
        b.side('decal_white', [rp(-0.034, 0.0), rp(-0.044, -0.024), rp(-0.016, -0.014)], xa2, xb2, 0, 1)
        win = [(rp(0.008, 0)[0] + 0.007 * math.cos(a), rp(0.008, 0)[1] + 0.007 * math.sin(a)) for a in [k / 12 * 2 * math.pi for k in range(12)]]
        xa3, xb3 = sorted((sg * (xe + 0.005), sg * (xe + 0.0075)))
        b.side('decal_dark', win, xa3, xb3, 0, 1)
        b.side('decal_gold', [rp(-0.034, -0.007), rp(-0.034, 0.007), rp(-0.058, 0.0)], xa2, xb2, 0, 1)
        # recessed handle and a small label plate on the lower facet
        zh = 0.35 if sx > 0 else 0.35
        xh = facet_out(zh, 0.74)
        b.rbox('graphite', 0.02, 0.03, 0.16, sg * (xh + 0.002), 0.74, zh, 0.006)
        b.box('decal_white', 0.006, 0.05, 0.12, sg * (facet_out(-0.05, 0.7) + 0.002), 0.7, -0.05, bevel=0)
        b.box('decal_dark', 0.007, 0.006, 0.1, sg * (facet_out(-0.05, 0.7) + 0.003), 0.7, -0.05, bevel=0)

# ------------------------------------------------------------------ build
body = B()
for fn in (chassis, nose, sides_and_frame, seats, dash, roof, bay, suspension, decals):
    fn(body)
wheel = build_wheel()

WORLD_UV['frame'] = 14
body_mesh, body_tris = mesh_from_acc('body_mesh', body.acc)
wheel_mesh, wheel_tris = mesh_from_acc('wheel_mesh', wheel.acc)

body_obj = bpy.data.objects.new('body', body_mesh)
col.objects.link(body_obj)
for name, sx, sz in [('wheelFL', -1, -1), ('wheelFR', 1, -1), ('wheelRL', -1, 1), ('wheelRR', 1, 1)]:
    pivot = bpy.data.objects.new(name, None)
    pivot.empty_display_type = 'PLAIN_AXES'; pivot.empty_display_size = 0.15
    pivot.location = G((sx * HT, R, sz * HB))
    col.objects.link(pivot)
    spin = bpy.data.objects.new(name + '_spin', None)
    spin.empty_display_type = 'ARROWS'; spin.empty_display_size = 0.1
    spin.parent = pivot
    col.objects.link(spin)
    mesh_obj = bpy.data.objects.new(name + '_tyre', wheel_mesh)  # same mesh data on all four wheels
    mesh_obj.parent = spin
    col.objects.link(mesh_obj)

total_tris = body_tris + 4 * wheel_tris
print(f'ROVER triangles: body {body_tris}, wheel {wheel_tris} x4, total {total_tris}')




# ------------------------------------------------------------------ floating-part check (static body, before merging)
def check_floating(acc, tol=0.002):
    """Parts are 'attached' when they touch (overlap, or a vertex within tol of the other part). Parts that are not
    connected, directly or through other parts, to the main structure are floating."""
    from mathutils.bvhtree import BVHTree
    parts = []
    for mat, v, f in acc.parts:
        pv = [Vector(G(p)) for p in v]
        tris = [(face[0], face[i], face[i + 1]) for face in f for i in range(1, len(face) - 1)]
        if not tris:
            continue
        a = np.array([tuple(p) for p in pv])
        parts.append({'mat': mat, 'v': pv, 'tris': tris, 'bvh': BVHTree.FromPolygons(pv, tris), 'lo': a.min(0) - tol, 'hi': a.max(0) + tol, 'c': a.mean(0)})
    n = len(parts)
    lo = np.array([p['lo'] for p in parts]); hi = np.array([p['hi'] for p in parts])
    parent = list(range(n))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for i in range(n):
        near = np.nonzero(np.all((lo <= hi[i]) & (hi >= lo[i]), axis=1))[0]
        for j in near:
            if j <= i or find(i) == find(j):
                continue
            a, b_ = parts[i], parts[j]
            touch = bool(a['bvh'].overlap(b_['bvh']))
            if not touch:
                for p, other in ((a, b_), (b_, a)):
                    for q in p['v']:
                        loc, nrm, idx, dist = other['bvh'].find_nearest(q, tol)
                        if loc is not None:
                            touch = True; break
                    if touch:
                        break
            if touch:
                parent[find(i)] = find(j)
    roots = {}
    for i in range(n):
        roots.setdefault(find(i), []).append(i)
    main = max(roots.values(), key=len)
    floaters = [g for g in roots.values() if g is not main]
    print(f'ROVER floating check: {n} parts, main structure {len(main)}, floating groups {len(floaters)}')
    mv, mt = [], []
    for i in main:
        o = len(mv); mv += parts[i]['v']; mt += [(o + t[0], o + t[1], o + t[2]) for t in parts[i]['tris']]
    mbvh = BVHTree.FromPolygons(mv, mt)
    for g in floaters:
        gap = min((mbvh.find_nearest(q)[3] or 9) for i in g for q in parts[i]['v'])
        c = np.mean([parts[i]['c'] for i in g], axis=0)
        print(f'ROVER   floating: {len(g)} part(s) {sorted(set(parts[i]["mat"] for i in g))} near game ({c[0]:.2f}, {c[2]:.2f}, {-c[1]:.2f}), gap {gap * 1000:.0f} mm')

check_floating(body.acc)

# ------------------------------------------------------------------ steering clearance check (all four wheels steer up to ~20 deg)
def check_clearance(max_deg=21):
    from mathutils.bvhtree import BVHTree
    bm_ = bmesh.new(); bm_.from_mesh(body_mesh)
    bmesh.ops.triangulate(bm_, faces=bm_.faces[:])
    bvh = BVHTree.FromBMesh(bm_)
    wv = [v.co.copy() for v in wheel_mesh.vertices]
    wbm = bmesh.new(); wbm.from_mesh(wheel_mesh); bmesh.ops.triangulate(wbm, faces=wbm.faces[:])
    wtris = [tuple(v.index for v in f.verts) for f in wbm.faces]
    worst = (9.0, None)
    for name, sx, sz in [('wheelFL', -1, -1), ('wheelFR', 1, -1), ('wheelRL', -1, 1), ('wheelRR', 1, 1)]:
        P = Vector(G((sx * HT, R, sz * HB)))
        wmin, wang, overlaps = 9.0, 0, 0
        for deg in range(-max_deg, max_deg + 1):
            Rz = Matrix.Rotation(math.radians(deg), 3, 'Z')
            pts = [Rz @ v + P for v in wv]
            amin, aloc = 9.0, None
            for q in pts:
                loc, nrm, idx, dist = bvh.find_nearest(q)
                if dist is not None and dist < amin:
                    amin, aloc = dist, (loc, q)
            if amin < wmin:
                wmin, wang = amin, deg
            if '--debug-overlap' in argv and deg in (0, 10, 20, -20, -10):
                l, q = aloc
                print(f'ROVER   {name} {deg:+d} deg: nearest {amin * 100:.1f} cm; body point game({l.x:.2f},{l.z:.2f},{-l.y:.2f}) tyre point game({q.x:.2f},{q.z:.2f},{-q.y:.2f})')
            wt = BVHTree.FromPolygons(pts, wtris)
            overlaps += len(bvh.overlap(wt))
        print(f'ROVER clearance {name}: min {wmin * 100:.1f} cm at {wang} deg, overlapping triangle pairs over all angles: {overlaps}')
        if wmin < worst[0]:
            worst = (wmin, name)
    print(f'ROVER clearance minimum: {worst[0] * 100:.1f} cm ({worst[1]})')

check_clearance()

# ------------------------------------------------------------------ baked ambient occlusion (body only) -> glTF occlusion texture
def bake_ao(obj, skip, size=1024):
    """Smart-UV the body into a second UV set (AO), bake AO with Cycles into one image and wire it to every body material
    through a 'glTF Material Output' group node, which the exporter writes as occlusionTexture (TEXCOORD_1)."""
    me = obj.data
    ao = me.uv_layers.new(name='AO')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    me.uv_layers.active = ao
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.new('rover_ao', size, size, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    mats = [m for m in me.materials]
    for m in mats:
        nt = m.node_tree
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; tex.name = 'AO_TEX'
        uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'AO'
        nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
        nt.nodes.active = tex
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'; scene.cycles.samples = 400
    w = bpy.data.worlds.new('bake'); w.light_settings.distance = 0.35; scene.world = w
    bpy.ops.object.bake(type='AO', margin=6, use_clear=True)
    px = np.empty(size * size * 4, np.float32); img.pixels.foreach_get(px)
    px = np.round(px * 24) / 24  # a few grey levels: keeps the PNG small (the AO is smooth anyway)
    img.pixels.foreach_set(px)
    img.filepath_raw = os.path.join(TMP, 'rover_ao.png'); img.file_format = 'PNG'
    img.save(); img.pack()
    ng = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    ng.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    for m in mats:
        if m.name in skip:
            continue
        nt = m.node_tree
        grp = nt.nodes.new('ShaderNodeGroup'); grp.node_tree = ng
        nt.links.new(nt.nodes['AO_TEX'].outputs['Color'], grp.inputs['Occlusion'])
    me.uv_layers.active = me.uv_layers['UVMap']
    print('ROVER AO baked')

if '--no-ao' not in argv:
    try:
        bake_ao(body_obj, set(wheel.acc.m.keys()))
    except Exception as ex:
        print('ROVER AO skipped:', repr(ex))

# ------------------------------------------------------------------ export (rover collection only, no lights/cameras)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
for o in col.objects:
    o.select_set(True)
bpy.context.view_layer.objects.active = body_obj
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                          export_cameras=False, export_lights=False, export_materials='EXPORT', export_image_format='AUTO',
                          export_normals=True, export_texcoords=True, export_tangents=False, export_extras=False)
print('ROVER glb', OUT, os.path.getsize(OUT), 'bytes')

# ------------------------------------------------------------------ preview renders (not exported)
def look_at(obj, target):
    d = Vector(G(target)) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def render_previews(outdir):
    os.makedirs(outdir, exist_ok=True)
    try:
        scene.render.engine = ENGINE
    except TypeError:
        scene.render.engine = 'CYCLES'
    if scene.render.engine == 'CYCLES':
        scene.cycles.samples = 48; scene.cycles.use_denoising = True
    else:
        try: scene.eevee.taa_render_samples = 48
        except Exception: pass
    scene.render.resolution_x, scene.render.resolution_y = 1100, 700
    scene.view_settings.view_transform = 'AgX'
    w = bpy.data.worlds.new('w'); w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.20, 0.23, 0.30, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
    scene.world = w
    # ground
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    gm = bpy.data.materials.new('ground'); gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.30, 0.30, 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
    bpy.context.object.data.materials.append(gm)
    def light(kind, loc, energy, size=1, color=(1, 1, 1), target=(0, 0.9, 0)):
        l = bpy.data.lights.new(kind, kind); l.energy = energy; l.color = color
        if kind == 'AREA': l.size = size
        if kind == 'SUN': l.angle = 0.05
        o = bpy.data.objects.new(kind, l); o.location = G(loc); scene.collection.objects.link(o); look_at(o, target)
    light('SUN', (-6, 8, -5), 3.0, color=(1.0, 0.95, 0.88))
    light('AREA', (6, 4, 6), 500, 6, (0.6, 0.75, 1.0))
    light('AREA', (-5, 3, 5), 300, 5)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
    shots = {
        'side': ((-10, 0.95, 0.1), (0, 0.95, 0.1), 85),       # left side, front to the left (reference 3)
        'threeq': ((-4.6, 1.7, -6.0), (0, 0.95, 0.1), 50),     # front-left, slightly elevated (reference 1)
        'rear34': ((4.6, 1.8, 6.0), (0, 0.95, 0), 50),         # rear right: open bay and arm
        'front': ((0, 1.2, -9), (0, 0.95, 0), 70),
        'top': ((0, 9, 0.01), (0, 0.5, 0), 70),
        'bay': ((-1.9, 1.35, 3.6), (0.25, 1.3, 1.6), 50),    # rear-left at bay height: tool rack and equipment
    }
    for name, (loc, tgt, lens) in shots.items():
        cam.location = G(loc); cam.data.lens = lens; look_at(cam, tgt)
        scene.render.filepath = os.path.join(outdir, name + '.png')
        bpy.ops.render.render(write_still=True)
        print('ROVER shot', scene.render.filepath)

if RENDER:
    render_previews(SHOTS)
