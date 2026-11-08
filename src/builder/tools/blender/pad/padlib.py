"""
Launch pad (ground) pieces: shared helpers on top of ../common.py. Read ../README.md "Ground models" first.

Every piece is built for the REFERENCE SHIP, 20 m tall and 2.5 m wide (radius 1.25 m), in GAME coordinates (metres,
x right, y up, z toward the viewer), origin on the ground at the piece's own anchor:
  - a mount, deck, trench or table: centred on the rocket's axis;
  - a tower, mast or arm structure: the centre of its base, its face toward the rocket on -X;
  - a far-field piece (water tower, sphere, lightning tower): the centre of its base, real size.
`sections/pad/art.js` scales a piece along one axis family only (towers in height by H / 20, mounts and arms across by
D / 2.5, far-field pieces not at all), so details keep their shape. Named nodes:
  - `attach_<name>`: an empty marking a point the art uses (the deck the ship stands on, an arm's pivot);
  - `pose_<name>`: a part that moves, its origin on its pivot, modelled in its working pose (arm at the ship);
  - plain names (`body`, `head`, `plate`, `deflector_wedge`, ...): parts the art may hide, repeat or re-place.

Geometry is written through a small builder (Piece) that keeps ONE mesh per node with one primitive per material, box-
projected UVs in world metres (so the generated tileable textures keep their real size), and a 4x4 transform stack like
the code-drawn art's Kit. Textures are generated here with seeded numpy noise (stable output from run to run).
"""
import bpy, bmesh, math, os, sys, json, tempfile
import numpy as np
from mathutils import Vector, Matrix
from mathutils.geometry import tessellate_polygon

sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import common as C  # noqa: E402

REF_H, REF_D, REF_R = 20.0, 2.5, 1.25
HERE = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp(prefix='padtex_')
DEG = math.pi / 180


def G(p):
    return (p[0], -p[2], p[1])


def GI(b):
    """blender (x, y, z) -> game (x, z, -y)"""
    return (b[0], b[2], -b[1])


# ------------------------------------------------------------------ colours and materials
def lin(hexcol):
    """sRGB hex (the code-drawn art's colours) -> linear, as glTF and three.js expect."""
    out = []
    for k in (16, 8, 0):
        c = ((hexcol >> k) & 255) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


# name: (sRGB hex as in sections/pad/art.js M, roughness, metalness, texture kind or None, texture tile in metres)
PALETTE = {
    'concrete': (0xa7a8a4, 0.95, 0.0, 'concrete', 8.0),
    'concrete_old': (0x8a8982, 0.95, 0.0, 'concrete_old', 8.0),
    'scorch': (0x5d5851, 0.95, 0.0, None, 1),
    'trench': (0x2a2b2c, 0.95, 0.0, 'concrete_dark', 8.0),
    'brick': (0x8c5b45, 0.9, 0.0, 'brick', 2.4),
    'steel': (0x9ea5ab, 0.45, 0.55, None, 1),
    'steel_dark': (0x4a5158, 0.55, 0.5, None, 1),
    'deck': (0x7f878d, 0.6, 0.45, 'grating', 2.4),
    'paint': (0xb3472f, 0.6, 0.3, None, 1),          # the tower colour: art.js recolours it (red, white, grey, dark)
    'red': (0xb3472f, 0.6, 0.3, None, 1),
    'orange': (0xc8642a, 0.6, 0.3, None, 1),
    'grey': (0x8d949a, 0.55, 0.45, None, 1),
    'grey_light': (0xb9bec2, 0.55, 0.35, None, 1),
    'white': (0xe6e8ea, 0.5, 0.08, None, 1),
    'glass': (0x24313c, 0.25, 0.3, None, 1),
    'yellow': (0xe0b03a, 0.5, 0.2, None, 1),
    'green': (0x3f8a5a, 0.6, 0.3, None, 1),           # Baikonur's launch-system green
    'blue': (0x2e5f9a, 0.55, 0.3, None, 1),
    'wire': (0x2a2d31, 0.6, 0.5, None, 1),
    'rubber': (0x1e1f21, 0.9, 0.0, None, 1),
    'earth': (0x7d6c52, 1.0, 0.0, None, 1),
    'slope': (0x9a958a, 1.0, 0.0, None, 1),           # the hardstand's paved and grassed slopes, plain
    'ceramic': (0x9c9a92, 0.9, 0.0, None, 1),         # the deflector's heat-proof face (Fondu Fyre)
    'silver': (0xc3c7cb, 0.35, 0.5, None, 1),         # aluminised fabric (escape baskets)
    'light': (0xf3efd8, 0.4, 0.0, None, 1),
    'slab_top': (0xa7a8a4, 0.95, 0.0, 'slab_top', 17.0),  # one tile over the whole slab: the scorch sits at uv (0, 0)
}
_mats = {}


def material(name):
    if name in _mats:
        return _mats[name]
    hexcol, rough, metal, tex, tile = PALETTE[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*lin(hexcol), 1.0)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if tex:
        img = texture(tex)
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = img
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    _mats[name] = m
    return m


# ------------------------------------------------------------------ generated textures (seeded, tileable)
_tex = {}


def _noise(n, scale, rng):
    """Tileable value noise: a coarse random grid, bicubic-ish upsampled with wrap-around."""
    g = rng.random((scale, scale))
    reps = n // scale
    x = np.arange(n) / reps
    i0 = np.floor(x).astype(int) % scale
    i1 = (i0 + 1) % scale
    f = x - np.floor(x)
    f = f * f * (3 - 2 * f)
    rows = g[i0][:, :] * (1 - f)[:, None] + g[i1] * f[:, None]
    return rows[:, i0] * (1 - f)[None, :] + rows[:, i1] * f[None, :]


def _fbm(n, rng, octaves=((4, 0.5), (8, 0.25), (16, 0.15), (32, 0.1))):
    v = np.zeros((n, n))
    for s, a in octaves:
        v += a * _noise(n, s, rng)
    return v / sum(a for _, a in octaves)


def _save(name, rgb):
    h, w, _ = rgb.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    arr = np.concatenate([np.clip(rgb, 0, 1), np.ones((h, w, 1))], -1)
    img.pixels.foreach_set(np.flipud(arr).astype(np.float32).ravel())
    img.filepath_raw = os.path.join(TMP, name + '.jpg')
    img.file_format = 'JPEG'
    img.save()
    img.pack()
    return img


def _srgb(hexcol):
    return np.array([((hexcol >> k) & 255) / 255 for k in (16, 8, 0)])


def texture(kind):
    if kind in _tex:
        return _tex[kind]
    rng = np.random.RandomState(sum(ord(ch) for ch in kind) * 7919 % 100000)
    n = 512
    if kind in ('concrete', 'concrete_old', 'concrete_dark'):
        base = {'concrete': 0xa7a8a4, 'concrete_old': 0x8a8982, 'concrete_dark': 0x2e2f30}[kind]
        c = _srgb(base)
        low = _fbm(n, rng)
        mid = _fbm(n, rng, ((32, 0.6), (64, 0.4)))
        v = 0.92 + 0.09 * (low - 0.5) + 0.035 * (mid - 0.5)
        if kind == 'concrete_old':
            stains = _fbm(n, rng, ((4, 0.6), (16, 0.4)))
            v -= 0.08 * np.clip((stains - 0.55) * 4, 0, 1)
        # cast-in-place joints every half tile (3 m): soft, wide lines (thin ones shimmer far off)
        yy, xx = np.mgrid[0:n, 0:n]
        d = np.minimum(np.minimum(xx % (n // 2), (n // 2) - xx % (n // 2)), np.minimum(yy % (n // 2), (n // 2) - yy % (n // 2)))
        v = v * (1 - 0.1 * np.clip(1 - d / 5.0, 0, 1))
        rgb = c[None, None, :] * v[..., None]
        img = _save(kind, rgb)
    elif kind == 'brick':
        # heat-proof refractory brick: 6 rows x 4 bricks per 512 px tile... set by the tile size (2.4 m): 0.6 x 0.2 m
        yy, xx = np.mgrid[0:n, 0:n]
        rows = 12
        rh = n // rows
        row = yy // rh
        off = np.where(row % 2 == 0, 0, n // 8)
        bw = n // 4
        bx = (xx + off) % bw
        by = yy % rh
        mortar = (bx < 4) | (by < 4)
        brick_id = ((xx + off) // bw) + row * 7
        tint = rng.random(4 * rows * 8 + 64)[brick_id % (4 * rows * 8 + 64)]
        c = _srgb(0x8c5b45)
        v = (0.82 + 0.3 * tint) * (0.92 + 0.12 * _fbm(n, rng))
        rgb = c[None, None, :] * v[..., None]
        soot = _fbm(n, rng, ((2, 0.5), (8, 0.5)))
        rgb *= (1 - 0.35 * np.clip((soot - 0.45) * 3, 0, 1))[..., None]
        rgb[mortar] = _srgb(0x6d6a62) * 0.85
        img = _save(kind, rgb)
    elif kind == 'grating':
        m = 256
        yy, xx = np.mgrid[0:m, 0:m]
        bar = (xx % 16) < 5
        cross = (yy % 64) < 5
        c = _srgb(0x7f878d)
        v = np.where(bar | cross, 1.0, 0.72) * (0.95 + 0.1 * _fbm(m, rng, ((4, 0.6), (16, 0.4))))
        rgb = c[None, None, :] * v[..., None]
        img = _save(kind, rgb)
    elif kind == 'slab_top':
        # a launch slab seen from above: concrete with expansion joints and the engines' scorch in the middle
        yy, xx = np.mgrid[0:n, 0:n] / n - 0.5
        r = np.hypot(xx, yy)
        c = _srgb(0xa7a8a4)
        v = 0.9 + 0.12 * (_fbm(n, rng) - 0.5) + 0.035 * (_fbm(n, rng, ((32, 0.6), (64, 0.4))) - 0.5)
        rgb = c[None, None, :] * v[..., None]
        ang = np.arctan2(yy, xx)
        streak = 0.5 + 0.5 * np.sin(ang * 23 + 3 * np.sin(ang * 7))
        burn = np.clip(1 - (r - 0.06) / (0.22 + 0.05 * streak), 0, 1) ** 1.6
        burn *= 0.85 + 0.15 * _fbm(n, rng, ((8, 0.5), (32, 0.5)))
        sc = _srgb(0x2c2925)
        rgb = rgb * (1 - burn[..., None]) + sc[None, None, :] * burn[..., None]
        px = np.mgrid[0:n, 0:n]
        joint = ((px[1] % (n // 8)) < 2) | ((px[0] % (n // 8)) < 2)
        rgb[joint] *= 0.75
        rgb = np.roll(np.roll(rgb, n // 2, 0), n // 2, 1)  # the scorch's centre at the tile corner (world 0, 0)
        img = _save(kind, rgb)
    else:
        raise ValueError(kind)
    _tex[kind] = img
    return img


# ------------------------------------------------------------------ the piece builder
def T(x=0.0, y=0.0, z=0.0):
    return Matrix.Translation((x, y, z))


def Ry(deg):
    return Matrix.Rotation(deg * DEG, 4, 'Y')


def Rx(deg):
    return Matrix.Rotation(deg * DEG, 4, 'X')


def Rz(deg):
    return Matrix.Rotation(deg * DEG, 4, 'Z')


def S(sx, sy=None, sz=None):
    sy = sx if sy is None else sy
    sz = sx if sz is None else sz
    return Matrix.Diagonal((sx, sy, sz, 1.0))


class Node:
    def __init__(self, name, parent, origin, rot_y=0.0):
        self.name, self.parent, self.origin, self.rot_y = name, parent, Vector(origin), rot_y
        self.geo = {}  # material -> [verts(list of Vector), faces(list of tuple), smooth(list of bool)]
        self.obj = None


class Piece:
    """One ground piece (one GLB). Geometry goes to the current node; `with p.node('pose_arm', pivot):` switches."""

    def __init__(self, slug, anchor, scale, notes=''):
        C.reset()
        _mats.clear()
        _tex.clear()
        for im in list(bpy.data.images):
            bpy.data.images.remove(im)
        self.slug, self.anchor, self.scale, self.notes = slug, anchor, scale, notes
        self.nodes = [Node(slug, None, (0, 0, 0))]
        self.cur = self.nodes[0]
        self.stack = [Matrix.Identity(4)]
        self.attach = {}
        self.extra = {}

    # ---- nodes and transforms
    def node(self, name, origin=(0, 0, 0), parent=None, rot_y=0.0):
        """Switch to (or create) a node; `parent` is a node name; rot_y turns the node's own frame (game degrees)."""
        p = self
        n = next((k for k in self.nodes if k.name == name), None)
        if n is None:
            par = next(k for k in self.nodes if k.name == parent) if parent else self.nodes[0]
            n = Node(name, par, origin, rot_y)
            self.nodes.append(n)

        class _Ctx:
            def __enter__(s):
                s.prev = p.cur
                p.cur = n
                return n

            def __exit__(s, *a):
                p.cur = s.prev
        return _Ctx()

    def mark(self, name, pos, parent=None):
        """An attach_<name> empty at pos (game coords), under the node named `parent` (default the root)."""
        par = next(k for k in self.nodes if k.name == parent) if parent else self.nodes[0]
        n = Node('attach_' + name, par, pos)
        n.empty = True
        self.nodes.append(n)
        self.attach[name] = [round(v, 3) for v in pos]

    def push(self, m):
        self.stack.append(self.stack[-1] @ m)

    def pop(self):
        self.stack.pop()

    class _Frame:
        def __init__(s, p, m):
            s.p, s.m = p, m

        def __enter__(s):
            s.p.push(s.m)

        def __exit__(s, *a):
            s.p.pop()

    def at(self, m):
        return Piece._Frame(self, m)

    # ---- low level
    def add(self, mat, verts, faces, smooth=False):
        g = self.cur.geo.setdefault(mat, [[], [], []])
        M = self.stack[-1]
        base = len(g[0])
        for v in verts:
            g[0].append(M @ Vector(v))
        for f in faces:
            g[1].append(tuple(base + i for i in f))
            g[2].append(smooth if not isinstance(smooth, (list, tuple)) else None)
        if isinstance(smooth, (list, tuple)):
            g[2][-len(faces):] = list(smooth)

    # ---- primitives (local coordinates, current transform)
    def box(self, mat, w, h, d, x=0.0, y=0.0, z=0.0, ry=0.0, rx=0.0, rz=0.0, chamfer=0.0):
        hx, hy, hz = w / 2, h / 2, d / 2
        M = T(x, y, z) @ Ry(ry) @ Rx(rx) @ Rz(rz)
        if chamfer > 0 and min(w, h, d) > 3 * chamfer:
            c = chamfer
            # a box with its vertical edges and top edges chamfered (concrete, heavy steel): 16 verts
            pts = [(-hx + c, -hz), (hx - c, -hz), (hx, -hz + c), (hx, hz - c), (hx - c, hz), (-hx + c, hz), (-hx, hz - c), (-hx, -hz + c)]
            inner = [(px - math.copysign(c, px) * (abs(px) >= hx - 1e-6), pz - math.copysign(c, pz) * (abs(pz) >= hz - 1e-6)) for px, pz in pts]
            verts = [(px, -hy, pz) for px, pz in pts] + [(px, hy - c, pz) for px, pz in pts] + [(px, hy, pz) for px, pz in inner]
            verts = [tuple(M @ Vector(v)) for v in verts]
            faces = []
            for i in range(8):
                j = (i + 1) % 8
                faces.append((i, j, 8 + j, 8 + i))
                faces.append((8 + i, 8 + j, 16 + j, 16 + i))
            faces.append(tuple(range(23, 15, -1)))
            faces.append(tuple(range(0, 8)))
            self.add(mat, verts, faces)
            self._fix_last(mat, len(faces))
            return
        v = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz), (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)]
        v = [tuple(M @ Vector(p)) for p in v]
        f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (3, 7, 6, 2), (0, 4, 7, 3), (1, 2, 6, 5)]
        self.add(mat, v, f)

    def _fix_last(self, mat, nfaces):
        """Make the last n faces' winding point outward from their own centroid group (cheap normal fix)."""
        g = self.cur.geo[mat]
        faces = g[1][-nfaces:]
        idx = sorted({i for f in faces for i in f})
        cen = sum((g[0][i] for i in idx), Vector()) / len(idx)
        out = []
        for f in faces:
            a, b, c = g[0][f[0]], g[0][f[1]], g[0][f[2]]
            n = (b - a).cross(c - a)
            fc = sum((g[0][i] for i in f), Vector()) / len(f)
            out.append(f if n.dot(fc - cen) >= 0 else tuple(reversed(f)))
        g[1][-nfaces:] = out

    def beam(self, mat, a, b, t, t2=None, roll=0.0):
        """A straight member of section t x t2 (default square) from a to b."""
        a, b = Vector(a), Vector(b)
        d = b - a
        L = d.length
        if L < 1e-5:
            return
        t2 = t if t2 is None else t2
        q = Vector((0, 1, 0)).rotation_difference(d.normalized())
        M = T(*a) @ q.to_matrix().to_4x4() @ Ry(roll) @ T(0, L / 2, 0)
        with self.at(M):
            self.box(mat, t, L, t2)

    def tube(self, mat, a, b, r, seg=8, caps=True, r2=None):
        a, b = Vector(a), Vector(b)
        d = b - a
        L = d.length
        if L < 1e-5:
            return
        q = Vector((0, 1, 0)).rotation_difference(d.normalized())
        with self.at(T(*a) @ q.to_matrix().to_4x4()):
            self.lathe(mat, [(r, 0.0), (r if r2 is None else r2, L)], seg=seg, caps=caps)

    def lathe(self, mat, profile, seg=32, x=0.0, z=0.0, caps=True, arc=360.0, a0=0.0, smooth=True):
        """
        Surface of revolution round the local y axis; profile [(r, y)] walked with the solid on its left (bottom to
        top along the outside), which makes the normals point out. r = 0 makes an apex.
        """
        full = abs(arc - 360) < 1e-6
        n = seg if full else seg + 1
        verts, faces, sm = [], [], []
        rings = []
        for (r, y) in profile:
            if r < 1e-6:
                rings.append([len(verts)] * n)
                verts.append((x, y, z))
                continue
            ring = []
            for i in range(n):
                ang = (a0 + arc * i / seg) * DEG
                ring.append(len(verts))
                verts.append((x + r * math.cos(ang), y, z - r * math.sin(ang)))
            rings.append(ring)
        for j in range(len(rings) - 1):
            for i in range(seg):
                i2 = (i + 1) % n if full else i + 1
                fa = [rings[j][i], rings[j][i2], rings[j + 1][i2], rings[j + 1][i]]
                fa = [v for k, v in enumerate(fa) if v not in fa[:k]]
                if len(fa) < 3:
                    continue
                faces.append(tuple(fa))
                sm.append(smooth)
        if caps and full:
            if profile[0][0] > 1e-5:
                faces.append(tuple(reversed(rings[0])))
                sm.append(False)
            if profile[-1][0] > 1e-5:
                faces.append(tuple(rings[-1]))
                sm.append(False)
        self.add(mat, verts, faces, smooth=sm)

    def cyl(self, mat, r, y0, y1, x=0.0, z=0.0, seg=24, caps=True):
        self.lathe(mat, [(r, y0), (r, y1)], seg=seg, x=x, z=z, caps=caps)

    def sphere(self, mat, r, x=0.0, y=0.0, z=0.0, seg=24, rings=12, sy=1.0, top=1.0):
        prof = []
        for k in range(rings + 1):
            t = -math.pi / 2 + math.pi * k / rings
            if math.sin(t) > top * 1.0001 - 1e-9 and top < 1:
                break
            prof.append((max(1e-6, r * math.cos(t)), y + r * sy * math.sin(t)))
        prof[0] = (0.0, prof[0][1])
        if top >= 1:
            prof[-1] = (0.0, prof[-1][1])
        self.lathe(mat, prof, seg=seg, x=x, z=z, caps=False)

    def torus(self, mat, R, r, x=0.0, y=0.0, z=0.0, seg=32, seg2=6, arc=360.0, a0=0.0):
        """A ring round the local y axis (a pipe ring, a rail)."""
        full = abs(arc - 360) < 1e-6
        n = seg if full else seg + 1
        verts, faces = [], []
        for i in range(n):
            a = (a0 + arc * i / seg) * DEG
            for k in range(seg2):
                b = 2 * math.pi * k / seg2
                rr = R + r * math.cos(b)
                verts.append((x + rr * math.cos(a), y + r * math.sin(b), z - rr * math.sin(a)))
        for i in range(seg if full else seg):
            i2 = (i + 1) % n
            for k in range(seg2):
                k2 = (k + 1) % seg2
                faces.append((i * seg2 + k, i2 * seg2 + k, i2 * seg2 + k2, i * seg2 + k2))
        self.add(mat, verts, faces, smooth=True)
        # orient: away from the tube's centre line
        g = self.cur.geo[mat]
        M = self.stack[-1]
        inv = M.inverted()
        out = []
        for f in g[1][-len(faces):]:
            pts = [inv @ g[0][i] for i in f]
            nrm = (pts[1] - pts[0]).cross(pts[2] - pts[0])
            fc = sum(pts, Vector()) / 4
            ang = math.atan2(-(fc.z - z), fc.x - x)
            cl = Vector((x + R * math.cos(ang), y, z - R * math.sin(ang)))
            out.append(f if nrm.dot(fc - cl) >= 0 else tuple(reversed(f)))
        g[1][-len(faces):] = out

    def prism(self, mat, pts, y0, y1):
        """A polygon of [(x, z)] points extruded from y0 to y1 (any simple polygon)."""
        n = len(pts)
        if n < 3:
            return
        # counter-clockwise in (x, -z) (seen from above) makes the side quads (i, j, j', i') face out
        area = sum(pts[i][0] * (-pts[(i + 1) % n][1]) - pts[(i + 1) % n][0] * (-pts[i][1]) for i in range(n))
        if area < 0:
            pts = list(reversed(pts))
        verts = [(x, y0, z) for x, z in pts] + [(x, y1, z) for x, z in pts]
        faces = []
        for t in tessellate_polygon([[Vector((x, -z, 0)) for x, z in pts]]):
            (ax, az), (bx, bz), (cx, cz) = pts[t[0]], pts[t[1]], pts[t[2]]
            ccw = (bx - ax) * (-(cz - az)) - (cx - ax) * (-(bz - az)) > 0
            t = t if ccw else (t[2], t[1], t[0])
            faces.append((n + t[0], n + t[1], n + t[2]))
            faces.append((t[2], t[1], t[0]))
        for i in range(n):
            j = (i + 1) % n
            faces.append((i, j, n + j, n + i))
        self.add(mat, verts, faces)

    def loft(self, mat, pts0, pts1, y0, y1, top=None, bottom=True):
        """Joins polygon pts0 at y0 to polygon pts1 at y1 (same vertex count and order): a slope-sided block."""
        n = len(pts0)
        def ccw(pts):
            return sum(pts[i][0] * (-pts[(i + 1) % n][1]) - pts[(i + 1) % n][0] * (-pts[i][1]) for i in range(n)) > 0
        if not ccw(pts1):
            pts0, pts1 = list(reversed(pts0)), list(reversed(pts1))
        verts = [(x, y0, z) for x, z in pts0] + [(x, y1, z) for x, z in pts1]
        sides = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        self.add(mat, verts, sides)
        tris = tessellate_polygon([[Vector((x, -z, 0)) for x, z in pts1]])
        capt = []
        for t in tris:
            (ax, az), (bx, bz), (cx, cz) = pts1[t[0]], pts1[t[1]], pts1[t[2]]
            ok = (bx - ax) * (-(cz - az)) - (cx - ax) * (-(bz - az)) > 0
            capt.append(t if ok else (t[2], t[1], t[0]))
        self.add(top or mat, [(x, y1, z) for x, z in pts1], capt)
        if bottom:
            self.add(mat, [(x, y0, z) for x, z in pts0], [(t[2], t[1], t[0]) for t in capt])

    def side_prism(self, mat, pts_yz, x0, x1):
        """A polygon of [(y, z)] points (a side profile) extruded across x from x0 to x1."""
        with self.at(Rz(90)):
            self.prism(mat, [(y, z) for (y, z) in pts_yz], -x1, -x0)

    def front_prism(self, mat, pts_xy, z0, z1):
        """A polygon of [(x, y)] points (a front profile) extruded along z from z0 to z1."""
        with self.at(Rx(-90)):
            self.prism(mat, [(x, y) for (x, y) in pts_xy], -z1, -z0)

    def disc(self, mat, r, y, x=0.0, z=0.0, seg=32):
        verts = [(x, y, z)] + [(x + r * math.cos(2 * math.pi * i / seg), y, z - r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        faces = [(0, 1 + i, 1 + (i + 1) % seg) for i in range(seg)]
        self.add(mat, verts, faces)

    def quad(self, mat, a, b, c, d):
        self.add(mat, [a, b, c, d], [(0, 1, 2, 3)])

    # ---- structures
    def lattice(self, mat, x=0.0, z=0.0, w=2.0, d=None, y0=0.0, y1=10.0, bay=2.4, t=0.16, ry=0.0, faces='nsew', top_ring=True, diag=0.8):
        """A square lattice tower: four columns, a ring of beams every bay, alternating diagonals on each face."""
        d = w if d is None else d
        hx, hz, h = w / 2, d / 2, y1 - y0
        n = max(1, round(h / bay))
        step = h / n
        tt = t * 0.7
        with self.at(T(x, 0, z) @ Ry(ry)):
            for cx, cz in ((-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz)):
                self.box(mat, t, h, t, cx, y0 + h / 2, cz)
            for i in range(n + 1):
                if i == n and not top_ring:
                    continue
                y = y0 + i * step
                if 'n' in faces:
                    self.box(mat, w, tt, tt, 0, y, -hz)
                if 's' in faces:
                    self.box(mat, w, tt, tt, 0, y, hz)
                if 'w' in faces:
                    self.box(mat, tt, tt, d, -hx, y, 0)
                if 'e' in faces:
                    self.box(mat, tt, tt, d, hx, y, 0)
            for i in range(n):
                a = y0 + i * step
                b = a + step
                f = 1 if i % 2 else -1
                if 'n' in faces:
                    self.beam(mat, (-hx * f, a, -hz), (hx * f, b, -hz), tt * diag)
                if 's' in faces:
                    self.beam(mat, (hx * f, a, hz), (-hx * f, b, hz), tt * diag)
                if 'w' in faces:
                    self.beam(mat, (-hx, a, -hz * f), (-hx, b, hz * f), tt * diag)
                if 'e' in faces:
                    self.beam(mat, (hx, a, hz * f), (hx, b, -hz * f), tt * diag)

    def xbrace_face(self, mat, a, b, c, d, t, n=1):
        """X-bracing in the quad a-b-c-d (a,b bottom; d,c top), split in n panels up its height."""
        A, B, Cc, D = map(Vector, (a, b, c, d))
        for i in range(n):
            f0, f1 = i / n, (i + 1) / n
            l0, r0 = A.lerp(D, f0), B.lerp(Cc, f0)
            l1, r1 = A.lerp(D, f1), B.lerp(Cc, f1)
            self.beam(mat, l0, r1, t)
            self.beam(mat, r0, l1, t)

    def truss(self, mat, a, b, w, h, panel=1.0, t=0.08, up=(0, 1, 0)):
        """A rectangular box truss from a to b: four chords, verticals and alternating diagonals (arms, booms)."""
        A, B = Vector(a), Vector(b)
        d = B - A
        L = d.length
        x = d.normalized()
        upv = Vector(up)
        y = (upv - x * upv.dot(x)).normalized()
        z = x.cross(y)
        n = max(1, round(L / panel))
        corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        P = lambda f, cy, cz: A + d * f + y * (cy * h / 2) + z * (cz * w / 2)
        for cy, cz in corners:
            self.beam(mat, P(0, cy, cz), P(1, cy, cz), t)
        for i in range(n + 1):
            f = i / n
            for k in range(4):
                (y0, z0), (y1, z1) = corners[k], corners[(k + 1) % 4]
                self.beam(mat, P(f, y0, z0), P(f, y1, z1), t * 0.7)
        for i in range(n):
            f0, f1 = i / n, (i + 1) / n
            s = 1 if i % 2 else -1
            for cz in (-1, 1):
                self.beam(mat, P(f0, -s, cz), P(f1, s, cz), t * 0.6)
            for cy in (-1, 1):
                self.beam(mat, P(f0, cy, -s), P(f1, cy, s), t * 0.6)

    def railing(self, mat, pts, y, h=1.1, step=1.5, closed=False, t=0.05):
        """A safety railing (posts, top and mid rails) along [(x, z)] at level y."""
        n = len(pts)
        segs = n if closed else n - 1
        for i in range(segs):
            (x0, z0), (x1, z1) = pts[i], pts[(i + 1) % n]
            L = math.hypot(x1 - x0, z1 - z0)
            if L < 1e-3:
                continue
            for hh in (h, h * 0.5):
                self.beam(mat, (x0, y + hh, z0), (x1, y + hh, z1), t)
            k = max(1, round(L / step))
            for j in range(k + (0 if closed or i < segs - 1 else 1)):
                f = j / k
                self.box(mat, t, h, t, x0 + (x1 - x0) * f, y + h / 2, z0 + (z1 - z0) * f)

    def stairs(self, mat, a, b, width=0.9, rise=0.2, t=0.06):
        """A stair flight from a (bottom, (x, y, z)) to b (top): two stringers and treads."""
        A, B = Vector(a), Vector(b)
        d = B - A
        hor = Vector((d.x, 0, d.z))
        side = Vector((-hor.z, 0, hor.x)).normalized() * (width / 2)
        for s in (-1, 1):
            self.beam(mat, A + side * s, B + side * s, t * 2.2, t)
        n = max(2, round(d.y / rise))
        ang = math.degrees(math.atan2(-hor.z, hor.x)) if hor.length > 1e-6 else 0
        for i in range(1, n):
            p = A.lerp(B, i / n)
            self.box(mat, max(0.25, hor.length / n * 1.1), 0.04, width, p.x, p.y, p.z, ry=ang)

    # ---- finish
    def build(self):
        # a ground piece stands on the ground: members laid on y = 0 (half their thickness below) are cut flat there
        for n in self.nodes:
            for (vs, fs, sm) in n.geo.values():
                for v in vs:
                    if -0.4 < v.y < 0.0:
                        v.y = 0.0
        objs = {}
        for n in self.nodes:
            if getattr(n, 'empty', False) or not n.geo:
                o = bpy.data.objects.new(n.name, None)
                o.empty_display_size = 0.5
            else:
                me = bpy.data.meshes.new('m_' + n.name)  # mesh data named apart from its node (three.js names a node's parts after it)
                verts, faces, mats, smooth = [], [], [], []
                inv = Ry(-n.rot_y).to_3x3()
                for mi, (mname, (vs, fs, sm)) in enumerate(n.geo.items()):
                    base = len(verts)
                    verts += [G(inv @ (v - n.origin)) for v in vs]
                    for f, s in zip(fs, sm):
                        faces.append(tuple(base + i for i in f))
                        mats.append(mi)
                        smooth.append(bool(s))
                me.from_pydata(verts, [], faces)
                for mname in n.geo:
                    me.materials.append(material(mname))
                for p, mi, s in zip(me.polygons, mats, smooth):
                    p.material_index = mi
                    p.use_smooth = s
                # box-projected UVs in world metres / the material's tile
                uv = me.uv_layers.new(name='UVMap')
                for p in me.polygons:
                    mname = list(n.geo.keys())[p.material_index]
                    tile = PALETTE[mname][4]
                    nrm = p.normal
                    ax = max(range(3), key=lambda k: abs(nrm[k]))
                    for li in p.loop_indices:
                        co = Vector(G(Ry(n.rot_y).to_3x3() @ Vector(GI(me.vertices[me.loops[li].vertex_index].co)) + n.origin))
                        # blender coords: x, y(-game z), z(game y)
                        if ax == 2:
                            u, v = co.x, co.y
                        elif ax == 0:
                            u, v = co.y, co.z
                        else:
                            u, v = co.x, co.z
                        uv.data[li].uv = (u / tile, v / tile)
                me.validate(clean_customdata=False)
                me.update()
                o = bpy.data.objects.new(n.name, me)
            bpy.context.scene.collection.objects.link(o)
            objs[n.name] = o
        for n in self.nodes:
            o = objs[n.name]
            if n.parent is not None:
                o.parent = objs[n.parent.name]
                pr = Ry(-n.parent.rot_y).to_3x3()
                o.location = G(pr @ (n.origin - n.parent.origin))
                o.rotation_euler = (0, 0, (n.rot_y - n.parent.rot_y) * DEG)
            else:
                o.location = G(n.origin)
        self.objs = objs
        self.root = objs[self.slug]
        self.root['pad'] = json.dumps({'slug': self.slug, 'anchor': self.anchor, 'scale': self.scale, 'ref': {'H': REF_H, 'D': REF_D}, 'attach': self.attach, **self.extra})
        return self.root


# ------------------------------------------------------------------ export, checks, manifest
def export(piece, out_dir, max_tris=20000, max_kb=400):
    root = piece.build()
    out = os.path.join(out_dir, piece.slug + '.glb')
    tris, lo, hi = C.stats(root)
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root] + list(root.children_recursive):
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(out), export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12,
        export_materials='EXPORT', export_cameras=False, export_lights=False, export_extras=True,
        export_image_format='AUTO', export_jpeg_quality=82,
    )
    size = os.path.getsize(out)
    names = [o.name for o in [root] + list(root.children_recursive)]
    print(f'[pad] {piece.slug}: {tris} triangles, {size / 1024:.0f} KB, x {lo[0]:.2f}..{hi[0]:.2f}, y {lo[1]:.2f}..{hi[1]:.2f}, z {lo[2]:.2f}..{hi[2]:.2f}')
    if tris > max_tris:
        print(f'[pad] WARNING: {piece.slug} {tris} triangles is over {max_tris}')
    if size > max_kb * 1024:
        print(f'[pad] WARNING: {piece.slug} is over {max_kb} KB')
    entry = {
        'file': f'pad/{piece.slug}.glb', 'anchor': piece.anchor, 'scale': piece.scale, 'notes': piece.notes,
        'tris': tris, 'kb': round(size / 1024), 'bbox': [[round(v, 2) for v in lo], [round(v, 2) for v in hi]],
        'nodes': sorted(n for n in names if n != piece.slug), 'attach': piece.attach, **piece.extra,
    }
    return entry


def write_manifest(entries):
    path = os.path.join(HERE, 'pieces.json')
    data = {}
    if os.path.exists(path):
        with open(path, encoding='utf8') as f:
            data = json.load(f)
    data.update(entries)
    data = dict(sorted(data.items()))
    with open(path, 'w', encoding='utf8') as f:
        json.dump(data, f, indent=1)
        f.write('\n')


# ------------------------------------------------------------------ preview next to the reference ship
def preview(piece, path, ship=(0.0, 0.0, 0.0), ship_on=True, views=('34', 'detail', 'side'), res=720, ground=True, extra_ships=(), frame=12.0):
    """Renders the piece beside a 20 m x 2.5 m reference cylinder standing at `ship` (x, deck height, z)."""
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = res
    scene.render.film_transparent = False
    tmp = []
    ref = []
    if ship_on:
        for (sx, sy, sz) in [ship] + list(extra_ships):
            ref_mat = bpy.data.materials.get('ref_ship') or bpy.data.materials.new('ref_ship')
            ref_mat.use_nodes = True
            ref_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.9, 0.9, 0.92, 1)
            band = bpy.data.materials.get('ref_band') or bpy.data.materials.new('ref_band')
            band.use_nodes = True
            band.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.05, 0.05, 0.06, 1)
            o = C.cylinder('ref_ship', REF_R, sy, sy + REF_H, ref_mat, None, segments=32, x=sx, z=sz)
            tmp.append(o)
            for k in range(1, 4):
                b = C.ring(f'ref_band{k}', REF_R, sy + 5 * k, 0.15, 0.01, band, None, segments=32)
                b.location = G((sx, 0, sz))
                tmp.append(b)
            ref.append(o)
    if ground:
        gm = bpy.data.materials.new('ground_prev')
        gm.use_nodes = True
        gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*lin(0xb9ad87), 1)
        g = C.cylinder('ground_prev', 80, -0.05, -0.01, gm, None, segments=48)
        tmp.append(g)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.2
    sun.data.angle = 0.05
    sun.rotation_euler = (math.radians(48), math.radians(8), math.radians(35))
    scene.collection.objects.link(sun)
    tmp.append(sun)
    world = scene.world or bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.52, 0.62, 0.78, 1)
    bg.inputs['Strength'].default_value = 0.9
    # framing: the piece (within `frame` metres of the ship's axis, so long trenches and rails do not shrink it) and the ship
    objs = [o for o in [piece.root] + list(piece.root.children_recursive) if o.type == 'MESH']
    pts = []
    for o in objs:
        me = o.data
        mw = o.matrix_world
        for v in me.vertices:
            w = mw @ v.co
            if abs(w.x - ship[0]) <= frame and abs(-w.y - ship[2]) <= frame:
                pts.append(w)
    if not pts:
        pts = [Vector(G(ship))]
    plo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    phi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    sx, sy, sz = G(ship)
    lo, hi = plo.copy(), phi.copy()
    if ship_on:
        lo = Vector((min(lo.x, sx - REF_R), min(lo.y, sy - REF_R), min(lo.z, sz)))
        hi = Vector((max(hi.x, sx + REF_R), max(hi.y, sy + REF_R), max(hi.z, sz + REF_H)))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    tmp.append(cam)
    scene.camera = cam
    outs = []
    for v in views:
        L, Hh = (lo, hi) if v != 'detail' else (plo, phi)
        if v == 'detail':
            Hh = Vector((Hh.x, Hh.y, min(Hh.z, plo.z + max(phi.x - plo.x, phi.y - plo.y) * 0.8)))
        centre = (L + Hh) / 2
        rad = (Hh - L).length / 2
        if v in ('34', 'detail', 'low'):
            cam.data.type = 'PERSP'
            cam.data.lens = 40 if v != 'low' else 28
            fov = cam.data.angle
            az, el = {'34': (-120, 16), 'detail': (-125, 24), 'low': (-100, 6)}[v]
            az, el = math.radians(az), math.radians(el)
            dist = rad / math.sin(fov / 2) * (0.95 if v != 'low' else 0.8)
            dirv = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
        elif v == 'side':
            cam.data.type = 'ORTHO'
            cam.data.ortho_scale = max(Hh.x - L.x, Hh.z - L.z) * 1.08
            dist = rad * 3 + 50
            dirv = Vector((0, -1, 0.0))
        elif v == 'front':
            cam.data.type = 'ORTHO'
            cam.data.ortho_scale = max(Hh.y - L.y, Hh.z - L.z) * 1.08
            dist = rad * 3 + 50
            dirv = Vector((-1, 0, 0.0))
        elif v == 'top':
            cam.data.type = 'ORTHO'
            cam.data.ortho_scale = max(Hh.x - L.x, Hh.y - L.y) * 1.08
            dist = rad * 3 + 50
            dirv = Vector((0, -0.001, 1))
        cam.location = centre + dirv * dist
        cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.clip_end = dist * 4 + 200
        p = path.replace('.png', f'_{v}.png')
        scene.render.filepath = os.path.abspath(p)
        bpy.ops.render.render(write_still=True)
        outs.append(p)
    for o in tmp:
        bpy.data.objects.remove(o, do_unlink=True)
    return outs
