"""Shared helpers for capsuleCockpit.py: game-space geometry accumulation, materials, canvases, floating/leak checks, GLB export.
All geometry is authored in GAME coordinates (x right, y up = toward the head, -z = toward the capsule apex) and converted once with G().
Parts: every named node of the exported glb. A Part has a world pose (pos, rot), a parent and geometry in its own local game frame."""
import bpy, bmesh, math, os, sys, time, tempfile
import numpy as np
from mathutils import Vector, Matrix, Euler

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
T0 = time.time()
def log(*a):
    print(f'CAPCOCKPIT {time.time() - T0:5.1f}s', *a, flush=True)

def G(p):  # game (x, y, z) -> blender (x, -z, y)
    return (p[0], -p[2], p[1])
CM = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))   # game -> blender, linear part
def Rx(a): return Matrix.Rotation(a, 3, 'X')
def Ry(a): return Matrix.Rotation(a, 3, 'Y')
def Rz(a): return Matrix.Rotation(a, 3, 'Z')

scene = None
col = None
def reset_scene():
    global scene, col
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    col = scene.collection
    PARTS.clear(); MATS.clear(); IMAGES.clear()

TMP = tempfile.mkdtemp(prefix='capcockpit_tex_')
IMAGES = {}
MATS = {}
PARTS = {}

# ------------------------------------------------------------------ images, canvas, text
def make_image(name, arr, srgb=True):
    h, w = arr.shape[:2]
    if arr.ndim == 2:
        arr = np.stack([arr] * 3, -1)
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1))], -1)
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.pixels.foreach_set(np.flipud(np.clip(arr, 0, 1)).astype(np.float32).ravel())
    img.filepath_raw = os.path.join(TMP, name + '.png')
    img.file_format = 'PNG'
    img.save()
    img.pack()
    img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    IMAGES[name] = (w, h, os.path.getsize(img.filepath_raw))
    return img

_TEXT = {}
def text_tris(s):
    if s in _TEXT:
        return _TEXT[s]
    cu = bpy.data.curves.new('t', 'FONT'); cu.body = s; cu.size = 1.0; cu.resolution_u = 3
    cu.align_x = 'LEFT'; cu.align_y = 'BOTTOM'
    ob = bpy.data.objects.new('t', cu); col.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    tris = []
    for f in bm.faces:
        v = [vv.co for vv in f.verts]
        tris.append((v[0].x, v[0].y, v[1].x, v[1].y, v[2].x, v[2].y))
    xs = [t[i] for t in tris for i in (0, 2, 4)] or [0, 1]; ys = [t[i] for t in tris for i in (1, 3, 5)] or [0, 1]
    x0, y0 = min(xs), min(ys)
    tris = [(a - x0, b - y0, c - x0, d - y0, e - x0, f_ - y0) for a, b, c, d, e, f_ in tris]
    bm.free(); bpy.data.objects.remove(ob); bpy.data.curves.remove(cu); bpy.data.meshes.remove(me)
    _TEXT[s] = (tris, max(xs) - x0, 0.72)
    return _TEXT[s]

_MASKS = {}
class Canvas:
    """Float RGB canvas (row 0 = top) with colour and glow layers."""
    def __init__(self, w, h, base=(0.05, 0.05, 0.055)):
        self.w, self.h = w, h
        self.col = np.ones((h, w, 3)) * np.array(base)
        self.glow = np.zeros((h, w, 3))
    def _sdf(self, x, y, w, h, r):
        x0, y0 = int(max(0, x - 2)), int(max(0, y - 2)); x1, y1 = int(min(self.w, x + w + 3)), int(min(self.h, y + h + 3))
        yy, xx = np.mgrid[y0:y1, x0:x1]
        px, py = xx + 0.5 - (x + w / 2), yy + 0.5 - (y + h / 2)
        qx, qy = np.abs(px) - (w / 2 - r), np.abs(py) - (h / 2 - r)
        d = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r
        return (y0, y1, x0, x1), d
    def rect(self, x, y, w, h, color=None, r=0, glow=None):
        (y0, y1, x0, x1), d = self._sdf(x, y, w, h, min(r, w / 2, h / 2))
        a = np.clip(0.5 - d, 0, 1)
        if color is not None:
            self.col[y0:y1, x0:x1] = self.col[y0:y1, x0:x1] * (1 - a[..., None]) + np.array(color, float) * a[..., None]
        if glow is not None:
            self.glow[y0:y1, x0:x1] = self.glow[y0:y1, x0:x1] * (1 - a[..., None]) + np.array(glow, float) * a[..., None]
    def outline(self, x, y, w, h, color, t=2, r=0):
        (y0, y1, x0, x1), d = self._sdf(x, y, w, h, min(r, w / 2, h / 2))
        a = np.clip(t / 2 + 0.5 - np.abs(d + t / 2), 0, 1)
        self.col[y0:y1, x0:x1] = self.col[y0:y1, x0:x1] * (1 - a[..., None]) + np.array(color, float) * a[..., None]
    def disc(self, cx, cy, r, color=None, glow=None):
        self.rect(cx - r, cy - r, 2 * r, 2 * r, color, r=r, glow=glow)
    def ring(self, cx, cy, r, color, t=2):
        self.outline(cx - r, cy - r, 2 * r, 2 * r, color, t, r=r)
    def line(self, x0, y0, x1, y1, color, t=2):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n + 1):
            k = i / max(1, n)
            self.rect(x0 + (x1 - x0) * k - t / 2, y0 + (y1 - y0) * k - t / 2, t, t, color)
    def mtext(self, s, x, y, size, color, align='c', glow=None):
        """Cached-mask text; (x, y) = centre of the line, size = cap height in px."""
        key = (s, int(round(size * 4)))
        m = _MASKS.get(key)
        if m is None:
            tris, wid, hgt = text_tris(s); k = size / max(hgt, 1e-6)
            ymax = max([max(t[1], t[3], t[5]) for t in tris] or [1.0])
            Wm, Hm = int(wid * k) + 4, int(ymax * k) + 4
            cov = np.zeros((Hm, Wm))
            for (ax, ay, bx, by, cx_, cy_) in tris:
                pts = np.array([[ax * k + 1.5, (ymax - ay) * k + 1.5], [bx * k + 1.5, (ymax - by) * k + 1.5], [cx_ * k + 1.5, (ymax - cy_) * k + 1.5]])
                xmin, xmax = int(max(0, pts[:, 0].min() - 1)), int(min(Wm, pts[:, 0].max() + 2))
                ymin, ymax_ = int(max(0, pts[:, 1].min() - 1)), int(min(Hm, pts[:, 1].max() + 2))
                if xmax <= xmin or ymax_ <= ymin:
                    continue
                yy, xx = np.mgrid[ymin:ymax_, xmin:xmax]
                c_ = np.zeros(xx.shape)
                for sx in (0.25, 0.75):
                    for sy in (0.25, 0.75):
                        px, py = xx + sx, yy + sy
                        d1 = (px - pts[1, 0]) * (pts[0, 1] - pts[1, 1]) - (pts[0, 0] - pts[1, 0]) * (py - pts[1, 1])
                        d2 = (px - pts[2, 0]) * (pts[1, 1] - pts[2, 1]) - (pts[1, 0] - pts[2, 0]) * (py - pts[2, 1])
                        d3 = (px - pts[0, 0]) * (pts[2, 1] - pts[0, 1]) - (pts[2, 0] - pts[0, 0]) * (py - pts[0, 1])
                        c_ += ~(((d1 < 0) | (d2 < 0) | (d3 < 0)) & ((d1 > 0) | (d2 > 0) | (d3 > 0)))
                cov[ymin:ymax_, xmin:xmax] = np.minimum(cov[ymin:ymax_, xmin:xmax] + c_ / 4, 1)
            m = (cov, wid * k, ymax * k); _MASKS[key] = m
        cov, wk, yk = m
        ox = x - (wk / 2 if align == 'c' else (wk if align == 'r' else 0))
        oy = y + size / 2
        left, top = int(round(ox - 1.5)), int(round(oy - yk - 1.5))
        h_, w_ = cov.shape
        cx0, cy0 = max(0, -left), max(0, -top); cx1, cy1 = min(w_, self.w - left), min(h_, self.h - top)
        if cx1 <= cx0 or cy1 <= cy0:
            return
        a = cov[cy0:cy1, cx0:cx1][..., None]
        sl = (slice(top + cy0, top + cy1), slice(left + cx0, left + cx1))
        self.col[sl] = self.col[sl] * (1 - a) + np.array(color, float) * a
        if glow is not None:
            self.glow[sl] = np.maximum(self.glow[sl], a * np.array(glow, float))
    def text_w(self, s, size):
        tris, wid, hgt = text_tris(s)
        return wid * size / max(hgt, 1e-6)

# ------------------------------------------------------------------ materials
def material(name, lin, rough=0.6, metal=0.0, emit=None, emit_strength=1.0, image=None, emit_image=None, spec=None):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*lin, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if spec is not None:
        bsdf.inputs['Specular IOR Level'].default_value = spec
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    def tex(img):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
        u = nt.nodes.new('ShaderNodeUVMap'); u.uv_map = 'UVMap'
        nt.links.new(u.outputs['UV'], t.inputs['Vector'])
        return t
    if image:
        nt.links.new(tex(image).outputs['Color'], bsdf.inputs['Base Color'])
    if emit_image:
        bsdf.inputs['Emission Strength'].default_value = emit_strength
        nt.links.new(tex(emit_image).outputs['Color'], bsdf.inputs['Emission Color'])
    MATS[name] = m
    return m

def glass_material(name, alpha=0.12, tint=(0.75, 0.9, 0.95)):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*tint, 1)
    bsdf.inputs['Alpha'].default_value = alpha
    bsdf.inputs['Roughness'].default_value = 0.04
    if hasattr(m, 'surface_render_method'):
        m.surface_render_method = 'DITHERED'
    MATS[name] = m
    return m

def lens_material(name, rgb, strength=1.0):
    return material(name, tuple(c * 0.15 for c in rgb), 0.3, emit=rgb, emit_strength=strength)

# ------------------------------------------------------------------ geometry helpers
def finish(verts, faces, bevel=0.0, segs=2, closed=True, angle=28):
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
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, offset_type='OFFSET', segments=segs, profile=0.5, affect='EDGES', clamp_overlap=True)
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
    z = Vector(d).normalized()
    s = side if abs(z.dot(side)) < 0.98 else Vector((0, 1, 0))
    y = z.cross(s).normalized()
    x = y.cross(z)
    return Matrix(((x.x, y.x, z.x), (x.y, y.y, z.y), (x.z, y.z, z.z)))

def frame_from(z, x_hint=Vector((1, 0, 0))):
    """Rotation matrix whose local z is `z`, local x as close to x_hint as possible (columns = local axes in the parent)."""
    z = Vector(z).normalized()
    x = Vector(x_hint) - z * Vector(x_hint).dot(z)
    if x.length < 1e-4:
        x = Vector((0, 1, 0)) - z * z.y
    x.normalize()
    y = z.cross(x)
    return Matrix(((x.x, y.x, z.x), (x.y, y.y, z.y), (x.z, y.z, z.z)))

def lathe_geo(profile, seg, closed_loop=True):
    """profile: [(radius, axial)] around the local X axis (axial = x). radius 0 = pole."""
    verts, vid = [], {}
    def vert(i, j):
        r, a = profile[j]
        key = ('c', j) if r == 0 else (i % seg, j)
        if key not in vid:
            vid[key] = len(verts)
            th = 2 * math.pi * (i % seg) / seg
            verts.append((a, r * math.cos(th), r * math.sin(th)))
        return vid[key]
    faces = []
    for j in range(len(profile) - 1):
        for i in range(seg):
            idx = [vert(i, j), vert(i + 1, j), vert(i + 1, j + 1), vert(i, j + 1)]
            keep = []
            for ix in idx:
                if keep and keep[-1] == ix:
                    continue
                keep.append(ix)
            if len(keep) > 1 and keep[0] == keep[-1]:
                keep.pop()
            if len(set(keep)) >= 3:
                faces.append(tuple(keep))
    return verts, faces

def circle_profile(r, n=6):
    return [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)) for i in range(n)]

def rrect_pts(w, h, r, seg=3):
    """Rounded-rectangle outline (counter-clockwise), centred, in 2D."""
    r = min(r, w / 2 - 1e-4, h / 2 - 1e-4)
    pts = []
    for (cx, cy, a0) in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def sweep(points, profile, closed=False, caps=True):
    pts = [Vector(p) for p in points]
    n = len(pts)
    ts = []
    for i in range(n):
        t = (pts[(i + 1) % n] - pts[(i - 1) % n]) if closed else (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)])
        ts.append(t.normalized())
    verts, k, prev = [], len(profile), None
    for i in range(n):
        if prev is None:
            ref = Vector((0, 1, 0)) if abs(ts[i].y) < 0.9 else Vector((1, 0, 0))
            sd = ts[i].cross(ref).normalized()
        else:
            sd = (prev - ts[i] * prev.dot(ts[i])).normalized()
        prev = sd
        nr = sd.cross(ts[i]).normalized()
        for (a, b) in profile:
            verts.append(tuple(pts[i] + sd * a + nr * b))
    faces = []
    for i in range(n if closed else n - 1):
        i2 = (i + 1) % n
        for j in range(k):
            j2 = (j + 1) % k
            faces.append((i * k + j, i2 * k + j, i2 * k + j2, i * k + j2))
    if caps and not closed:
        faces.append(tuple(range(k - 1, -1, -1))); faces.append(tuple((n - 1) * k + j for j in range(k)))
    return finish(verts, faces, 0.0, closed=True)

def catmull(points, per=6):
    P = [Vector(p) for p in points]; n = len(P); out = []
    for i in range(n - 1):
        p0 = P[i - 1] if i > 0 else P[i]
        p1 = P[i]; p2 = P[i + 1]
        p3 = P[i + 2] if i + 2 < n else P[i + 1]
        for s in range(per):
            t = s / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-1])
    return out

# ------------------------------------------------------------------ Part
class Part:
    """A named node. pos/rot = world pose (game frame). Geometry is added in the part's own local game frame."""
    def __init__(self, name, pos=(0, 0, 0), rot=None, parent=None):
        assert name not in PARTS, name
        self.name = name
        self.pos = Vector(pos)
        self.rot = rot if rot is not None else Matrix.Identity(3)
        self.parent = parent.name if isinstance(parent, Part) else parent
        self.m = {}
        self.visible = True
        PARTS[name] = self
    def add(self, mat, geo, uv=None):
        verts, faces = geo
        d = self.m.setdefault(mat, {'v': [], 'f': [], 'uv': []})
        o = len(d['v'])
        d['v'] += [tuple(v) for v in verts]
        d['f'] += [tuple(i + o for i in f) for f in faces]
        d['uv'] += uv if uv else [None] * len(faces)
    def box(self, mat, w, h, d, x=0, y=0, z=0, rx=0, ry=0, rz=0, bevel=0.004, segs=1):
        M = Rx(rx) @ Ry(ry) @ Rz(rz)
        bevel = min(bevel, min(w, h, d) * 0.45)
        self.add(mat, xform(finish(*box_geo(w, h, d), bevel, segs), M, (x, y, z)))
    def strut(self, mat, a, b, r, r1=None, n=10):
        a, b = Vector(a), Vector(b)
        L = (b - a).length
        if L < 1e-6:
            return
        r1 = r if r1 is None else r1
        geo = lathe_geo([(0, -L / 2), (r, -L / 2), (r1, L / 2), (0, L / 2)], n)
        M = basis_from_dir(b - a) @ Matrix(((0, 0, 1), (0, 1, 0), (1, 0, 0)))
        self.add(mat, xform(geo, M, (a + b) / 2))
    def cyl(self, mat, r, h, x, y, z, axis='z', n=12, r1=None):
        c = Vector((x, y, z))
        d = {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}[axis]
        self.strut(mat, c - d * h / 2, c + d * h / 2, r, r1, n)
    def sphere(self, mat, r, x, y, z, n=12, m=6, sx=1, sy=1, sz=1):
        prof = [(r * math.sin(math.pi * k / m), -r * math.cos(math.pi * k / m)) for k in range(m + 1)]
        g = lathe_geo(prof, n)
        M = Matrix(((0, 0, 1), (0, 1, 0), (1, 0, 0)))
        S = Matrix(((sx, 0, 0), (0, sy, 0), (0, 0, sz)))
        self.add(mat, xform(g, S @ M, (x, y, z)))
    def quad(self, mat, w, h, x=0, y=0, z=0, uvr=(0, 0, 1, 1), rot=None):
        v = [(-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0)]
        u0, v0, u1, v1 = uvr
        self.add(mat, xform((v, [(0, 1, 2, 3)]), rot, (x, y, z)), [[(u0, v0), (u1, v0), (u1, v1), (u0, v1)]])
    def tube(self, mat, pts, r, n=6, per=4):
        self.add(mat, sweep(catmull(pts, per), circle_profile(r, n), closed=False, caps=True))
    def raw(self, mat, geo, uv=None):
        self.add(mat, geo, uv)
    def tris(self):
        return sum(len(f) - 2 for d in self.m.values() for f in d['f'])

def world_faces(part):
    """[(mat, verts_world, faces)] of one part."""
    out = []
    for mat, d in part.m.items():
        out.append((mat, [tuple(part.pos + part.rot @ Vector(v)) for v in d['v']], d['f']))
    return out

# ------------------------------------------------------------------ Blender objects
def mesh_from_part(part):
    mats = list(part.m.keys())
    verts, faces, midx, uvs = [], [], [], []
    for k, m in enumerate(mats):
        d = part.m[m]
        o = len(verts)
        verts += [G(v) for v in d['v']]
        for f, u in zip(d['f'], d['uv']):
            faces.append(tuple(i + o for i in f)); midx.append(k); uvs.append(u)
    me = bpy.data.meshes.new(part.name)
    me.from_pydata(verts, [], faces)
    for m in mats:
        me.materials.append(MATS[m])
    me.polygons.foreach_set('material_index', midx)
    layer = me.uv_layers.new(name='UVMap')
    for p, u in zip(me.polygons, uvs):
        for li, uv in zip(p.loop_indices, u or [(0, 0)] * p.loop_total):
            layer.data[li].uv = uv
    me.update()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(40))
    return me

def build_objects():
    objs = {}
    for name, p in PARTS.items():
        if p.m:
            ob = bpy.data.objects.new(name, mesh_from_part(p))
        else:
            ob = bpy.data.objects.new(name, None)
            ob.empty_display_type = 'PLAIN_AXES'; ob.empty_display_size = 0.02
        col.objects.link(ob)
        R = CM @ p.rot @ CM.inverted()
        ob.matrix_world = Matrix.Translation(Vector(G(p.pos))) @ R.to_4x4()
        objs[name] = ob
    bpy.context.view_layer.update()
    for name, p in PARTS.items():
        if p.parent:
            c, par = objs[name], objs[p.parent]
            mw = c.matrix_world.copy()
            c.parent = par
            c.matrix_parent_inverse = par.matrix_world.inverted()
            c.matrix_world = mw
    bpy.context.view_layer.update()
    return objs

# ------------------------------------------------------------------ floating-part check (same idea as flightdeck.py)
def check_floating(parts_list, tol=0.004, names=None):
    from mathutils.bvhtree import BVHTree
    parts = []
    for k, (mat, v, f) in enumerate(parts_list):
        pv = [Vector(p) for p in v]
        tris = [(face[0], face[i], face[i + 1]) for face in f for i in range(1, len(face) - 1)]
        if not tris:
            continue
        a = np.array([tuple(p) for p in pv])
        parts.append({'mat': mat, 'name': names[k] if names else '', 'v': pv, 'tris': tris, 'bvh': BVHTree.FromPolygons(pv, tris),
                      'lo': a.min(0) - tol, 'hi': a.max(0) + tol, 'c': a.mean(0)})
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
                    for q in p['v'][::2]:
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
    log(f'floating check: {n} parts, main structure {len(main)}, floating groups {len(floaters)}')
    for g in floaters[:12]:
        c = np.mean([parts[i]['c'] for i in g], axis=0)
        log(f'  floating: {len(g)} part(s) {sorted(set(parts[i]["name"] or parts[i]["mat"] for i in g))[:4]} near game ({c[0]:.2f}, {c[1]:.2f}, {c[2]:.2f})')
    return len(floaters)

def export_glb(path, objs, active):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs.values():
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[active]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_cameras=False, export_lights=False, export_materials='EXPORT', export_image_format='JPEG', export_image_quality=82,
                              export_normals=True, export_texcoords=True, export_tangents=False, export_extras=False)
    log('glb', path, os.path.getsize(path), 'bytes')
