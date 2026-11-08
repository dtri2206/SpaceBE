"""
Nose-section modelling library (SpaceB&E builder, Role 1). Shared by capsules.py, fairings.py, towers.py, modules.py
and small.py. Read ../README.md (the contract) first.

Everything is written in GAME coordinates (metres, x right, y up, z toward the viewer) and converted once to Blender
with common.G, like common.py, the tail library (../tail/tl.py, whose accumulator design this copies) and Role 3's
rover.py. Azimuths are in degrees with the same sweep as common.lathe: az 0 = +x, az 90 = -z (x = r cos a, z = -r sin a).
FRONT is the azimuth that faces the design page's default camera, so hatches and windows are seen first.

Geometry goes into an accumulator (Acc): many primitives, one mesh per group with one material slot per material, so a
model has few nodes (the body, and one node per slot_<key> piece the explanation card pulls apart) and small files.
Colours are sRGB hex (like the code-drawn art) converted to linear for glTF. Textures are generated with numpy from a
fixed formula or a seeded generator (no run-to-run randomness), so every run writes the same file.
"""
import bpy, bmesh, math, os, sys, json, tempfile
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
import common as C  # noqa: E402

TAU = 2 * math.pi
DEG = math.pi / 180
G = C.G
RADIUS = C.RADIUS
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..', '..'))
OUTDIR = os.path.join(REPO, 'public', 'assets', 'models', 'builder', 'nose')
TMP = tempfile.mkdtemp(prefix='nose_tex_')
NECK = 0.45   # radius of the standard docking ring on every capsule's nose (sections/nose/art.js NECK)
TOP_R = 0.48  # radius of the flat top a cover gets when a tower stands on it (art.js TOP_R)
FRONT = -56.0  # azimuth facing the design page's default camera (yaw 0.6 rad)


def V(x, y=None, z=None):
    return Vector(x) if y is None else Vector((x, y, z))


def lerp(a, b, t):
    return a + (b - a) * t


def clamp(x, a, b):
    return a if x < a else b if x > b else x


def er(az):
    """Unit radial vector at an azimuth (degrees)."""
    a = az * DEG
    return V(math.cos(a), 0, -math.sin(a))


def ea(az):
    """Unit tangent toward increasing azimuth."""
    a = az * DEG
    return V(-math.sin(a), 0, -math.cos(a))


def polar(az, r, y=0.0):
    a = az * DEG
    return V(r * math.cos(a), y, -r * math.sin(a))


# ------------------------------------------------------------------ part data (stage 2: the data wins)
def part_data(part_id):
    """The part's entry from sections/nose/parts.json (repo), or None. Used for size, height and hullProfile."""
    try:
        with open(os.path.join(REPO, 'src', 'builder', 'sections', 'nose', 'parts.json'), encoding='utf8') as f:
            d = json.load(f)
        for p in d.get('parts', d):
            if p.get('id') == part_id:
                return p
    except Exception:
        pass
    return None


# ------------------------------------------------------------------ colours and textures
def srgb(c):
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


def hexc(h):
    return ((h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255)


_M, _IMG = {}, {}


def image(name, arr, color=False):
    """arr: float array (h, w, 3|4) in 0..1, saved as PNG and packed (the exporter embeds it)."""
    if name in _IMG:
        return _IMG[name]
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones((h, w, 1))], axis=2)
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.pixels.foreach_set(np.flipud(np.clip(arr, 0, 1)).astype(np.float32).ravel())
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


def h_beads(w=64, h=16, ridges=4, seam_rows=0):
    """Corrugated shingles: `ridges` rounded beads across u (they run along the meridian), optional seams across v."""
    x = (np.arange(w) % (w // ridges)) / (w // ridges)
    prof = np.sqrt(np.clip(1 - (2 * x - 1) ** 2, 0, 1))
    hgt = np.tile(prof, (h, 1))
    if seam_rows:
        y = np.arange(h)[:, None]
        seam = ((y % (h // seam_rows)) < 1).astype(float)
        hgt = hgt * (1 - seam) - 0.4 * seam
    return hgt


def h_quilt(n=32):
    yy, xx = np.mgrid[0:n, 0:n] / n
    return (np.sin(math.pi * xx) * np.sin(math.pi * yy)) ** 0.6


def h_grid(n=64, cells=4, gap=1.5):
    """Square tiles with grooves (Orion's backshell tiles, panel seams)."""
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    s = n / cells
    d = np.minimum(np.minimum(xx % s, s - xx % s), np.minimum(yy % s, s - yy % s))
    return np.clip(d / gap, 0, 1)


def h_panels(w=128, h=128, cols=2, rows=2, gap=1.2):
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    sx, sy = w / cols, h / rows
    d = np.minimum(np.minimum(xx % sx, sx - xx % sx), np.minimum(yy % sy, sy - yy % sy))
    return np.clip(d / gap, 0, 1)


def h_isogrid(n=128, cells=4):
    """Triangular isogrid ribs (PSLV fairing, Delta-style skins): raised ribs, recessed pockets."""
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    s = n / cells
    hgt = s * math.sqrt(3) / 2
    d1 = np.abs(((yy / hgt) % 1.0) - 0.5)
    u = (xx / s + yy / (2 * hgt))
    w_ = (xx / s - yy / (2 * hgt))
    d2 = np.abs((u % 1.0) - 0.5)
    d3 = np.abs((w_ % 1.0) - 0.5)
    rib = np.maximum.reduce([d1, d2, d3])
    return np.clip((rib - 0.42) / 0.06, 0, 1)


def h_wrinkle(n=128, seed=7):
    """Aluminised Mylar film: soft wrinkles (seeded, so every run writes the same file)."""
    rng = np.random.default_rng(seed)
    f = rng.normal(size=(n, n))
    k = np.fft.fftfreq(n)
    kk = np.sqrt(k[None, :] ** 2 * 0.15 + k[:, None] ** 2)
    spec = np.fft.fft2(f) * np.exp(-(kk * 18) ** 2)
    hgt = np.real(np.fft.ifft2(spec))
    hgt = (hgt - hgt.min()) / (hgt.max() - hgt.min() + 1e-9)
    return hgt


def h_noise(n=64, seed=3, smooth=6):
    rng = np.random.default_rng(seed)
    f = rng.normal(size=(n, n))
    k = np.fft.fftfreq(n)
    kk = np.sqrt(k[None, :] ** 2 + k[:, None] ** 2)
    hgt = np.real(np.fft.ifft2(np.fft.fft2(f) * np.exp(-(kk * smooth) ** 2)))
    return (hgt - hgt.min()) / (hgt.max() - hgt.min() + 1e-9)


def hex_field(n=256, across=8):
    """Distance to the nearest hexagon edge (1 inside, 0 at the gaps): Starship-style tiles."""
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    s = n / across
    hgt = s / math.sqrt(3) * 1.5
    best = np.full((n, n), 1e9)
    for row in range(-1, int(n / hgt) + 2):
        cy = row * hgt
        off = (row % 2) * s / 2
        for col in range(-1, across + 2):
            cx = col * s + off
            d = np.maximum(np.abs(xx - cx) * 0.866 + np.abs(yy - cy) * 0.5, np.abs(yy - cy))
            best = np.minimum(best, d)
    return np.clip((s * 0.5 - best) / 1.6, 0, 1)


def solar_colour(w=128, h=128, cells=8):
    """Solar cells: dark blue cells with lighter gaps and bus bars."""
    yy, xx = np.mgrid[0:h, 0:w]
    s = w // cells
    cell = (xx % s >= 1) & (xx % s < s - 1) & (yy % s >= 1) & (yy % s < s - 1)
    img = np.zeros((h, w, 3))
    img[..., 0] = np.where(cell, 0.06, 0.55)
    img[..., 1] = np.where(cell, 0.09, 0.58)
    img[..., 2] = np.where(cell, 0.22, 0.62)
    return img


def tiles_colour(base, gap_col, n=64, cells=4, gap=1.2, var=0.03, seed=5):
    """Tile colour map: each tile a slightly different shade (seeded), gaps darker."""
    rng = np.random.default_rng(seed)
    g = h_grid(n, cells, gap)
    shade = rng.uniform(-var, var, size=(cells, cells))
    s = n // cells
    sh = np.kron(shade, np.ones((s, s)))[:n, :n]
    b = np.array(srgb_inv(base))
    c = np.clip(b[None, None, :] + sh[..., None], 0, 1)
    gc = np.array(srgb_inv(gap_col))
    return c * g[..., None] + gc[None, None, :] * (1 - g[..., None])


def srgb_inv(c):
    """Hex or tuple to a 0..1 sRGB tuple (texture pixels are stored as sRGB)."""
    return hexc(c) if isinstance(c, int) else tuple(c)


# ------------------------------------------------------------------ materials
def material(name, color, metal=0.3, rough=0.5, normal=None, nstrength=1.0, base=None, emissive=None):
    """A glTF PBR material. color: 0xRRGGBB or sRGB tuple. normal / base: numpy arrays (height -> normal done here)."""
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
    if emissive is not None:
        b.inputs['Emission Color'].default_value = (*srgb(hexc(emissive) if isinstance(emissive, int) else emissive), 1.0)
        b.inputs['Emission Strength'].default_value = 1.0
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


def _pal():
    """The nose palette. Names carry the family prefixes the shared code may tint, fade or glow:
    skin_*, tile_*, ablator_*, glass_*, metal_*, solar_*, mli_*."""
    return {
        # skins
        'white': lambda: material('skin_white', 0xe9e8e3, 0.08, 0.5),
        'white_panel': lambda: material('skin_white_panels', 0xe6e5e0, 0.08, 0.5, normal=normal_from_height(h_panels(128, 128, 2, 2, 1.0), 2.0), nstrength=0.6),
        'offwhite': lambda: material('skin_offwhite', 0xd9d8d2, 0.08, 0.55),
        'grey': lambda: material('skin_light_grey', 0xbfc3c6, 0.15, 0.5),
        'mid_grey': lambda: material('skin_mid_grey', 0x8d9296, 0.25, 0.5),
        'shingle': lambda: material('skin_shingles_black', 0x2b2d31, 0.45, 0.45, normal=normal_from_height(h_beads(64, 64, 4, 2), 5.0), nstrength=1.0),
        'beryl': lambda: material('skin_beryllium', 0x4a4d52, 0.5, 0.42, normal=normal_from_height(h_beads(64, 16, 4), 4.0), nstrength=0.8),
        'mylar': lambda: material('skin_mylar', 0xc4c8cd, 0.6, 0.26, normal=normal_from_height(h_wrinkle(128, 7) * 0.6 + h_panels(128, 128, 1, 1, 1.5) * 0.4, 2.0), nstrength=0.3),
        'aetb': lambda: material('tile_aetb_silver', 0xb9bcc0, 0.45, 0.4, base=tiles_colour(0xb9bcc0, 0x7d8186, 64, 4, 1.1, 0.025), normal=normal_from_height(h_grid(64, 4, 1.2), 2.5), nstrength=0.7),
        'mli_green': lambda: material('mli_green', 0x646b55, 0.15, 0.7, normal=normal_from_height(h_quilt(32), 3.5), nstrength=0.6),
        'mli_soyuz': lambda: material('mli_soyuz_dm', 0x55554d, 0.15, 0.72, normal=normal_from_height(h_quilt(32), 2.5), nstrength=0.35),
        'mli_grey': lambda: material('mli_grey_white', 0xc2bfb3, 0.15, 0.65, normal=normal_from_height(h_quilt(32), 2.0), nstrength=0.25),
        'mli_white': lambda: material('mli_white', 0xdcdad2, 0.1, 0.65, normal=normal_from_height(h_quilt(32), 2.0), nstrength=0.25),
        'mli_gold': lambda: material('mli_gold', 0xc49a45, 0.55, 0.38, normal=normal_from_height(h_quilt(32), 3.0), nstrength=0.6),
        'mli_silver': lambda: material('mli_silver', 0xb7b8b2, 0.45, 0.42, normal=normal_from_height(h_quilt(32), 3.0), nstrength=0.7),
        'steel': lambda: material('skin_stainless', 0xb8bcbf, 0.6, 0.28, normal=normal_from_height(h_noise(64, 11, 3) * 0.3, 1.0), nstrength=0.3),
        'hex': lambda: material('tile_hex', 0x26272a, 0.15, 0.7, base=np.stack([0.11 + 0.04 * hex_field(256, 8)] * 3, -1) * np.array([1.0, 1.02, 1.06]), normal=normal_from_height(hex_field(256, 8), 2.0), nstrength=0.8),
        'carbon': lambda: material('skin_carbon', 0x2a2c2f, 0.3, 0.5),
        'isogrid': lambda: material('skin_isogrid', 0xd6d6d0, 0.2, 0.5, normal=normal_from_height(h_isogrid(128, 4), 2.0), nstrength=0.9),
        'cork': lambda: material('skin_cork', 0xb39470, 0.0, 0.9, normal=normal_from_height(h_noise(64, 21, 2), 2.0), nstrength=0.5),
        # heat shields
        'abl_char': lambda: material('ablator_char', 0x3a322c, 0.05, 0.9, base=np.stack([0.18 + 0.1 * h_noise(64, 4, 5)] * 3, -1) * np.array([1.08, 0.97, 0.88])),
        'abl_vostok': lambda: material('ablator_vostok', 0x5b5650, 0.1, 0.85, base=np.stack([0.30 + 0.08 * h_noise(64, 9, 6)] * 3, -1) * np.array([1.03, 1.0, 0.95])),
        'abl_avcoat': lambda: material('ablator_avcoat', 0x9a8f80, 0.05, 0.85),
        'abl_pica': lambda: material('ablator_pica', 0x1d1e20, 0.05, 0.9),
        'abl_bla': lambda: material('ablator_bla', 0x45484c, 0.05, 0.85),
        'abl_soyuz': lambda: material('ablator_phenolic', 0x4b4038, 0.05, 0.85),
        # metals
        'alu': lambda: material('metal_aluminium', 0xbfc3c7, 0.5, 0.36),
        'dark': lambda: material('metal_dark', 0x34383d, 0.5, 0.45),
        'black': lambda: material('metal_black', 0x202225, 0.3, 0.6),
        'ti': lambda: material('metal_titanium', 0x6f7276, 0.55, 0.42),
        'gold': lambda: material('metal_gold', 0xc9a24a, 0.6, 0.3),
        'copper': lambda: material('metal_copper', 0xa8683c, 0.6, 0.35),
        'nozzle': lambda: material('metal_nozzle', 0x3b3e42, 0.5, 0.5),
        'soot': lambda: material('metal_soot', 0x1f1e1d, 0.2, 0.85),
        'steel_m': lambda: material('metal_steel', 0xa3a8ad, 0.55, 0.32),
        'red': lambda: material('skin_red', 0xa8402c, 0.2, 0.55),
        'orange': lambda: material('skin_orange', 0xd86a26, 0.1, 0.6),
        'blue': lambda: material('skin_blue', 0x2c5aa0, 0.15, 0.5),
        # glass and cells
        'glass': lambda: material('glass_window', 0x1b2430, 0.35, 0.12),
        'solar': lambda: material('solar_cells', 0x18233e, 0.4, 0.35, base=solar_colour(128, 128, 8)),
        'radiator': lambda: material('skin_radiator', 0xe8e8e2, 0.1, 0.45, normal=normal_from_height(h_beads(64, 8, 8) * 0.5, 2.0), nstrength=0.6),
        # inside
        'seat': lambda: material('seat_liner', 0x3b3f45, 0.05, 0.85),
        'seat_light': lambda: material('seat_light', 0xc9c6bd, 0.05, 0.8),
        'frame': lambda: material('metal_frame', 0x8d9399, 0.55, 0.4),
        'suit_white': lambda: material('suit_white', 0xe2e0d8, 0.0, 0.8),
        'suit_orange': lambda: material('suit_orange', 0xe0782c, 0.0, 0.8),
        'suit_silver': lambda: material('suit_silver', 0xb9bcbe, 0.4, 0.45),
        'suit_blue': lambda: material('suit_blue', 0x3c5f9a, 0.0, 0.8),
        'suit_grey': lambda: material('suit_overalls', 0x6c7480, 0.0, 0.85),
        'visor': lambda: material('glass_visor', 0x2a2f36, 0.5, 0.15),
        'canopy': lambda: material('chute_canopy', 0xe08a3a, 0.0, 0.9),
        'canopy_w': lambda: material('chute_canopy_white', 0xe7e4dc, 0.0, 0.9),
        'bag': lambda: material('chute_bag', 0xcfc6ad, 0.0, 0.9),
        'airbag': lambda: material('airbag_fabric', 0xd8c69a, 0.0, 0.85),
        'grain': lambda: material('propellant_grain', 0x8a7a5a, 0.0, 0.9),
        'amber': lambda: material('metal_amber', 0xc08a2a, 0.45, 0.45),
        'rubber': lambda: material('seal_rubber', 0x2c2c2e, 0.0, 0.8),
    }


_K = {}


def M(key):
    if key not in _K:
        _K[key] = _pal()[key]()
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

    def emit(self, name, parent, sharp_deg=40):
        if not self.F:
            e = bpy.data.objects.new(name, None)
            bpy.context.scene.collection.objects.link(e)
            e.parent = parent
            return e
        me = bpy.data.meshes.new('m_' + name)  # mesh data named apart from its node (README "Inner pieces")
        me.from_pydata([G(v) for v in self.V], [], self.F)
        for m in self.mats:
            me.materials.append(m)
        me.polygons.foreach_set('material_index', self.MI)
        uvl = me.uv_layers.new(name='UVMap')
        for p, uvs in zip(me.polygons, self.UV):
            for k in range(p.loop_total):
                uvl.data[p.loop_start + k].uv = uvs[k]
        me.validate(clean_customdata=False)
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


def rings(acc, centers, radii, e1s, e2s, m, seg, a0=0.0, a1=TAU, u_rep=1.0, v_scale=1.0, cap0=False, cap1=False, flip=False, closed=False):
    """
    A swept surface through rings (centre, radius, frame) with `seg` sides; quads face outward when the rings advance
    along e1 x e2. A radius of ~0 collapses to one vertex. UV: u round (0..u_rep), v along (metres x v_scale).
    """
    full = abs((a1 - a0) - TAU) < 1e-6
    ncol = seg if full else seg + 1
    verts, faces, uvs, idx = [], [], [], []
    vs = [0.0]
    for k in range(1, len(centers)):
        vs.append(vs[-1] + (Vector(centers[k]) - Vector(centers[k - 1])).length + abs(radii[k] - radii[k - 1]))
    vs = [v * v_scale for v in vs]
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
            va, vb = vs[j], (vs[j2] if j2 > j else vs[j] + 0.1)
            if a == b and c2 == d:
                continue
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


def lathe(acc, prof, m, seg=32, c=(0, 0, 0), axis=(0, 1, 0), az0=None, az1=None, **kw):
    """Surface of revolution: prof = [(r, h), ...] along `axis` from c. az0/az1 (degrees) make a partial sweep."""
    d = Vector(axis).normalized()
    e1, e2 = frame(d)
    c = Vector(c)
    if az0 is not None:
        kw['a0'], kw['a1'] = az0 * DEG, az1 * DEG
    rings(acc, [c + d * h for (_, h) in prof], [r for (r, _) in prof], [e1] * len(prof), [e2] * len(prof), m, seg, **kw)


def cyl(acc, a, b, r, m, seg=12, caps=True, r2=None):
    """A cylinder (or frustum with r2) from point a to point b."""
    a, b = Vector(a), Vector(b)
    L = (b - a).length
    lathe(acc, [(r, 0), (r if r2 is None else r2, L)], m, seg, a, b - a, cap0=caps, cap1=caps)


def sphere(acc, c, r, m, seg=16, rings_n=None, squash=1.0):
    n = rings_n or max(4, seg // 2)
    prof = [(r * math.sin(math.pi * k / n), -r * squash * math.cos(math.pi * k / n)) for k in range(n + 1)]
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


def box(acc, c, size, m, axes=None):
    """A box centred at c with size (sx, sy, sz) along `axes` (three unit vectors; default x, y, z)."""
    c = Vector(c)
    X, Y, Z = axes or (V(1, 0, 0), V(0, 1, 0), V(0, 0, 1))
    X, Y, Z = Vector(X), Vector(Y), Vector(Z)
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    verts = [c + X * sx * hx + Y * sy * hy + Z * sz * hz for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    if X.cross(Y).dot(Z) < 0:
        faces = [f[::-1] for f in faces]
    acc.add(verts, faces, m, [[(0, 0), (1, 0), (1, 1), (0, 1)]] * 6)


def beam(acc, a, b, w, d, m, up=None):
    """A box from a to b: w across, d deep."""
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


def prism(acc, loops, t, m, o=(0, 0, 0), U=(1, 0, 0), Vv=(0, 0, -1), edge_m=None):
    """A flat plate: polygon `loops` (outer + holes) in the plane (o, U, Vv), extruded by t along U x Vv."""
    o, U, Vv = Vector(o), Vector(U).normalized(), Vector(Vv).normalized()
    W = U.cross(Vv).normalized()
    loops = [lp if _area(lp) > 0 else lp[::-1] for lp in loops]
    pts, tris = fill2d(loops)
    n = len(pts)
    bot = [o + U * p[0] + Vv * p[1] for p in pts]
    top = [q + W * t for q in bot]
    faces, uvs = [], []
    for tr in tris:
        faces.append([n + i for i in tr])
        uvs.append([(pts[i][0], pts[i][1]) for i in tr])
        faces.append([i for i in tr[::-1]])
        uvs.append([(pts[i][0], pts[i][1]) for i in tr[::-1]])
    acc.add(bot + top, faces, m, uvs)
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


def circle2d(cx, cy, r, n, a0=0.0, cw=False):
    pts = [(cx + r * math.cos(a0 + TAU * i / n), cy + r * math.sin(a0 + TAU * i / n)) for i in range(n)]
    return pts[::-1] if cw else pts


def bell(acc, apex, axis, r_throat, r_exit, length, m, seg=16, inner_m=None, chamber=None):
    """A simple bell nozzle from its throat at `apex` along `axis` (exit downstream): parabolic contour, open exit,
    with an inner wall (inner_m) so the opening reads dark. chamber=(r, length) adds a chamber upstream."""
    apex, d = Vector(apex), Vector(axis).normalized()
    prof = []
    for k in range(6):
        t = k / 5
        prof.append((r_throat + (r_exit - r_throat) * (1 - (1 - t) ** 1.8), length * t))
    lathe(acc, prof, m, seg, apex, d)
    inner = [(r * 0.97, h) for (r, h) in prof]
    lathe(acc, inner, inner_m or M('soot'), seg, apex, d, flip=True)
    if chamber:
        cr, cl = chamber
        lathe(acc, [(r_throat, 0), (cr, -cl * 0.35), (cr, -cl), (cr * 0.6, -cl * 1.08), (0.0, -cl * 1.1)], m, seg, apex, d, flip=True)


# ------------------------------------------------------------------ profiles and surfaces of revolution
def fillet(points, rad=0.05, n=4):
    """Rounds every inner corner of an (r, y) polyline with an arc of radius `rad` (n points per corner)."""
    P_ = [Vector((p[0], p[1], 0)) for p in points]
    out = [P_[0]]
    for k in range(1, len(P_) - 1):
        a, b, c = P_[k - 1], P_[k], P_[k + 1]
        u, w = (a - b), (c - b)
        lu, lw = u.length, w.length
        if lu < 1e-6 or lw < 1e-6:
            continue
        u, w = u / lu, w / lw
        ang = u.angle(w)
        if ang > math.pi - 2e-2:
            out.append(b)
            continue
        t = min(rad / math.tan(ang / 2), lu * 0.45, lw * 0.45)
        p0, p1 = b + u * t, b + w * t
        for i in range(n + 1):
            s = i / n
            out.append((1 - s) ** 2 * p0 + 2 * s * (1 - s) * b + s * s * p1)
    out.append(P_[-1])
    return [(max(0.0, p.x), p.y) for p in out]


def resample(points, step=0.05):
    """Inserts points so no segment of an (r, y) polyline is longer than `step` (smooth shading, patch conformity)."""
    out = [points[0]]
    for (r0, y0), (r1, y1) in zip(points, points[1:]):
        L = math.hypot(r1 - r0, y1 - y0)
        n = max(1, int(math.ceil(L / step)))
        for k in range(1, n + 1):
            out.append((r0 + (r1 - r0) * k / n, y0 + (y1 - y0) * k / n))
    return out


class Rev:
    """A surface of revolution given by an (r, y) profile bottom to top: positions, normals and frames on it."""

    def __init__(self, prof):
        self.p = [(float(r), float(y)) for (r, y) in prof]
        self.s = [0.0]
        for (r0, y0), (r1, y1) in zip(self.p, self.p[1:]):
            self.s.append(self.s[-1] + math.hypot(r1 - r0, y1 - y0))
        self.L = self.s[-1]

    def _seg_s(self, s):
        s = clamp(s, 0, self.L)
        for k in range(len(self.p) - 1):
            if self.s[k + 1] >= s and self.s[k + 1] > self.s[k]:
                return k, (s - self.s[k]) / (self.s[k + 1] - self.s[k])
        return len(self.p) - 2, 1.0

    def at_s(self, s):
        """(r, y, dr/ds, dy/ds) at arc length s, with a tangent smoothed between neighbouring segments."""
        k, t = self._seg_s(s)
        (r0, y0), (r1, y1) = self.p[k], self.p[k + 1]
        L = max(1e-9, self.s[k + 1] - self.s[k])
        dr, dy = (r1 - r0) / L, (y1 - y0) / L
        return r0 + (r1 - r0) * t, y0 + (y1 - y0) * t, dr, dy

    def s_at_y(self, y):
        """Arc length at the first place the profile reaches height y (profiles rising in y)."""
        for k in range(len(self.p) - 1):
            (r0, y0), (r1, y1) = self.p[k], self.p[k + 1]
            if (y0 <= y <= y1 or y1 <= y <= y0) and abs(y1 - y0) > 1e-9:
                return self.s[k] + (self.s[k + 1] - self.s[k]) * (y - y0) / (y1 - y0)
        return 0.0 if y < self.p[0][1] else self.L

    def r_at_y(self, y):
        return self.at_s(self.s_at_y(y))[0]

    def frame_s(self, az, s, off=0.0):
        """(P, N, Tm, Ta): surface point (pushed `off` along the normal), outward normal, meridian (upward) tangent,
        azimuth tangent."""
        r, y, dr, dy = self.at_s(s)
        e, t = er(az), ea(az)
        N = (e * dy - V(0, dr, 0)).normalized()
        Tm = (e * dr + V(0, dy, 0)).normalized()
        return e * r + V(0, y, 0) + N * off, N, Tm, t

    def frame_y(self, az, y, off=0.0):
        return self.frame_s(az, self.s_at_y(y), off)

    def point(self, az_c, s_c, u, v, off=0.0):
        """Surface point at (u along the azimuth, v along the meridian) metres from (az_c, s_c), pushed `off` out."""
        r = max(1e-3, self.at_s(s_c + v)[0])
        az = az_c + (u / r) / DEG
        return self.frame_s(az, s_c + v, off)


def samples(rev, s0, s1, step=0.25):
    """Arc lengths from s0 to s1: the profile's own vertices in between plus enough points that no gap exceeds step."""
    pts = sorted({s0, s1} | {x for x in rev.s if s0 < x < s1})
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(math.ceil((b - a) / step)))
        out += [a + (b - a) * k / n for k in range(1, n + 1)]
    return out


def shell(acc, prof, m, seg=64, az0=None, az1=None, u_rep=1.0, v_scale=1.0, cap_bottom=False, cap_top=False):
    """The outer surface of a profile [(r, y)] round the y axis (partial when az0/az1 are given)."""
    kw = dict(u_rep=u_rep, v_scale=v_scale, cap0=cap_bottom, cap1=cap_top)
    lathe(acc, prof, m, seg, az0=az0, az1=az1, **kw)


def band(acc, rev, s0, s1, m, off=0.003, seg=64, step=0.25, az0=None, az1=None, u_rep=1.0):
    """A band of the surface between arc lengths s0..s1, pushed `off` outward (paint bands, ablator edges)."""
    pts = []
    for s in samples(rev, s0, s1, step):
        r, y, dr, dy = rev.at_s(s)
        pts.append((r + dy * off, y - dr * off))
    lathe(acc, pts, m, seg, az0=az0, az1=az1, u_rep=u_rep)


def ring_on(acc, rev, s, width, depth, m, seg=64, off=0.0):
    """A ring frame round the surface at arc length s: `width` along the meridian, `depth` proud."""
    pts = []
    for (dv, dd) in ((-width / 2, 0.0), (-width / 2, depth), (width / 2, depth), (width / 2, 0.0)):
        r, y, dr, dy = rev.at_s(s + dv)
        pts.append((r + dy * (dd + off), y - dr * (dd + off)))
    lathe(acc, pts, m, seg)


def patch(acc, rev, az, s_c, w, h, m, off=0.004, t=0.0, nu=6, nv=4, taper=1.0, corner=0.0, side_m=None, sink=0.012):
    """
    A conforming panel on the surface centred at (az, s_c): w wide (along the azimuth, at its bottom), h tall (along
    the meridian), top width w*taper, rounded corners of radius `corner`. Pushed `off` out; t > 0 gives it a thickness
    (top at off + t, sides down to off - sink so it seats on the surface). Windows, hatches, doors, decals.
    """
    rows = []
    for j in range(nv + 1):
        v = -h / 2 + h * j / nv
        f = j / nv
        hw = w * lerp(1.0, taper, f) / 2
        if corner > 0:
            dv = abs(v) - (h / 2 - corner)
            if dv > 0:
                hw -= corner * (1 - math.sqrt(max(0.0, 1 - (dv / corner) ** 2)))
        rows.append([(-hw + 2 * hw * i / nu, v) for i in range(nu + 1)])
    top = off + t
    verts, faces, uvs = [], [], []
    grid = []
    for j, row in enumerate(rows):
        line = []
        for (u, v) in row:
            P, N, _, _ = rev.point(az, s_c, u, v, top)
            line.append(len(verts))
            verts.append(P)
        grid.append(line)
    for j in range(nv):
        for i in range(nu):
            faces.append([grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]])
            uvs.append([(i / nu, j / nv), ((i + 1) / nu, j / nv), ((i + 1) / nu, (j + 1) / nv), (i / nu, (j + 1) / nv)])
    # faces must point outward: check one
    a, b, c = Vector(verts[faces[0][0]]), Vector(verts[faces[0][1]]), Vector(verts[faces[0][2]])
    P0, N0, _, _ = rev.point(az, s_c, 0, 0, 0)
    if (b - a).cross(c - a).dot(N0) < 0:
        faces = [f[::-1] for f in faces]
        uvs = [u[::-1] for u in uvs]
    acc.add(verts, faces, m, uvs)
    if t > 0:
        # side walls round the outline, from the top surface down below the skin
        ring_pts = [p for p in rows[0]] + [row[-1] for row in rows[1:]] + [p for p in reversed(rows[-1][:-1])] + [row[0] for row in reversed(rows[1:-1])]
        sv, sf = [], []
        n = len(ring_pts)
        for k in range(n):
            u0, v0 = ring_pts[k]
            u1, v1 = ring_pts[(k + 1) % n]
            p0t = rev.point(az, s_c, u0, v0, top)[0]
            p1t = rev.point(az, s_c, u1, v1, top)[0]
            p0b = rev.point(az, s_c, u0, v0, off - sink)[0]
            p1b = rev.point(az, s_c, u1, v1, off - sink)[0]
            q = len(sv)
            sv += [p0b, p1b, p1t, p0t]
            sf.append([q, q + 1, q + 2, q + 3])
        # orient outward from the panel centre
        cen = rev.point(az, s_c, 0, 0, top)[0]
        fixed = []
        for f in sf:
            a, b, c = sv[f[0]], sv[f[1]], sv[f[2]]
            mid = (sv[f[0]] + sv[f[2]]) / 2
            fixed.append(f if (b - a).cross(c - a).dot(mid - cen) >= 0 else f[::-1])
        acc.add(sv, fixed, side_m or m)


def disc(acc, rev, az, s_c, rad, m, off=0.004, t=0.0, seg=16, rings_n=2, inner=0.0, side_m=None, sink=0.012):
    """A conforming round panel (or annulus with inner > 0): portholes, hatch rims, thruster ports, mortar covers."""
    top = off + t
    verts, faces = [], []
    radii = [inner + (rad - inner) * k / rings_n for k in range(rings_n + 1)] if inner > 0 else [rad * k / rings_n for k in range(rings_n + 1)]
    idx = []
    for rr in radii:
        if rr < 1e-6:
            idx.append([len(verts)] * seg)
            verts.append(rev.point(az, s_c, 0, 0, top)[0])
            continue
        row = []
        for i in range(seg):
            a = TAU * i / seg
            row.append(len(verts))
            verts.append(rev.point(az, s_c, rr * math.cos(a), rr * math.sin(a), top)[0])
        idx.append(row)
    for j in range(len(radii) - 1):
        for i in range(seg):
            a, b, c, d = idx[j][i], idx[j][(i + 1) % seg], idx[j + 1][(i + 1) % seg], idx[j + 1][i]
            if a == b:
                faces.append([a, c, d])
            else:
                faces.append([a, b, c, d])
    P0, N0, _, _ = rev.point(az, s_c, 0, 0, 0)
    f0 = faces[len(faces) // 2]
    a, b, c = Vector(verts[f0[0]]), Vector(verts[f0[1]]), Vector(verts[f0[2]])
    if (b - a).cross(c - a).dot(N0) < 0:
        faces = [f[::-1] for f in faces]
    acc.add(verts, faces, m)
    if t > 0:
        sv, sf = [], []
        for rr, sgn in ((rad, 1), (inner, -1)) if inner > 0 else ((rad, 1),):
            for i in range(seg):
                a0, a1 = TAU * i / seg, TAU * (i + 1) / seg
                p0t = rev.point(az, s_c, rr * math.cos(a0), rr * math.sin(a0), top)[0]
                p1t = rev.point(az, s_c, rr * math.cos(a1), rr * math.sin(a1), top)[0]
                p0b = rev.point(az, s_c, rr * math.cos(a0), rr * math.sin(a0), off - sink)[0]
                p1b = rev.point(az, s_c, rr * math.cos(a1), rr * math.sin(a1), off - sink)[0]
                q = len(sv)
                sv += [p0b, p1b, p1t, p0t]
                cen = rev.point(az, s_c, 0, 0, top)[0]
                f = [q, q + 1, q + 2, q + 3]
                aa, bb, cc = sv[q], sv[q + 1], sv[q + 2]
                out = (bb - aa).cross(cc - aa).dot((sv[q] + sv[q + 2]) / 2 - cen) >= 0
                sf.append(f if out == (sgn > 0) else f[::-1])
        acc.add(sv, sf, side_m or m)


def frame_rect(acc, rev, az, s_c, w, h, bw, m, off=0.004, t=0.012, corner=0.0, taper=1.0):
    """A raised rectangular frame (window surround): four strips round a w x h opening, `bw` wide."""
    for (du, dv, ww, hh) in ((0, -h / 2 - bw / 2, w + 2 * bw, bw), (0, h / 2 + bw / 2, (w * taper) + 2 * bw, bw)):
        patch(acc, rev, az, _s_off(rev, s_c, dv), ww, hh, m, off, t, max(2, int(ww / 0.1)), 1)
    r = max(1e-3, rev.at_s(s_c)[0])
    for side in (-1, 1):
        # the side strips follow the taper: centre them at the mean half-width
        hw = (w + w * taper) / 4 + bw / 2
        patch(acc, rev, az + side * (hw / r) / DEG, s_c, bw, h, m, off, t, 1, max(2, int(h / 0.08)))


def _s_off(rev, s, dv):
    return clamp(s + dv, 0, rev.L)


def window(acc, rev, az, s_c, w, h, off=0.004, frame_m=None, glass_m=None, bw=0.03, taper=1.0, corner=0.0, round_=False):
    """A window: dark glass pane flush with the skin and a raised frame round it."""
    glass_m = glass_m or M('glass')
    frame_m = frame_m or M('dark')
    if round_:
        disc(acc, rev, az, s_c, w / 2, glass_m, off, 0.0, 20, max(2, int(w / 0.12)))
        disc(acc, rev, az, s_c, w / 2 + bw, frame_m, off, 0.012, 20, 1, inner=w / 2)
    else:
        nu, nv = max(2, int(w / 0.14)), max(2, int(h / 0.1))
        patch(acc, rev, az, s_c, w, h, glass_m, off, 0.0, nu, nv, taper, corner)
        frame_rect(acc, rev, az, s_c, w, h, bw, frame_m, off, 0.012, taper=taper)


def port(acc, rev, az, s_c, rad, off=0.004, m=None, rim_m=None, seg=10):
    """A thruster port: a dark round opening with a thin rim."""
    disc(acc, rev, az, s_c, rad, m or M('soot'), off, 0.0, seg, 1)
    disc(acc, rev, az, s_c, rad * 1.45, rim_m or M('dark'), off, 0.008, seg, 1, inner=rad)


def strip_along(acc, rev, az, s0, s1, w, t, m, off=0.0, step=0.3):
    """A strip following the meridian at an azimuth (straps, umbilical fairings, separation rails)."""
    ss = samples(rev, s0, s1, step)
    n = len(ss)
    path = [rev.frame_s(az, x, off + t / 2) for x in ss]
    for k in range(n - 1):
        P0, N0, T0, A0 = path[k]
        P1, N1, T1, A1 = path[k + 1]
        box(acc, (P0 + P1) / 2, (w, (P1 - P0).length + 0.002, t), m, (A0, (P1 - P0).normalized(), N0))


# ------------------------------------------------------------------ scene, checks, export
def reset():
    C.reset()
    _M.clear()
    _IMG.clear()
    _K.clear()
    for coll in (bpy.data.materials, bpy.data.images, bpy.data.meshes, bpy.data.cameras, bpy.data.lights):
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
        print(f'[groups]   {ch.name}: {count(ch)} tris')


def export(r, slug, height=None, radius=None, max_tris=20000):
    out = os.path.join(OUTDIR, slug + '.glb')
    return C.export(r, out, max_tris=max_tris, expect_height=height, expect_radius=radius)


def shots_arg():
    return C.arg('--shots')


def look(path, target, cam_pos, res=560, ortho=None, lens=50, bg=(0.32, 0.34, 0.37)):
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
    for (rx, rz, e) in ((50, 30, 3.2), (65, 210, 1.2), (100, 120, 0.8)):
        sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
        sun.data.energy = e
        sun.rotation_euler = (math.radians(rx), 0, math.radians(rz))
        scene.collection.objects.link(sun)
        lights.append(sun)
    world = scene.world or bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    b = world.node_tree.nodes['Background']
    b.inputs['Strength'].default_value = 0.7
    b.inputs['Color'].default_value = (*bg, 1)
    scene.render.filepath = os.path.abspath(path)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    for s in lights:
        bpy.data.objects.remove(s, do_unlink=True)


def cam_front(H, R, dist=None, az=FRONT, pitch=12.0):
    """A camera position on the design page's default side, framing a part H tall and R wide."""
    d = dist or max(H, 2 * R) * 2.3
    e = er(az)
    p = math.radians(pitch)
    return (e.x * d * math.cos(p), H * 0.5 + d * math.sin(p), e.z * d * math.cos(p))


def hide_except(r, keep):
    """Preview helper: show the default slot piece of each key, or the variant chosen in keep {key: optionId}."""
    for o in r.children_recursive:
        if not o.name.startswith('slot_'):
            continue
        key, _, opt = o.name[5:].partition('__')
        want = keep.get(key)
        has = want is not None and any(c.name == f'slot_{key}__{want}' for c in r.children_recursive)
        show = (opt == want) if opt else not has
        for x in [o] + list(o.children_recursive):
            x.hide_render = not show


def show_only(r, names):
    """Preview helper: render only the objects whose names are listed (and their children)."""
    for o in r.children_recursive:
        o.hide_render = True
    for o in r.children_recursive:
        if o.name in names:
            for x in [o] + list(o.children_recursive):
                x.hide_render = False


def show_all(r):
    for o in [r] + list(r.children_recursive):
        o.hide_render = False


def write_profile(slug, prof, R, H):
    """Writes the model's own outline as hull-profile fractions next to the GLB's script output (for the data)."""
    pts = [(round(r / R, 3), round(y / H, 3)) for (r, y) in prof]
    d = os.path.join(TMP, '..', 'nose_profiles')
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, slug + '.json'), 'w') as f:
        json.dump(pts, f)
