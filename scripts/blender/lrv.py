"""
SpaceB&E traditional rover: the Apollo Lunar Roving Vehicle (LRV), modelled in Blender and exported to
public/assets/models/lrv.glb (served by src/graphics/roverLrv.js as assets 'rover:lrv').

Regenerate (Blender 5.2, nothing else needed, about a minute):

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/blender/lrv.py -- \
      --out public/assets/models/lrv.glb [--shots DIR] [--no-ao] [--ao-size 2048]

Game contract (src/surface/roverModel.js drives the model): metres, +Y up, forward -Z, +X right, origin on the ground at
the centre of wheelbase (2.29) and track (1.83), wheels rest on y = 0, no root transform. Four pivots wheelFL/FR/RL/RR at
(+-0.915, 0.41, -+1.145); each pivot's FIRST child is the spinning wheel node (<pivot>_spin), symmetric around the X axle.

What is in it (all after the NASA photos): aluminium tube chassis in three sections with checkered thermal side beams,
perforated floor panels, wishbone suspensions with drive motors, tan fibreglass fenders with hinged extensions, battery and
electronics boxes under quilted white beta-cloth blankets with dust-cover mirrors, a gold Mylar communications relay unit,
the umbrella high-gain antenna on a braced mast, TV camera, helical low-gain antenna, two tubular seats with checkered nylon
webbing and belts, the console on a post with gauges and the T hand controller, and the aft pallet with the hand tool
carrier, tools, sample bags and cables. Wheels: woven wire mesh tyre, titanium chevrons in a V pattern with rivets, light
grey bump-stop disc, dark hub motor.

Geometry is written in GAME coordinates (x right, y up, z back) and converted once to Blender (x, -z, y); the glTF exporter
(+Y up) maps it back. Edges are bevelled through bmesh, parts are merged into one mesh with one slot per material.
Image textures are generated here with numpy (JPEG, packed in the GLB): brushed aluminium, beta cloth, crinkled foil,
webbing, fibreglass, wire mesh and normal maps. Dust is baked into vertex colours (heavy low down and on upward faces);
ambient occlusion is baked in Cycles on a second UV map (Smart UV Project) and exported as the glTF occlusion texture.
"""
import bpy, bmesh, math, os, sys, tempfile, random
import numpy as np
from mathutils import Vector, Matrix, Euler

# ------------------------------------------------------------------ args
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
OUT = os.path.abspath(arg('--out', 'public/assets/models/lrv.glb'))
SHOTS = arg('--shots')
AO_SIZE = int(arg('--ao-size', 1024))
DO_AO = '--no-ao' not in argv

WHEELBASE, TRACK, R = 2.29, 1.83, 0.41
HB, HT = WHEELBASE / 2, TRACK / 2
TMP = tempfile.mkdtemp(prefix='lrv_tex_')
rng = np.random.default_rng(7)
random.seed(7)

# ------------------------------------------------------------------ scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
col = bpy.data.collections.new('LRV')
scene.collection.children.link(col)

def G(p):  # game (x, y, z) -> blender (x, -z, y)
    return (p[0], -p[2], p[1])

# ------------------------------------------------------------------ generated textures
def pnoise(n, beta=1.5, seed=0, sx=None, sy=None):
    """Seamless fractal noise 0..1 (FFT filtered white noise); sx/sy low-pass widths give streaks."""
    r = np.random.default_rng(seed)
    f = np.fft.fft2(r.standard_normal((n, n)))
    fx = np.fft.fftfreq(n)[None, :] * n
    fy = np.fft.fftfreq(n)[:, None] * n
    k = np.sqrt(fx * fx + fy * fy); k[0, 0] = 1
    f = f / k ** beta
    if sx: f = f * np.exp(-(fx / sx) ** 2)
    if sy: f = f * np.exp(-(fy / sy) ** 2)
    f[0, 0] = 0
    a = np.real(np.fft.ifft2(f))
    a = (a - a.mean()) / (a.std() + 1e-9)
    return np.clip(a * 0.22 + 0.5, 0, 1)

def to_normal(h, strength):
    gy, gx = np.gradient(h)
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5
    nx, ny, nz = -gx * strength, gy * strength, np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5, np.ones_like(h)], -1)

def rgba(r, g, b):
    return np.stack([r, g, b, np.ones_like(r)], -1).clip(0, 1)

IMAGES = []
def make_image(name, arr, srgb=True, quality=80):
    """float array (h, w, 4) -> JPEG on disk -> loaded and packed (the GLB keeps the JPEG bytes)."""
    h, w, _ = arr.shape
    tmp = bpy.data.images.new(name + '_t', w, h, alpha=False)
    tmp.pixels.foreach_set(np.flipud(arr).astype(np.float32).ravel())
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = quality
    scene.render.image_settings.color_mode = 'RGB'
    path = os.path.join(TMP, name + '.jpg')
    tmp.save_render(path, scene=scene)
    bpy.data.images.remove(tmp)
    img = bpy.data.images.load(path)
    img.name = name
    img.pack()
    img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    IMAGES.append(img)
    return img

N = 512
yy, xx = np.mgrid[0:N, 0:N]

def tex_alu():
    s = pnoise(N, 1.0, 1, sx=6, sy=None)          # horizontal brushing streaks
    b = pnoise(N, 2.2, 2)
    v = 0.70 + (s - 0.5) * 0.30 + (b - 0.5) * 0.14
    scratch = pnoise(N, 0.6, 3, sx=14)
    v = np.where(scratch > 0.74, v * 0.82, v)
    alb = rgba(v * 0.99, v, v * 1.01)
    return make_image('alu', alb), make_image('alu_n', to_normal(s * 0.6 + scratch * 0.4, 1.6), False)

def tex_floor():  # perforated floor panel: round holes on a 32 px grid, tile = 0.2 m
    base = pnoise(N, 1.0, 4, sx=6) * 0.15 + 0.62
    cx, cy = (xx % 32) - 15.5, (yy % 32) - 15.5
    hole = np.hypot(cx, cy) < 7
    rim = np.hypot(cx, cy) < 9
    v = np.where(hole, 0.07, np.where(rim, base * 1.1, base))
    h = np.where(hole, 0.0, np.where(rim, 0.9, 1.0))
    return make_image('floor', rgba(v, v, v * 1.02)), make_image('floor_n', to_normal(h.astype(float), 1.0), False)

def tex_beta():  # quilted off-white beta cloth, tile = 0.32 m: 4 x 4 pillows with stitched seams + fine weave
    cell = 256
    u, v = (xx % cell) / cell, (yy % cell) / cell
    pillow = (np.sin(np.pi * u) * np.sin(np.pi * v)) ** 0.6
    weave = 0.5 + 0.5 * np.sin(xx * 2 * np.pi / 4) * np.sin(yy * 2 * np.pi / 4)
    mott = pnoise(N, 2.0, 5)
    h = pillow * 0.45 + weave * 0.06 + pnoise(N, 1.8, 22) * 0.5
    seam = np.minimum(np.minimum(u, 1 - u), np.minimum(v, 1 - v)) < 0.008
    shade = 0.70 + pillow * 0.08 + (mott - 0.5) * 0.16 + (weave - 0.5) * 0.04
    shade = np.where(seam, shade * 0.85, shade)
    shade = shade * (0.9 + 0.2 * pnoise(N, 1.2, 21))
    return make_image('beta', rgba(shade, shade * 0.975, shade * 0.93)), make_image('beta_n', to_normal(h, 4.0), False)

def tex_foil():  # crinkled gold Mylar: ridged noise
    h = 1 - np.abs(pnoise(N, 2.0, 6) - 0.5) * 2
    h = h ** 1.4 * 0.7 + pnoise(N, 1.6, 7) * 0.3
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)); gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1))
    light = np.clip(0.62 + (gx - gy) * 4.0, 0.35, 0.95)
    base = np.array((0.78, 0.60, 0.30))
    alb = np.stack([base[0] * light, base[1] * light, base[2] * light, np.ones_like(h)], -1)
    return make_image('foil', alb), make_image('foil_n', to_normal(h, 3.5), False)

def tex_webbing():  # checkered light-grey nylon straps, tile = 0.16 m: 4 x 4 pattern of 2 over / 2 under weave
    cell = 64
    u, v = xx % cell, yy % cell
    band = 14
    hor = (v >= band) & (v < cell - band) & True
    gap_h = (v < 5) | (v > cell - 5)
    gap_v = (u < 5) | (u > cell - 5)
    over = ((xx // cell + yy // cell) % 2 == 0)
    fine = 0.5 + 0.5 * np.sin(np.where(over, xx, yy) * 2 * np.pi / 3)
    v0 = np.where(over, 0.80, 0.70) + (fine - 0.5) * 0.06
    v0 = np.where(gap_h | gap_v, 0.42, v0)
    v0 = v0 + (pnoise(N, 2.0, 8) - 0.5) * 0.10
    return make_image('webbing', rgba(v0, v0 * 0.99, v0 * 0.96)), make_image('webbing_n', to_normal(np.where(gap_h | gap_v, 0.0, 1.0) + fine * 0.2, 1.2), False)

def tex_fender():  # tan fibreglass with mottling, scuffs and dust speckle
    m = pnoise(N, 2.4, 9); s = pnoise(N, 1.1, 10, sx=10)
    v = 0.50 + (m - 0.5) * 0.22
    base = np.stack([v * 1.00, v * 0.92, v * 0.80], -1)
    scuff = (s > 0.66)[..., None]
    base = np.where(scuff, base * np.array((1.25, 1.2, 1.15)), base)
    speck = (pnoise(N, 0.2, 11) > 0.80)[..., None]
    base = np.where(speck, base * 0.7, base)
    h = pnoise(N, 0.8, 12) * 0.5 + m * 0.5
    return make_image('fender', np.concatenate([base.clip(0, 1), np.ones((N, N, 1))], -1)), make_image('fender_n', to_normal(h, 1.5), False)

def tex_checker():  # checkered thermal tape on the chassis beams, tile = 0.16 m
    c = ((xx // 64) + (yy // 64)) % 2 == 0
    v = np.where(c, 0.78, 0.25) + (pnoise(N, 2.0, 13) - 0.5) * 0.14
    return make_image('checker', rgba(v, v, v * 0.98))

def tex_dishmesh():  # fine cream wire mesh of the umbrella antenna, tile = 0.05 m
    g = ((xx % 16) < 2) | ((yy % 16) < 2)
    v = np.where(g, 0.78, 0.50) + (pnoise(N, 2.0, 14) - 0.5) * 0.12
    return make_image('dishmesh', rgba(v * 1.0, v * 0.97, v * 0.88)), make_image('dishmesh_n', to_normal(g.astype(float), 1.5)[::2, ::2], False)

def tex_tyre():  # woven zinc-coated steel wire: diamond weave, tile = 0.08 m (8 x 8 diamonds), dusty
    p = 64
    a = (xx + yy) % p; b = (xx - yy) % p
    wa = np.clip(1 - np.abs(a - p / 2) / 13.0, 0, 1)
    wb = np.clip(1 - np.abs(b - p / 2) / 13.0, 0, 1)
    over = (((xx + yy) // p + (xx - yy) // p) % 2 == 0)
    h = np.where(over, np.maximum(wa, wb * 0.7), np.maximum(wb, wa * 0.7))
    mott = pnoise(N, 2.0, 15)
    v = 0.16 + h * 0.26 + (mott - 0.5) * 0.12
    dust = pnoise(N, 2.5, 16)
    v = v + np.clip(dust - 0.42, 0, 1) * 0.5
    return make_image('tyre', rgba(v * 0.97, v, v * 1.02)), make_image('tyre_n', to_normal(h, 2.5), False)

def tex_chevron():  # titanium strip: brushed, rivets along the centreline (u along the strip, tile covers one strip)
    s = pnoise(N, 1.0, 17, sx=5)
    v = 0.50 + (s - 0.5) * 0.18 + (pnoise(N, 2.0, 23) - 0.5) * 0.15
    out = np.stack([v, v * 1.0, v * 0.98], -1)
    for k in range(7):  # rivets
        cx, cy = 36 + k * 74, 256
        d = np.hypot(xx - cx, yy - cy)
        out = np.where((d < 16)[..., None], np.array((0.42, 0.40, 0.38)) * (0.9 + 0.2 * (xx < cx)[..., None]), out)
        out = np.where((d < 9)[..., None], np.array((0.78, 0.50, 0.38)), out)
    out = np.where((np.abs(yy - 256) > 240)[..., None], out * 0.6, out)
    return make_image('chevron', np.concatenate([out.clip(0, 1), np.ones((N, N, 1))], -1))

def tex_disc():  # dusty light-grey bump-stop disc, tile = 0.5 m
    m = pnoise(N, 2.2, 24); s = pnoise(N, 1.2, 25, sx=6)
    v = 0.60 + (m - 0.5) * 0.22 + (s - 0.5) * 0.10
    return make_image('disc', rgba(v * 1.0, v * 0.97, v * 0.92))

def tex_dial():  # console: three round gauges and a small display, texture 512 x 256
    img = np.zeros((256, 512, 4)); img[..., :3] = (0.06, 0.065, 0.07); img[..., 3] = 1
    y2, x2 = np.mgrid[0:256, 0:512]
    for cx in (96, 256, 416):
        d = np.hypot(x2 - cx, y2 - 128)
        img[d < 78, :3] = (0.22, 0.23, 0.24)
        img[d < 68, :3] = (0.82, 0.82, 0.78)
        for k in range(11):
            a = math.radians(-135 + k * 27)
            for t in np.linspace(48, 64, 12):
                px, py = int(cx + t * math.sin(a)), int(128 - t * math.cos(a))
                img[py - 1:py + 2, px - 1:px + 2, :3] = 0.08
        a = math.radians(-135 + (cx % 7) * 30 + 40)
        for t in np.linspace(0, 52, 40):
            px, py = int(cx + t * math.sin(a)), int(128 - t * math.cos(a))
            img[py - 1:py + 2, px - 1:px + 2, :3] = (0.75, 0.12, 0.08)
    return make_image('dial', img)

def tex_placard():  # white/black/orange label with bars of 'text'
    img = np.ones((128, 256, 4)); img[..., :3] = 0.88
    img[:6] = img[-6:] = (0.1, 0.1, 0.1, 1)
    img[:, :6] = img[:, -6:] = (0.1, 0.1, 0.1, 1)
    for i, wid in enumerate((190, 150, 210, 100)):
        img[24 + i * 24:34 + i * 24, 16:16 + wid, :3] = 0.12
    img[100:118, 16:100, :3] = (0.9, 0.45, 0.1)
    return make_image('placard', img)

# ------------------------------------------------------------------ materials (Principled BSDF)
MATS = {}
AUTO_UV = {}   # material name -> metres per texture tile (box projection) for parts that carry no uvs
DUSTY = {}     # material name -> vertex-colour dust strength 0..1
def material(name, color, rough=0.5, metal=0.0, image=None, normal=None, nscale=1.0, tile=None, dust=0.0, double=False,
             vcol=True, ao=True):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    c = tuple(x ** 2.2 for x in color)
    bsdf.inputs['Base Color'].default_value = (*c, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    m.use_backface_culling = not double
    uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'
    def tex(img, srgb):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
        t.image.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        nt.links.new(uvn.outputs['UV'], t.inputs['Vector'])
        return t
    last = None
    if image:
        last = tex(image, True).outputs['Color']
    if vcol and dust:
        va = nt.nodes.new('ShaderNodeVertexColor'); va.layer_name = 'Col'
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        if last is None:
            mix.inputs['A'].default_value = (*c, 1)
        else:
            nt.links.new(last, mix.inputs['A'])
        nt.links.new(va.outputs['Color'], mix.inputs['B'])
        last = mix.outputs['Result']
    if last is not None:
        nt.links.new(last, bsdf.inputs['Base Color'])
    if normal:
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = nscale
        nt.links.new(tex(normal, False).outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    m['ao'] = ao
    if tile: AUTO_UV[name] = tile
    if dust: DUSTY[name] = dust
    MATS[name] = m
    return m

a_al, a_aln = tex_alu(); a_fl, a_fln = tex_floor(); a_be, a_ben = tex_beta(); a_fo, a_fon = tex_foil()
a_we, a_wen = tex_webbing(); a_fe, a_fen = tex_fender(); a_ck = tex_checker(); a_dm, a_dmn = tex_dishmesh()
a_dc = tex_disc(); a_ty, a_tyn = tex_tyre(); a_ch = tex_chevron(); a_di = tex_dial(); a_pl = tex_placard()

material('alu', (1, 1, 1), 0.5, 0.55, a_al, a_aln, 0.5, tile=0.5, dust=0.7)
material('floor', (1, 1, 1), 0.5, 0.5, a_fl, a_fln, 1.0, tile=0.2, dust=0.8)
material('steel', (0.45, 0.44, 0.43), 0.55, 0.5, a_al, a_aln, 0.4, tile=0.5, dust=0.6)
material('motor', (0.12, 0.125, 0.14), 0.55, 0.5, dust=0.5)
material('beta', (1, 1, 1), 0.9, 0.0, a_be, a_ben, 0.9, tile=0.6, dust=0.9)
material('foil', (1, 1, 1), 0.38, 0.9, a_fo, a_fon, 1.0, tile=0.30, dust=0.45)
material('webbing', (1, 1, 1), 0.88, 0.0, a_we, a_wen, 0.8, tile=0.16, dust=0.8, double=True)
material('strap', (0.16, 0.17, 0.19), 0.85, 0.0, dust=0.6)
material('fender', (1, 1, 1), 0.5, 0.0, a_fe, a_fen, 0.8, tile=0.5, dust=0.8, ao=False)
material('checker', (1, 1, 1), 0.6, 0.3, a_ck, tile=0.16, dust=0.8)
material('dishmesh', (1, 1, 1), 0.7, 0.2, a_dm, a_dmn, 1.0, tile=0.05, dust=0.5, double=True)
material('rubber', (0.045, 0.045, 0.05), 0.8, 0.0, dust=0.3)
material('tvblack', (0.03, 0.03, 0.035), 0.4, 0.2, dust=0.3)
material('lens', (0.02, 0.025, 0.04), 0.08, 0.5, dust=0.0)
material('mirror', (0.55, 0.57, 0.6), 0.08, 1.0, dust=0.3)
material('dial', (1, 1, 1), 0.4, 0.0, a_di, dust=0.0)
material('placard', (1, 1, 1), 0.6, 0.0, a_pl, dust=0.0)
material('brass', (0.7, 0.55, 0.25), 0.4, 0.9, dust=0.4)
# wheel materials: own copies (no occlusion map, no vertex colours: the wheel mesh is shared by four wheels)
material('tyre', (1, 1, 1), 0.85, 0.35, a_ty, a_tyn, 1.2, vcol=False, ao=False)
material('chevron', (1, 1, 1), 0.45, 0.7, a_ch, None, vcol=False, ao=False)
material('wdisc', (1, 1, 1), 0.75, 0.25, a_dc, a_aln, 0.3, vcol=False, ao=False)
material('whub', (0.22, 0.21, 0.20), 0.6, 0.5, vcol=False, ao=False)

# ------------------------------------------------------------------ geometry accumulator (game coordinates)
CURRENT = ['']   # name of the builder function currently adding parts (for reports)

class Acc:
    def __init__(self):
        self.m = {}
        self.parts = []   # (tag, material, verts, faces) per added part, for the floating-part check
    def add(self, mat, geo, uv=None):
        verts, faces = geo
        self.parts.append((CURRENT[0], mat, [tuple(v) for v in verts], [tuple(f) for f in faces]))
        d = self.m.setdefault(mat, {'v': [], 'f': [], 'uv': []})
        o = len(d['v'])
        d['v'] += [tuple(v) for v in verts]
        d['f'] += [tuple(i + o for i in f) for f in faces]
        d['uv'] += uv if uv else [None] * len(faces)

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
    """Revolve (radius, axial) points around the X axis; per-face uvs if uv(i, j) is given."""
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

SWAP = Matrix(((0, 0, 1), (0, 1, 0), (1, 0, 0)))   # lathe axis X -> Z

class B:
    def __init__(self):
        self.acc = Acc()
    def box(self, mat, w, h, d, x, y, z, rx=0, ry=0, rz=0, bevel=0.006, segs=1):
        M = Euler((rx, ry, rz), 'XYZ').to_matrix()
        self.acc.add(mat, xform(finish(*box_geo(w, h, d), bevel, segs), M, (x, y, z)))
    def bar(self, mat, a, b, width, t, bevel=0.004, segs=1, side=Vector((1, 0, 0))):
        a, b = Vector(a), Vector(b)
        M = basis_from_dir(b - a, side)
        self.acc.add(mat, xform(finish(*box_geo(width, t, (b - a).length), bevel, segs), M, (a + b) / 2))
    def tube(self, mat, a, b, r, n=None):
        n = n or (5 if r < 0.008 else 6 if r < 0.013 else 8)
        a, b = Vector(a), Vector(b)
        L = (b - a).length
        if L < 1e-5:
            return
        prof = [(0, -L / 2), (r, -L / 2), (r, L / 2), (0, L / 2)]
        geo, _ = lathe_geo(prof, n)
        M = basis_from_dir(b - a) @ SWAP
        self.acc.add(mat, xform(geo, M, (a + b) / 2))
    def lathe(self, mat, prof, pos, axis=Vector((0, 0, 1)), seg=16):
        """Revolve a (r, axial) profile about `axis` starting at pos."""
        geo, _ = lathe_geo(prof, seg)
        M = basis_from_dir(Vector(axis)) @ SWAP
        self.acc.add(mat, xform(geo, M, pos))
    def side(self, mat, pts, x0, x1, bevel=0.006, segs=1):
        """Profile (z, y) extruded across x."""
        self.acc.add(mat, finish(*prism_geo(pts, lambda p, t: (t, p[1], p[0]), x0, x1), bevel, segs))
    def top(self, mat, pts, y0, h, bevel=0.006, segs=1):
        """Outline (x, z) extruded up from y0 by h."""
        self.acc.add(mat, finish(*prism_geo(pts, lambda p, t: (p[0], t, p[1]), y0, y0 + h), bevel, segs))
    def sphere(self, mat, r, x, y, z, seg=6, rings=4):
        prof = [(r * math.sin(math.pi * k / rings), -r * math.cos(math.pi * k / rings)) for k in range(rings + 1)]
        geo, _ = lathe_geo(prof, seg)
        self.acc.add(mat, xform(geo, None, (x, y, z)))
    def raw(self, mat, geo, uv=None):
        self.acc.add(mat, geo, uv)
    def bolt(self, p, nrm, r=0.008, h=0.005, mat='steel'):
        p = Vector(p); n = Vector(nrm).normalized()
        self.tube(mat, p - n * 0.003, p + n * h, r, 6)
    def cable(self, pts, r=0.006, mat='rubber', samples=5):
        """Catmull-Rom curve through pts, as a chain of thin tubes."""
        P = [Vector(p) for p in pts]
        P = [P[0]] + P + [P[-1]]
        out = []
        for i in range(1, len(P) - 2):
            p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
            for s in range(samples):
                t = s / samples
                out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
        out.append(P[-2])
        for a, b in zip(out, out[1:]):
            self.tube(mat, a, b, r, 4)

def mesh_from_acc(name, acc, dust=True, zoff=0.0):
    mats = list(acc.m.keys())
    verts, faces, midx, uvs = [], [], [], []
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
    me.update()
    layer = me.uv_layers.new(name='UVMap')
    for p, u in zip(me.polygons, uvs):
        tile = AUTO_UV.get(mats[midx[p.index]], 1.0)
        n = p.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li, vi in zip(p.loop_indices, p.vertices):
            if u:
                layer.data[li].uv = u[list(p.loop_indices).index(li)]
            else:
                c = verts[vi]
                a, b = [(1, 2), (0, 2), (0, 1)][ax]
                layer.data[li].uv = (c[a] / tile, c[b] / tile)
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(50))
    if dust:
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        flat = []
        tint = np.array((0.62, 0.52, 0.40))     # linear multiplier at full dust: warm grey regolith
        for p in me.polygons:
            strength = DUSTY.get(mats[midx[p.index]], 0.5)
            n = p.normal
            for vi in p.vertices:
                x, y, z = verts[vi]
                z += zoff
                noise = 0.5 + 0.25 * math.sin(x * 23.1 + y * 7.3) * math.sin(y * 19.7 - z * 11.1) + 0.2 * math.sin(z * 31.0 + x * 13.7)
                dstv = 0.45 + 0.55 * max(n.z, 0) ** 0.7 + 0.5 * math.exp(-z / 0.40) + (noise - 0.5) * 0.6
                dstv = min(max(dstv, 0.0), 1.0) * strength
                flat += [*(1 - (1 - tint) * dstv), 1.0]
        ca.data.foreach_set('color', flat)
        me.color_attributes.active_color = ca
    me.update()
    return me, sum(len(f) - 2 for f in faces)

# ------------------------------------------------------------------ helpers for oriented surfaces
def orient(geo, outward, uv=None):
    """Flip faces whose normal points against outward(centre). Returns geo and matching uv corner lists."""
    v, f = geo
    nf, nu = [], []
    for k, face in enumerate(f):
        p = [Vector(v[i]) for i in face]
        n = (p[1] - p[0]).cross(p[2] - p[0])
        c = sum(p, Vector()) / len(p)
        flip = n.dot(outward(c)) < 0
        nf.append(face[::-1] if flip else face)
        if uv:
            nu.append(uv[k][::-1] if flip else uv[k])
    return (v, nf), (nu if uv else None)

# ------------------------------------------------------------------ wheel (symmetric around the X axle, origin = hub)
HALF = [(0.30 + 0.11 * math.cos(math.radians(q)), 0.12 * math.sin(math.radians(q))) for q in range(0, 91, 15)] + [(0.27, 0.118)]   # round cross-section
A_ = [a for r, a in HALF]; R_ = [r for r, a in HALF]
def tread_r(a):
    return float(np.interp(abs(a), A_, R_))

def build_wheel():
    b = B()
    prof = [(r, -a) for r, a in reversed(HALF[1:])] + [HALF[0]] + [(r, a) for r, a in HALF[1:]]
    n = len(prof)
    SEG = 56
    arc = [0.0]
    for j in range(1, n):
        arc.append(arc[-1] + math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]))
    TILE = 0.08
    uvf = lambda i, j: (i / SEG * (2 * math.pi * 0.40 / TILE), arc[min(j, n - 1)] / TILE)
    geo, uv = lathe_geo(prof, SEG, uv=uvf)
    geo, uv = orient(geo, lambda c: Vector((0, c.y, c.z)), uv)
    b.raw('tyre', geo, uv)
    # titanium chevrons riveted on in a V pattern: 36 V's, two arms each, raised 3 mm, covering about half the tread
    NV, SM = 32, 6
    hw = 0.0165
    for k in range(NV):
        phi = k * 2 * math.pi / NV
        for sg in (-1, 1):
            verts, faces, uvs = [], [], []
            for i in range(SM + 1):
                t = i / SM
                q = math.radians(3 + t * 80)            # position round the tyre section
                rr = 0.30 + 0.11 * math.cos(q) + 0.003 * math.cos(q)
                a = sg * (0.12 * math.sin(q) + 0.003 * math.sin(q))
                th = phi - t * 0.38
                for s_ in (-1, 1):
                    w_ = th + s_ * hw / rr
                    verts.append((a, rr * math.cos(w_), rr * math.sin(w_)))
            for i in range(SM):
                faces.append((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2))
                uvs.append([(i / SM, 0), (i / SM, 1), ((i + 1) / SM, 1), ((i + 1) / SM, 0)])
            g, u2 = orient((verts, faces), lambda c: Vector((0, c.y, c.z)) + Vector((c.x * 3, 0, 0)), uvs)
            b.raw('chevron', g, u2)
    for sx in (-1, 1):
        # light grey bump-stop disc (dished) with a lip, ribs and a dark hub motor
        d = [(0.28, sx * 0.108), (0.272, sx * 0.1), (0.25, sx * 0.093), (0.2, sx * 0.082), (0.13, sx * 0.088), (0.092, sx * 0.118), (0.0, sx * 0.122)]
        g, _ = lathe_geo(d, 32)
        g, _ = orient(g, lambda c, sx=sx: Vector((sx, 0, 0)) * 0.1 + Vector((0, c.y, c.z)) * 0.0 + Vector((sx, 0, 0)) * c.x * 0 + Vector((sx, 0, 0)))
        b.raw('wdisc', g)
        for i in range(6):
            M = Euler((i / 6 * 2 * math.pi + 0.3, 0, 0), 'XYZ').to_matrix()
            sp = xform(finish(*box_geo(0.010, 0.17, 0.012), 0.0, 1), None, (sx * 0.092, 0.17, 0))
            b.acc.add('wdisc', xform(sp, M))
        hub = [(0, sx * 0.11), (0.078, sx * 0.11), (0.078, sx * 0.13), (0.06, sx * 0.138), (0, sx * 0.138)]
        g, _ = lathe_geo(hub, 20)
        g, _ = orient(g, lambda c: Vector((0, c.y, c.z)) + Vector((sx * 0.01, 0, 0)))
        b.raw('whub', g)
        for i in range(6):
            q = i / 6 * 2 * math.pi
            b.bolt((sx * 0.138, 0.062 * math.cos(q), 0.062 * math.sin(q)), (sx, 0, 0), 0.006, 0.006, 'steel')
    return b

# ------------------------------------------------------------------ body parts
def sheet(grid, nu, nv, t):
    """Closed thin shell from grid(i, j) -> (outer point, outward normal)."""
    outer, inner = [], []
    for i in range(nu + 1):
        for j in range(nv + 1):
            p, n = grid(i, j)
            outer.append(tuple(p)); inner.append(tuple(Vector(p) - Vector(n) * t))
    V = lambda i, j: i * (nv + 1) + j
    off = len(outer)
    f = []
    for i in range(nu):
        for j in range(nv):
            f.append((V(i, j), V(i + 1, j), V(i + 1, j + 1), V(i, j + 1)))
            f.append((off + V(i, j + 1), off + V(i + 1, j + 1), off + V(i + 1, j), off + V(i, j)))
    for j in range(nv):
        f.append((V(0, j + 1), V(0, j), off + V(0, j), off + V(0, j + 1)))
        f.append((V(nu, j), V(nu, j + 1), off + V(nu, j + 1), off + V(nu, j)))
    for i in range(nu):
        f.append((V(i, 0), V(i + 1, 0), off + V(i + 1, 0), off + V(i, 0)))
        f.append((V(i + 1, nv), V(i, nv), off + V(i, nv), off + V(i + 1, nv)))
    return finish(outer + inner, f, 0, 1, True)

def fender_shell(b, p0, p1, r=0.462, hw=0.150, t=0.009, nseg=22, nv=6, taper=0.4, ramp=0):
    """Closed ~9 mm fibreglass shell over the wheel, in wheel-local coordinates (origin = hub, axle along x).
    phi runs from +z (0) over the top (90) to -z (180). Edges curl down toward the tyre with a small outward lip; the ends
    narrow into rounded corners; bevels roll every rim edge, so there is no raw cut anywhere."""
    def grid(i, j):
        phi = math.radians(p0 + (p1 - p0) * i / nseg)
        sa = abs(2 * i / nseg - 1)
        k = max(0.0, (sa - 0.80) / 0.20)
        h = hw * (1 - taper * k * k)
        u = -h + 2 * h * j / nv
        e = abs(u) / hw
        along = i / nseg if ramp > 0 else 1 - i / nseg
        rr = r + (0.014 * max(0.0, (along - 0.65) / 0.35) ** 2 if ramp else 0.0) - 0.05 * e ** 2 + 0.014 * max(0.0, (e - 0.82) / 0.18) ** 2
        n = Vector((0, math.sin(phi), math.cos(phi)))
        return (u, rr * n.y, rr * n.z), n
    outer, inner = [], []
    for i in range(nseg + 1):
        for j in range(nv + 1):
            pt, n = grid(i, j)
            outer.append(pt); inner.append(tuple(Vector(pt) - Vector(n) * t))
    V = lambda i, j: i * (nv + 1) + j
    off = len(outer)
    f = []
    for i in range(nseg):
        for j in range(nv):
            f.append((V(i, j), V(i + 1, j), V(i + 1, j + 1), V(i, j + 1)))
            f.append((off + V(i, j + 1), off + V(i + 1, j + 1), off + V(i + 1, j), off + V(i, j)))
    for j in range(nv):
        f.append((V(0, j + 1), V(0, j), off + V(0, j), off + V(0, j + 1)))
        f.append((V(nseg, j), V(nseg, j + 1), off + V(nseg, j + 1), off + V(nseg, j)))
    for i in range(nseg):
        f.append((V(i, 0), V(i + 1, 0), off + V(i + 1, 0), off + V(i, 0)))
        f.append((V(i + 1, nv), V(i, nv), off + V(i, nv), off + V(i + 1, nv)))
    b.raw('fender', finish(outer + inner, f, 0.0035, 1, True, 35))

def fender_parts(sx, sz):
    """One wheel's fender: main shell over the top plus the hinged extension flap at the outer end (front wheels: leading
    edge, rear wheels: trailing edge) and the mount to the traction-drive knuckle. Steers with the wheel."""
    b = B()
    # one continuous band over the top of the wheel, never below the axle line; the hinged extension is the outer end of
    # the same surface, flaring slightly outward as it continues forward (front) or back (rear) and down to the axle height
    if sz < 0:
        fender_shell(b, 28, 180, ramp=1)
    else:
        fender_shell(b, 0, 152, ramp=-1)
    xk = -sx * 0.14
    for dz in (-0.035, 0.035):        # struts from the fender's inner rim to the knuckle
        b.tube('alu', (xk, 0.40, dz), (-sx * 0.225, 0.20, dz * 0.3), 0.011, 6)
    b.box('steel', 0.03, 0.03, 0.10, xk, 0.405, 0.0, bevel=0.004)
    b.bolt((xk, 0.42, -0.04), (0, 1, 0), 0.006, 0.004); b.bolt((xk, 0.42, 0.04), (0, 1, 0), 0.006, 0.004)
    return b

def rbox(b, mat, w, h, d, x, y, z, r=0.02, rx=0, ry=0, rz=0):
    b.box(mat, w, h, d, x, y, z, rx, ry, rz, bevel=r, segs=2 if r > 0.02 else 1)

def chassis(b):
    sect = [(-1.32, -0.52), (-0.46, 0.80), (0.86, 1.42)]
    for sx in (-1, 1):
        for z0, z1 in sect:
            L, zc = z1 - z0, (z0 + z1) / 2
            b.box('checker', 0.07, 0.085, L, sx * 0.50, 0.50, zc, bevel=0.008)
            b.tube('alu', (sx * 0.50, 0.565, z0 + 0.03), (sx * 0.50, 0.565, z1 - 0.03), 0.014)
            for z in (z0 + 0.03, z1 - 0.03):
                b.tube('alu', (sx * 0.50, 0.50, z), (sx * 0.50, 0.565, z), 0.012)
        for z in (-0.49, 0.83):   # hinge brackets between the three sections
            b.box('steel', 0.09, 0.10, 0.12, sx * 0.50, 0.50, z, bevel=0.01)
            b.bolt((sx * 0.50, 0.55, z - 0.03), (0, 1, 0)); b.bolt((sx * 0.50, 0.55, z + 0.03), (0, 1, 0))
    for z0, z1 in sect:
        L, zc = z1 - z0, (z0 + z1) / 2
        for z in (z0 + 0.02, z1 - 0.02, zc):
            b.tube('alu', (-0.50, 0.465, z), (0.50, 0.465, z), 0.016)
        n = max(2, int(L / 0.4))
        for k in range(n):
            za, zb = z0 + L * k / n, z0 + L * (k + 1) / n
            b.tube('alu', (-0.50, 0.47, za), (0.50, 0.47, zb), 0.011, 6)
            b.tube('alu', (0.50, 0.47, za), (-0.50, 0.47, zb), 0.011, 6)
    b.box('floor', 0.98, 0.014, 0.76, 0, 0.545, -0.91, bevel=0.003)
    b.box('floor', 0.98, 0.014, 1.24, 0, 0.545, 0.17, bevel=0.003)
    b.box('floor', 0.98, 0.014, 0.50, 0, 0.545, 1.13, bevel=0.003)
    for z in (-1.2, -0.7, -0.35, 0.0, 0.35, 0.7, 1.0, 1.25):   # fasteners along the floor panel edges
        for sx in (-1, 1):
            b.bolt((sx * 0.445, 0.552, z), (0, 1, 0), 0.007, 0.004)
    for sx in (-1, 1):   # front bumper hoop
        b.tube('alu', (sx * 0.50, 0.53, -1.30), (sx * 0.46, 0.58, -1.56), 0.016)
        b.sphere('steel', 0.022, sx * 0.46, 0.58, -1.56)
    b.tube('alu', (-0.46, 0.58, -1.56), (0.46, 0.58, -1.56), 0.016)
    b.tube('alu', (-0.50, 0.53, -1.32), (0.50, 0.53, -1.32), 0.016)

def wheel_stations(b):
    for sx in (-1, 1):
        for sz in (-1, 1):
            zc = sz * HB
            xin, xw = sx * 0.50, sx * 0.69
            for dz in (-1, 1):   # upper and lower wishbones
                b.tube('alu', (xin, 0.60, zc + dz * 0.20), (xw, 0.62, zc), 0.014)
                b.tube('alu', (xin, 0.44, zc + dz * 0.22), (xw, 0.24, zc), 0.014)
                b.sphere('steel', 0.019, xin, 0.60, zc + dz * 0.20, 6, 4)
            b.tube('steel', (xw, 0.2, zc), (xw, 0.66, zc), 0.022)                   # king post
            b.sphere('steel', 0.03, xw, 0.62, zc, 8, 5); b.sphere('steel', 0.03, xw, 0.24, zc, 8, 5)
            b.lathe('motor', [(0, 0), (0.075, 0), (0.075, 0.085), (0.06, 0.1), (0, 0.1)], (xw, R, zc), (-sx, 0, 0), 20)   # drive motor
            b.tube('motor', (sx * 0.62, 0.60, zc), (sx * 0.74, 0.60, zc), 0.028, 10)           # torsion bar / steering motor housing
            b.tube('alu', (sx * 0.55, 0.50, zc - 0.10), (xw, 0.40, zc), 0.01, 6)

def seats(b):
    for x in (-0.32, 0.32):
        zf, zb = 0.02, 0.42
        for sx in (-1, 1):
            xs = x + sx * 0.20
            b.tube('alu', (xs, 0.62, zf), (xs, 0.62, zb), 0.013)                 # pan rails
            b.tube('alu', (xs, 0.62, zb), (xs, 1.24, 0.60), 0.013)               # back posts
            b.tube('alu', (xs, 0.55, zf + 0.03), (xs, 0.62, zf), 0.013)          # front legs
            b.tube('alu', (xs, 0.55, zb - 0.05), (xs, 0.62, zb), 0.013)
            b.tube('alu', (xs, 0.55, zb - 0.02), (xs, 0.55, 0.62), 0.011)        # skid
            b.tube('alu', (xs, 0.86, 0.50), (xs + sx * 0.03, 0.86, 0.15), 0.011)   # armrest
            b.tube('alu', (xs + sx * 0.03, 0.86, 0.15), (xs, 0.62, zf + 0.12), 0.01, 6)
            b.sphere('steel', 0.017, xs, 0.62, zb, 6, 4); b.sphere('steel', 0.017, xs, 1.24, 0.60, 6, 4)
        b.tube('alu', (x - 0.20, 0.62, zf), (x + 0.20, 0.62, zf), 0.013)
        b.tube('alu', (x - 0.20, 0.62, zb), (x + 0.20, 0.62, zb), 0.013)
        b.tube('alu', (x - 0.20, 1.24, 0.60), (x + 0.20, 1.24, 0.60), 0.014)
        b.tube('alu', (x - 0.20, 0.93, 0.51), (x + 0.20, 0.93, 0.51), 0.011)
        b.box('webbing', 0.40, 0.008, 0.40, x, 0.63, 0.22, bevel=0.002)     # checkered nylon webbing pan and back
        b.bar('webbing', (x, 0.66, 0.43), (x, 1.22, 0.585), 0.40, 0.008, 0.002)
        for k in range(3):                                                    # darker straps across the back
            t = 0.25 + k * 0.32
            b.box('strap', 0.42, 0.04, 0.012, x, 0.62 + 0.6 * t, 0.42 + 0.17 * t, rx=0.26, bevel=0.002)
        for dx in (-0.10, 0.10):                                              # seat belt
            b.bar('strap', (x + dx, 0.64, 0.30), (x + dx * 1.6, 1.0, 0.50), 0.045, 0.01, 0.002)
        b.box('steel', 0.06, 0.03, 0.03, x, 0.645, 0.26, bevel=0.005)        # buckle
        b.box('floor', 0.30, 0.012, 0.22, x, 0.60, -0.20, rx=0.55, bevel=0.003)   # footrest
        b.tube('alu', (x - 0.12, 0.55, -0.08), (x - 0.12, 0.60, -0.17), 0.009, 6); b.tube('alu', (x + 0.12, 0.55, -0.08), (x + 0.12, 0.60, -0.17), 0.009, 6)
        b.box('strap', 0.04, 0.008, 0.10, x, 0.62, -0.22, rx=0.55, bevel=0.001)

def console(b):
    # post, console housing under a sun shade, gauges, T hand controller between the seats
    b.tube('alu', (0, 0.55, -0.50), (0, 0.84, -0.50), 0.02)
    b.tube('alu', (0.0, 0.58, -0.30), (0, 0.82, -0.46), 0.011, 6)
    rbox(b, 'alu', 0.42, 0.15, 0.20, 0, 0.90, -0.50, 0.012)
    b.box('alu', 0.46, 0.012, 0.30, 0, 0.985, -0.54, rx=-0.10, bevel=0.003)        # sun shade
    b.box('beta', 0.40, 0.012, 0.20, 0, 0.99, -0.54, rx=-0.10, bevel=0.003)
    for sx in (-1, 1):
        b.tube('alu', (sx * 0.20, 0.97, -0.44), (sx * 0.22, 0.99, -0.62), 0.006, 5)
    face = [(-0.19, 0.835, -0.4005), (0.19, 0.835, -0.4005), (0.19, 0.965, -0.4005), (-0.19, 0.965, -0.4005)]
    b.raw('dial', (face, [(0, 1, 2, 3)]), [[(0, 0), (1, 0), (1, 1), (0, 1)]])
    for sx in (-1, 0, 1):
        b.box('steel', 0.03, 0.03, 0.02, sx * 0.14, 0.82, -0.40, bevel=0.004)
    b.tube('steel', (0, 0.55, -0.06), (0, 0.92, -0.06), 0.012, 8)                    # hand controller stem and T grip
    b.tube('rubber', (-0.07, 0.93, -0.06), (0.07, 0.93, -0.06), 0.016, 8)
    b.sphere('steel', 0.022, 0, 0.92, -0.06, 8, 5)
    b.box('steel', 0.14, 0.025, 0.10, 0, 0.56, -0.06, bevel=0.005)

def blanket_box(b, x, y, z, w, h, d, mirror=True, tag=True):
    rbox(b, 'beta', w, h, d, x, y, z, 0.03)
    b.box('beta', w * 0.84, 0.012, d * 0.5, x, y + h / 2 + 0.002, z + d * 0.12, bevel=0.004)           # folded flap
    for sx in (-1, 1):
        b.box('steel', 0.02, 0.035, 0.03, x + sx * (w / 2 - 0.02), y - h / 2 + 0.02, z - d / 2 + 0.03, bevel=0.003)
        b.bar('strap', (x + sx * 0.06, y + h / 2 + 0.008, z - d / 2 + 0.02), (x + sx * 0.06, y + h / 2 + 0.008, z + d / 2 - 0.02), 0.03, 0.006, 0.001)
    if mirror:   # dust-cover mirror hinged along the top rear edge
        hy, hz = y + h / 2 + 0.004, z + d / 2 - 0.02          # hinge line along the top rear edge
        b.box('mirror', min(w * 0.55, 0.22), 0.004, 0.13, x, hy + 0.0283, hz - 0.0585, rx=0.45, bevel=0.0005)
        b.tube('steel', (x - 0.1, hy, hz), (x + 0.1, hy, hz), 0.006, 6)
    if tag:
        xx_ = x - w / 2 - 0.0008
        b.raw('placard', ([(xx_, y + 0.02, z - 0.07), (xx_, y + 0.02, z + 0.07), (xx_, y + 0.08, z + 0.07), (xx_, y + 0.08, z - 0.07)], [(0, 1, 2, 3)]), [[(0, 0), (1, 0), (1, 1), (0, 1)]])

def front_equipment(b):
    blanket_box(b, -0.34, 0.72, -0.96, 0.44, 0.30, 0.52)
    blanket_box(b, 0.08, 0.71, -0.90, 0.38, 0.28, 0.44)
    blanket_box(b, 0.14, 0.66, -0.56, 0.28, 0.20, 0.22, mirror=False)
    # communications relay unit in crinkled gold foil, with a few extra folds
    rbox(b, 'foil', 0.26, 0.34, 0.30, 0.46, 0.78, -1.22, 0.03)
    b.box('foil', 0.20, 0.10, 0.34, 0.46, 0.97, -1.22, rx=0.25, rz=0.12, bevel=0.02, segs=2)
    b.box('foil', 0.10, 0.28, 0.32, 0.35, 0.76, -1.22, rz=-0.15, bevel=0.02, segs=2)
    b.box('steel', 0.04, 0.04, 0.28, 0.46, 0.60, -1.22, bevel=0.004)
    # TV control unit and the black colour TV camera on a yoke
    rbox(b, 'beta', 0.18, 0.16, 0.22, 0.30, 0.70, -1.42, 0.02)
    b.tube('steel', (0.30, 0.78, -1.42), (0.30, 0.86, -1.42), 0.015)
    b.box('steel', 0.14, 0.015, 0.06, 0.30, 0.87, -1.42, bevel=0.003)
    b.lathe('tvblack', [(0, 0), (0.055, 0), (0.055, 0.16), (0.05, 0.175), (0.0, 0.175)], (0.30, 0.93, -1.34), (0, 0.02, -1), 20)
    b.lathe('lens', [(0, 0.175), (0.036, 0.175), (0.044, 0.20), (0.0, 0.2)], (0.30, 0.93, -1.34), (0, 0.02, -1), 16)
    b.lathe('steel', [(0.058, 0.11), (0.058, 0.125), (0.05, 0.125), (0.05, 0.11)], (0.30, 0.93, -1.34), (0, 0.02, -1), 16)
    b.box('tvblack', 0.06, 0.05, 0.08, 0.30, 0.99, -1.40, bevel=0.005)      # viewfinder hood

def antennas(b):
    # high-gain umbrella antenna: braced tall mast at the front right, tilted ribbed mesh dish
    mx, mz = 0.48, -1.55
    b.tube('alu', (mx, 0.55, mz), (mx, 2.05, mz), 0.016, 10)
    b.box('steel', 0.10, 0.06, 0.10, mx, 0.58, mz, bevel=0.01)
    for sx in (-1, 1):
        b.tube('alu', (mx + sx * 0.07, 0.56, mz + 0.12), (mx, 1.45, mz), 0.006, 5)
        b.tube('alu', (mx + sx * 0.07, 0.56, mz - 0.10), (mx, 1.70, mz), 0.005, 5)
    b.tube('alu', (mx, 0.56, mz + 0.22), (mx, 1.6, mz), 0.005, 5)
    for y in (0.9, 1.3, 1.7):
        b.tube('steel', (mx, y, mz), (mx, y + 0.025, mz), 0.022, 8)
    axis = Vector((0.0, 0.84, -0.54)).normalized()
    vtx = Vector((mx, 2.03, mz))
    base = basis_from_dir(axis)
    xb, yb = base.col[0], base.col[1]
    RD, DEPTH, SEGD, RINGS = 0.46, 0.17, 16, 5
    prof = [(RD * i / RINGS, DEPTH * (i / RINGS) ** 2) for i in range(RINGS + 1)]
    geo, _ = lathe_geo(prof, SEGD)
    M = base @ SWAP
    b.raw('dishmesh', xform(geo, M, vtx))
    def dpt(r, th, a):
        return vtx + axis * a + r * (math.cos(th) * yb + math.sin(th) * xb)
    for k in range(SEGD):
        th = 2 * math.pi * k / SEGD
        pts = [dpt(RD * i / RINGS, th, DEPTH * (i / RINGS) ** 2 + 0.004) for i in range(RINGS + 1)]
        for a_, b_ in zip(pts, pts[1:]):
            b.tube('alu', a_, b_, 0.0045, 4)
        th2 = 2 * math.pi * (k + 1) / SEGD
        b.tube('alu', pts[-1], dpt(RD, th2, DEPTH + 0.004), 0.004, 4)
    b.tube('steel', vtx, vtx + axis * 0.30, 0.008, 6)                            # feed boom
    b.lathe('steel', [(0, 0), (0.03, 0), (0.03, 0.05), (0.0, 0.05)], vtx + axis * 0.30, axis, 12)
    b.sphere('steel', 0.04, vtx.x, vtx.y - 0.02, vtx.z, 8, 5)                    # gimbal
    b.box('steel', 0.07, 0.06, 0.07, mx, 2.07, mz, rx=0.4, bevel=0.008)
    # low-gain helical antenna: thin mast, helix, white cylinder at the top
    lx, lz = 0.50, -0.56
    b.tube('alu', (lx, 0.58, lz), (lx, 1.90, lz), 0.007, 6)
    b.box('steel', 0.08, 0.05, 0.08, lx, 0.60, lz, bevel=0.008)
    pts = []
    for i in range(0, 61):
        q = i / 60
        a = q * 6 * 2 * math.pi
        pts.append((lx + 0.035 * math.cos(a), 1.15 + q * 0.5, lz + 0.035 * math.sin(a)))
    for a_, b_ in zip(pts, pts[1:]):
        b.tube('brass', a_, b_, 0.0025, 3)
    for q in (0, 20, 40, 60):          # thin spokes tie the helix to the mast
        b.tube('brass', (lx, pts[q][1], lz), pts[q], 0.0025, 3)
    b.lathe('beta', [(0, 0), (0.024, 0), (0.024, 0.20), (0.0, 0.20)], (lx, 1.90, lz), (0, 1, 0), 10)
    b.lathe('steel', [(0.0, 0), (0.032, 0), (0.032, 0.025), (0.0, 0.025)], (lx, 1.88, lz), (0, 1, 0), 10)
    b.tube('alu', (lx, 0.9, lz), (lx + 0.12, 0.62, lz + 0.2), 0.005, 5)

def pallet(b):
    blanket_box(b, 0.35, 0.80, 0.98, 0.34, 0.50, 0.22, mirror=False)
    rbox(b, 'alu', 0.34, 0.56, 0.20, -0.30, 0.83, 0.96, 0.012)
    for sx in (-1, 1):
        b.tube('alu', (sx * 0.50, 0.56, 0.89), (sx * 0.50, 1.28, 0.90), 0.014)
        b.tube('alu', (sx * 0.50, 0.56, 1.10), (sx * 0.50, 1.28, 0.95), 0.012)
    b.tube('alu', (-0.55, 1.28, 0.90), (0.55, 1.28, 0.90), 0.014)
    b.tube('alu', (-0.55, 0.95, 0.88), (0.55, 0.95, 0.88), 0.011)
    rbox(b, 'foil', 0.30, 0.22, 0.26, 0.30, 0.68, 1.24, 0.03)
    rbox(b, 'alu', 0.56, 0.26, 0.34, -0.20, 0.69, 1.22, 0.015)
    for dz in (-0.12, 0.12):
        b.box('steel', 0.05, 0.03, 0.03, -0.20, 0.82, 1.22 + dz, bevel=0.004)
    for tx, ln in [(-0.40, 1.05), (-0.34, 0.95), (-0.28, 1.0), (-0.22, 0.85), (-0.16, 0.98)]:   # long-handled tools in clips
        b.tube('alu', (tx, 0.78, 1.36), (tx + 0.05, 0.80 + ln * 0.5, 1.50), 0.011, 6)
        hw_ = 0.12 if tx == -0.34 else 0.07          # the second tool carries the wide scoop head
        b.box('steel', hw_, 0.07, 0.02, tx + 0.05, 0.80 + ln * 0.5 + 0.03, 1.50, bevel=0.004)
    for dx in (0.0, 0.22):          # sample bags with drawstrings
        rbox(b, 'beta', 0.20, 0.16, 0.22, 0.12 + dx, 0.64, 1.28 if dx == 0 else 1.36, 0.03)
        b.tube('strap', (0.12 + dx - 0.1, 0.716, 1.28 if dx == 0 else 1.36), (0.12 + dx + 0.1, 0.716, 1.28 if dx == 0 else 1.36), 0.005, 4)
    b.tube('alu', (-0.50, 0.50, 1.43), (0.50, 0.50, 1.43), 0.015)
    b.raw('placard', ([(0.4408, 0.60, 1.33), (0.4408, 0.60, 1.36), (0.4408, 0.66, 1.36), (0.4408, 0.66, 1.33)], [(0, 1, 2, 3)]), [[(0, 0), (1, 0), (1, 1), (0, 1)]])

def cables(b):
    b.cable([(0.46, 0.70, -1.10), (0.55, 0.60, -0.9), (0.35, 0.585, -0.75), (0.15, 0.62, -0.62), (0.05, 0.80, -0.50)], 0.007)
    b.cable([(0.30, 0.65, -1.42), (0.38, 0.58, -1.25), (0.58, 0.574, -1.0), (0.45, 0.574, -0.75)], 0.006)
    b.cable([(-0.30, 0.575, -0.80), (-0.20, 0.62, -0.60), (-0.10, 0.80, -0.50)], 0.006)
    b.cable([(0.50, 0.60, -0.56), (0.45, 0.60, -0.4), (0.44, 0.565, 0.1), (0.46, 0.565, 0.6), (0.40, 0.575, 0.95)], 0.007)
    b.cable([(0.48, 1.95, -1.55), (0.44, 1.5, -1.52), (0.51, 1.1, -1.58), (0.44, 0.7, -1.5), (0.40, 0.62, -1.3)], 0.004)
    b.cable([(0.42, 0.9, -0.56), (0.30, 0.75, -0.50), (0.12, 0.80, -0.50)], 0.004)
    b.cable([(-0.45, 0.58, -1.0), (-0.47, 0.57, -0.3), (-0.46, 0.57, 0.3), (-0.42, 0.575, 0.9), (-0.30, 0.86, 0.96)], 0.006)
    b.cable([(0.05, 0.56, -0.06), (0.10, 0.553, 0.3), (0.25, 0.553, 0.8), (0.30, 0.6, 1.1)], 0.005)

# ------------------------------------------------------------------ build
body = B()
for fn in (chassis, wheel_stations, seats, console, front_equipment, antennas, pallet, cables):
    CURRENT[0] = fn.__name__
    fn(body)
CURRENT[0] = 'fender'
wheel = build_wheel()
body_mesh, body_tris = mesh_from_acc('body_mesh', body.acc, True)
wheel_mesh, wheel_tris = mesh_from_acc('wheel_mesh', wheel.acc, False)
fender_meshes = {}
fender_tris = 0
for _n, _sx, _sz in [('wheelFL', -1, -1), ('wheelFR', 1, -1), ('wheelRL', -1, 1), ('wheelRR', 1, 1)]:
    fender_meshes[_n], _t = mesh_from_acc(_n + '_fender_mesh', fender_parts(_sx, _sz).acc, True, R)
    fender_tris += _t

body_obj = bpy.data.objects.new('body', body_mesh)
col.objects.link(body_obj)
pivots = []
for name, sx, sz in [('wheelFL', -1, -1), ('wheelFR', 1, -1), ('wheelRL', -1, 1), ('wheelRR', 1, 1)]:
    pivot = bpy.data.objects.new(name, None)
    pivot.empty_display_type = 'PLAIN_AXES'; pivot.empty_display_size = 0.15
    pivot.location = G((sx * HT, R, sz * HB))
    col.objects.link(pivot)
    spin = bpy.data.objects.new(name + '_spin', None)
    spin.empty_display_type = 'ARROWS'; spin.empty_display_size = 0.1
    spin.parent = pivot
    col.objects.link(spin)
    wo = bpy.data.objects.new(name + '_tyre', wheel_mesh)
    wo.parent = spin
    col.objects.link(wo)
    fo = bpy.data.objects.new(name + '_wing', fender_meshes[name])   # the fender: non-spinning, steers with the pivot (children[1]; the exporter sorts children by name, so it must sort after '_spin')
    fo.parent = pivot
    col.objects.link(fo)
    pivots.append((name, pivot, fo))
total_tris = body_tris + 4 * wheel_tris + fender_tris
print(f'LRV triangles: body {body_tris}, wheel {wheel_tris} x4, fenders {fender_tris}, total {total_tris}')

# ------------------------------------------------------------------ steering clearance test (tyre, chevrons, hub and fender vs the static body)
def clearance_report():
    from mathutils.bvhtree import BVHTree
    bv = [v.co.copy() for v in body_mesh.vertices]
    body_bvh = BVHTree.FromPolygons(bv, [tuple(p.vertices) for p in body_mesh.polygons])
    wv = [v.co.copy() for v in wheel_mesh.vertices]
    wp = [tuple(p.vertices) for p in wheel_mesh.polygons]
    print('LRV clearance (steering -21..+21 deg, 1 deg steps; min distance in cm, overlaps = triangle pairs)')
    worst = 9.0
    for name, pivot, fo in pivots:
        loc = pivot.location
        fm = fender_meshes[name]
        shell_idx = [i for i, m in enumerate(fm.materials) if m.name == 'fender']
        fverts = [v.co.copy() for v in fm.vertices]
        fpolys = [tuple(p.vertices) for p in fm.polygons if p.material_index in shell_idx]
        near_wheel = [v for v in bv if (Vector((v.x, v.y, 0)) - Vector((loc.x, loc.y, 0))).length < 1.0]
        res = {'tyre': (9.0, 0, 0), 'fender': (9.0, 0, 0)}
        for deg in range(-21, 22):
            M = Matrix.Translation(loc) @ Matrix.Rotation(math.radians(deg), 4, 'Z')
            for key, verts, polys in (('tyre', wv, wp), ('fender', fverts, fpolys)):
                tv = [M @ v for v in verts]
                tb = BVHTree.FromPolygons(tv, polys)
                used = sorted({i for pl in polys for i in pl})
                tv = [tv[i] for i in used] if key == 'fender' else tv
                pairs = body_bvh.overlap(tb)
                ov = len(pairs)
                if ov and os.environ.get('LRV_DEBUG') and deg in (0, 21) and name == os.environ.get('LRV_DEBUG'):
                    names = {}
                    for bi, ti in pairs:
                        pc = body_mesh.polygons[bi].center
                        k = (body_mesh.materials[body_mesh.polygons[bi].material_index].name, round(pc.x, 1), round(pc.y, 1), round(pc.z, 1))
                        names[k] = names.get(k, 0) + 1
                    print('   DEBUG', key, deg, sorted(names.items(), key=lambda kv: -kv[1])[:8])
                d = min((body_bvh.find_nearest(v)[3] for v in tv if (v - loc).length < 1.2 and v.z > -1), default=9.0)
                d2 = min((tb.find_nearest(v)[3] for v in near_wheel), default=9.0)
                d = min(d, d2)
                if ov: d = 0.0
                cur = res[key]
                res[key] = (min(cur[0], d), cur[1] + ov, cur[2] + (1 if ov else 0))
                if d == res[key][0]: res[key + '_at'] = deg
        print(f"  {name}: tyre min {res['tyre'][0] * 100:.1f} cm at {res.get('tyre_at')} deg, overlaps {res['tyre'][1]} | fender min {res['fender'][0] * 100:.1f} cm at {res.get('fender_at')} deg, overlaps {res['fender'][1]}")
        worst = min(worst, res['tyre'][0], res['fender'][0])
        # fender against its own tyre at rest
        tb = BVHTree.FromPolygons([v for v in wv], wp)
        dd = min(tb.find_nearest(v)[3] for v in fverts if True) if False else None
    print('LRV worst clearance %.1f cm' % (worst * 100))

clearance_report()

# ------------------------------------------------------------------ floating-part check
def floating_report():
    """Every separate part (tube, box, bracket, fender shell ...) must touch (within 2 mm) another part, and every connected
    group of parts must reach the chassis. Fenders are tested in world space at rest, against the body."""
    from mathutils.bvhtree import BVHTree
    TOL = 0.002
    parts = [(t, m, v, f) for t, m, v, f in body.acc.parts]
    for name, pivot, fo in pivots:
        sx = 1 if pivot.location.x > 0 else -1
        sz = -1 if name[5] == 'F' else 1
        off = Vector((sx * HT, R, sz * HB))
        for t, m, v, f in fender_parts(sx, sz).acc.parts:
            parts.append((name + ':' + t, m, [tuple(Vector(p) + off) for p in v], f))
    n = len(parts)
    bvhs, boxes = [], []
    for t, m, v, f in parts:
        vs = [Vector(p) for p in v]
        bvhs.append(BVHTree.FromPolygons(vs, f))
        a = np.array(v); boxes.append((a.min(0) - TOL, a.max(0) + TOL))
    lo = np.array([b[0] for b in boxes]); hi = np.array([b[1] for b in boxes])
    parent = list(range(n))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for i in range(n):
        cand = np.where(np.all(lo <= hi[i], 1) & np.all(hi >= lo, 1))[0]
        vi = [Vector(p) for p in parts[i][2]]
        for j in cand:
            if j <= i or find(i) == find(j): continue
            if bvhs[i].overlap(bvhs[j]) or any(bvhs[j].find_nearest(p, TOL)[0] is not None for p in vi) \
               or any(bvhs[i].find_nearest(Vector(p), TOL)[0] is not None for p in parts[j][2]):
                parent[find(i)] = find(j)
    roots = {}
    for i in range(n): roots.setdefault(find(i), []).append(i)
    anchor = find(next(i for i, p in enumerate(parts) if p[0] == 'chassis'))
    bad = [grp for r, grp in roots.items() if r != anchor]
    print('LRV floating parts: %d of %d parts (%d separate groups not connected to the chassis)' % (sum(len(g) for g in bad), n, len(bad)))
    anchored = [i for i in range(n) if find(i) == anchor]
    for grp in sorted(bad, key=lambda g: -len(g)):
        ctr = np.mean([np.mean(parts[i][2], 0) for i in grp], 0)
        best = (9.0, None)
        for i in grp:
            for j in anchored:
                if np.any(lo[j] - 0.3 > hi[i]) or np.any(hi[j] + 0.3 < lo[i]): continue
                for p in parts[i][2][::3]:
                    d = bvhs[j].find_nearest(Vector(p))[3]
                    if d is not None and d < best[0]: best = (d, parts[j][0] + '/' + parts[j][1])
        print('   FLOATING group of %d: %s at game (%.2f, %.2f, %.2f), nearest %.1f cm to %s' % (len(grp), sorted({parts[i][0] + '/' + parts[i][1] for i in grp})[:4], *ctr, best[0] * 100, best[1]))

floating_report()

# ------------------------------------------------------------------ ambient occlusion bake (Cycles, second UV map on the body)
def bake_ao():
    me = body_mesh
    uv2 = me.uv_layers.new(name='UVAO')
    bpy.ops.object.select_all(action='DESELECT')
    body_obj.select_set(True)
    bpy.context.view_layer.objects.active = body_obj
    me.uv_layers.active = uv2
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.002, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    w = bpy.data.worlds.new('bakeworld'); w.use_nodes = True
    w.light_settings.distance = 0.5
    scene.world = w
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 64
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 6
    scene.render.bake.target = 'IMAGE_TEXTURES'
    ao = bpy.data.images.new('ao_bake', AO_SIZE, AO_SIZE, alpha=False)
    ao.generated_color = (1, 1, 1, 1)
    nodes_added = []
    for m in me.materials:
        nt = m.node_tree
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = ao
        nt.nodes.active = n; n.select = True
        nodes_added.append((m, n))
    bpy.ops.object.bake(type='AO')
    path = os.path.join(TMP, 'ao.jpg')
    scene.render.image_settings.file_format = 'JPEG'; scene.render.image_settings.quality = 80
    scene.render.image_settings.color_mode = 'BW'
    ao.save_render(path, scene=scene)
    scene.render.image_settings.color_mode = 'RGB'
    ao2 = bpy.data.images.load(path); ao2.name = 'ao'; ao2.pack(); ao2.colorspace_settings.name = 'Non-Color'
    # glTF Material Output group with an Occlusion socket, fed by the red channel of the AO texture
    grp = bpy.data.node_groups.get('glTF Material Output')
    if grp is None:
        grp = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        grp.interface.new_socket('Occlusion', socket_type='NodeSocketFloat')
        grp.nodes.new('NodeGroupOutput'); grp.nodes.new('NodeGroupInput')
    for m, n in nodes_added:
        nt = m.node_tree
        n.image = ao2
        uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVAO'
        nt.links.new(uvn.outputs['UV'], n.inputs['Vector'])
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(n.outputs['Color'], sep.inputs['Color'])
        g = nt.nodes.new('ShaderNodeGroup'); g.node_tree = grp
        nt.links.new(sep.outputs['Red'], g.inputs['Occlusion'])
    # the exporter takes the first UV map as TEXCOORD_0: keep the tiling map first
    print('LRV AO baked', AO_SIZE)

if DO_AO:
    bake_ao()

# ------------------------------------------------------------------ export (LRV collection only, no lights/cameras)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
for o in col.objects:
    o.select_set(True)
bpy.context.view_layer.objects.active = body_obj
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                          export_cameras=False, export_lights=False, export_materials='EXPORT', export_image_format='AUTO',
                          export_vertex_color='MATERIAL', export_normals=True, export_texcoords=True, export_tangents=False,
                          export_extras=False, export_jpeg_quality=80)
print('LRV glb', OUT, os.path.getsize(OUT), 'bytes')

# ------------------------------------------------------------------ preview renders (not exported)
def look_at(obj, target):
    d = Vector(G(target)) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def render_previews(outdir):
    os.makedirs(outdir, exist_ok=True)
    scene.render.engine = 'CYCLES'
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'; prefs.get_devices_for_type('METAL')
        for d in prefs.devices: d.use = True
        scene.cycles.device = 'GPU'
    except Exception as e:
        print('GPU not available', e); scene.cycles.device = 'CPU'
    scene.cycles.samples = 96; scene.cycles.use_denoising = True
    scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGB'
    scene.render.resolution_x, scene.render.resolution_y = 1084, 717
    scene.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w'); w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.0, 0.0, 0.0, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    scene.world = w
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
    gm = bpy.data.materials.new('ground'); gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.31, 0.30, 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
    bpy.context.object.data.materials.append(gm)
    def light(kind, loc, energy, size=1, color=(1, 1, 1), target=(0, 0.6, 0)):
        l = bpy.data.lights.new(kind, kind); l.energy = energy; l.color = color
        if kind == 'AREA': l.size = size
        if kind == 'SUN': l.angle = 0.01
        o = bpy.data.objects.new(kind, l); o.location = G(loc); scene.collection.objects.link(o); look_at(o, target)
    light('SUN', (-7, 6, 5), 6.0, color=(1.0, 0.97, 0.92))        # hard low sun from behind the left side
    light('AREA', (6, 4, -5), 250, 8, (0.8, 0.82, 0.9))           # dim fill
    light('AREA', (-4, 3, -6), 120, 6, (1, 0.95, 0.9))            # soft front fill
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
    shots = {
        'side': ((-8.0, 1.5, 0.05), (0, 0.95, 0.05), 60),
        'front34': ((-4.2, 1.5, -5.0), (0, 0.8, 0.0), 55),
        'rear34': ((4.2, 1.9, 5.2), (0, 0.8, 0.0), 55),
        'wheel': ((-2.6, 0.6, -1.1), (-0.9, 0.4, -1.145), 60),
        'driver': ((-0.32, 1.48, 0.22), (-0.32, 1.0, -3.0), 28),
        'top': ((0, 9, 0.01), (0, 0.5, 0), 70),
        'frontview': ((0.3, 0.9, -7.5), (0, 0.8, 0), 65),
        'fenderF': ((-2.6, 0.95, -2.7), (-0.915, 0.6, -1.145), 50),    # front wheel from outside
        'fenderR': ((-2.6, 0.95, 2.7), (-0.915, 0.6, 1.145), 50),      # rear wheel from outside
        'fenderLow': ((-0.2, 0.30, -2.1), (-0.915, 0.55, -1.145), 45), # low inner angle at the front wheel
    }
    steer = math.radians(float(os.environ.get('LRV_STEER', 0)))   # preview only: steer front wheels, rear opposite
    for name, pivot, fo in pivots:
        pivot.rotation_euler.z = steer if name.startswith('wheelF') else -steer
    only = os.environ.get('LRV_SHOTS')
    for name, (loc, tgt, lens) in shots.items():
        if only and name not in only.split(','):
            continue
        cam.location = G(loc); cam.data.lens = lens; look_at(cam, tgt)
        scene.render.filepath = os.path.join(outdir, name + '.png')
        bpy.ops.render.render(write_still=True)
        print('LRV shot', scene.render.filepath)

if SHOTS:
    render_previews(SHOTS)
