"""
Body-section modelling library (SpaceB&E builder, Role 1). Shared by tanks.py, structures.py and side.py; build.py runs
them. Read ../README.md (the contract) first.

Everything is written in GAME coordinates (metres, x right, y up, z toward the viewer) and converted once to Blender with
common.G. Geometry goes into accumulators (Acc): many primitives, one mesh per node with one material slot per material,
so a model has few nodes (the outer skin, the details, and one node per kit slot that the explanation card pulls apart).
Colours are sRGB hex (like the code-drawn art) converted to linear for glTF. Textures are small tiles generated with
numpy from fixed formulas and seeded noise, so every run writes the same files.

Node names (see build.py's docstring for the full list):
  shell                      the outer skin (it fades to see-through when the card is open)
  detail, frames, inner      fittings and ring frames outside; domes and supports inside
  slot_<key>                 the piece of a kit slot in the look of the kit's FIRST option ...
  slot_<key>__<optionId>     ... and its version for every other option (an empty node when the option has no piece);
                             a skirt's skin is its `construction` slot, so the ship shows the chosen build
  piece_<name>               other notable inner pieces (cluster tanks, spheres, truss)
"""
import bpy, bmesh, json, math, os, sys, tempfile
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
import common as C  # noqa: E402

TAU = 2 * math.pi
G = C.G
RADIUS = C.RADIUS
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..', '..'))
OUTDIR = os.path.join(REPO, 'public', 'assets', 'models', 'builder', 'body')
TMP = tempfile.mkdtemp(prefix='body_tex_')
_PARTS = None


def part(pid):
    """A part's data from sections/body/parts.json (height, size, hullProfile), so the models follow the catalogue."""
    global _PARTS
    if _PARTS is None:
        with open(os.path.join(REPO, 'src', 'builder', 'sections', 'body', 'parts.json'), encoding='utf-8') as f:
            data = json.load(f)
        _PARTS = {p['id']: p for p in (data['parts'] if isinstance(data, dict) else data)}
    return _PARTS[pid]


def dims(pid):
    """(height, stack radius) of a part."""
    p = part(pid)
    return float(p['height']), RADIUS[p['size']]


def V(x, y=None, z=None):
    return Vector(x) if y is None else Vector((x, y, z))


def lerp(a, b, t):
    return a + (b - a) * t


def polar(deg, r, y=0.0):
    """A point at angle deg (from +x toward -z, the same sweep as common.lathe), radius r, height y."""
    a = math.radians(deg)
    return V(r * math.cos(a), y, -r * math.sin(a))


def radial(deg):
    a = math.radians(deg)
    return V(math.cos(a), 0, -math.sin(a))


def tangent(deg):
    a = math.radians(deg)
    return V(-math.sin(a), 0, -math.cos(a))


# ------------------------------------------------------------------ colours, textures, materials
def srgb(c):
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


def hexc(h):
    return ((h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255)


_M, _IMG, _K = {}, {}, {}


def image(name, arr, color=False):
    """arr: float array (h, w, 3|4) in 0..1, saved as PNG and packed (the exporter embeds it)."""
    if name in _IMG:
        return _IMG[name]
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1))], axis=2)
    arr = np.round(np.clip(arr, 0, 1) * 255) / 255  # 8-bit steps: identical bytes every run
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


def _noise(n, cells, seed):
    """Smooth tileable value noise (n x n) with `cells` lattice cells per side, fixed seed."""
    rs = np.random.RandomState(seed)
    g = rs.rand(cells, cells)
    t = np.arange(n) * cells / n
    i0 = np.floor(t).astype(int)
    f = t - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    a = g[i0][:, i0] * (1 - f)[None, :] + g[i0][:, i1] * f[None, :]
    b = g[i1][:, i0] * (1 - f)[None, :] + g[i1][:, i1] * f[None, :]
    return a * (1 - f)[:, None] + b * f[:, None]


def fbm(n, seed, octaves=(4, 8, 16, 32), amps=(0.5, 0.25, 0.15, 0.1)):
    out = np.zeros((n, n))
    for k, (c, a) in enumerate(zip(octaves, amps)):
        out += a * _noise(n, c, seed + 17 * k)
    return out / sum(amps)


def tex_foam_n(n=128, seed=3):
    """Sprayed foam: a soft lumpy surface (normal map)."""
    return normal_from_height(fbm(n, seed, (8, 16, 32), (0.5, 0.3, 0.2)), 2.2)


def tex_foam_c(base, n=128, seed=5, amount=0.07):
    """Sprayed foam colour: the base colour with soft mottling (sRGB array)."""
    v = fbm(n, seed, (4, 8, 16), (0.5, 0.3, 0.2))
    c = np.array(hexc(base))
    return np.clip(c[None, None, :] * (1 + amount * (v[..., None] - 0.5) * 2), 0, 1)


def tex_mottle(base, dark, n=128, seed=9, contrast=1.0):
    """Two-tone mottling (the Tiodize-finished Atlas tanks, cork): mixes base and dark by tileable noise."""
    v = fbm(n, seed, (3, 6, 12, 24), (0.45, 0.3, 0.15, 0.1))
    v = np.clip((v - 0.5) * 2.2 * contrast + 0.5, 0, 1)[..., None]
    return np.array(hexc(base))[None, None, :] * (1 - v) + np.array(hexc(dark))[None, None, :] * v


def tex_speckle(base, dark, n=128, seed=13, density=0.2):
    """Cork: fine dark speckles on a tan ground."""
    rs = np.random.RandomState(seed)
    s = (rs.rand(n, n) < density).astype(float)
    s = (s + np.roll(s, 1, 0) * 0.5 + np.roll(s, 1, 1) * 0.5) / 2
    v = np.clip(s, 0, 1)[..., None] * 0.7
    return np.array(hexc(base))[None, None, :] * (1 - v) + np.array(hexc(dark))[None, None, :] * v


def tex_quilt(n=64):
    """A quilted MLI blanket: stitched squares with a crinkle."""
    yy, xx = np.mgrid[0:n, 0:n] / n
    hgt = (np.sin(math.pi * xx) * np.sin(math.pi * yy)) ** 0.6 + 0.12 * fbm(n, 21, (8, 16), (0.6, 0.4))
    return normal_from_height(hgt, 3.5)


def tex_brushed(w=16, h=128, seed=31):
    """Brushed stainless: fine horizontal lines (v runs along the rocket, so the lines run round it)."""
    rs = np.random.RandomState(seed)
    line = np.convolve(rs.rand(h), np.ones(3) / 3, mode='same')
    return normal_from_height(np.tile(line[:, None], (1, w)), 1.2)


def tex_grid(kind, n=256, rib=0.08, pocket=0.0):
    """Machined stiffening seen from outside or on a panel: 'isogrid' (triangles), 'orthogrid' (squares), 'waffle'
    (squares at 45 degrees). One tile = one cell (isogrid: two triangle rows). Height map -> normal map."""
    if kind == 'isogrid':
        w, h = n, int(round(n * math.sqrt(3)))
        yy, xx = np.mgrid[0:h, 0:w].astype(float)
        u, v = xx / w, yy / h * math.sqrt(3)  # triangle side 1; the tile is one side wide and two rows tall
        s = math.sqrt(3) / 2  # spacing of each family of parallel ribs
        d = []
        for (nx, ny) in ((0.0, 1.0), (-s, 0.5), (s, 0.5)):  # normals of the ribs at 0, 60 and 120 degrees
            q = (u * nx + v * ny) / s
            d.append(np.abs(q - np.round(q)) * s)
        dist = np.minimum.reduce(d)
    else:
        w = h = n
        yy, xx = np.mgrid[0:h, 0:w].astype(float) / n
        if kind == 'waffle':
            xx, yy = (xx + yy), (xx - yy)
        dist = np.minimum(np.abs(xx - np.round(xx)), np.abs(yy - np.round(yy)))
    hgt = np.clip(1 - (dist - rib / 2) / 0.02, 0, 1)
    return normal_from_height(hgt * 0.9 + pocket, 3.0)


def tex_slats(n=128):
    """Skirt stringer bays seen from outside (the white skirts of the Delta IV / ICPS hydrogen tank): rows of
    rectangles. u: 4 bays round, v: 2 rows."""
    yy, xx = np.mgrid[0:n, 0:n].astype(float) / n
    bx = np.abs(((xx * 4) % 1) - 0.5)
    by = np.abs(((yy * 2) % 1) - 0.5)
    edge = np.clip((np.maximum(bx * 1.0, by * 0.5 / 0.5) - 0.44) / 0.04, 0, 1)
    return normal_from_height(1 - edge, 2.5)


def tex_corrugation(n=64, ridges=4):
    """Corrugated skin: rounded ridges across the tile (u round the part)."""
    x = (np.arange(n) % (n // ridges)) / (n // ridges)
    prof = 0.5 + 0.5 * np.cos(TAU * x)
    return normal_from_height(np.tile(prof, (16, 1)), 3.0)


def tex_hex(n=128, cells=8):
    """Honeycomb core (colour): pale cells with darker walls."""
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    s = n / cells
    hgt_ = s * math.sqrt(3) / 2
    best = np.full((n, n), 1e9)
    for row in range(-1, int(n / hgt_) + 2):
        cy = row * hgt_
        off = (row % 2) * s / 2
        for col in range(-1, cells + 2):
            cx = col * s + off
            d = np.maximum(np.abs(xx - cx) * 0.866 + np.abs(yy - cy) * 0.5, np.abs(yy - cy))
            best = np.minimum(best, d)
    edge = np.clip((s * 0.43 - best) / 1.5, 0, 1)
    wall, cell = np.array(hexc(0x8a7a52)), np.array(hexc(0xd8c48a))
    return wall[None, None, :] * (1 - edge[..., None]) + cell[None, None, :] * edge[..., None]


def tex_twill(n=64):
    """2x2 twill carbon weave (normal map)."""
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    cell = n / 8
    flip = (((xx // cell) + (yy // cell)) % 2) == 0
    t = np.where(flip, xx + yy, xx - yy)
    h = 0.5 + 0.5 * np.sin(TAU * t / (cell / 2))
    return normal_from_height(h, 1.0)


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


# The body palette (sRGB). Metalness kept moderate: the studio has no environment map. Real colours (models.md).
PALETTE = {
    'white': lambda: material('white_paint', 0xeceae4, 0.08, 0.5),
    'white_panel': lambda: material('white_panel', 0xe9e8e3, 0.08, 0.5, normal=tex_slats(), nstrength=0.7),
    'cream': lambda: material('cream_paint', 0xe8e1cc, 0.08, 0.55),
    'cream_foam': lambda: material('cream_foam', 0xe3d4a6, 0.0, 0.85, normal=tex_foam_n(seed=4), nstrength=0.6),
    'foam_white': lambda: material('foam_white', 0xeeeae2, 0.0, 0.8, normal=tex_foam_n(seed=6), nstrength=0.7),
    'foam_et': lambda: material('foam_orange', 0xffffff, 0.0, 0.9, normal=tex_foam_n(seed=3), nstrength=0.9,
                                base=tex_foam_c(0xd07434, seed=5)),
    'foam_tan': lambda: material('foam_tan', 0xffffff, 0.0, 0.9, normal=tex_foam_n(seed=7), nstrength=0.8,
                                 base=tex_foam_c(0xc98a4e, seed=8)),
    'foam_dark': lambda: material('foam_dark_trim', 0xa95a24, 0.0, 0.9),
    'cork': lambda: material('cork', 0xffffff, 0.0, 0.9, base=tex_speckle(0xa9825a, 0x5e432a)),
    'tiodize': lambda: material('tiodize_copper', 0xffffff, 0.45, 0.42, base=tex_mottle(0xc4916a, 0xad7c58, seed=12, contrast=0.5)),
    'soyuz': lambda: material('soyuz_grey', 0xbfc6bc, 0.15, 0.55),
    'soyuz_dark': lambda: material('soyuz_grey_dark', 0x9aa197, 0.2, 0.55),
    'grey': lambda: material('light_grey', 0xc4c8cb, 0.15, 0.5),
    'n1': lambda: material('n1_white', 0xe2e2dc, 0.08, 0.55),
    'black': lambda: material('black_paint', 0x26282b, 0.15, 0.6),
    'dark': lambda: material('dark_metal', 0x34383d, 0.5, 0.45),
    'frame': lambda: material('frame_dark', 0x2b3036, 0.45, 0.5),
    'alu': lambda: material('aluminium', 0xbfc3c7, 0.5, 0.36),
    'alu_cut': lambda: material('aluminium_machined', 0xc9ccd0, 0.55, 0.3),
    'al_li': lambda: material('al_li', 0xa9aca9, 0.5, 0.42),
    'stainless': lambda: material('stainless', 0xc5c9cc, 0.6, 0.26, normal=tex_brushed(), nstrength=0.6),
    'steel': lambda: material('steel', 0xa3a8ad, 0.55, 0.32),
    'titanium': lambda: material('titanium', 0x7f8388, 0.55, 0.42),
    'copper': lambda: material('copper', 0xb0703f, 0.6, 0.34),
    'bronze': lambda: material('bronze_ring', 0xa58a55, 0.55, 0.38),
    'gold': lambda: material('gold_foil', 0xc9a24a, 0.6, 0.3, normal=tex_quilt(), nstrength=0.6),
    'mli': lambda: material('mli_silver', 0xb4b9bd, 0.6, 0.3, normal=tex_quilt(), nstrength=1.2),
    'carbon': lambda: material('carbon_fibre', 0x1f2124, 0.3, 0.5, normal=tex_twill(), nstrength=0.5),
    'copv': lambda: material('copv_overwrap', 0x2a2c2f, 0.3, 0.45, normal=tex_twill(), nstrength=0.7),
    'truss_black': lambda: material('composite_truss', 0x15181b, 0.25, 0.55),
    'red': lambda: material('red_bottle', 0xa8322b, 0.15, 0.5),
    'green': lambda: material('umbilical_green', 0x5fd0a8, 0.1, 0.55),
    'amber': lambda: material('valve_amber', 0xc08a2a, 0.45, 0.45),
    'yellow': lambda: material('primer_yellow', 0xc9b04a, 0.2, 0.6),
    'blue': lambda: material('blue_band', 0x2d4f9a, 0.1, 0.5),
    'cable': lambda: material('cable_black', 0x202124, 0.1, 0.7),
    'honeycomb': lambda: material('honeycomb_core', 0xffffff, 0.2, 0.6, base=tex_hex()),
    'tile': lambda: material('foam_tiles', 0xd8cc9a, 0.0, 0.85),
    'glass_cloth': lambda: material('glass_cloth', 0xe7dfc4, 0.0, 0.8),
    'box': lambda: material('avionics_box', 0x3a4048, 0.4, 0.5),
    'box_light': lambda: material('avionics_box_light', 0x8a929b, 0.45, 0.45),
    'box_beige': lambda: material('avionics_box_beige', 0xb9ae94, 0.2, 0.55),
    'coldplate': lambda: material('cold_plate', 0x9aa3ab, 0.55, 0.32),
    'orange_box': lambda: material('fts_orange', 0xd0632a, 0.2, 0.5),
    'heat': lambda: material('heat_shield_ti', 0x6c6f73, 0.55, 0.42),
    'soot': lambda: material('soot', 0x2a2826, 0.2, 0.85),
    'grain': lambda: material('propellant_grain', 0x8a7a5a, 0.0, 0.9),
    'isogrid': lambda: material('isogrid_bare', 0xb7bbbf, 0.5, 0.4, normal=tex_grid('isogrid'), nstrength=1.0),
    'orthogrid': lambda: material('orthogrid_bare', 0xb7bbbf, 0.5, 0.4, normal=tex_grid('orthogrid'), nstrength=1.0),
    'iso_white': lambda: material('isogrid_white', 0xe6e5df, 0.08, 0.5, normal=tex_grid('isogrid'), nstrength=0.8),
    'ortho_white': lambda: material('orthogrid_white', 0xe6e5df, 0.08, 0.5, normal=tex_grid('orthogrid'), nstrength=0.8),
}


def M(key):
    if key not in _K:
        _K[key] = PALETTE[key]()
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
            return node(name, parent)
        me = bpy.data.meshes.new('m_' + name)  # mesh data named apart from its node (three.js names sub-meshes after it)
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


def rings(acc, centers, radii, e1s, e2s, m, seg, a0=0.0, a1=TAU, u_rep=1.0, v_scale=1.0, cap0=False, cap1=False,
          flip=False, closed=False):
    """
    The workhorse: a swept surface through rings (centre, radius, frame) with `seg` sides. Quads face outward when the
    rings advance along e1 x e2 (game +y for a lathe walked bottom to top). A radius of ~0 collapses to one vertex.
    UV: u round (0..u_rep), v along (metres x v_scale). closed=True joins the last ring to the first (a torus).
    """
    full = abs((a1 - a0) - TAU) < 1e-6
    ncol = seg if full else seg + 1
    verts, faces, uvs, idx = [], [], [], []
    vs = [0.0]
    for k in range(1, len(centers)):
        vs.append(vs[-1] + ((Vector(centers[k]) - Vector(centers[k - 1])).length + abs(radii[k] - radii[k - 1])) * v_scale)
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
            va, vb = vs[j], (vs[j2] if j2 > j else vs[j] + 1.0)
            if a == b:
                f, uv = [a, c2, d], [(ua, va), (ub, vb), (ua, vb)]
            elif c2 == d:
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


def cyl(acc, a, b, r, m, seg=12, caps=True, r2=None, **kw):
    """A cylinder (or frustum with r2) from point a to point b."""
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    lathe(acc, [(r, 0), (r if r2 is None else r2, L)], m, seg, a, b - a, cap0=caps, cap1=caps, **kw)


def sphere(acc, c, r, m, seg=16, rings_n=None, sy=1.0):
    """A sphere (sy squashes it along y: an oblate tank)."""
    n = rings_n or max(4, seg // 2)
    prof = [(r * math.sin(math.pi * k / n), -r * sy * math.cos(math.pi * k / n)) for k in range(n + 1)]
    lathe(acc, prof, m, seg, c)


def capsule(acc, c, r, length, m, seg=16, axis=(0, 1, 0), n=4):
    """A cylinder with hemispherical ends (a COPV or a bottle), `length` overall along axis, centred at c."""
    L = max(0.0, length - 2 * r)
    prof = []
    for k in range(n + 1):
        a = math.pi / 2 * k / n
        prof.append((r * math.sin(a), -L / 2 - r * math.cos(a)))
    for k in range(n + 1):
        a = math.pi / 2 * k / n
        prof.append((r * math.cos(a), L / 2 + r * math.sin(a)))
    lathe(acc, prof, m, seg, c, axis)


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


def bellows(acc, a, b, r, m, folds=4, seg=10, depth=0.25):
    """A flexible bellows joint: a corrugated cylinder from a to b."""
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    prof = [(r * (1 + depth if k % 2 else 1), L * k / (folds * 2)) for k in range(folds * 2 + 1)]
    lathe(acc, prof, m, seg, a, b - a)


def box(acc, c, size, m, axes=None):
    """A box centred at c with size (sx, sy, sz) along `axes` (three unit vectors; default x, y, z)."""
    c = Vector(c)
    X, Y, Z = axes or (V(1, 0, 0), V(0, 1, 0), V(0, 0, 1))
    X, Y, Z = Vector(X), Vector(Y), Vector(Z)
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    verts = [c + X * sx * hx + Y * sy * hy + Z * sz * hz for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    if X.cross(Y).dot(Z) < 0:  # left-handed axes: turn the faces so they still face outward
        faces = [f[::-1] for f in faces]
    acc.add(verts, faces, m, [[(0, 0), (1, 0), (1, 1), (0, 1)]] * 6)


def beam(acc, a, b, w, d, m, up=None):
    """A box from a to b: w across, d deep (perpendicular to both)."""
    a, b = Vector(a), Vector(b)
    Y = (b - a).normalized()
    ref = Vector(up) if up is not None else (V(0, 1, 0) if abs(Y.y) < 0.95 else V(1, 0, 0))
    X = Y.cross(ref)
    if X.length < 1e-6:
        X = Y.cross(V(0, 0, 1))
    X.normalize()
    Z = X.cross(Y).normalized()
    box(acc, (a + b) / 2, (w, (b - a).length, d), m, (X, Y, Z))


def on_wall(acc, deg, r, y, size, m, out=0.0):
    """A box sitting on a cylinder wall at angle deg: size = (along the tangent, height, thickness outward)."""
    R_, T_ = radial(deg), tangent(deg)
    c = V(0, y, 0) + R_ * (r + out + size[2] / 2)
    box(acc, c, (size[0], size[1], size[2]), m, (T_, V(0, 1, 0), R_))


def curved_panel(acc, r, deg0, deg1, y0, y1, m, seg=12, thick=0.0, u_rep=1.0, v_scale=1.0, rows=1):
    """A piece of a cylinder wall between angles deg0..deg1 (degrees) and heights y0..y1, optionally with thickness
    (inward). u/v as rings()."""
    e1, e2 = frame((0, 1, 0))
    a0, a1 = math.radians(deg0), math.radians(deg1)
    ys = [y0 + (y1 - y0) * k / rows for k in range(rows + 1)]
    rings(acc, [V(0, y, 0) for y in ys], [r] * len(ys), [e1] * len(ys), [e2] * len(ys), m, seg, a0, a1, u_rep, v_scale)
    if thick > 0:
        ri = r - thick
        rings(acc, [V(0, y, 0) for y in ys], [ri] * len(ys), [e1] * len(ys), [e2] * len(ys), m, seg, a0, a1, u_rep, v_scale, flip=True)
        # edges
        for a in (a0, a1):
            d = V(math.cos(a), 0, -math.sin(a))
            pts = [d * r + V(0, y0, 0), d * r + V(0, y1, 0), d * ri + V(0, y1, 0), d * ri + V(0, y0, 0)]
            f = [0, 1, 2, 3] if a == a0 else [3, 2, 1, 0]
            acc.add(pts, [f], m)
        for y, up in ((y0, False), (y1, True)):
            rings(acc, [V(0, y, 0), V(0, y, 0)], [ri, r], [e1, e1], [e2, e2], m, seg, a0, a1, flip=not up)


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
    bm.verts.ensure_lookup_table()
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges, normal=(0, 0, 1))
    tris = []
    for f in bm.faces:
        ids = [v.index for v in f.verts]
        a, b, c = [bm.verts[i].co for i in ids]
        if (b - a).cross(c - a).z < 0:
            ids = ids[::-1]
        tris.append(ids)
    bm.free()
    return pts, tris


def _area(lp):
    return 0.5 * sum(lp[i][0] * lp[(i + 1) % len(lp)][1] - lp[(i + 1) % len(lp)][0] * lp[i][1] for i in range(len(lp)))


def circle2d(cx, cy, r, n, a0=0.0):
    return [(cx + r * math.cos(a0 + TAU * i / n), cy + r * math.sin(a0 + TAU * i / n)) for i in range(n)]


def rounded_rect2d(cx, cy, w, h, rad, n=3):
    pts = []
    for (sx, sy, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ox, oy = cx + sx * (w / 2 - rad), cy + sy * (h / 2 - rad)
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((ox + rad * math.cos(a), oy + rad * math.sin(a)))
    return pts


def wrap_on_cyl(acc, loops, r, deg_c, y_c, m, out=0.002, flipx=False):
    """A flat 2D shape (loops in metres: u along the tangent, v up) laid onto a cylinder of radius r, centred at angle
    deg_c and height y_c, `out` metres proud of the wall. Used for stencils and painted panels."""
    pts, tris = fill2d(loops)
    verts = []
    for (u, v) in pts:
        a = math.radians(deg_c) + (u / r) * (-1 if flipx else 1)  # u runs to the viewer's right
        verts.append(V((r + out) * math.cos(a), y_c + v, -(r + out) * math.sin(a)))
    faces = [list(t) for t in tris]
    # tris are counter-clockwise in (u, v); on the wall u runs along -tangent... make them face outward
    test = faces[0]
    a_, b_, c_ = verts[test[0]], verts[test[1]], verts[test[2]]
    nrm = (b_ - a_).cross(c_ - a_)
    mid = (a_ + b_ + c_) / 3
    if nrm.dot(V(mid.x, 0, mid.z)) < 0:
        faces = [f[::-1] for f in faces]
    acc.add(verts, faces, m, [[(pts[i][0], pts[i][1]) for i in f] for f in faces])


_GLYPHS = {}


def stencil_font():
    """Inter (SIL Open Font License 1.1), the font that ships in Blender's own data files: the same letters on every
    machine, and a licence that allows shipping the letter shapes in a model."""
    path = os.path.join(bpy.utils.system_resource('DATAFILES', path='fonts'), 'Inter.woff2')
    if not os.path.exists(path):
        raise FileNotFoundError(f'the stencil font is missing: {path}')
    return bpy.data.fonts.load(path, check_existing=True)


def glyph(ch, size):
    """The outline of one letter (Blender's built-in font) as loops of 2D points, `size` tall (cap height ~0.7 size)."""
    key = (ch, round(size, 4))
    if key in _GLYPHS:
        return _GLYPHS[key]
    cu = bpy.data.curves.new('glyph', 'FONT')
    cu.font = stencil_font()
    cu.body = ch
    cu.size = size
    cu.resolution_u = 3
    cu.fill_mode = 'BOTH'
    cu.offset = size * 0.06  # stencil letters are bold
    ob = bpy.data.objects.new('glyph', cu)
    bpy.context.scene.collection.objects.link(ob)
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(deps))
    verts = [(v.co.x, v.co.y) for v in me.vertices]
    faces = [list(p.vertices) for p in me.polygons]
    width = (max(v[0] for v in verts) - min(v[0] for v in verts)) if verts else size * 0.3
    xmin = min((v[0] for v in verts), default=0.0)
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    _GLYPHS[key] = (verts, faces, width, xmin)
    return _GLYPHS[key]


def stencil_vertical(acc, text, r, deg_c, y_top, size, pitch, m, out=0.003):
    """Upright letters stacked downward on a cylinder wall (the UNITED STATES of the Titan II), centred at angle deg_c."""
    y = y_top
    for ch in text:
        if ch != ' ':
            verts, faces, width, xmin = glyph(ch, size)
            vs = []
            for (u, v) in verts:
                uu = u - xmin - width / 2
                a = math.radians(deg_c) + uu / r
                vs.append(V((r + out) * math.cos(a), y - size * 0.72 + v, -(r + out) * math.sin(a)))
            fs = []
            for f in faces:
                a_, b_, c_ = vs[f[0]], vs[f[1]], vs[f[2]]
                nrm = (b_ - a_).cross(c_ - a_)
                mid = (a_ + b_ + c_) / 3
                fs.append(f if nrm.dot(V(mid.x, 0, mid.z)) >= 0 else f[::-1])
            acc.add(vs, fs, m)
        y -= pitch


# ------------------------------------------------------------------ shells
def profile_r(profile, R, H, y):
    """Radius at height y of a hullProfile ([[rFrac, yFrac], ...], bottom to top), as hull.js profileAt."""
    f = min(1.0, max(0.0, y / H))
    for (r0, y0), (r1, y1) in zip(profile, profile[1:]):
        if y0 <= f <= y1:
            return R * (r0 + (r1 - r0) * (f - y0) / (y1 - y0) if y1 > y0 else r1)
    return R * profile[-1][0]


def skin(acc_by_mat, r_of, ys, seg, mat_of, u_rep=1.0, v_scale=1.0):
    """
    The outer skin as a lathe between heights ys (bottom to top), radius r_of(y), split into `seg` sectors. mat_of(deg,
    y_mid) returns the material key for each sector and band, so painted roll patterns (Titan II, Saturn) are real
    geometry edges, not textures. acc_by_mat: one Acc for the whole skin.
    """
    acc = acc_by_mat
    e1, e2 = frame((0, 1, 0))
    for j in range(len(ys) - 1):
        y0, y1 = ys[j], ys[j + 1]
        ym = (y0 + y1) / 2
        # group consecutive sectors with the same material into one strip
        i = 0
        while i < seg:
            key = mat_of(360.0 * (i + 0.5) / seg, ym)
            k = i
            while k + 1 < seg and mat_of(360.0 * (k + 1.5) / seg, ym) == key:
                k += 1
            a0, a1 = TAU * i / seg, TAU * (k + 1) / seg
            n = k - i + 1
            rings(acc, [V(0, y0, 0), V(0, y1, 0)], [r_of(y0), r_of(y1)], [e1, e1], [e2, e2], M(key), n, a0, a1,
                  u_rep=u_rep * n / seg, v_scale=v_scale)
            i = k + 1


def flange(acc, r_out, r_in, y, t, m, seg=64):
    """A flat annular flange (bolting ring) at height y, thickness t (downward if t < 0)."""
    lo, hi = (y, y + t) if t > 0 else (y + t, y)
    lathe(acc, [(r_in, lo), (r_out, lo), (r_out, hi), (r_in, hi), (r_in, lo)], m, seg)


def band(acc, r, y0, y1, depth, m, seg=64):
    """A raised ring band on a wall of radius r (ring frame, weld land, load ring)."""
    lathe(acc, [(r - 0.004, y0), (r + depth, y0 + min(depth, (y1 - y0) / 3)), (r + depth, y1 - min(depth, (y1 - y0) / 3)), (r - 0.004, y1)], m, seg)


def dome(acc, r, y_eq, depth, m, down=False, seg=40, n=8, r_hole=0.0, cap=True):
    """An ellipsoidal tank dome: equator radius r at y_eq, `depth` to the pole, convex up (or down)."""
    s = -1 if down else 1
    prof = []
    for k in range(n + 1):
        a = math.pi / 2 * k / n
        rr = r * math.cos(a)
        if rr < r_hole and k > 0:
            prof.append((r_hole, y_eq + s * depth * math.sqrt(max(0.0, 1 - (r_hole / r) ** 2))))
            break
        prof.append((rr, y_eq + s * depth * math.sin(a)))
    if down:
        prof = prof[::-1]
    lathe(acc, prof, m, seg)


# ------------------------------------------------------------------ export and previews
def reset():
    C.reset()
    _M.clear()
    _IMG.clear()
    _K.clear()
    _GLYPHS.clear()
    for coll in (bpy.data.materials, bpy.data.images, bpy.data.meshes, bpy.data.curves):
        for d in list(coll):
            coll.remove(d)


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
        print(f'[groups]   {ch.name}: {count(ch)} tris')


def export(r, slug, height=None, radius=None, max_tris=20000):
    out = os.path.join(OUTDIR, slug + '.glb')
    return C.export(r, out, max_tris=max_tris, expect_height=height, expect_radius=radius)


def look(path, target, cam_pos, res=640, ortho=None, lens=50):
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


def choose(r, keep=None, outer=True):
    """Preview helper, the rule the game should follow: a node <prefix>_<key>__<opt> shows only when that option is
    fitted; <prefix>_<key> shows when no variant of it matches. keep: {key: optionId}. outer=False hides the skin and
    the outer looks (a cut-away view of the inner pieces)."""
    keep = keep or {}
    names = {o.name for o in r.children_recursive}
    for o in r.children_recursive:
        o.hide_render = False
    for o in r.children_recursive:
        n = o.name
        pre, _, rest = n.partition('_')
        if pre not in ('slot', 'look'):
            if not outer and (n == 'shell' or n.startswith('shell_') or n == 'frames' or n == 'detail' or n.startswith('detail_')):
                for x in [o] + list(o.children_recursive):
                    x.hide_render = True
            continue
        key, _, opt = rest.partition('__')
        want = keep.get(key)
        if opt:
            show = opt == want
        else:
            show = not (want and f'{pre}_{key}__{want}' in names)
        if pre == 'look' and not outer:
            show = False
        if not show:
            for x in [o] + list(o.children_recursive):
                x.hide_render = True


def shots(r, slug, H, R, shots_dir, keep=None, extra=None, side=False):
    """The standard previews: a 3/4 view of the outside and a cut-away of the inner pieces (as built)."""
    if not shots_dir:
        return
    os.makedirs(shots_dir, exist_ok=True)
    big = max(H, 2 * R)
    tgt = (0, H * 0.5, 0)
    if side:  # radial parts: they point +x
        tgt = (R * 0.5, H * 0.5, 0)
        cam = (R * 0.5 + big * 1.7, H * 0.75, big * 2.2)
    else:
        cam = (big * 1.25, H * 0.62, big * 1.6)
    choose(r, keep or {})
    look(os.path.join(shots_dir, f'{slug}.png'), tgt, cam, lens=50)
    if not side:
        choose(r, keep or {}, outer=False)
        look(os.path.join(shots_dir, f'{slug}_inside.png'), tgt, cam, lens=50)
    for (name, k) in (extra or []):
        choose(r, k)
        look(os.path.join(shots_dir, f'{slug}_{name}.png'), tgt, cam, lens=50)
    choose(r, keep or {})
    for o in r.children_recursive:
        o.hide_render = False
