"""
Tail-section modelling library (SpaceB&E builder, Role 1). Shared by engine.py, thrust.py, boosters.py and gear.py.
Read ../README.md (the contract) first. Everything is written in GAME coordinates (metres, x right, y up, z toward the
viewer) and converted once to Blender with common.G, the same trick as common.py and Role 3's rover.py.

Geometry goes into an accumulator (Acc): many primitives, one mesh per group with one material slot per material, so a
model has few nodes (the slot_<key> groups the explanation card pulls apart) and small files. Colours are given in sRGB
(like the hex colours of the code-drawn art) and converted to linear for glTF. Textures are generated with numpy from a
fixed formula (no randomness), so every run writes the same file.
"""
import bpy, bmesh, math, os, sys, tempfile
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
import common as C  # noqa: E402

TAU = 2 * math.pi
G = C.G
RADIUS = C.RADIUS
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..', '..'))
OUTDIR = os.path.join(REPO, 'public', 'assets', 'models', 'builder', 'tail')
TMP = tempfile.mkdtemp(prefix='tail_tex_')


def V(x, y=None, z=None):
    return Vector(x) if y is None else Vector((x, y, z))


def lerp(a, b, t):
    return a + (b - a) * t


def polar(deg, r, y=0.0):
    a = math.radians(deg)
    return V(r * math.cos(a), y, r * math.sin(a))


# ------------------------------------------------------------------ materials
def srgb(c):
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


def hexc(h):
    return ((h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255)


_M = {}
_IMG = {}


def image(name, arr, color=False):
    """arr: float array (h, w, 3|4) in 0..1, saved as PNG and packed into the .blend (the exporter embeds it)."""
    if name in _IMG:
        return _IMG[name]
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1))], axis=2)
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.pixels.foreach_set(np.flipud(arr).astype(np.float32).ravel())
    img.filepath_raw = os.path.join(TMP, name + '.png')
    img.file_format = 'PNG'
    img.save()
    img.pack()
    img.colorspace_settings.name = 'sRGB' if color else 'Non-Color'
    _IMG[name] = img
    return img


def normal_from_height(h, strength=4.0):
    gy, gx = np.gradient(h)
    nx, ny, nz = -gx * strength, gy * strength, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], -1)


def tex_tubes():
    """Brazed cooling tubes: 8 round tubes across a 128 x 16 tile (u runs round the nozzle, v along it)."""
    w, h = 128, 16
    x = (np.arange(w) % 16) / 16.0
    prof = np.sqrt(np.clip(1 - (2 * x - 1) ** 2, 0, 1))
    return normal_from_height(np.tile(prof, (h, 1)), 6.0)


def tex_corrugation():
    """Corrugated skin / hat stringers: 4 rounded ridges across a 128 x 16 tile."""
    w, h = 128, 16
    x = (np.arange(w) % 32) / 32.0
    prof = 0.5 + 0.5 * np.cos(TAU * x)
    return normal_from_height(np.tile(prof, (h, 1)), 3.0)


def tex_quilt():
    """A quilted thermal blanket: stitched squares (height and a slight colour change)."""
    n = 64
    yy, xx = np.mgrid[0:n, 0:n] / n
    hgt = np.sin(math.pi * xx) * np.sin(math.pi * yy)
    return normal_from_height(hgt ** 0.6, 3.5)


def tex_hex():
    """Starship-style hexagonal heat-shield tiles, colour: dark tiles with lighter gaps (512 px, 16 x 9 tiles)."""
    n = 512
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    s = n / 16.0  # tile width
    hgt = s / math.sqrt(3) * 1.5
    # axial hex grid: nearest centre
    best = np.full((n, n), 1e9)
    for row in range(-1, int(n / hgt) + 2):
        cy = row * hgt
        off = (row % 2) * s / 2
        for col in range(-1, 18):
            cx = col * s + off
            d = np.maximum(np.abs(xx - cx) * 0.866 + np.abs(yy - cy) * 0.5, np.abs(yy - cy))
            best = np.minimum(best, d)
    edge = np.clip((s * 0.5 - best) / 2.2, 0, 1)  # 0 at the gaps
    shade = 0.10 + 0.035 * edge
    col = np.stack([shade, shade * 1.02, shade * 1.06], -1)
    gap = (1 - edge)[..., None]
    col = col * (1 - gap) + np.array([0.42, 0.42, 0.40]) * gap * 0.6 + col * gap * 0.4
    return col


def tex_hex_normal():
    n = 512
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    s = n / 16.0
    hgt = s / math.sqrt(3) * 1.5
    best = np.full((n, n), 1e9)
    for row in range(-1, int(n / hgt) + 2):
        cy = row * hgt
        off = (row % 2) * s / 2
        for col in range(-1, 18):
            cx = col * s + off
            d = np.maximum(np.abs(xx - cx) * 0.866 + np.abs(yy - cy) * 0.5, np.abs(yy - cy))
            best = np.minimum(best, d)
    edge = np.clip((s * 0.5 - best) / 2.2, 0, 1)
    return normal_from_height(edge, 2.0)


def material(name, color, metal=0.4, rough=0.5, normal=None, nstrength=1.0, base=None):
    """A glTF PBR material. color: sRGB tuple or 0xRRGGBB. normal / base: numpy arrays from the tex_* functions."""
    if name in _M:
        return _M[name]
    if isinstance(color, int):
        color = hexc(color)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*srgb(color), 1.0)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if normal is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image(name + '_n', normal)
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = nstrength
        nt.links.new(tex.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    if base is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = image(name + '_c', base, color=True)
        nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    _M[name] = m
    return m


class P:
    """The tail palette (sRGB). Metalness kept moderate: the studio has no environment map."""
    @staticmethod
    def get(key):
        return {
            'white': lambda: material('white_paint', 0xeceae4, 0.08, 0.5),
            'offwhite': lambda: material('offwhite_paint', 0xdcdcd6, 0.08, 0.55),
            'grey': lambda: material('light_grey', 0xc4c8cb, 0.15, 0.5),
            'soyuz': lambda: material('soyuz_grey', 0xbfc6bc, 0.12, 0.55),
            'black': lambda: material('black_paint', 0x26282b, 0.2, 0.6),
            'dark': lambda: material('dark_metal', 0x34383d, 0.5, 0.45),
            'steel': lambda: material('engine_steel', 0xa3a8ad, 0.55, 0.32),
            'inconel': lambda: material('inconel', 0x8d9195, 0.55, 0.38),
            'stainless': lambda: material('stainless', 0xc5c9cc, 0.6, 0.26),
            'soot_steel': lambda: material('sooted_steel', 0x5d5a57, 0.45, 0.6),
            'alu': lambda: material('aluminium', 0xbfc3c7, 0.5, 0.36),
            'copper': lambda: material('chamber_copper', 0xb0703f, 0.6, 0.34),
            'regen': lambda: material('regen_bell', 0x8a8580, 0.32, 0.5, normal=tex_tubes(), nstrength=0.8),
            'regen_tube': lambda: material('regen_tubes', 0x8e8984, 0.35, 0.45, normal=tex_tubes(), nstrength=1.1),
            'soot': lambda: material('bell_soot', 0x1c1a19, 0.2, 0.9),
            'niobium': lambda: material('niobium_skirt', 0x4a4549, 0.55, 0.42),
            'cc': lambda: material('carbon_carbon', 0x232426, 0.25, 0.62),
            'ablative': lambda: material('ablative', 0x3b332d, 0.05, 0.9),
            'blanket': lambda: material('blanket_silver', 0xc9c8c2, 0.4, 0.5, normal=tex_quilt(), nstrength=0.8),
            'blanket_black': lambda: material('blanket_black', 0x2a2b2d, 0.1, 0.85, normal=tex_quilt(), nstrength=0.8),
            'fabric': lambda: material('fabric_boot', 0xd7d0bb, 0.0, 0.92, normal=tex_quilt(), nstrength=0.6),
            'gold': lambda: material('gold_foil', 0xc9a24a, 0.6, 0.3),
            'carbon': lambda: material('carbon_fibre', 0x1f2124, 0.3, 0.5),
            'foam': lambda: material('foam_orange', 0xc8783a, 0.0, 0.85),
            'foam_tan': lambda: material('foam_tan', 0xc89a62, 0.0, 0.85),
            'shield': lambda: material('base_shield', 0xb8bbbf, 0.45, 0.45),
            'plate': lambda: material('base_plate', 0x3d4147, 0.4, 0.6),
            'titanium': lambda: material('titanium', 0x6c6f73, 0.55, 0.42),
            'corr_white': lambda: material('corrugated_white', 0xe6e4de, 0.1, 0.5, normal=tex_corrugation(), nstrength=0.9),
            'corr_steel': lambda: material('corrugated_steel', 0xc0c4c7, 0.55, 0.3, normal=tex_corrugation(), nstrength=0.9),
            'hex': lambda: material('hex_tiles', 0x222326, 0.15, 0.7, normal=tex_hex_normal(), nstrength=0.9, base=tex_hex()),
            'amber': lambda: material('valve_amber', 0xc08a2a, 0.45, 0.45),
            'red': lambda: material('red_cover', 0xa8322b, 0.1, 0.6),
            'cable': lambda: material('cable_black', 0x202124, 0.1, 0.7),
            'grain': lambda: material('propellant_grain', 0x8a7a5a, 0.0, 0.9),
            'rubber': lambda: material('rubber_seal', 0x2c2c2e, 0.0, 0.8),
            'yellow': lambda: material('primer_yellow', 0xc9b04a, 0.2, 0.6),
            'green_grey': lambda: material('angara_grey', 0xb7beb3, 0.12, 0.55),
        }[key]()


_K = {}


def M(key):
    if key not in _K:
        _K[key] = P.get(key)
    return _K[key]


# ------------------------------------------------------------------ accumulator
class Acc:
    """Collects polygons (game coordinates) per material; emit() writes one Blender mesh object."""

    def __init__(self):
        self.V, self.F, self.UV, self.MI, self.mats = [], [], [], [], []

    def _mi(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def add(self, verts, faces, m, uvs=None):
        base = len(self.V)
        self.V.extend([tuple(v) for v in verts])
        mi = self._mi(m)
        for k, f in enumerate(faces):
            self.F.append(tuple(base + i for i in f))
            self.MI.append(mi)
            self.UV.append(uvs[k] if uvs else [(0.0, 0.0)] * len(f))

    def tris(self):
        return sum(len(f) - 2 for f in self.F)

    def emit(self, name, parent, sharp_deg=38):
        if not self.F:
            e = bpy.data.objects.new(name, None)
            bpy.context.scene.collection.objects.link(e)
            e.parent = parent
            return e
        # the mesh data must not start with slot_: three.js names a multi-material node's extra parts <mesh name>_1, _2...
        me = bpy.data.meshes.new('m_' + name)
        me.from_pydata([G(v) for v in self.V], [], self.F)
        for m in self.mats:
            me.materials.append(m)
        me.polygons.foreach_set('material_index', self.MI)
        uvl = me.uv_layers.new(name='UVMap')
        for p, uvs in zip(me.polygons, self.UV):
            for k in range(p.loop_total):
                uvl.data[p.loop_start + k].uv = uvs[k]
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(sharp_deg))
        me.update()
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        o.parent = parent
        return o


def node(name, parent):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    return e


def frame(d):
    """(e1, e2) orthonormal to the unit axis d; for d = +y this is (+x, -z), the same sweep as common.lathe."""
    d = Vector(d).normalized()
    a = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 0, 1))
    e1 = (a - d * a.dot(d)).normalized()
    return e1, d.cross(e1)


def rings(acc, centers, radii, e1s, e2s, m, seg, a0=0.0, a1=TAU, u_rep=1.0, cap0=False, cap1=False, flip=False, closed=False, vlen=None):
    """
    The workhorse: a swept surface through rings (centre, radius, frame) with `seg` sides. Quads face outward when the
    rings advance along e1 x e2 (game +y for a lathe walked bottom to top). A radius of ~0 collapses to one vertex.
    UV: u round (0..u_rep), v along (metres). closed=True joins the last ring to the first (a torus).
    """
    full = abs((a1 - a0) - TAU) < 1e-6
    ncol = seg if full else seg + 1
    verts, faces, uvs, idx = [], [], [], []
    vs = [0.0]
    for k in range(1, len(centers)):
        vs.append(vs[-1] + (Vector(centers[k]) - Vector(centers[k - 1])).length + abs(radii[k] - radii[k - 1]))
    for k, (c, r) in enumerate(zip(centers, radii)):
        c = Vector(c)
        if r < 1e-6:
            idx.append([len(verts)] * ncol)
            verts.append(c)
            continue
        row = []
        for i in range(ncol):
            a = a0 + (a1 - a0) * i / seg
            row.append(len(verts))
            verts.append(c + (e1s[k] * math.cos(a) + e2s[k] * math.sin(a)) * r)
        idx.append(row)
    nk = len(centers)
    pairs = [(k, k + 1) for k in range(nk - 1)] + ([(nk - 1, 0)] if closed else [])
    for (j, j2) in pairs:
        for i in range(seg):
            i2 = (i + 1) % ncol if full else i + 1
            a, b, c2, d = idx[j][i], idx[j][i2], idx[j2][i2], idx[j2][i]
            ua, ub = u_rep * i / seg, u_rep * (i + 1) / seg
            va, vb = vs[j], vs[j2] if j2 > j else vs[j] + (Vector(centers[j]) - Vector(centers[0])).length
            if a == b:  # apex at ring j
                f, uv = [a, c2, d], [(ua, va), (ub, vb), (ua, vb)]
            elif c2 == d:  # apex at ring j2
                f, uv = [a, b, c2], [(ua, va), (ub, va), (ua, vb)]
            else:
                f, uv = [a, b, c2, d], [(ua, va), (ub, va), (ub, vb), (ua, vb)]
            if flip:
                f, uv = f[::-1], uv[::-1]
            faces.append(f)
            uvs.append(uv)
    for (k, want) in ((0, cap0), (nk - 1, cap1)):
        if want and radii[k] > 1e-6 and full:
            f = list(idx[k])
            back = (k == 0) != flip
            f = f[::-1] if back else f
            faces.append(f)
            uvs.append([(0.5 + 0.5 * math.cos(TAU * i / seg), 0.5 + 0.5 * math.sin(TAU * i / seg)) for i in range(seg)][:: -1 if back else 1])
    acc.add(verts, faces, m, uvs)


def lathe(acc, prof, m, seg=32, c=(0, 0, 0), axis=(0, 1, 0), **kw):
    """Surface of revolution: prof = [(r, h), ...] along `axis` from the point c (game +y by default)."""
    d = Vector(axis).normalized()
    e1, e2 = frame(d)
    c = Vector(c)
    rings(acc, [c + d * h for (_, h) in prof], [r for (r, _) in prof], [e1] * len(prof), [e2] * len(prof), m, seg, **kw)


def cyl(acc, a, b, r, m, seg=12, caps=True, r2=None):
    """A cylinder (or frustum with r2) from point a to point b."""
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    lathe(acc, [(r, 0), (r if r2 is None else r2, L)], m, seg, a, b - a, cap0=caps, cap1=caps)


def sphere(acc, c, r, m, seg=16, rings_n=None):
    n = rings_n or max(4, seg // 2)
    prof = [(r * math.sin(math.pi * k / n), -r * math.cos(math.pi * k / n)) for k in range(n + 1)]
    lathe(acc, prof, m, seg, c)


def torus(acc, c, R, r, m, seg=32, seg2=6, axis=(0, 1, 0), a0=0.0, a1=TAU):
    d = Vector(axis).normalized()
    e1, e2 = frame(d)
    c = Vector(c)
    full = abs((a1 - a0) - TAU) < 1e-6
    n = seg if full else seg + 1
    pts = [c + (e1 * math.cos(a0 + (a1 - a0) * i / seg) + e2 * math.sin(a0 + (a1 - a0) * i / seg)) * R for i in range(n)]
    tube(acc, pts, r, m, seg2, closed=full)


def _transport(path, closed=False):
    """Tangents and rotation-minimising frames along a polyline."""
    P_ = [Vector(p) for p in path]
    n = len(P_)
    T = []
    for k in range(n):
        if closed:
            t = P_[(k + 1) % n] - P_[k - 1]
        elif k == 0:
            t = P_[1] - P_[0]
        elif k == n - 1:
            t = P_[-1] - P_[-2]
        else:
            t = (P_[k + 1] - P_[k]).normalized() + (P_[k] - P_[k - 1]).normalized()
        T.append(t.normalized())
    e1, _ = frame(T[0])
    E1, E2 = [], []
    for k in range(n):
        if k > 0:
            q = T[k - 1].rotation_difference(T[k])
            e1 = q @ e1
            e1 = (e1 - T[k] * e1.dot(T[k])).normalized()
        E1.append(e1.copy())
        E2.append(T[k].cross(e1))
    return P_, E1, E2


def tube(acc, path, r, m, seg=8, closed=False, caps=False, radii=None):
    """A pipe of radius r (or per-point radii) along a polyline."""
    keep = [0] + [k for k in range(1, len(path)) if (Vector(path[k]) - Vector(path[k - 1])).length > 1e-6]
    path = [path[k] for k in keep]
    radii = [radii[k] for k in keep] if radii else None
    P_, E1, E2 = _transport(path, closed)
    rr = radii or [r] * len(P_)
    rings(acc, P_, rr, E1, E2, m, seg, closed=closed, cap0=caps, cap1=caps)


def bend(pts, rad, n=4):
    """Rounds every inner corner of a polyline with an arc of radius `rad` (n points per corner)."""
    P_ = [Vector(p) for p in pts]
    out = [P_[0]]
    for k in range(1, len(P_) - 1):
        a, b, c = P_[k - 1], P_[k], P_[k + 1]
        u, w = (a - b), (c - b)
        lu, lw = u.length, w.length
        if lu < 1e-6 or lw < 1e-6:
            continue
        u, w = u / lu, w / lw
        ang = u.angle(w)
        if ang > math.pi - 1e-3:
            out.append(b)
            continue
        t = min(rad / math.tan(ang / 2), lu * 0.45, lw * 0.45)
        p0, p1 = b + u * t, b + w * t
        for i in range(n + 1):
            s = i / n
            out.append((1 - s) ** 2 * p0 + 2 * s * (1 - s) * b + s * s * p1)
    out.append(P_[-1])
    return out


def bellows(acc, a, b, r, m, folds=5, seg=10, depth=0.18):
    """A flexible bellows joint: a corrugated cylinder from a to b."""
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    prof = []
    for k in range(folds * 2 + 1):
        prof.append((r * (1 + depth if k % 2 else 1), L * k / (folds * 2)))
    lathe(acc, prof, m, seg, a, b - a)


def box(acc, c, size, m, axes=None):
    """A box centred at c with size (sx, sy, sz) along `axes` (three unit vectors; default x, y, z)."""
    c = Vector(c)
    X, Y, Z = axes or (V(1, 0, 0), V(0, 1, 0), V(0, 0, 1))
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    verts = [c + X * sx * hx + Y * sy * hy + Z * sz * hz for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    # index = (sx>0)*4 + (sy>0)*2 + (sz>0)
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    acc.add(verts, faces, m, [[(0, 0), (1, 0), (1, 1), (0, 1)]] * 6)


def beam(acc, a, b, w, d, m, up=None):
    """A box from a to b: w across (horizontal), d deep (perpendicular to both)."""
    a, b = Vector(a), Vector(b)
    Y = (b - a).normalized()
    ref = Vector(up) if up is not None else (V(0, 1, 0) if abs(Y.y) < 0.95 else V(1, 0, 0))
    X = Y.cross(ref)
    if X.length < 1e-6:
        X = Y.cross(V(0, 0, 1))
    X.normalize()
    Z = X.cross(Y).normalized()
    box(acc, (a + b) / 2, (w, (b - a).length, d), m, (X, Y, Z))


def fill2d(loops):
    """Triangles of a polygon with holes: loops = [outer, hole, hole...] of (u, v) points. Returns (points, tris)."""
    bm = bmesh.new()
    edges, pts = [], []
    for lp in loops:
        vs = [bm.verts.new((p[0], p[1], 0.0)) for p in lp]
        pts.extend(lp)
        for i in range(len(vs)):
            edges.append(bm.edges.new((vs[i], vs[(i + 1) % len(vs)])))
    bm.verts.index_update()
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges, normal=(0, 0, 1))
    bm.verts.ensure_lookup_table()
    tris = []
    for f in bm.faces:
        ids = [v.index for v in f.verts]
        a, b, c = [bm.verts[i].co for i in ids]
        if (b - a).cross(c - a).z < 0:
            ids = ids[::-1]
        tris.append(ids)
    bm.free()
    return pts, tris


def prism(acc, loops, t, m, o=(0, 0, 0), U=(1, 0, 0), Vv=(0, 0, -1), edge_m=None, uv_scale=1.0):
    """
    A flat plate: the polygon `loops` (outer + holes, in the plane spanned by U and Vv from o) extruded by t along
    U x Vv. Default plane is horizontal (U = +x, Vv = -z, so the plate rises along +y).
    """
    o, U, Vv = Vector(o), Vector(U).normalized(), Vector(Vv).normalized()
    W = U.cross(Vv).normalized()
    loops = [lp if _area(lp) > 0 else lp[::-1] for lp in loops]  # every loop counter-clockwise
    pts, tris = fill2d(loops)
    n = len(pts)
    bot = [o + U * p[0] + Vv * p[1] for p in pts]
    top = [q + W * t for q in bot]
    verts = bot + top
    faces, uvs = [], []
    for tr in tris:
        faces.append([n + i for i in tr])
        uvs.append([(pts[i][0] * uv_scale, pts[i][1] * uv_scale) for i in tr])
        faces.append([i for i in tr[::-1]])
        uvs.append([(pts[i][0] * uv_scale, pts[i][1] * uv_scale) for i in tr[::-1]])
    acc.add(verts, faces, m, uvs)
    # sides
    side_v, side_f = [], []
    start = 0
    for li, lp in enumerate(loops):
        L = len(lp)
        for i in range(L):
            a, b = start + i, start + (i + 1) % L
            k = len(side_v)
            side_v += [bot[a], bot[b], top[b], top[a]]
            side_f.append([k, k + 1, k + 2, k + 3] if li == 0 else [k + 3, k + 2, k + 1, k])
        start += L
    acc.add(side_v, side_f, edge_m or m)


def _area(lp):
    return 0.5 * sum(lp[i][0] * lp[(i + 1) % len(lp)][1] - lp[(i + 1) % len(lp)][0] * lp[i][1] for i in range(len(lp)))


def circle2d(cx, cy, r, n, a0=0.0, cw=False):
    pts = [(cx + r * math.cos(a0 + TAU * i / n), cy + r * math.sin(a0 + TAU * i / n)) for i in range(n)]
    return pts[::-1] if cw else pts


# ------------------------------------------------------------------ nozzle contours
def rao_bell(Rt, Re, length, th_n=32.0, th_e=9.0, n=14):
    """
    Thrust-optimised (Rao) bell from the throat to the exit: [(r, x)] with x measured downstream from the throat.
    A circular arc of radius 0.382 Rt leaves the throat, then a quadratic Bezier meets the exit at angle th_e.
    """
    rd = 0.382 * Rt
    tn, te = math.radians(th_n), math.radians(th_e)
    xN, rN = rd * math.sin(tn), Rt + rd - rd * math.cos(tn)
    m1, m2 = math.tan(tn), math.tan(te)
    c1, c2 = rN - m1 * xN, Re - m2 * length
    qx = (c2 - c1) / (m1 - m2)
    qr = m1 * qx + c1
    pts = [(Rt, 0.0)]
    for k in range(1, 3):
        a = tn * k / 2
        pts.append((Rt + rd - rd * math.cos(a), rd * math.sin(a)))
    for k in range(1, n + 1):
        t = k / n
        # cluster points toward the throat where the curvature is
        t = 1 - (1 - t) ** 1.35
        x = (1 - t) ** 2 * xN + 2 * t * (1 - t) * qx + t * t * length
        r = (1 - t) ** 2 * rN + 2 * t * (1 - t) * qr + t * t * Re
        pts.append((r, x))
    return pts


def bell_r_at(bell, x):
    """Radius of a rao_bell profile at the downstream distance x (linear between points)."""
    for (r0, x0), (r1, x1) in zip(bell, bell[1:]):
        if x0 <= x <= x1:
            return r0 + (r1 - r0) * (x - x0) / max(1e-9, x1 - x0)
    return bell[-1][0] if x > bell[-1][1] else bell[0][0]


def converging(Rt, Rc, th_c=30.0, n=5):
    """The chamber's converging section from the throat upstream: [(r, x)] with x upstream from the throat (x >= 0)."""
    ru = 1.5 * Rt
    tc = math.radians(th_c)
    pts = []
    for k in range(n + 1):
        a = tc * k / n
        pts.append((Rt + ru - ru * math.cos(a), ru * math.sin(a)))
    r1, x1 = pts[-1]
    # straight cone to near Rc, then a round shoulder
    rs = 0.9 * Rc
    xs = x1 + (rs - r1) / math.tan(tc)
    pts.append((rs, xs))
    pts.append((Rc * 0.985, xs + (Rc - rs) * 0.9))
    pts.append((Rc, xs + (Rc - rs) * 1.8))
    return pts


# ------------------------------------------------------------------ scene, checks, export
def reset():
    C.reset()
    _M.clear()
    _IMG.clear()
    _K.clear()
    for coll in (bpy.data.materials, bpy.data.images, bpy.data.meshes):
        for d in list(coll):
            coll.remove(d)


def root(name):
    return C.root(name)


def count(o):
    deps = bpy.context.evaluated_depsgraph_get()
    n = 0
    for x in [o] + list(o.children_recursive):
        if x.type == 'MESH':
            me = x.evaluated_get(deps).to_mesh()
            me.calc_loop_triangles()
            n += len(me.loop_triangles)
            x.evaluated_get(deps).to_mesh_clear()
    return n


def report_groups(r):
    for ch in r.children:
        ys = [(ch.matrix_world @ v.co).z for v in ch.data.vertices] if ch.type == 'MESH' else [0]
        print(f'[groups]   {ch.name}: {count(ch)} tris, y {min(ys):.3f}..{max(ys):.3f}')


def export(r, slug, height=None, radius=None, max_tris=20000):
    out = os.path.join(OUTDIR, slug + '.glb')
    return C.export(r, out, max_tris=max_tris, expect_height=height, expect_radius=radius)


def shots_arg():
    return C.arg('--shots')


def look(path, target, cam_pos, res=720, ortho=None, lens=50):
    """Render a preview from cam_pos looking at target (game coordinates)."""
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = res
    scene.render.film_transparent = False
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    cam.data.lens = lens
    cam.data.clip_end = 500
    if ortho:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = ortho
    cam.location = G(cam_pos)
    t = Vector(G(target))
    cam.rotation_euler = (t - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    lights = []
    for (rx, rz, e) in ((50, 30, 3.2), (65, 210, 1.2)):
        sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
        sun.data.energy = e
        sun.rotation_euler = (math.radians(rx), 0, math.radians(rz))
        scene.collection.objects.link(sun)
        lights.append(sun)
    world = scene.world or bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Strength'].default_value = 0.7
    bg.inputs['Color'].default_value = (0.32, 0.34, 0.37, 1)
    scene.render.filepath = os.path.abspath(path)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    for s in lights:
        bpy.data.objects.remove(s, do_unlink=True)


def hide_except(r, keep):
    """Preview helper: hide every slot variant except the chosen ones (keep: {key: optionId or None})."""
    for o in r.children_recursive:
        if not o.name.startswith('slot_'):
            continue
        key, _, opt = o.name[5:].partition('__')
        want = keep.get(key, None)
        if want == '__none__':
            show = False
        else:
            show = (opt == want) if opt else (want is None or not any(c.name == f'slot_{key}__{want}' for c in r.children_recursive))
        for x in [o] + list(o.children_recursive):
            x.hide_render = not show


def show_all(r):
    for o in [r] + list(r.children_recursive):
        o.hide_render = False
