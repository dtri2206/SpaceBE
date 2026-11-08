"""
SpaceB&E flight deck, modelled on the Space Shuttle flight deck (reference photo chosen by Role 3): canopy of overhead panels, six forward
windows, glare shield with the checklist/system button strip and MASTER ALARM, twelve displays, FLIGHT MODE panel (X ENGINE CUT-OFF,
F MANUAL, SPACE LOCK), centre and side consoles filled with generated switch panels, two quilted seats. PHASE 1: preview renders and GLB.
The display pages come from scripts/blender/flightdeck_screens/*.png (drawn with src/graphics/cockpitScreens.js; --screens DIR overrides).

Regenerate (Blender 5.2):

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/blender/flightdeck.py -- \
      --shots DIR [--only 1,6] [--samples 64] [--scale 50] [--no-render] [--out file.glb] [--screens DIR]

Coordinates (same as the game's cockpit): the origin is the COMMANDER'S EYE (left seat), +Y up, -Z forward (the windows), +X right, metres.
All geometry is written in game coordinates and converted once to Blender with G(p) = (x, -z, y).
Cockpit centreline x = +0.55, the pilot's eye is at x = +1.10.

Named objects: displayLeft, centreDisplay, displayRight (flat quads, UV 0..1), stick, throttle; wall_L and ceiling are separate
objects so the overview shot can hide them.
"""
import bpy, bmesh, math, os, sys, time, random, tempfile
import numpy as np
from mathutils import Vector, Matrix, Euler
from mathutils.geometry import tessellate_polygon

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default
SHOTS = arg('--shots')
SAMPLES = int(arg('--samples', 32))
ONLY = [int(x) for x in arg('--only', '').split(',') if x]
RENDER = '--no-render' not in argv and SHOTS is not None
T0 = time.time()
def log(*a):
    print(f'FLIGHTDECK {time.time() - T0:5.1f}s', *a, flush=True)

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
col = bpy.data.collections.new('FLIGHTDECK')
scene.collection.children.link(col)

def G(p):  # game (x, y, z) -> blender (x, -z, y)
    return (p[0], -p[2], p[1])
CM = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))

# ------------------------------------------------------------------ images / noise
TMP = tempfile.mkdtemp(prefix='flightdeck_tex_')
IMAGES = {}
def make_image(name, arr, srgb=True, keep=False):
    """arr: float array (h, w, 3 or 4) in 0..1 (row 0 = top)."""
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

def noise2(h, w, cells, seed):
    r = np.random.RandomState(seed)
    g = r.rand(cells, cells)
    ys = (np.arange(h) / h * cells); xs = (np.arange(w) / w * cells)
    y0 = ys.astype(int); x0 = xs.astype(int); fy = ys - y0; fx = xs - x0
    fy = (1 - np.cos(fy * np.pi)) / 2; fx = (1 - np.cos(fx * np.pi)) / 2
    y1 = (y0 + 1) % cells; x1 = (x0 + 1) % cells
    a = g[np.ix_(y0, x0)]; b = g[np.ix_(y0, x1)]; c = g[np.ix_(y1, x0)]; d = g[np.ix_(y1, x1)]
    top = a + (b - a) * fx[None, :]; bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]

def fbm(h, w, base, octaves, seed):
    out = np.zeros((h, w)); amp = 1.0; tot = 0
    for o in range(octaves):
        out += amp * noise2(h, w, base * 2 ** o, seed + o); tot += amp; amp *= 0.5
    return out / tot

class Canvas:
    def __init__(self, w, h, base=(0.2, 0.27, 0.43)):
        self.w, self.h = w, h
        self.col = np.ones((h, w, 3)) * np.array(base)
        self.glow = np.zeros((h, w, 3))
        self.hgt = np.zeros((h, w))
    def _sdf_rrect(self, x, y, w, h, r):
        x0, y0 = int(max(0, x - 2)), int(max(0, y - 2)); x1, y1 = int(min(self.w, x + w + 3)), int(min(self.h, y + h + 3))
        yy, xx = np.mgrid[y0:y1, x0:x1]
        px, py = xx + 0.5 - (x + w / 2), yy + 0.5 - (y + h / 2)
        qx, qy = np.abs(px) - (w / 2 - r), np.abs(py) - (h / 2 - r)
        d = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r
        return (y0, y1, x0, x1), d
    def rect(self, x, y, w, h, color=None, r=0, height=None, glow=None):
        (y0, y1, x0, x1), d = self._sdf_rrect(x, y, w, h, min(r, w / 2, h / 2))
        a = np.clip(0.5 - d, 0, 1)
        if color is not None:
            c = np.array(color, float)
            self.col[y0:y1, x0:x1] = self.col[y0:y1, x0:x1] * (1 - a[..., None]) + c * a[..., None]
        if height is not None:
            self.hgt[y0:y1, x0:x1] = self.hgt[y0:y1, x0:x1] * (1 - a) + height * a
        if glow is not None:
            self.glow[y0:y1, x0:x1] = self.glow[y0:y1, x0:x1] * (1 - a[..., None]) + np.array(glow, float) * a[..., None]
    def outline(self, x, y, w, h, color, t=2, r=0, height=None):
        (y0, y1, x0, x1), d = self._sdf_rrect(x, y, w, h, min(r, w / 2, h / 2))
        a = np.clip(0.5 - np.abs(d + t / 2) + t / 2, 0, 1) * (d < 0.5)
        a = np.clip(t / 2 + 0.5 - np.abs(d + t / 2), 0, 1)
        self.col[y0:y1, x0:x1] = self.col[y0:y1, x0:x1] * (1 - a[..., None]) + np.array(color, float) * a[..., None]
        if height is not None:
            self.hgt[y0:y1, x0:x1] = np.maximum(self.hgt[y0:y1, x0:x1], a * height)
    def disc(self, cx, cy, r, color=None, glow=None, height=None):
        self.rect(cx - r, cy - r, 2 * r, 2 * r, color, r=r, height=height, glow=glow)
    def line(self, x0, y0, x1, y1, color, t=2):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(n + 1):
            k = i / max(1, n)
            self.rect(x0 + (x1 - x0) * k - t / 2, y0 + (y1 - y0) * k - t / 2, t, t, color)
    def text(self, s, x, y, size, color, align='c', glow=None):
        """Text rasterised from Blender's built-in font (outline -> triangles -> coverage). (x, y) = centre of the line."""
        tris, wid, hgt = text_tris(s)
        k = size / max(hgt, 1e-6)
        ox = x - (wid * k / 2 if align == 'c' else (wid * k if align == 'r' else 0))
        oy = y + size / 2
        c = np.array(color, float)
        for (ax, ay, bx, by, cx_, cy_) in tris:
            pts = np.array([[ox + ax * k, oy - ay * k], [ox + bx * k, oy - by * k], [ox + cx_ * k, oy - cy_ * k]])
            xmin, xmax = int(max(0, pts[:, 0].min() - 1)), int(min(self.w, pts[:, 0].max() + 2))
            ymin, ymax = int(max(0, pts[:, 1].min() - 1)), int(min(self.h, pts[:, 1].max() + 2))
            if xmax <= xmin or ymax <= ymin:
                continue
            yy, xx = np.mgrid[ymin:ymax, xmin:xmax]
            cov = np.zeros(xx.shape)
            for sx in (0.25, 0.75):
                for sy in (0.25, 0.75):
                    px, py = xx + sx, yy + sy
                    d1 = (px - pts[1, 0]) * (pts[0, 1] - pts[1, 1]) - (pts[0, 0] - pts[1, 0]) * (py - pts[1, 1])
                    d2 = (px - pts[2, 0]) * (pts[1, 1] - pts[2, 1]) - (pts[1, 0] - pts[2, 0]) * (py - pts[2, 1])
                    d3 = (px - pts[0, 0]) * (pts[2, 1] - pts[0, 1]) - (pts[2, 0] - pts[0, 0]) * (py - pts[0, 1])
                    neg = (d1 < 0) | (d2 < 0) | (d3 < 0); pos = (d1 > 0) | (d2 > 0) | (d3 > 0)
                    cov += ~(neg & pos)
            cov = np.minimum(cov / 4, 1)[..., None]
            sl = (slice(ymin, ymax), slice(xmin, xmax))
            self.col[sl] = self.col[sl] * (1 - cov) + c * cov
            if glow is not None:
                self.glow[sl] = np.maximum(self.glow[sl], cov * np.array(glow, float))

    def text_w(self, s, size):
        tris, wid, hgt = text_tris(s)
        return wid * size / max(hgt, 1e-6)
    def mtext(self, s, x, y, size, color, align='c', glow=None):
        """Cached-mask text for small labels: same layout as text(), glyph coverage rendered once per (string, size)."""
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
                if xmax <= xmin or ymax_ <= ymin: continue
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
        if cx1 <= cx0 or cy1 <= cy0: return
        a = cov[cy0:cy1, cx0:cx1][..., None]
        sl = (slice(top + cy0, top + cy1), slice(left + cx0, left + cx1))
        self.col[sl] = self.col[sl] * (1 - a) + np.array(color, float) * a
        if glow is not None:
            self.glow[sl] = np.maximum(self.glow[sl], a * np.array(glow, float))

_MASKS = {}
_TEXT = {}
def text_tris(s):
    """Triangles of a string in Blender's default font: list of (ax, ay, bx, by, cx, cy) with height 1 = cap height, plus width, height."""
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
    _TEXT[s] = (tris, max(xs) - x0, 0.72)  # cap height of the default font is about 0.72 em
    return _TEXT[s]

class Atlas:
    """Shelf-packs canvases into one image set (colour, glow, height). add() returns the uv rect (u0, v0, u1, v1), v up."""
    def __init__(self, size):
        self.size = size; self.items = []
    def add(self, name, cv):
        self.items.append((name, cv)); return name
    def pack(self):
        order = sorted(self.items, key=lambda it: -it[1].h)
        x = y = shelf = 0; pos = {}
        for name, cv in order:
            if x + cv.w > self.size:
                x = 0; y += shelf; shelf = 0
            assert y + cv.h <= self.size, 'atlas full'
            pos[name] = (x, y); x += cv.w + 2; shelf = max(shelf, cv.h + 2)
        S = self.size
        col = np.zeros((S, S, 3)); glow = np.zeros((S, S, 3)); hgt = np.zeros((S, S))
        self.rects = {}
        for name, cv in self.items:
            px, py = pos[name]
            col[py:py + cv.h, px:px + cv.w] = cv.col; glow[py:py + cv.h, px:px + cv.w] = cv.glow; hgt[py:py + cv.h, px:px + cv.w] = cv.hgt
            self.rects[name] = (px / S, 1 - (py + cv.h) / S, (px + cv.w) / S, 1 - py / S)
        return col, glow, hgt


# ------------------------------------------------------------------ materials (Principled BSDF; colours LINEAR). Painted metal gets procedural edge wear and grime in Cycles.
MATS = {}
WORLD_UV = {}   # material name -> tiles per metre, box-projected in world space (quilting)
def material(name, lin, rough=0.6, metal=0.0, emit=None, emit_strength=1.0, coat=0.0, spec=None,
             image=None, emit_image=None, bump_image=None, bump_strength=0.3, uv_map=None, world_uv=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*lin, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if spec is not None:
        bsdf.inputs['Specular IOR Level'].default_value = spec
    if coat:
        bsdf.inputs['Coat Weight'].default_value = coat
        bsdf.inputs['Coat Roughness'].default_value = 0.05
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    def tex(img, srgb):
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
        t.image.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        t.interpolation = 'Linear'; t.extension = 'REPEAT'
        if uv_map:
            u = nt.nodes.new('ShaderNodeUVMap'); u.uv_map = uv_map
            nt.links.new(u.outputs['UV'], t.inputs['Vector'])
        return t
    if image:
        nt.links.new(tex(image, True).outputs['Color'], bsdf.inputs['Base Color'])
    if bump_image:
        bm_ = nt.nodes.new('ShaderNodeBump'); bm_.inputs['Strength'].default_value = bump_strength; bm_.inputs['Distance'].default_value = 0.004
        nt.links.new(tex(bump_image, False).outputs['Color'], bm_.inputs['Height'])
        nt.links.new(bm_.outputs['Normal'], bsdf.inputs['Normal'])
    if emit_image:
        bsdf.inputs['Emission Strength'].default_value = emit_strength
        nt.links.new(tex(emit_image, True).outputs['Color'], bsdf.inputs['Emission Color'])
    if world_uv:
        WORLD_UV[name] = world_uv
    MATS[name] = m
    return m

def add_wear(name, dirt=0.35, scuff=0.55, rough_add=0.25, scale=30.0):
    """Soft grime plus chipped paint along real edges (bevel-normal edge mask). Cycles only; the exported glb keeps the clean material."""
    m = MATS.get(name)
    if m is None:
        return
    nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']
    if bsdf.inputs['Base Color'].links:
        return
    base = tuple(bsdf.inputs['Base Color'].default_value[:3])
    tc = nt.nodes.new('ShaderNodeTexCoord')
    n1 = nt.nodes.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value = 3.0; n1.inputs['Detail'].default_value = 3; n1.inputs['Roughness'].default_value = 0.5
    n2 = nt.nodes.new('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = 90.0; n2.inputs['Detail'].default_value = 5
    nt.links.new(tc.outputs['Object'], n1.inputs['Vector']); nt.links.new(tc.outputs['Object'], n2.inputs['Vector'])
    dm = nt.nodes.new('ShaderNodeMapRange'); dm.inputs['From Min'].default_value = 0.3; dm.inputs['From Max'].default_value = 0.7; dm.inputs['To Max'].default_value = dirt * 0.5
    nt.links.new(n1.outputs['Fac'], dm.inputs['Value'])
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
    mx.inputs[6].default_value = (*base, 1); mx.inputs[7].default_value = (base[0] * 0.45, base[1] * 0.45, base[2] * 0.42, 1)
    nt.links.new(dm.outputs['Result'], mx.inputs[0])
    bev = nt.nodes.new('ShaderNodeBevel'); bev.inputs['Radius'].default_value = 0.004; bev.samples = 4
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    dt = nt.nodes.new('ShaderNodeVectorMath'); dt.operation = 'DOT_PRODUCT'
    nt.links.new(bev.outputs['Normal'], dt.inputs[0]); nt.links.new(geo.outputs['Normal'], dt.inputs[1])
    em = nt.nodes.new('ShaderNodeMapRange'); em.inputs['From Min'].default_value = 0.985; em.inputs['From Max'].default_value = 0.90
    nt.links.new(dt.outputs['Value'], em.inputs['Value'])
    sm = nt.nodes.new('ShaderNodeMapRange'); sm.inputs['From Min'].default_value = 0.40; sm.inputs['From Max'].default_value = 0.55
    nt.links.new(n2.outputs['Fac'], sm.inputs['Value'])
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
    nt.links.new(em.outputs['Result'], mul.inputs[0]); nt.links.new(sm.outputs['Result'], mul.inputs[1])
    mul2 = nt.nodes.new('ShaderNodeMath'); mul2.operation = 'MULTIPLY'; mul2.inputs[1].default_value = min(1.0, scuff)
    nt.links.new(mul.outputs['Value'], mul2.inputs[0])
    mx2 = nt.nodes.new('ShaderNodeMix'); mx2.data_type = 'RGBA'
    nt.links.new(mul2.outputs['Value'], mx2.inputs[0]); nt.links.new(mx.outputs[2], mx2.inputs[6])
    mx2.inputs[7].default_value = (*[min(0.45, base[i] * 2.4 + 0.12) for i in range(3)], 1)
    nt.links.new(mx2.outputs[2], bsdf.inputs['Base Color'])
    r0 = bsdf.inputs['Roughness'].default_value
    ra = nt.nodes.new('ShaderNodeMath'); ra.operation = 'MULTIPLY_ADD'; ra.inputs[1].default_value = rough_add * 0.3; ra.inputs[2].default_value = max(0.05, r0 - rough_add * 0.1)
    nt.links.new(n1.outputs['Fac'], ra.inputs[0])
    nt.links.new(ra.outputs['Value'], bsdf.inputs['Roughness'])

def quilt_maps(size=256):
    """Smooth upholstery: fine woven blue cloth, no quilting, a very soft large-scale pillow shade. One tile = 0.12 m, 32 weave cells."""
    yy, xx = np.mgrid[0:size, 0:size] / size
    weave = 0.5 + 0.5 * np.sin(xx * 2 * np.pi * 8) * np.sin(yy * 2 * np.pi * 8)   # low frequency, so it never aliases
    n = fbm(size, size, 8, 3, 3)
    blue = np.array([0.12, 0.18, 0.44])
    col = blue[None, None, :] * (0.975 + 0.025 * weave[..., None]) * (0.97 + 0.05 * n[..., None])
    return make_image('quilt', np.clip(col, 0, 1)), make_image('quilt_h', weave * 0.5 + 0.25 * n, srgb=False)

def glass_material(name='glass', fac=0.05, tint=(0.78, 0.9, 0.95)):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*tint, 1)
    bsdf.inputs['Alpha'].default_value = fac
    bsdf.inputs['Roughness'].default_value = 0.04
    transmission = bsdf.inputs.get('Transmission Weight') or bsdf.inputs.get('Transmission')
    if transmission:
        transmission.default_value = 0.9
    if hasattr(m, 'surface_render_method'):
        m.surface_render_method = 'DITHERED'
    elif hasattr(m, 'blend_method'):
        m.blend_method = 'BLEND'
    MATS[name] = m

def hazard_material(name='hazard'):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']; bsdf.inputs['Roughness'].default_value = 0.7
    tc = nt.nodes.new('ShaderNodeTexCoord')
    wv = nt.nodes.new('ShaderNodeTexWave'); wv.wave_type = 'BANDS'; wv.bands_direction = 'DIAGONAL'; wv.wave_profile = 'SAW'
    wv.inputs['Scale'].default_value = 14.0; wv.inputs['Distortion'].default_value = 0.0
    cr = nt.nodes.new('ShaderNodeValToRGB'); cr.color_ramp.interpolation = 'CONSTANT'
    cr.color_ramp.elements[0].color = (0.012, 0.012, 0.012, 1)
    e = cr.color_ramp.elements.new(0.5); e.color = (0.75, 0.50, 0.01, 1)
    nt.links.new(tc.outputs['Object'], wv.inputs['Vector']); nt.links.new(wv.outputs['Fac'], cr.inputs['Fac'])
    nt.links.new(cr.outputs['Color'], bsdf.inputs['Base Color'])
    MATS[name] = m

def define_materials():
    material('clay', (0.20, 0.20, 0.21), 0.55)          # painted grey metal
    material('frame', (0.07, 0.07, 0.075), 0.45)
    material('hood', (0.11, 0.11, 0.115), 0.5)
    material('bay', (0.04, 0.04, 0.045), 0.7)
    material('seam', (0.012, 0.012, 0.014), 0.8)
    material('bezel', (0.045, 0.045, 0.05), 0.45)
    qc, qh = quilt_maps()
    material('fabric', (1, 1, 1), 0.6, image=qc, world_uv=8.3, spec=0.55)
    material('fabric2', (0.6, 0.6, 0.6), 0.6, image=qc, world_uv=8.3, spec=0.55)
    material('seatframe', (0.06, 0.06, 0.065), 0.45, metal=0.5)
    material('floorgrey', (0.16, 0.16, 0.17), 0.75)
    material('stickmat', (0.035, 0.035, 0.04), 0.4)
    material('fixture', (0.9, 0.9, 0.85), 0.4, emit=(1.0, 0.95, 0.85), emit_strength=2.0)
    material('dash_dark', (0.003, 0.004, 0.006), 0.45, 0.1)
    material('steel', (0.6, 0.62, 0.66), 0.28, 1.0)
    material('alu_dark', (0.02, 0.022, 0.026), 0.4, 0.85)
    material('red', (0.34, 0.004, 0.002), 0.4, coat=0.3)
    material('yellow', (0.79, 0.35, 0.0), 0.4, coat=0.3)
    material('soft', (0.012, 0.013, 0.015), 0.55)
    material('rubber', (0.01, 0.01, 0.012), 0.5, spec=0.7)
    material('lamp_red', (0.3, 0.0, 0.0), 0.3, emit=(1.0, 0.08, 0.04), emit_strength=1.5)
    material('capdark', (0.03, 0.03, 0.035), 0.45)
    material('tickwhite', (0.7, 0.7, 0.68), 0.6)
    material('cable', (0.012, 0.012, 0.014), 0.5)
    material('cabley', (0.8, 0.5, 0.01), 0.45)
    glass_material(fac=0.01)
    glass_material('hudglass', 0.25, (0.55, 0.85, 0.7))
    hazard_material()
    for nm, kw in (('clay', dict(dirt=0.5, scuff=0.6)), ('hood', dict(dirt=0.5, scuff=0.6)), ('frame', dict(dirt=0.4, scuff=0.7)), ('floorgrey', dict(dirt=0.7, scuff=0.3))):
        add_wear(nm, **kw)

def lens_material(name, rgb, strength):
    return material(name, tuple(c * 0.15 for c in rgb), 0.3, emit=rgb, emit_strength=strength)

define_materials()
# ------------------------------------------------------------------ geometry accumulator (game coordinates) with a frame stack
FRAMES = [(Matrix.Identity(3), Vector((0, 0, 0)))]
class frame:
    def __init__(self, M=None, t=(0, 0, 0)):
        self.M = M if M is not None else Matrix.Identity(3); self.t = Vector(t)
    def __enter__(self):
        M0, t0 = FRAMES[-1]
        FRAMES.append((M0 @ self.M, M0 @ self.t + t0))
    def __exit__(self, *a):
        FRAMES.pop()

class Acc:
    def __init__(self):
        self.m = {}
        self.parts = []
    def add(self, mat, geo, uv=None):
        verts, faces = geo
        M, t = FRAMES[-1]
        verts = [tuple(M @ Vector(v) + t) for v in verts]
        self.parts.append((mat, verts, [tuple(f) for f in faces]))
        d = self.m.setdefault(mat, {'v': [], 'f': [], 'uv': []})
        o = len(d['v'])
        d['v'] += verts
        d['f'] += [tuple(i + o for i in f) for f in faces]
        d['uv'] += uv if uv else [None] * len(faces)
    def tris(self):
        return sum(len(f) - 2 for d in self.m.values() for f in d['f'])

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

def Rx(a): return Matrix.Rotation(a, 3, 'X')
def Ry(a): return Matrix.Rotation(a, 3, 'Y')
def Rz(a): return Matrix.Rotation(a, 3, 'Z')

def lathe_geo(profile, seg):
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

class B:
    def __init__(self):
        self.acc = Acc()
    def box(self, mat, w, h, d, x, y, z, rx=0, ry=0, rz=0, bevel=0.006, segs=1):
        M = Rx(rx) @ Ry(ry) @ Rz(rz)
        bevel = min(bevel, min(w, h, d) * 0.45)
        self.acc.add(mat, xform(finish(*box_geo(w, h, d), bevel, segs), M, (x, y, z)))
    def strut(self, mat, a, b, r, r1=None, n=10):
        a, b = Vector(a), Vector(b)
        L = (b - a).length
        r1 = r if r1 is None else r1
        prof = [(0, -L / 2), (r, -L / 2), (r1, L / 2), (0, L / 2)]
        geo = lathe_geo(prof, n)
        M = basis_from_dir(b - a) @ Matrix(((0, 0, 1), (0, 1, 0), (1, 0, 0)))
        self.acc.add(mat, xform(geo, M, (a + b) / 2))
    def bar(self, mat, a, b, width, t, bevel=0.004, side=Vector((1, 0, 0))):
        a, b = Vector(a), Vector(b)
        M = basis_from_dir(b - a, side)
        self.acc.add(mat, xform(finish(*box_geo(width, t, (b - a).length), bevel, 1), M, (a + b) / 2))
    def quad(self, mat, w, h, x, y, z, uvr=(0, 0, 1, 1)):
        v = [(-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0)]
        u0, v0, u1, v1 = uvr
        self.acc.add(mat, xform((v, [(0, 1, 2, 3)]), None, (x, y, z)), [[(u0, v0), (u1, v0), (u1, v1), (u0, v1)]])
    def raw(self, mat, geo):
        self.acc.add(mat, geo)


# ---- more builder methods (copied from cockpit.py) and tubes
def _cyl(self, mat, r, h, x, y, z, axis='y', n=12, r1=None, bevel=0):
    c = Vector((x, y, z))
    d = {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}[axis]
    self.strut(mat, c - d * h / 2, c + d * h / 2, r, r1, n)
def _rbox(self, mat, w, h, d, x, y, z, r, rx=0, ry=0, rz=0, segs=2):
    segs = 1 if min(w, h, d) < 0.045 else min(segs, 2)
    self.box(mat, w, h, d, x, y, z, rx, ry, rz, bevel=r, segs=segs)
def _panel(self, mat, w, h, x, y, z, uvr, rot=(0, 0, 0)):
    v = [(-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0)]
    M = Euler(rot, 'XYZ').to_matrix()
    u0, v0, u1, v1 = uvr
    self.acc.add(mat, xform((v, [(0, 1, 2, 3)]), M, (x, y, z)), [[(u0, v0), (u1, v0), (u1, v1), (u0, v1)]])
def _sphere(self, mat, r, x, y, z, n=12, m=6):
    prof = [(r * math.sin(math.pi * k / m), -r * math.cos(math.pi * k / m)) for k in range(m + 1)]
    self.acc.add(mat, xform(lathe_geo(prof, n), None, (x, y, z)))
def _tube(self, mat, pts, r, n=6, per=5):
    self.acc.add(mat, sweep(catmull(pts, per, False), circle_profile(r, n), closed=False, caps=True))
B.cyl = _cyl; B.rbox = _rbox; B.panel = _panel; B.sphere = _sphere; B.tube = _tube

def ov_cone(b, mat, a, c, r0, r1, n):
    a, c = Vector(a), Vector(c); L = (c - a).length
    geo = lathe_geo([(r0, -L / 2), (r1, L / 2), (0, L / 2)], n)
    M = basis_from_dir(c - a) @ Matrix(((0, 0, 1), (0, 1, 0), (1, 0, 0)))
    b.acc.add(mat, xform(geo, M, (a + c) / 2))

def sweep(points, profile, normals=None, closed=False, caps=True, sides=None):
    """Extrude a 2D profile [(side, out)] along a polyline. normals: per-point 'out' direction (else parallel transported)."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    ts = []
    for i in range(n):
        if closed:
            t = pts[(i + 1) % n] - pts[(i - 1) % n]
        else:
            t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        ts.append(t.normalized())
    verts, k = [], len(profile)
    prev = None
    for i in range(n):
        if normals is not None and sides is not None:
            nr = Vector(normals[i]).normalized(); sd = Vector(sides[i]); sd = (sd - nr * sd.dot(nr)).normalized()
        elif normals is not None:
            nr = Vector(normals[i]); sd = ts[i].cross(nr).normalized(); nr = sd.cross(ts[i]).normalized()
        else:
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

def circle_profile(r, n=6):
    return [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)) for i in range(n)]

def rrect_profile(w, h, r, seg=2, y0=0.0):
    """Rounded rectangle, bottom at y0 (sits on a surface), width w along 'side', height h along 'out'."""
    pts = []
    for (cx, cy, a0) in ((w / 2 - r, h - r, 0), (-w / 2 + r, h - r, 90), (-w / 2 + r, r, 180), (w / 2 - r, r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), y0 + cy + r * math.sin(a)))
    return pts

def catmull(points, per=6, closed=False):
    P = [Vector(p) for p in points]; n = len(P); out = []
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        p0 = P[(i - 1) % n] if (closed or i > 0) else P[i]
        p1 = P[i]; p2 = P[(i + 1) % n]
        p3 = P[(i + 2) % n] if (closed or i + 2 < n) else P[(i + 1) % n]
        for s in range(per):
            t = s / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    if not closed:
        out.append(P[-1])
    return out


OBJS = {}
def O(name):
    return OBJS.setdefault(name, B())

def mesh_from_acc(name, acc, pivot=None):
    mats = list(acc.m.keys())
    verts, faces, midx, uvs = [], [], [], []
    any_uv = any(any(u is not None for u in d['uv']) for d in acc.m.values()) or any(m in WORLD_UV for m in mats)
    pv = Vector(pivot) if pivot is not None else Vector((0, 0, 0))
    for k, m in enumerate(mats):
        d = acc.m[m]
        o = len(verts)
        verts += [G(Vector(v) - pv) for v in d['v']]
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
        for p in me.polygons:
            nm = mats[p.material_index]
            if nm not in WORLD_UV:
                continue
            k = WORLD_UV[nm]; n = p.normal
            for li, vi in zip(p.loop_indices, p.vertices):
                v = me.vertices[vi].co
                ax = max(range(3), key=lambda i: abs(n[i]))
                layer.data[li].uv = (v.y * k, v.z * k) if ax == 0 else ((v.x * k, v.y * k) if ax == 2 else (v.x * k, v.z * k))
    me.update()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(40))
    return me


# ------------------------------------------------------------------ construction helpers: planes, slabs with holes, panel bays
def pf(origin, ex, n):
    """Frame on a plane: local x = ex, local z = n (the visible side), local y = n x ex."""
    ex = Vector(ex).normalized(); n = Vector(n).normalized()
    ey = n.cross(ex).normalized()
    M = Matrix(((ex.x, ey.x, n.x), (ex.y, ey.y, n.y), (ex.z, ey.z, n.z)))
    return frame(M, origin), (ex, ey, n)

def rect(c):
    a0, a1, b0, b1 = c
    return [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]

def rrect(a0, a1, b0, b1, r, seg=3):
    pts = []
    for (cx, cy, s) in ((a1 - r, b0 + r, 270), (a1 - r, b1 - r, 0), (a0 + r, b1 - r, 90), (a0 + r, b0 + r, 180)):
        for i in range(seg + 1):
            t = math.radians(s + 90 * i / seg)
            pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    return pts

def slab_geo(outline, holes, thick):
    """Planar slab: front face at local z = 0, back at -thick, holes are through-holes (their walls are the reveals)."""
    rings = [outline] + list(holes)
    pts, idx = [], []
    for r in rings:
        idx.append(list(range(len(pts), len(pts) + len(r)))); pts += list(r)
    n = len(pts)
    verts = [(a, b, 0.0) for a, b in pts] + [(a, b, -thick) for a, b in pts]
    tris = tessellate_polygon([[Vector((a, b, 0)) for a, b in r] for r in rings])
    faces = [tuple(t) for t in tris] + [(t[2] + n, t[1] + n, t[0] + n) for t in tris]
    for r in idx:
        m = len(r)
        for i in range(m):
            i0, i1 = r[i], r[(i + 1) % m]
            faces.append((i0, i1, i1 + n, i0 + n))
    return finish(verts, faces, 0.0, closed=True)

def centroid(poly):
    return (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))

def shrink(poly, d):
    cx, cy = centroid(poly)
    return [(p[0] - d * (1 if p[0] > cx else -1), p[1] - d * (1 if p[1] > cy else -1)) for p in poly]

def grow(poly, d):
    return shrink(poly, -d)

def inside(p, poly):
    x, y = p; c = False
    for i in range(len(poly)):
        x0, y0 = poly[i]; x1, y1 = poly[(i + 1) % len(poly)]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            c = not c
    return c

def edge_dist(p, poly):
    best = 9.0
    for i in range(len(poly)):
        ax, ay = poly[i]; bx, by = poly[(i + 1) % len(poly)]
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy + 1e-12)))
        best = min(best, math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy))
    return best

def xspan(poly, y):
    xs = []
    for i in range(len(poly)):
        x0, y0 = poly[i]; x1, y1 = poly[(i + 1) % len(poly)]
        if (y0 > y) != (y1 > y):
            xs.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
    return (min(xs), max(xs)) if len(xs) >= 2 else None

def auto_cells(poly, wmax=0.34, hmax=0.22, margin=0.03, gap=0.022, seed=0, minsize=0.05):
    """Bays in rows; each row spans the polygon's width at that height (works for trapezoids and skewed quads)."""
    ys = [p[1] for p in poly]
    b0, b1 = min(ys), max(ys)
    rnd = random.Random(seed)
    def split(lo, hi, n):
        ws = [0.8 + 0.4 * rnd.random() for _ in range(n)]
        tot = sum(ws); L = hi - lo - (n - 1) * gap
        out, x = [], lo
        for w in ws:
            ww = L * w / tot; out.append((x, x + ww)); x += ww + gap
        return out
    ny = max(1, math.ceil((b1 - b0 - 2 * margin + gap) / (hmax + gap)))
    cells = []
    for (r0, r1) in split(b0 + margin, b1 - margin, ny):
        if r1 - r0 < min(minsize, 0.035):
            continue
        sp0 = xspan(poly, r0 + 1e-4); sp1 = xspan(poly, r1 - 1e-4)
        if not sp0 or not sp1:
            continue
        lo = max(sp0[0], sp1[0]) + margin; hi = min(sp0[1], sp1[1]) - margin
        if hi - lo < minsize:
            continue
        nx = max(1, math.ceil((hi - lo + gap) / (wmax + gap)))
        for (c0, c1) in split(lo, hi, nx):
            if c1 - c0 < minsize:
                continue
            if all((inside(p, poly) or edge_dist(p, poly) < 1e-6) and edge_dist(p, poly) >= margin * 0.7 - 1e-6 for p in rect((c0, c1, r0, r1))):
                cells.append((c0, c1, r0, r1))
    return cells

# ------------------------------------------------------------------ console banks (v3): typed panels in shared rails, laid out by system and reach
PN_PPM = int(arg('--ppm', 560))
PN_BASE = (0.50, 0.505, 0.52)      # sRGB-coded dark grey (linear ~0.06)
PN_FG = (0.9, 0.91, 0.9)
RW = 0.024                         # rail / stile width: one profile everywhere
SYS = {
    'PROPULSION': ['MAIN ENG', 'ENG ARM', 'FUEL A', 'FUEL B', 'LOX A', 'LOX B', 'PRESS', 'VENT', 'TVC 1', 'TVC 2', 'IGN', 'SHUTDN', 'HE PRS', 'PURGE'],
    'RCS': ['RCS A', 'RCS B', 'THR 1', 'THR 2', 'THR 3', 'THR 4', 'ISOL', 'XFEED', 'PRPLNT', 'HTR', 'VLV A', 'VLV B', 'ARM', 'FIRE'],
    'ABORT': ['LES ARM', 'ABORT', 'PYRO A', 'PYRO B', 'SEP', 'JETT', 'TOWER', 'CHUTE', 'DEPLOY', 'SAFE', 'MOTOR', 'ENABLE'],
    'EPS BUS A': ['BAT 1', 'BAT 2', 'BAT 3', 'INV A', 'INV B', 'BUS TIE', 'FC 1', 'FC 2', 'LOAD', 'SHED', 'MAIN A', 'AUX A'],
    'EPS BUS B': ['BAT 4', 'BAT 5', 'BAT 6', 'INV C', 'INV D', 'BUS TIE', 'FC 3', 'FC 4', 'LOAD', 'SHED', 'MAIN B', 'AUX B'],
    'COMM': ['S-BAND', 'UHF', 'VHF', 'DATA', 'VOICE A', 'VOICE B', 'XPDR', 'ANT SEL', 'ENCRYPT', 'REC', 'PWR AMP', 'SQL'],
    'ECLSS': ['CAB FAN', 'CO2 SCR', 'O2 SUP', 'H2O', 'COOLANT', 'HX', 'VENT', 'DUMP', 'SUIT LOOP', 'PRESS', 'HUMID', 'TEMP'],
    'CABIN PRESS': ['PRESS', 'DEPRESS', 'EQUAL', 'RELIEF', 'O2 FLOW', 'N2 FLOW', 'ISOL', 'LEAK CK', 'REPRESS', 'ALARM'],
    'LIGHTING': ['FLOOD', 'DIM', 'PANEL', 'STROBE', 'READ L', 'READ R', 'DOCK LT', 'EXT LT', 'ANNUN', 'TEST'],
    'WINDOW HTR': ['HTR 1', 'HTR 2', 'DEFOG', 'OUTER', 'INNER', 'ZONE A', 'ZONE B', 'AUTO'],
    'DOCKING': ['DOCK PWR', 'LATCH', 'HOOKS', 'PROBE', 'SOFT CAP', 'HARD MATE', 'LEAK CK', 'SEQ', 'RETRACT', 'EXTEND'],
    'HATCH': ['HATCH EQ', 'EQUAL', 'PRESS', 'LATCH 1', 'LATCH 2', 'UNLOCK', 'SEAL', 'ACTUATE', 'VENT', 'SAFE'],
    'ENTRY': ['DROGUE', 'MAIN 1', 'MAIN 2', 'CUTOFF', 'JETT HS', 'ARM', 'APEX', 'BARO', 'SEQ A', 'SEQ B'],
    'CB MAIN A': ['A'], 'CB MAIN B': ['B'], 'CB ESS': ['E'],
    'CAUTION & WARNING': ['MASTER', 'CABIN P', 'O2 LOW', 'FUEL', 'BATT', 'APU', 'RCS', 'COMMS', 'THERM', 'GUID', 'ABORT', 'HATCH', 'DOCK', 'PARA', 'IMU', 'PYRO', 'CO2', 'FIRE',
                          'MAIN BUS', 'INV', 'PROP', 'PRESS', 'COOLNT', 'SUIT', 'WIN HTR', 'LES', 'SEP', 'ENTRY', 'DATA', 'TLM', 'NAV', 'SEQ'],
}
PN_SPECS, PN_CELLS, PN_DEFER, PN_IDS = {}, [], [], {}
PN_MAP = []

def pn_make(kind, system, fw, fh, pid, rng, red=False):
    sp = dict(kind=kind, system=system, fw=fw, fh=fh, pid=pid, items=[], groups=[], red=red)
    L = SYS[system]
    x0, x1 = -fw / 2 + 0.012, fw / 2 - 0.012
    top, bot = fh / 2 - 0.021, -fh / 2 + 0.009
    li = [rng.randint(len(L))]
    def lab():
        return L[rng.randint(len(L))]
    if kind == 'sw':
        pitch = 0.0235 if fw >= 0.16 else 0.026; cols = max(1, int((x1 - x0) // pitch)); rowp = 0.044
        rows = max(1, int((top - bot) // rowp))
        xs = (x0 + x1) / 2 + (np.arange(cols) - (cols - 1) / 2) * pitch
        for r in range(rows):
            yc = top - rowp * (r + 0.5) - (top - bot - rowp * rows) / 2
            c = 0
            while c < cols:
                g = min(cols - c, int(rng.randint(2, 5)))
                if cols - c - g == 1: g += 1
                sp['groups'].append(dict(x0=xs[c] - pitch / 2 + 0.002, x1=xs[c + g - 1] + pitch / 2 - 0.002, y0=yc - rowp / 2 + 0.002, y1=yc + rowp / 2 - 0.004, name=lab(), first=xs[c]))
                for k in range(g):
                    pg = 0.5 if system == 'ABORT' else (0.06 if system in ('PROPULSION', 'RCS', 'HATCH', 'DOCKING') else 0.025)
                    if red: pg = 0.4
                    guard = None
                    if rng.rand() < pg: guard = 'red' if (red or (system in ('ABORT', 'PROPULSION', 'ENTRY') and rng.rand() < 0.75)) else 'yellow'
                    pos = ['up', 'down', 'up', 'mid'][rng.randint(4)]
                    sp['items'].append(dict(t='tog', x=float(xs[c + k]), y=yc - 0.003, lab=lab(), pos=pos, guard=guard, lamp=bool(rng.rand() < 0.1)))
                c += g
    elif kind == 'brk':
        pitch = 0.0215; cols = max(4, int((x1 - x0) // pitch)); rowp = 0.027
        rows = max(1, int((top - bot) // rowp))
        xs = (x0 + x1) / 2 + (np.arange(cols) - (cols - 1) / 2) * pitch
        for r in range(rows):
            yc = top - rowp * (r + 0.5) - (top - bot - rowp * rows) / 2
            sp['items'].append(dict(t='brkrow', y=yc - 0.0025, xs=[float(x) for x in xs], seed=int(rng.randint(100000)), row=r, bus=('A' if 'A' in system[-1] else 'B') + str(r + 1)))
    elif kind == 'mini':
        pitch = 0.0215; cols = max(1, int((fw - 0.012) // pitch)); xs = (np.arange(cols) - (cols - 1) / 2) * pitch
        for c in range(cols):
            pg = 0.12 if system in ('ABORT', 'PROPULSION') else 0.03
            sp['items'].append(dict(t='tog', x=float(xs[c]), y=0.005, lab=lab(), pos=['up', 'down', 'up', 'mid'][rng.randint(4)], guard=('red' if rng.rand() < pg else None), lamp=bool(rng.rand() < 0.15)))
    elif kind in ('cw', 'ann'):
        lw = 0.0215; pitch = 0.0245
        cols = min(8, int((x1 - x0 - (0.055 if kind == 'cw' else 0.004)) // pitch)); rows = min(5, int((top - bot) // pitch))
        xs = x0 + 0.01 + np.arange(cols) * pitch + lw / 2
        ys = top - 0.002 - pitch * (np.arange(rows) + 0.5)
        n = 0
        for r in range(rows):
            for c in range(cols):
                st = 'off'
                if (r * cols + c) % 7 in (2, 5) and rng.rand() < 0.55: st = 'amber'
                sp['items'].append(dict(t='ann', x=float(xs[c]), y=float(ys[r]), w=lw, lab=L[(n + 3) % len(L)], st=st)); n += 1
        sp['items'][min(len(sp['items']) - 1, cols + 1)]['st'] = 'green'
        if kind == 'cw': sp['items'].append(dict(t='master', x=x1 - 0.024, y=(top + bot) / 2))
    elif kind == 'rot':
        n = int(min(4, max(2, (x1 - x0) // 0.075))); pitch = (x1 - x0) / n
        yc = (top + bot) / 2 + 0.002 + (0.008 if fh > 0.14 else 0)
        for k in range(n):
            sp['items'].append(dict(t='knob', x=x0 + pitch * (k + 0.5), y=yc, r=0.0135, ang=float(rng.rand() * 3 - 1.5), lab=lab(), poss=[lab(), lab(), lab()]))
        if fh > 0.17:
            for k in range(2):
                sp['items'].append(dict(t='thumb', x=x0 + (x1 - x0) * (0.3 + 0.4 * k), y=bot + 0.02, txt='%02d' % rng.randint(100)))
    elif kind == 'aud':
        yk = top - 0.026
        for k in range(2):
            sp['items'].append(dict(t='knob', x=x0 + (x1 - x0) * (0.25 + 0.5 * k), y=yk, r=0.0125, ang=float(rng.rand() * 3 - 1.5), lab=['VOL', 'SQL'][k], poss=['MIN', '', 'MAX']))
        pitch = 0.029; yt = bot + 0.03
        for k in range(3):
            sp['items'].append(dict(t='tog', x=x0 + 0.02 + k * pitch, y=yt - 0.003, lab=['PTT', 'MODE', 'VOX'][k] if k else lab(), pos=['up', 'down', 'mid'][k], guard=None, lamp=False))
        sp['items'].append(dict(t='ptt', x=x1 - 0.022, y=yt))
    elif kind == 'meter':
        n = 2 if fw > 0.2 else 1
        for k in range(n):
            r = min(0.032, (fh - 0.04) / 2)
            sp['items'].append(dict(t='gauge', x=(x0 + x1) / 2 + (k - (n - 1) / 2) * 0.075, y=(top + bot) / 2, r=r, lab=['PSI', 'TEMP'][k % 2], val=float(0.3 + 0.5 * rng.rand())))
    elif kind == 'keypad':
        labs = ['7', '8', '9', '4', '5', '6', '1', '2', '3', 'CLR', '0', 'ENT']
        kw = min(0.036, (fw - 0.03) / 3); pitch = kw + 0.009
        sp['items'].append(dict(t='thumb', x=0.0, y=top - 0.013, txt='00:00'))
        for i, l in enumerate(labs):
            r_, c_ = divmod(i, 3)
            sp['items'].append(dict(t='key', x=(c_ - 1) * pitch, y=top - 0.04 - kw / 2 - r_ * pitch, w=kw, lab=l))
    return sp

def pn_draw(sp):
    fw, fh = sp['fw'], sp['fh']
    P = PN_PPM
    W, H = int(fw * P), int(fh * P)
    base = PN_BASE; fg = np.array(PN_FG)
    cv = Canvas(W, H, base)
    X = lambda x: (x + fw / 2) * P
    Y = lambda y: (fh / 2 - y) * P
    cv.outline(1.5, 1.5, W - 3, H - 3, (0.06, 0.06, 0.07), 1, r=0.005 * P)
    if sp['kind'] != 'mini':
        cv.rect(2, 2, W - 4, 0.0165 * P - 1, (0.07, 0.07, 0.075))
        cv.mtext(sp['system'], X(-fw / 2 + 0.017), Y(fh / 2 - 0.0085), 0.0052 * P, tuple(fg), 'l')
        cv.mtext(sp['pid'], X(fw / 2 - 0.017), Y(fh / 2 - 0.0085), 0.0046 * P, tuple(fg * 0.8), 'r')
        cv.rect(0.012 * P, Y(fh / 2 - 0.0165), W - 0.024 * P, 1.2, tuple(fg * 0.55))
    else:
        cv.rect(0.004 * P, 0.004 * P, W - 0.008 * P, H - 0.008 * P, (0.16, 0.16, 0.175), r=3)
    for (sx, sy) in ((-1, 1), (1, 1), (-1, -1), (1, -1)):
        cx, cy = X(sx * (fw / 2 - 0.0065)), Y(sy * (fh / 2 - 0.0065))
        cv.disc(cx, cy, 0.0036 * P, (0.52, 0.53, 0.55), height=0.3)
        cv.line(cx - 0.0028 * P, cy - 0.0008 * P * sx, cx + 0.0028 * P, cy + 0.0008 * P * sx, (0.12, 0.12, 0.13), 1)
    lab_c = tuple(fg * 0.95)
    for g in sp['groups']:
        x0_, x1_, y0_, y1_ = X(g['x0']), X(g['x1']), Y(g['y1']), Y(g['y0'])
        fcol = (0.50, 0.07, 0.06) if sp.get('red') else (0.16, 0.16, 0.175)
        cv.rect(x0_, y0_, x1_ - x0_, y1_ - y0_, fcol, r=2)
        cv.outline(x0_, y0_, x1_ - x0_, y1_ - y0_, tuple(fg * 0.8), 1, r=2)
        tw = cv.text_w(g['name'], 0.0034 * P)
        cv.rect(x0_ + 0.004 * P, y0_ - 1.5, tw + 0.003 * P, 3.2, fcol)
        cv.mtext(g['name'], x0_ + 0.0055 * P, y0_ + 0.2, 0.0034 * P, tuple(fg * 0.9), 'l')
        cv.mtext('ON', X(g['first']) - 0.0105 * P, y0_ + 0.0075 * P + 0.006 * P, 0.0026 * P, tuple(fg * 0.75), 'l') if False else None
    for it in sp['items']:
        t = it['t']
        if t == 'tog':
            cx, cy = X(it['x']), Y(it['y'])
            cv.outline(cx - 0.0085 * P, cy - 0.0085 * P, 0.017 * P, 0.017 * P, tuple(fg * 0.55), 1, r=0.0085 * P)
            if sp.get('flat'):
                cv.disc(cx, cy, 0.0048 * P, (0.55, 0.57, 0.6), height=0.8)
                sgn = -1 if it['pos'] == 'up' else (1 if it['pos'] == 'down' else 0)
                cv.line(cx, cy, cx, cy + sgn * 0.0075 * P, (0.95, 0.95, 0.97), 2)
                if it['guard']: cv.rect(cx - 0.0082 * P, cy - 0.0125 * P, 0.0164 * P, 0.025 * P, (0.75, 0.1, 0.07) if it['guard'] == 'red' else (0.85, 0.65, 0.1), r=1)
            cv.mtext(it['lab'], cx, cy - 0.0195 * P, 0.0034 * P, lab_c)
            cv.mtext('ON', cx + 0.0125 * P, cy - 0.009 * P, 0.0024 * P, tuple(fg * 0.7), 'l')
            cv.mtext('OFF', cx + 0.0125 * P, cy + 0.009 * P, 0.0024 * P, tuple(fg * 0.7), 'l')
            if it['lamp']:
                cv.rect(cx - 0.012 * P, cy + 0.008 * P, 0.004 * P, 0.004 * P, (0.2, 1, 0.5), r=2, glow=(0.2, 0.6, 0.3))
        elif t == 'brkrow':
            r_ = np.random.RandomState(it['seed']); yy = Y(it['y'])
            cv.rect(X(it['xs'][0]) - 0.0108 * P, yy - 0.0155 * P, (it['xs'][-1] - it['xs'][0] + 0.0216) * P, 0.7, tuple(fg * 0.5))
            for c, x in enumerate(it['xs']):
                cx = X(x)
                cv.mtext('%s%d' % (it['bus'][0], 10 + 3 * c + 2 * it['row']), cx, yy - 0.0113 * P, 0.0029 * P, (0.04, 0.04, 0.045))
                tripped = r_.rand() < 0.07
                cv.disc(cx, yy, 0.0058 * P, (0.88, 0.88, 0.86) if not tripped else (0.95, 0.95, 0.9), height=0.5)
                cv.disc(cx, yy, 0.0046 * P, (0.035, 0.035, 0.04), height=1.0 if not tripped else 1.4)
        elif t == 'ann':
            cx, cy, w = X(it['x']), Y(it['y']), it['w'] * P
            lit = it['st'] != 'off'
            col = {'off': (0.075, 0.08, 0.09), 'amber': (0.6, 0.38, 0.05), 'green': (0.08, 0.45, 0.15)}[it['st']]
            gl = {'off': None, 'amber': (0.55, 0.32, 0.03), 'green': (0.06, 0.4, 0.12)}[it['st']]
            cv.rect(cx - w / 2, cy - w / 2, w, w, col, r=2, height=0.4, glow=gl)
            cv.outline(cx - w / 2 - 1, cy - w / 2 - 1, w + 2, w + 2, tuple(fg * 0.35), 1, r=2)
            words = it['lab'].split(' ')
            if len(words) == 2:
                cv.mtext(words[0], cx, cy - 0.0035 * P, 0.0029 * P, (0.05, 0.05, 0.05) if lit else (0.36, 0.37, 0.4))
                cv.mtext(words[1], cx, cy + 0.0035 * P, 0.0029 * P, (0.05, 0.05, 0.05) if lit else (0.36, 0.37, 0.4))
            else:
                cv.mtext(it['lab'], cx, cy, 0.0031 * P, (0.05, 0.05, 0.05) if lit else (0.36, 0.37, 0.4))
        elif t == 'master':
            cx, cy = X(it['x']), Y(it['y'])
            cv.outline(cx - 0.021 * P, cy - 0.017 * P, 0.042 * P, 0.034 * P, tuple(fg * 0.7), 1, r=3)
            cv.mtext('MASTER', cx, cy - 0.0235 * P, 0.0032 * P, tuple(fg * 0.9))
            cv.mtext('ALARM', cx, cy + 0.0245 * P, 0.0032 * P, tuple(fg * 0.9))
        elif t == 'knob':
            cx, cy, r = X(it['x']), Y(it['y']), it['r'] * P
            for k, ang in enumerate((-60, 0, 60)):
                a = math.radians(ang)
                cv.line(cx + math.sin(a) * (r + 0.0045 * P), cy - math.cos(a) * (r + 0.0045 * P), cx + math.sin(a) * (r + 0.0085 * P), cy - math.cos(a) * (r + 0.0085 * P), tuple(fg * 0.9), 1)
                if it['poss'][k]:
                    cv.mtext(it['poss'][k], cx + math.sin(a) * (r + 0.0135 * P) + (0.002 * P if ang > 0 else (-0.002 * P if ang < 0 else 0)), cy - math.cos(a) * (r + 0.0135 * P), 0.0028 * P, tuple(fg * 0.85), 'l' if ang > 0 else ('r' if ang < 0 else 'c'))
            cv.disc(cx, cy, r + 1, (0.015, 0.015, 0.018), height=-0.2)
            cv.mtext(it['lab'], cx, cy + r + 0.0095 * P, 0.0032 * P, (0.04, 0.04, 0.045))
        elif t == 'thumb':
            cx, cy = X(it['x']), Y(it['y'])
            cv.rect(cx - 0.011 * P, cy - 0.0085 * P, 0.022 * P, 0.017 * P, (0.01, 0.012, 0.014), r=2, height=-0.3)
            cv.mtext(it['txt'], cx, cy, 0.0085 * P, (0.85, 0.88, 0.8))
        elif t == 'ptt':
            cx, cy = X(it['x']), Y(it['y'])
            cv.outline(cx - 0.0145 * P, cy - 0.0145 * P, 0.029 * P, 0.029 * P, tuple(fg * 0.6), 1, r=3)
            cv.mtext('PTT', cx, cy - 0.0195 * P, 0.0032 * P, tuple(fg * 0.9))
        elif t == 'gauge':
            cx, cy, r = X(it['x']), Y(it['y']), it['r'] * P
            cv.disc(cx, cy, r, (0.01, 0.012, 0.014), height=-0.2); cv.outline(cx - r - 2, cy - r - 2, 2 * r + 4, 2 * r + 4, tuple(fg * 0.7), 1, r=r + 2)
            for k in range(11):
                a = math.radians(-130 + 260 * k / 10)
                cv.line(cx + math.sin(a) * r * 0.78, cy - math.cos(a) * r * 0.78, cx + math.sin(a) * r * 0.93, cy - math.cos(a) * r * 0.93, tuple(fg * 0.9), 1)
            a = math.radians(-130 + 260 * it['val'])
            cv.line(cx, cy, cx + math.sin(a) * r * 0.74, cy - math.cos(a) * r * 0.74, (0.95, 0.9, 0.8), 1.4)
            cv.mtext(it['lab'], cx, cy + r * 0.45, 0.0035 * P, tuple(fg * 0.8))
        elif t == 'key':
            cx, cy, w = X(it['x']), Y(it['y']), it['w'] * P
            cv.rect(cx - w / 2, cy - w / 2, w, w, (0.05, 0.05, 0.055), r=3, height=0.4)
            cv.mtext(it['lab'], cx, cy, w * 0.42, (0.95, 0.95, 0.95))
    return cv

PN_FAILS = []
PN_CHECKED = set()
def pn_footprints(sp):
    """(label, x0, x1, y0, y1) of the real 3D parts of every item, panel-local metres (mirrors pn_geometry)."""
    out = []
    for i, it in enumerate(sp['items']):
        t = it['t']; x = it.get('x', 0.0); y = it.get('y', 0.0)
        if t == 'tog':
            if it['guard']:
                out.append(('tog+guard', x - 0.0098, x + 0.0098, y - 0.014, y + 0.018))
            else:
                ext = 0.006 if it['pos'] == 'mid' else 0.0128
                out.append(('tog', x - 0.006, x + 0.006, y - (ext if it['pos'] == 'down' else 0.006), y + (ext if it['pos'] == 'up' else 0.006)))
        elif t == 'brkrow' and it['row'] == 0:
            for k, xx in enumerate(it['xs']):
                out.append(('brk%d' % k, xx - 0.00425, xx + 0.00425, it['y'] - 0.0045, it['y'] + 0.0045))
        elif t == 'knob':
            r = it['r']; out.append(('knob', x - r, x + r, y - r, y + r))
        elif t == 'master':
            out.append(('master', x - 0.018, x + 0.018, y - 0.014, y + 0.014))
        elif t == 'ptt':
            out.append(('ptt', x - 0.011, x + 0.011, y - 0.011, y + 0.011))
        elif t == 'key':
            w = it['w'] * 0.45; out.append(('key', x - w, x + w, y - w, y + w))
    return out

def pn_check(sp):
    if sp['name'] in PN_CHECKED:
        return
    PN_CHECKED.add(sp['name'])
    fw, fh = sp['fw'], sp['fh']; tol = 0.001
    fps = pn_footprints(sp)
    for lab, x0, x1, y0, y1 in fps:
        if x0 < -fw / 2 + 0.003 - tol or x1 > fw / 2 - 0.003 + tol or y0 < -fh / 2 + 0.003 - tol or y1 > fh / 2 - (0.003 if sp['kind'] == 'mini' else 0.0165) + tol:
            PN_FAILS.append((sp['pid'], sp['kind'], 'outside face', lab, round(x0, 4), round(x1, 4), round(y0, 4), round(y1, 4), fw, fh))
    for i in range(len(fps)):
        for j in range(i + 1, len(fps)):
            a, c = fps[i], fps[j]
            if min(a[2], c[2]) - max(a[1], c[1]) > 0.0005 and min(a[4], c[4]) - max(a[3], c[3]) > 0.0005 and not (a[0].startswith('brk') and c[0].startswith('brk')):
                PN_FAILS.append((sp['pid'], sp['kind'], 'overlap', a[0], c[0], round(a[1], 4), round(c[1], 4)))

def pn_geometry(b, sp, rect, D):
    fw, fh = sp['fw'], sp['fh']
    zf = 0.0085
    b.box('dash_dark', fw + 0.008, fh + 0.008, D + 0.0075, 0, 0, (0.0075 - D) / 2, bevel=0)
    b.panel('label2', fw, fh, 0, 0, zf, rect)
    if sp.get('flat'):
        return
    pn_check(sp)
    for it in sp['items']:
        t = it['t']
        if t == 'tog':
            x, y = it['x'], it['y']
            b.box('steel', 0.012, 0.012, 0.004, x, y, zf + 0.002, bevel=0)
            if it['pos'] == 'mid':
                ov_cone(b, 'steel', (x, y, zf + 0.004), (x, y, zf + 0.023), 0.0038, 0.0024, 5)
            else:
                s = 1 if it['pos'] == 'up' else -1
                ov_cone(b, 'steel', (x, y, zf + 0.004), (x, y + s * 0.009, zf + 0.022), 0.0038, 0.0024, 5)
            if it['guard']:
                gm_ = it['guard']
                b.box(gm_, 0.0195, 0.032, 0.003, x, y + 0.002, zf + 0.027, bevel=0)
                for sx in (-1, 1):
                    b.box(gm_, 0.003, 0.032, 0.027, x + sx * 0.0082, y + 0.002, zf + 0.0135, bevel=0)
        elif t == 'brkrow' and it['row'] == 0:
            r_ = np.random.RandomState(it['seed'])
            for x in it['xs']:
                tripped = r_.rand() < 0.07
                hh = 0.014 if tripped else 0.009
                b.box('soft', 0.0085, 0.0085, hh, x, it['y'], zf + hh / 2, bevel=0)
        elif t == 'knob':
            r = it['r']
            b.cyl('alu_dark', r, 0.013, it['x'], it['y'], zf + 0.0065, 'z', 10, r1=r * 0.9)
            b.cyl('steel', r * 0.55, 0.004, it['x'], it['y'], zf + 0.015, 'z', 8)
            b.box('steel', 0.0035, r * 1.5, 0.004, it['x'] + math.sin(it['ang']) * r * 0.45, it['y'] + math.cos(it['ang']) * r * 0.45, zf + 0.0175, rz=-it['ang'], bevel=0)
        elif t == 'master':
            b.rbox('red', 0.036, 0.028, 0.012, it['x'], it['y'], zf + 0.006, 0.004, segs=1)
            b.rbox('lamp_red', 0.026, 0.018, 0.004, it['x'], it['y'], zf + 0.0125, 0.002, segs=1)
        elif t == 'ptt':
            b.rbox('rubber', 0.022, 0.022, 0.01, it['x'], it['y'], zf + 0.005, 0.004, segs=1)
        elif t == 'key':
            b.box('soft', it['w'] * 0.9, it['w'] * 0.9, 0.008, it['x'], it['y'], zf + 0.004, bevel=0)

SYS['KEYPAD A'] = ['K']; SYS['KEYPAD B'] = ['K']
EXTRA = ['ARM', 'SAFE', 'AUTO', 'MAN', 'TEST', 'RESET', 'PWR', 'HTR', 'FAN', 'PUMP', 'VLV', 'BUS', 'LOAD', 'SEL', 'NORM', 'ALT', 'INH', 'ENA', 'CAL', 'SYNC', 'DUMP', 'FILL', 'SEAL', 'PURGE', 'TEMP', 'FLOW', 'RATE', 'LIMIT', 'IMU', 'GPC', 'MDM', 'FWD', 'AFT', 'L', 'R', 'A', 'B', 'ON', 'OFF', 'CNTL', 'SEQ', 'XFER']
for _k in list(SYS):
    if len(SYS[_k]) > 2 and _k != 'CAUTION & WARNING':
        SYS[_k] = SYS[_k] + EXTRA

def wear_atlas(col, hgt):
    """Faded labels, grime, fine scratches and fingerprint smudges on the printed panels (returns colour and a roughness map)."""
    H, W = col.shape[:2]
    n = fbm(H, W, 14, 5, 31)
    col = col * (0.84 + 0.22 * n)[..., None]
    gray = col.mean(-1, keepdims=True)
    col = col * 0.93 + gray * 0.07
    r = np.random.RandomState(77)
    rough = 0.40 + 0.18 * fbm(H, W, 9, 4, 5)
    for _ in range(900):
        x, y = r.randint(0, W - 60), r.randint(0, H - 60); L = r.randint(6, 40); a = r.rand() * 6.28
        xs = np.clip((x + np.cos(a) * np.arange(L)).astype(int), 0, W - 1); ys = np.clip((y + np.sin(a) * np.arange(L)).astype(int), 0, H - 1)
        col[ys, xs] = np.minimum(col[ys, xs] + 0.13, 1.0); rough[ys, xs] = 0.75
    yy, xx = np.mgrid[0:H, 0:W]
    for _ in range(120):
        cx, cy = r.randint(0, W), r.randint(0, H); rx, ry = r.randint(6, 22), r.randint(8, 26)
        m = np.exp(-(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2))
        rough = rough * (1 - 0.6 * m) + 0.12 * 0.6 * m
        col = col * (1 - 0.06 * m[..., None])
    return np.clip(col, 0, 1), np.clip(rough, 0.05, 1)


BAY_DEPTH = 0.015
def bay_fill(b, cells, depth=BAY_DEPTH, plate=True):
    """Inside a slab hole: a near-black seam backing, a dark lining of the hole walls and (blank bays) a dark bay face."""
    for (a0, a1, b0, b1) in cells:
        w, h = a1 - a0, b1 - b0
        ca, cb = (a0 + a1) / 2, (b0 + b1) / 2
        b.box('seam', w + 0.008, h + 0.008, 0.004, ca, cb, -depth - 0.002 - 0.0005, bevel=0)
        if plate:
            b.box('bay', w - 0.008, h - 0.008, 0.0035, ca, cb, -depth - 0.00175, bevel=0)
        with frame(None, (0, 0, -0.0006)):
            b.acc.add('seam', slab_geo(rect((a0 - 0.0008, a1 + 0.0008, b0 - 0.0008, b1 + 0.0008)), [rect((a0 + 0.002, a1 - 0.002, b0 + 0.002, b1 - 0.002))], depth + 0.0012))

# ---- typed switch panels: zones, size classes, the unique-face pool
CLAY = '--clay' in argv      # checkpoint look: blank dark bays instead of typed panels
PN_SPECS, PN_CELLS, PN_CUSTOM = {}, [], []
PN_RNG = np.random.RandomState(11)
CW_DONE = [False]
WCLS = [0.05, 0.065, 0.08, 0.095, 0.11, 0.13, 0.15, 0.18, 0.21, 0.25, 0.29]
HCLS = [0.045, 0.055, 0.07, 0.085, 0.10, 0.12, 0.14, 0.17, 0.20, 0.24, 0.28]
ZONE_FLAT = {'wall', 'ceil'}      # far panels: switches printed into the texture (with bump) instead of real geometry
ZONES = {
    'overhead': (['ECLSS', 'CABIN PRESS', 'LIGHTING', 'WINDOW HTR', 'EPS BUS A', 'EPS BUS B', 'COMM'], [('sw', 10), ('rot', 1), ('meter', 1), ('brk', 2), ('ann', 2), ('mini', 3)]),
    'ip': (['LIGHTING', 'COMM', 'ECLSS', 'EPS BUS A'], [('sw', 5), ('meter', 1), ('rot', 1), ('ann', 3), ('mini', 4)]),
    'conL': (['PROPULSION', 'ABORT'], [('sw', 6), ('ann', 2), ('mini', 3)]),
    'conR': (['EPS BUS A', 'EPS BUS B', 'COMM'], [('sw', 5), ('aud', 2), ('rot', 2), ('ann', 1), ('mini', 2)]),
    'conC': (['RCS', 'DOCKING', 'ENTRY'], [('sw', 4), ('rot', 1), ('ann', 1), ('mini', 1)]),
    'ceil': (['ECLSS', 'LIGHTING', 'COMM', 'EPS BUS A', 'EPS BUS B', 'CABIN PRESS', 'CB MAIN A'], [('sw', 5), ('ann', 2), ('mini', 3), ('brk', 1), ('meter', 1)]),
    'wall': (['CB MAIN A', 'CB MAIN B', 'CB ESS', 'ECLSS', 'LIGHTING', 'COMM', 'EPS BUS A', 'CABIN PRESS'], [('brk', 3), ('sw', 3), ('ann', 1), ('mini', 2)]),
}
def feasible(kind, W, H):
    return {'sw': W >= 0.075 and H >= 0.08, 'brk': W >= 0.115 and H >= 0.06, 'rot': W >= 0.17 and H >= 0.10,
            'aud': W >= 0.11 and H >= 0.13, 'meter': W >= 0.09 and H >= 0.09, 'cw': W >= 0.13 and H >= 0.15, 'keypad': True,
            'ann': W >= 0.075 and H >= 0.065, 'mini': W >= 0.05 and H >= 0.045}[kind]

def make_item(rect_, W, H, zone, red=False, kind=None, system=None):
    syss, kinds = ZONES[zone]
    rng = PN_RNG
    if kind is None:
        opts = [k for k, w in kinds for _ in range(w) if feasible(k, W, H)]
        if not opts:
            return None
        kind = opts[rng.randint(len(opts))]
    if system is None:
        system = syss[rng.randint(len(syss))]
    if kind == 'brk' and not system.startswith('CB'):
        system = ['CB MAIN A', 'CB MAIN B', 'CB ESS'][rng.randint(3)]
    if kind != 'brk' and system.startswith('CB'):
        system = ['ECLSS', 'LIGHTING', 'COMM', 'EPS BUS A', 'EPS BUS B', 'CABIN PRESS'][rng.randint(6)]
    var = int(rng.randint(2))
    flat = zone in ZONE_FLAT
    key = (kind, system, round(W, 3), round(H, 3), bool(red), var, flat)
    sp = PN_SPECS.get(key)
    if sp is None:
        pid = system.replace(' ', '')[:3].upper() + '-%02d' % (10 + len(PN_SPECS) % 90)
        sp = pn_make(kind, system, W, H, pid, rng, red=red)
        sp['flat'] = flat
        sp['name'] = str(key)
        PN_SPECS[key] = sp
    return dict(rect=rect_, kind=kind, spec=sp)

def snap_items(cells, zone, red=False, cw_one=False):
    """Snap raw bay cells to the panel size classes (centred) and give each a typed panel. Cells too small stay plain paint."""
    snapped = []
    for (a0, a1, b0, b1) in cells:
        w = a1 - a0 - 0.010; h = b1 - b0 - 0.010
        ws = [x for x in WCLS if x <= w + 1e-6]; hs = [x for x in HCLS if x <= h + 1e-6]
        if not ws or not hs:
            continue
        W, H = max(ws), max(hs); ca, cb = (a0 + a1) / 2, (b0 + b1) / 2
        snapped.append(((ca - W / 2, ca + W / 2, cb - H / 2, cb + H / 2), W, H))
    items = []
    cw_idx = -1
    if cw_one and not CW_DONE[0]:
        cand = [i for i, s in enumerate(snapped) if feasible('cw', s[1], s[2])]
        if cand:
            cw_idx = max(cand, key=lambda i: snapped[i][1] * snapped[i][2]); CW_DONE[0] = True
    for i, (r_, W, H) in enumerate(snapped):
        it = make_item(r_, W, H, zone, red, 'cw' if i == cw_idx else None, 'CAUTION & WARNING' if i == cw_idx else None)
        if it:
            items.append(it)
    return items

def hole_of(it, m=0.006):
    a0, a1, b0, b1 = it['rect']
    return rect((a0 - m, a1 + m, b0 - m, b1 + m))

def place_panels(b, items):
    """Record each panel (frame of the current slab) for the atlas pass, and line its bay."""
    M, t = FRAMES[-1]
    for it in items:
        a0, a1, b0, b1 = it['rect']; ca, cb = (a0 + a1) / 2, (b0 + b1) / 2
        if CLAY:
            bay_fill(b, [(a0 - 0.006, a1 + 0.006, b0 - 0.006, b1 + 0.006)], plate=True)
            continue
        PN_CELLS.append(dict(b=b, M=M.copy(), org=t + M @ Vector((ca, cb, 0)), sp=it['spec'], D=BAY_DEPTH))
        bay_fill(b, [(a0 - 0.006, a1 + 0.006, b0 - 0.006, b1 + 0.006)], plate=False)

def bay_slab_items(b, poly, items, thick=0.04, mat='clay', seam=True, gap=0.0045):
    """Panel slab (current frame): face at z = 0, one hole per typed panel, thin dark seam around the outline."""
    inner = shrink(poly, gap) if seam else poly
    b.acc.add(mat, slab_geo(inner, [hole_of(it) for it in items], thick))
    place_panels(b, items)
    if seam:
        with frame(None, (0, 0, -0.008)):
            b.acc.add('seam', slab_geo(poly, [], 0.004))

def newell(P):
    n = Vector((0, 0, 0))
    for i in range(len(P)):
        a, c = P[i], P[(i + 1) % len(P)]
        n += Vector(((a.y - c.y) * (a.z + c.z), (a.z - c.z) * (a.x + c.x), (a.x - c.x) * (a.y + c.y)))
    return n.normalized()

def poly_panel(b, pts, hint, thick=0.04, wmax=0.30, hmax=0.22, margin=0.012, gap=0.012, bays=True, seam=True, mat='clay', zone='wall', red=False, items=None, cw_one=False, seed=0):
    """Flat panel from 3D corner points, visible side facing `hint`, filled with typed panels (auto grid, or explicit `items` in local coords)."""
    P = [Vector(p) for p in pts]
    n = newell(P)
    if n.dot(Vector(hint)) < 0:
        n = -n
    ref = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 0, 1))
    ex = (ref - n * ref.dot(n)).normalized()
    fr, (ex, ey, n) = pf(P[0], ex, n)
    poly = [((p - P[0]).dot(ex), (p - P[0]).dot(ey)) for p in P]
    with fr:
        if items is not None:
            its = items(poly)
        elif bays:
            its = snap_items(auto_cells(poly, wmax, hmax, margin, gap, seed), zone, red, cw_one)
        else:
            its = []
        bay_slab_items(b, poly, its, thick, mat, seam)
    return fr

def ext_poly(b, mat, pts_a, d, bevel=0.0):
    """Extrude a planar polygon (3D points) by vector d; closed solid."""
    A = [Vector(p) for p in pts_a]; d = Vector(d)
    n = len(A)
    verts = [tuple(p) for p in A] + [tuple(p + d) for p in A]
    faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    for i in range(n):
        faces.append((i, (i + 1) % n, (i + 1) % n + n, i + n))
    b.raw(mat, finish(verts, faces, bevel, 1, True))

# ------------------------------------------------------------------ main dimensions
X0 = 0.55                      # cockpit centreline
XL, XR = -0.65, 1.75           # side walls
FY, CY, ZB = -1.15, 0.70, 1.0   # floor, ceiling, aft bulkhead
SILL, TOP = 0.02, 0.45         # forward window sill and top (game y)
WT = 0.35                      # forward windows lean back toward the top (top is closer to the eye)
ZC = -0.85 - (TOP - SILL) * WT  # forward window sill line at the centre (window top at z -0.85)
TILT = math.radians(17)        # forward instrument panel tilt
UP = Vector((0, 1, 0))
SHIELD_Y = 0.02
EYE_ROWS = (0.0, -0.20)       # display row centres along the tilted panel (local b)
IP_O = Vector((0, -0.20, -0.66))
def ip_y(b): return IP_O.y + b * math.cos(TILT)
def ip_z(b): return IP_O.z - b * math.sin(TILT)
def ip_z_at_y(y): return IP_O.z - (y - IP_O.y) * math.tan(TILT)

# ---- forward windows: a chain of 6 facets (2 side facets at 40 degrees, 4 front facets in a shallow arc)
def build_facets():
    right = []
    p = Vector((X0, SILL, ZC))
    for yaw, L in ((3, 0.44), (8, 0.40), (45, None)):
        y = math.radians(yaw); t = Vector((math.cos(y), 0, math.sin(y)))
        if L is None:
            L = (XR - p.x) / t.x
        q = p + t * L
        right.append((p, q, t)); p = q
    facets = []
    for (p, q, t) in reversed(right):
        m = lambda v: Vector((2 * X0 - v.x, v.y, v.z))
        facets.append((m(q), m(p), Vector((t.x, 0, -t.z))))
    facets += right
    return facets
FACETS = build_facets()
def facet_basis(t):
    nh = Vector((-t.z, 0, t.x))
    n = (nh - UP * WT).normalized(); ey = (UP + nh * WT).normalized()
    return nh, n, ey
def joint_lines():
    ns = [facet_basis(f[2])[1] for f in FACETS]
    J = []
    for i in range(7):
        P = FACETS[i][0] if i < 6 else FACETS[5][1]
        na = ns[i - 1] if i > 0 else Vector((1, 0, 0))
        nb = ns[i] if i < 6 else Vector((-1, 0, 0))
        d = na.cross(nb).normalized()
        if d.y < 0:
            d = -d
        J.append((P.copy(), d))
    return J
JOINTS = joint_lines()
def jpt(i, y):
    P, d = JOINTS[i]
    return P + d * ((y - SILL) / d.y)

def chain_z(x):
    """z of the window chain (at the sill) at x."""
    for p, q, t in FACETS:
        if min(p.x, q.x) - 1e-6 <= x <= max(p.x, q.x) + 1e-6:
            s = (x - p.x) / (q.x - p.x)
            return p.z + (q.z - p.z) * s
    return ZC

# ---- overhead canopy profile (z -> y), three rows
OZ = [-0.85, -0.55, -0.30, 0.05, 0.35]
OY = [0.45, 0.45 + 0.17 * 0.30 / 0.55, 0.62, 0.62 + 0.06 * 0.35 / 0.65, 0.68]
def oy(z):
    for i in range(len(OZ) - 1):
        if z <= OZ[i + 1] + 1e-9 or i == len(OZ) - 2:
            return OY[i] + (z - OZ[i]) * (OY[i + 1] - OY[i]) / (OZ[i + 1] - OZ[i])
HINGE = (X0 - 0.77, X0 + 0.77)   # centre section 1.54 wide
WING_ANG = math.radians(30)
WING_LEN = (HINGE[0] - XL) / math.cos(WING_ANG)
WING_DROP = WING_LEN * math.sin(WING_ANG)

# ------------------------------------------------------------------ build: window wall
WIN_PLUGS = []   # world-space corner quads of the open forward window holes (used by the leak scan only)
def build_windows():
    b = O('windows')
    for i, (p0, p1, t) in enumerate(FACETS):
        nh, n, ey = facet_basis(t)
        S_lo, E_lo, E_hi, S_hi = jpt(i, SILL - 0.06), jpt(i + 1, SILL - 0.06), jpt(i + 1, TOP + 0.05), jpt(i, TOP + 0.05)
        P = [S_lo, E_lo, E_hi, S_hi]
        fr, (ex, ey_, n_) = pf(p0, t, n)
        poly = [((q - p0).dot(ex), (q - p0).dot(ey_)) for q in P]
        a_lo = max(poly[0][0], poly[3][0]) + 0.035
        a_hi = min(poly[1][0], poly[2][0]) - 0.035
        b_lo, b_hi = 0.03, (TOP - SILL) / ey.y - 0.035
        WIN_PLUGS.append([wpos(fr, (a_lo, b_lo, 0.0)), wpos(fr, (a_hi, b_lo, 0.0)), wpos(fr, (a_hi, b_hi, 0.0)), wpos(fr, (a_lo, b_hi, 0.0))])
        with fr:
            b.acc.add('frame', slab_geo(grow(poly, 0.004), [rrect(a_lo, a_hi, b_lo, b_hi, 0.04, 4)], 0.10))

# ------------------------------------------------------------------ display pages (emissive images, for the renders; the game draws these live later)
D_BG = (0.012, 0.025, 0.05)
D_W = (0.95, 0.97, 1.0); D_CY = (0.3, 0.88, 1.0); D_DIM = (0.32, 0.46, 0.6); D_GN = (0.45, 1.0, 0.65); D_AM = (1.0, 0.72, 0.2); D_GRID = (0.09, 0.15, 0.23)

def _circle(cv, cx, cy, r, color, t=3):
    cv.outline(cx - r, cy - r, 2 * r, 2 * r, color, t, r=r)

def _path(t, px0, px1, py0, py1):
    return px0 + (px1 - px0) * (0.04 + 0.92 * t), py1 - (py1 - py0) * 0.9 * (1 - (1 - t) ** 2.2)

def disp_centre(manual=False):
    W, H = 1040, 840
    cv = Canvas(W, H, D_BG)
    cv.rect(0, 0, W, 66, (0.035, 0.065, 0.11))
    if not manual:
        cv.text('TRAJECTORY  ·  ASCENT', 28, 33, 28, D_W, 'l')
        cv.text('T+ 02:14', W - 28, 33, 28, D_CY, 'r')
        px0, px1, py0, py1 = 70, W - 50, 96, H - 130
        for i in range(7):
            x = px0 + (px1 - px0) * i / 6; cv.rect(x, py0, 1.6, py1 - py0, D_GRID)
        for j in range(6):
            y = py0 + (py1 - py0) * j / 5; cv.rect(px0, y, px1 - px0, 1.6, D_GRID)
        for j, s in enumerate(('60', '45', '30', '15', '5', '0')):
            cv.mtext(s, px0 - 10, py0 + (py1 - py0) * j / 5, 20, D_DIM, 'r')
        cv.mtext('ALT km', px0 + 4, py0 - 14, 18, D_DIM, 'l'); cv.mtext('DOWNRANGE km', px1, py1 + 20, 18, D_DIM, 'r')
        # planned path: dashed white
        N = 400; pts = [_path(i / N, px0, px1, py0, py1) for i in range(N + 1)]
        on = True; run = 0
        for i in range(N):
            if on: cv.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], D_W, 4)
            run += math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
            if run > (22 if on else 14):
                on = not on; run = 0
        # predicted path: cyan, a little off the plan
        for i in range(int(N * 0.78)):
            t0, t1 = i / N, (i + 1) / N
            a = _path(t0, px0, px1, py0, py1); b_ = _path(t1, px0, px1, py0, py1)
            o0, o1 = 16 * math.sin(6.5 * t0) * t0, 16 * math.sin(6.5 * t1) * t1
            cv.line(a[0], a[1] + o0, b_[0], b_[1] + o1, D_CY, 5)
        tm = 0.46
        mx, my = _path(tm, px0, px1, py0, py1); my += 16 * math.sin(6.5 * tm) * tm
        nx, ny = _path(tm + 0.01, px0, px1, py0, py1); dx, dy = nx - mx, ny - (my - 16 * math.sin(6.5 * tm) * tm); L = math.hypot(dx, dy); dx, dy = dx / L, dy / L
        for sgn in (-1, 1):                      # crisp ship marker: a small arrowhead
            cv.line(mx + dx * 16, my + dy * 16, mx - dx * 12 - dy * 11 * sgn, my - dy * 12 + dx * 11 * sgn, D_W, 4)
        cv.line(mx - dx * 12 - dy * 11, my - dy * 12 + dx * 11, mx - dx * 12 + dy * 11, my - dy * 12 - dx * 11, D_W, 4)
        cv.disc(mx, my, 6, D_CY)
        cv.text('On track · hold steady', W / 2, H - 82, 36, D_GN, 'c')
        cv.mtext('ALT 24.8 km', 60, H - 30, 24, D_W, 'l'); cv.mtext('VEL 1.62 km/s', W / 2, H - 30, 24, D_W, 'c'); cv.mtext('Q 31 kPa', W - 60, H - 30, 24, D_W, 'r')
    else:
        cv.text('ASCENT · GRAVITY TURN', 30, 33, 30, D_W, 'l')
        cv.text('12 s', W - 30, 33, 44, D_AM, 'r')
        cx, cy = W / 2, H / 2 - 20
        for i in range(1, 4):
            _circle(cv, cx, cy, 90 * i, D_GRID, 2)
        cv.rect(cx - 210, cy - 1, 420, 2, D_GRID); cv.rect(cx - 1, cy - 210, 2, 420, D_GRID)
        cv.rect(cx - 52, cy - 3, 104, 6, D_W); cv.rect(cx - 3, cy - 52, 6, 104, D_W)       # white + target
        _circle(cv, cx + 70, cy + 44, 66, D_CY, 6)                                             # cyan aim circle, slightly off
        cv.disc(cx + 70, cy + 44, 4, D_CY)
        bx0, bx1, by = 150, W - 150, H - 118
        cv.mtext('ACCURACY', bx0, by - 26, 22, D_DIM, 'l'); cv.mtext('62%', bx1, by - 26, 22, D_W, 'r')
        cv.outline(bx0, by - 11, bx1 - bx0, 24, D_W, 3, r=4)
        cv.rect(bx0 + 4, by - 7, (bx1 - bx0 - 8) * 0.62, 16, D_CY, r=3)
        cv.text('LOCK READY · SPACE', W / 2, H - 46, 38, D_GN, 'c')
    cv.outline(1, 1, W - 2, H - 2, (0.12, 0.2, 0.3), 2)
    return cv

def _bar(cv, x, y, w, h, frac, color, label, val):
    cv.outline(x, y, w, h, D_DIM, 2, r=3)
    cv.rect(x + 3, y + h - 3 - (h - 6) * frac, w - 6, (h - 6) * frac, color, r=2)
    cv.mtext(label, x + w / 2, y + h + 22, 22, D_W, 'c'); cv.mtext(val, x + w / 2, y - 18, 22, color, 'c')

def disp_propulsion():
    W = H = 540
    cv = Canvas(W, H, D_BG)
    cv.rect(0, 0, W, 48, (0.035, 0.065, 0.11)); cv.text('PROPULSION', 20, 24, 24, D_W, 'l'); cv.mtext('MAIN ENG', W - 20, 24, 20, D_CY, 'r')
    for i, (lab, fr, c) in enumerate((('LOX', 0.78, D_CY), ('FUEL', 0.71, D_CY), ('He', 0.92, D_GN), ('PRESS', 0.58, D_AM))):
        _bar(cv, 40 + i * 118, 120, 70, 250, fr, c, lab, '%d%%' % (fr * 100))
    cv.text('THRUST 98%', W / 2, 440, 34, D_W, 'c')
    cv.mtext('CH PRESS 2840 psi   TVC 1 · 2 OK', W / 2, 490, 22, D_DIM, 'c')
    for i in range(4): cv.disc(60 + i * 140, 520, 7, D_GN)
    return cv

def disp_loads():
    W = H = 540
    cv = Canvas(W, H, D_BG)
    cv.rect(0, 0, W, 48, (0.035, 0.065, 0.11)); cv.text('LOADS · ATTITUDE', 20, 24, 24, D_W, 'l')
    cx, cy, r = 270, 235, 150
    yy, xx = np.mgrid[0:H, 0:W]
    ang = math.radians(12)
    hz = (yy - cy) * math.cos(ang) - (xx - cx) * math.sin(ang) + 28
    inside = (xx - cx) ** 2 + (yy - cy) ** 2 < r * r
    sky = np.array([0.1, 0.4, 0.8]); gnd = np.array([0.45, 0.28, 0.12])
    ball = np.where((hz < 0)[..., None], sky, gnd) * (0.8 + 0.2 * np.clip(1 - np.abs(hz) / 140, 0, 1))[..., None]
    cv.col[inside] = ball[inside]
    cv.line(cx - 130, cy + 28 - 130 * math.tan(ang) * -1, cx + 130, cy + 28 + 130 * math.tan(ang) * -1 + 0, D_W, 3) if False else None
    for k in (-2, -1, 1, 2):
        yk = cy + 28 + k * 36
        cv.rect(cx - 30 + 0 * k, yk, 60, 2, D_W)
    _circle(cv, cx, cy, r, D_W, 4)
    cv.rect(cx - 70, cy - 2, 40, 5, D_AM); cv.rect(cx + 30, cy - 2, 40, 5, D_AM); cv.disc(cx, cy, 6, D_AM)
    cv.text('G 2.4', 120, 445, 30, D_W, 'c'); cv.text('Q 31 kPa', 270, 445, 30, D_CY, 'c'); cv.text('AoA 3.1°', 440, 445, 30, D_W, 'c')
    _bar_h = lambda x, y, w, f, c: (cv.outline(x, y, w, 16, D_DIM, 2, r=3), cv.rect(x + 3, y + 3, (w - 6) * f, 10, c, r=2))
    _bar_h(60, 480, 420, 0.46, D_GN)
    cv.mtext('RATE  PITCH 0.8  YAW 0.1  ROLL 0.0', W / 2, 515, 20, D_DIM, 'c')
    return cv

def disp_static(k):
    W = H = 540
    cv = Canvas(W, H, D_BG)
    cv.rect(0, 0, W, 48, (0.035, 0.065, 0.11))
    titles = ['EPS · BUS A', 'THERMAL', 'CABIN · ECLSS', 'NAV · MAP']
    cv.text(titles[k % 4], 20, 24, 24, D_W, 'l')
    if k % 4 == 0:
        for i in range(6): _bar(cv, 36 + i * 80, 110, 48, 280, [0.8, 0.62, 0.9, 0.5, 0.7, 0.35][i], [D_GN, D_CY, D_GN, D_AM, D_CY, D_AM][i], 'B%d' % (i + 1), '%d V' % (24 + i))
        cv.mtext('LOAD 4.2 kW   BUS TIE OPEN', W / 2, 470, 22, D_DIM, 'c')
    elif k % 4 == 1:
        for j in range(5): cv.rect(40, 90 + j * 70, 460, 1.5, D_GRID)
        for tr, c in ((0, D_CY), (1, D_AM)):
            pts = [(40 + i * 8, 300 - 70 * math.sin(i / 11 + tr * 1.5) - 60 * tr - i * 0.7) for i in range(58)]
            for a, b_ in zip(pts[:-1], pts[1:]): cv.line(a[0], a[1], b_[0], b_[1], c, 3)
        cv.mtext('COOLANT 18 C   HX 61%   RAD A', W / 2, 470, 22, D_DIM, 'c')
    elif k % 4 == 2:
        for i, (l, v, c) in enumerate((('CABIN P', '14.7 psi', D_GN), ('O2', '21.0 %', D_GN), ('CO2', '0.3 %', D_GN), ('TEMP', '22 C', D_W), ('HUMID', '44 %', D_W), ('FAN', 'AUTO', D_CY), ('SUIT', 'ON', D_CY))):
            cv.text(l, 40, 100 + i * 56, 22, D_DIM, 'l'); cv.text(v, W - 40, 100 + i * 56, 26, c, 'r'); cv.rect(40, 122 + i * 56, 460, 1.2, D_GRID)
    else:
        for i in range(1, 5): _circle(cv, 270, 280, 50 * i, D_GRID, 2)
        for (x, y, c) in ((300, 200, D_GN), (200, 330, D_AM), (350, 320, D_CY), (240, 230, D_W)): cv.disc(x, y, 7, c)
        cv.line(270, 280, 300, 200, D_CY, 2)
        cv.mtext('HDG 084   RNG 412 km', W / 2, 500, 22, D_DIM, 'c')
    return cv

_HERE = os.path.dirname(os.path.abspath(sys.argv[sys.argv.index('-P') + 1])) if '-P' in sys.argv else os.getcwd()
TEXDIR = os.path.join(arg('--screens', os.path.join(_HERE, 'flightdeck_screens')), '')   # screen pages drawn by src/graphics/cockpitScreens.js
def make_display_materials():
    """Final screen pages from screens-v1/tex, UV 0..1 on the exact display size. Black stays black: dark base, low specular, emission = the page."""
    pages = {'disp_centre': 'centre-traj-ok', 'disp_centre_manual': 'centre-manual', 'disp_left': 'left-propulsion', 'disp_right': 'right-attitude'}
    for k in ('eps', 'eclss', 'comm', 'nav', 'rcs', 'cw', 'apu', 'hyd'):
        pages['disp_' + k] = 'sys-' + k
    for nm, fn in pages.items():
        path = TEXDIR + fn + '.png'
        img = bpy.data.images.load(path)
        img.colorspace_settings.name = 'sRGB'
        img.pack()
        IMAGES[nm] = (img.size[0], img.size[1], os.path.getsize(path))
        m = material(nm, (0.0, 0.0, 0.0), 0.35, spec=0.04, emit_image=img, emit_strength=float(arg('--screen', 1.1)))
        for n_ in m.node_tree.nodes:
            if n_.type == 'TEX_IMAGE':
                n_.interpolation = 'Linear'

# ------------------------------------------------------------------ helpers for named parts
PIVOTS = {}      # object name -> world pivot (game coords)
PARENTS = {}     # child name -> parent name
EMPTIES = {}     # empty name -> world position
def wpos(fr, p):
    """World (game) position of a local point of a frame object created at top level."""
    return fr.M @ Vector(p) + fr.t
IPF, _ = pf(IP_O, (1, 0, 0), Vector((0, math.sin(TILT), math.cos(TILT))))
EBF, _ = pf((0, 0, -0.50), (1, 0, 0), (0, 0, 1))     # eyebrow face: local x = x, y = y, z = toward the crew

# ------------------------------------------------------------------ build: shell (walls, ceiling, floor, aft)
SIDE_WIN = (-0.30, 0.15, 0.04, 0.33)   # z0, z1, y0, y1 of the side window in the wall
def wall_polygon_z(side):
    i = 0 if side < 0 else 6
    zA = JOINTS[i][0].z
    zT = jpt(i, CY).z
    return [(zA, FY), (ZB, FY), (ZB, CY), (zT, CY), (zA, SILL)]

def build_walls():
    for side, name, xw in ((-1, 'wall_L', XL), (1, 'wall_R', XR)):
        b = O(name)
        if side < 0:
            fr, _ = pf((xw, 0, 0), (0, 0, -1), (1, 0, 0)); az = lambda z: -z
        else:
            fr, _ = pf((xw, 0, 0), (0, 0, 1), (-1, 0, 0)); az = lambda z: z
        outline = [(az(z), y) for z, y in wall_polygon_z(side)]
        z0, z1, y0, y1 = SIDE_WIN
        wa0, wa1 = sorted((az(z0), az(z1)))
        win = rrect(wa0, wa1, y0, y1, 0.05, 3)
        strip = [(az(-0.25), -0.02), (az(0.15), -0.28), (az(0.15), 0.0), (az(-0.25), 0.0)]   # forward of the seat backs only
        cells = []    # no switch panels on the side walls: the strip beside the forward panel was cut by the wing slab where the surfaces converge
        # a band of breaker panels forward of the window, on the facet side of the wall, above the console
        with fr:
            items = snap_items(cells, 'wall')
            b.acc.add('clay', slab_geo(outline, [win] + [hole_of(it) for it in items], 0.06))
            place_panels(b, items)
            b.box('glass', wa1 - wa0 + 0.02, y1 - y0 + 0.02, 0.003, (wa0 + wa1) / 2, (y0 + y1) / 2, -0.04, bevel=0)
            b.cyl('steel', 0.012, 0.50, az(0.70), -0.45, 0.05, axis='y', n=10)                 # grab bar on the plain aft wall
            for by_ in (-0.66, -0.24):
                b.cyl('steel', 0.009, 0.05, az(0.70), by_, 0.025, axis='z', n=8)
            if side < 0:
                b.rbox('fabric2', 0.30, 0.26, 0.09, az(0.45), -0.55, 0.045, 0.02, segs=2)      # strapped stowage bag
                for dz in (-0.07, 0.07):
                    b.box('seatframe', 0.03, 0.28, 0.094, az(0.45) + dz, -0.55, 0.047, bevel=0.003)

def build_ceiling():
    b = O('ceiling')
    fr, _ = pf((0, CY, 0), (1, 0, 0), (0, -1, 0))   # local a = x, b = +z
    outline = rect((XL - 0.06, XR + 0.06, -1.05, ZB + 0.06))
    wins = []     # the two rear overhead windows are gone: solid roof panels over the seats instead
    cells = []
    with fr:
        items = snap_items(cells, 'ceil')
        b.acc.add('clay', slab_geo(outline, [hole_of(it) for it in items], 0.08))
        place_panels(b, items)

def build_floor():
    b = O('floor')
    # Use a closed box here: the generic slab triangulation left visible gaps
    # in the footwell after GLB export on some Blender builds.
    b.box('floorgrey', XR - XL + 0.12, 0.06, ZB + 1.11,
          (XL + XR) / 2, FY - 0.03, 0.005, bevel=0)
    def strip(x0, x1, z0, z1):
        b.box('hazard', x1 - x0, 0.01, z1 - z0, (x0 + x1) / 2, FY + 0.002, (z0 + z1) / 2, bevel=0)
    strip(IP_A0, IP_A1, -0.80, -0.70)                    # toe-kick
    for s in (-1, 1):
        xin = X0 + s * CON_UI
        strip(*sorted((xin, xin - s * 0.09)), -0.40, 0.35)           # inboard foot of the side consoles
        xc = X0 + s * 0.30
        strip(*sorted((xc, xc + s * 0.09)), -0.60, 0.25)             # both sides of the centre console
    strip(XL, XR, 0.90, ZB)                             # aft edge

def build_cables():
    b = O('cables')
    r = 0.011; y = FY + r - 0.001
    b.tube('cabley', [(0.50, y, 0.27), (0.62, y, 0.40), (0.85, y, 0.50), (0.95, y, 0.66), (0.78, y, 0.80), (0.52, y, 0.74), (0.30, y, 0.62), (0.26, y, 0.48), (0.36, y, 0.40)], 0.013, n=7, per=6)   # the yellow floor cable
    b.tube('cable', [(0.84, -0.80, 0.20), (0.92, -1.0, 0.30), (1.00, y, 0.42), (0.96, y, 0.70), (0.80, y, 0.90)], r, n=6)
    b.tube('cable', [(0.26, -0.82, 0.20), (0.14, -1.02, 0.34), (0.10, y, 0.48), (0.30, y, 0.80)], r, n=6)
    b.tube('cable', [(XL + 0.02, y, 0.30), (-0.45, y, 0.55), (-0.30, y, 0.95)], 0.009, n=6)
    b.tube('cable', [(XR - 0.02, y, 0.30), (1.60, y, 0.58), (1.50, y, 0.95)], 0.009, n=6)

def build_aft():
    global fr_hatch
    b = O('aft')
    fr, _ = pf((0, 0, ZB), (-1, 0, 0), (0, 0, -1))      # a = -x
    fr_hatch = fr
    outline = rect((-(XR + 0.06), -(XL - 0.06), FY, CY + 0.06))
    wins = [(-xc - 0.225, -xc + 0.225, 0.08, 0.46) for xc in (0.0, 1.10)]
    cells = []
    HA = -X0          # hatch centre in the aft frame (a = -x)
    cells = []        # plain painted wall: no switch panels behind the seats
    with fr:
        items = snap_items(cells, 'wall')
        b.acc.add('clay', slab_geo(outline, [rrect(*w, 0.05, 3) for w in wins] + [hole_of(it) for it in items], 0.06))
        place_panels(b, items)
        for (a0, a1, b0, b1) in wins:
            b.box('glass', a1 - a0 + 0.02, b1 - b0 + 0.02, 0.003, (a0 + a1) / 2, (b0 + b1) / 2, -0.04, bevel=0)
        build_hatch(b, HA)
        build_aft_fittings(b, HA)

def build_aft_fittings(b, HA):
    # two grab bars either side of the hatch, and a strapped stowage bag on the wall to the left of it
    for sx in (-1, 1):
        ax = HA + sx * 0.44
        b.cyl('steel', 0.012, 0.50, ax, -0.62, 0.05, axis='y', n=10)
        for by in (-0.84, -0.40):
            b.cyl('steel', 0.009, 0.05, ax, by, 0.025, axis='z', n=8)
    bx, by_ = -1.30, -0.62
    b.rbox('fabric2', 0.36, 0.26, 0.09, bx, by_, 0.045, 0.02, segs=2)
    for dx in (-0.09, 0.09):
        b.box('seatframe', 0.03, 0.28, 0.094, bx + dx, by_, 0.047, bevel=0.003)
    b.box('steel', 0.04, 0.03, 0.01, bx, by_ + 0.02, 0.094, bevel=0.003)
HATCH_W, HATCH_B0, HATCH_B1 = 0.27, FY, -0.10
def hatch_canvas():
    ppm = 1000
    W, H = 340, 80
    cv = Canvas(W, H, PN_BASE)
    cv.outline(2, 2, W - 4, H - 4, (0.06, 0.06, 0.07), 2, r=4)
    cv.mtext('TO MID-DECK', W / 2, 30, 24, (0.97, 0.97, 0.95))
    cv.mtext('CABIN', W / 2, 62, 16, (0.97, 0.85, 0.4))
    return cv

def build_hatch(b, HA):
    """Passage hatch in the aft bulkhead (frame: a = -x, b = y, +z toward the crew). A jamb ring set into the wall with a visible reveal,
    a rubber seal, a thick door leaf with a recessed inner panel, three hinges tied to both leaf and jamb, a latch with escutcheon and keeper,
    a framed porthole, a kick plate, a floor sill and the placard."""
    W = HATCH_W
    ob0, ob1 = HATCH_B0, HATCH_B1
    jamb_out = rrect(HA - W - 0.07, HA + W + 0.07, ob0, ob1 + 0.07, 0.12, 5)
    opening = rrect(HA - W, HA + W, ob0 + 0.03, ob1, 0.08, 5)
    b.acc.add('steel', xform(slab_geo(jamb_out, [opening], 0.08), None, (0, 0, 0.06)))          # jamb: z -0.02 .. 0.06, tied into the wall
    seal_in = rrect(HA - W + 0.012, HA + W - 0.012, ob0 + 0.042, ob1 - 0.012, 0.066, 5)
    b.acc.add('rubber', xform(slab_geo(opening, [seal_in], 0.024), None, (0, 0, 0.040)))        # rubber seal line around the leaf
    leaf_out = seal_in
    pane = rrect(HA - W + 0.052, HA + W - 0.052, ob0 + 0.082, ob1 - 0.052, 0.04, 5)
    b.acc.add('clay', xform(slab_geo(leaf_out, [pane], 0.07), None, (0, 0, 0.032)))             # door leaf rim: z -0.038 .. 0.032
    b.acc.add('hood', xform(slab_geo(pane, [], 0.03), None, (0, 0, 0.022)))                     # recessed inner panel, 10 mm below the rim
    # kick plate and floor sill
    b.box('steel', 2 * W - 0.14, 0.10, 0.006, HA, ob0 + 0.15, 0.025, bevel=0.002)
    b.box('steel', 2 * W + 0.16, 0.02, 0.07, HA, ob0 + 0.01, 0.03, bevel=0.004)
    b.box('hazard', 2 * W - 0.14, 0.014, 0.004, HA, ob0 + 0.027, 0.066, bevel=0)
    # three hinges on the left edge: barrel on the seal line, one strap on the leaf rim and one on the jamb
    for by in (-0.30, -0.62, -0.94):
        hx = HA + W + 0.0
        b.cyl('alu_dark', 0.012, 0.13, hx, by, 0.049, axis='y', n=12)
        b.box('steel', 0.062, 0.12, 0.008, hx - 0.030, by, 0.036, bevel=0.002)                   # leaf strap (on the rim face 0.032)
        b.box('steel', 0.062, 0.12, 0.008, hx + 0.030, by, 0.064, bevel=0.002)                   # jamb strap (on the jamb face 0.06)
        b.cyl('steel', 0.006, 0.014, hx - 0.045, by, 0.042, axis='z', n=8)                      # rivet heads
    # latch: escutcheon plate, boss, lever, and the keeper on the jamb
    lx = HA - W + 0.095
    b.box('steel', 0.075, 0.17, 0.006, lx, -0.62, 0.025, bevel=0.003)
    b.cyl('alu_dark', 0.03, 0.018, lx, -0.62, 0.037, axis='z', n=16)
    b.box('steel', 0.15, 0.026, 0.018, lx + 0.04, -0.62, 0.055, bevel=0.006)
    b.cyl('red', 0.007, 0.006, lx, -0.70, 0.031, axis='z', n=10)                                # lock indicator
    b.box('steel', 0.032, 0.09, 0.008, HA - W - 0.02, -0.62, 0.064, bevel=0.002)                # keeper on the jamb
    # porthole with a steel ring and glass over a dark recess
    b.cyl('steel', 0.09, 0.012, HA, -0.40, 0.028, axis='z', n=28)
    b.cyl('dash_dark', 0.068, 0.018, HA, -0.40, 0.030, axis='z', n=28)
    b.cyl('hudglass', 0.068, 0.004, HA, -0.40, 0.040, axis='z', n=28)
    def cb(rect_):
        with fr_hatch:
            O('aft').panel('label2', 0.34, 0.08, HA, -0.205, 0.0225, rect_)
    PN_CUSTOM.append(('hatchplacard', hatch_canvas(), cb))

# ------------------------------------------------------------------ build: overhead canopy: fills the ceiling over both seats, centre nearly flat, wings dropping 30 degrees
ROWS = [(1, (0.55, 0.45), True), (2, (0.30, 0.40, 0.30), True), (3, (1.0,), False)]   # (knot index, centre column fractions, red guard rows)
def build_canopy():
    b = O('canopy')
    z_r1 = OZ[1]
    for i in range(6):                       # row 1: one panel per window facet, front edge on the window joint line
        Ta, Tb = jpt(i, TOP), jpt(i + 1, TOP)
        pts = [(Ta.x, oy(Ta.z), Ta.z), (Tb.x, oy(Tb.z), Tb.z), (Tb.x, oy(z_r1), z_r1), (Ta.x, oy(z_r1), z_r1)]
        poly_panel(b, pts, (0, -1, 0), zone='overhead', seed=20 + i)
    for row, (ki, fr_cols, red) in enumerate(ROWS):
        z0, z1 = OZ[ki], OZ[ki + 1]
        y0, y1 = oy(z0), oy(z1)
        w = HINGE[1] - HINGE[0]
        xs = [HINGE[0]]
        for f in fr_cols:
            xs.append(xs[-1] + w * f)
        for k in range(len(fr_cols)):
            pts = [(xs[k], y0, z0), (xs[k + 1], y0, z0), (xs[k + 1], y1, z1), (xs[k], y1, z1)]
            poly_panel(b, pts, (0, -1, 0), zone='overhead', red=red, bays=(row < 2), seam=(row < 2), seed=40 + row * 3 + k)   # row 3 is behind the seat backs: plain
        for s, hx in ((-1, HINGE[0]), (1, HINGE[1])):
            dx = s * WING_LEN * math.cos(WING_ANG); dy = -WING_DROP
            pts = [(hx, y0, z0), (hx, y1, z1), (hx + dx, y1 + dy, z1), (hx + dx, y0 + dy, z0)]
            poly_panel(b, pts, (0, -1, 0), zone='overhead', seed=60 + row * 2 + (s > 0))
            if row == 0:                     # round light / vent fixture near the outer corner
                fz = z0 + 0.10
                fy = oy(fz) + dy * 0.72
                nrm = Vector((-s * math.sin(WING_ANG), -math.cos(WING_ANG), 0)).normalized()
                c0 = Vector((hx + dx * 0.72, fy, fz))
                b.strut('fixture', c0 + nrm * 0.004, c0 - nrm * 0.02, 0.04, 0.04, n=14)
    for s, hx, xw in ((-1, HINGE[0], XL), (1, HINGE[1], XR)):   # step fascia where the wings drop below row 1, facing aft
        y = oy(z_r1)
        poly_panel(b, [(hx, y, z_r1), (xw, y, z_r1), (xw, y - WING_DROP, z_r1)], (0, 0, 1), seed=80, bays=False)
    ze = OZ[4]; y = oy(ze)                   # rear fascia up to the ceiling, facing aft
    pts = [(XL, y - WING_DROP, ze), (HINGE[0], y, ze), (HINGE[1], y, ze), (XR, y - WING_DROP, ze), (XR, CY, ze), (XL, CY, ze)]
    poly_panel(b, pts, (0, 0, 1), zone='wall', bays=False, seam=False, wmax=0.28, hmax=0.2, seed=81)

# ------------------------------------------------------------------ build: glare shield (thick hood) with the eyebrow strip of buttons, HUD units
HOOD_T = 0.08
LENS = {'green': ((0.2, 1.0, 0.45), 3.0), 'amber': ((1.0, 0.62, 0.08), 3.0), 'cyan': ((0.2, 0.9, 1.0), 3.0), 'red': ((1.0, 0.1, 0.05), 3.0), 'off': ((0.15, 0.2, 0.25), 0.15)}
BTNS = [('hatch', -0.20, '1 HATCH', 'green'), ('cabin', -0.12, '2 CABIN', 'green'), ('o2', -0.04, '3 O2', 'green'), ('arm', 0.04, '4 ARM ENGINE', 'amber')]
for _i, (_id, _lab, _st) in enumerate((('fire', 'FIRE', 'off'), ('dump', 'DUMP', 'off'), ('rcs-a', 'RCS A', 'green'), ('rcs-b', 'RCS B', 'green'), ('main', 'MAIN', 'off'),
                                       ('apu', 'APU', 'green'), ('pwr', 'PWR', 'green'), ('comms', 'COMMS', 'green'), ('dock', 'DOCK', 'off'), ('para', 'PARA', 'off'), ('entry', 'ENTRY', 'off'))):
    BTNS.append((_id, 0.235 + 0.073 * _i, _lab, _st))
ALARM_X = 0.135
BTN_Y = -0.0065      # eyebrow buttons + labels sit this far below the strip's old line, so the group is centred on the strip
EB_Y0, EB_Y1 = SHIELD_Y - HOOD_T + 0.01, SHIELD_Y - 0.005     # eyebrow face height range (local y)

def strip_texture():
    xa, xb = XL + 0.04, XR - 0.04
    ppm = 1100; W = int((xb - xa) * ppm); H = int((EB_Y1 - EB_Y0) * ppm)
    cv = Canvas(W, H, (0.40, 0.40, 0.41))
    X = lambda x: (x - xa) * ppm; Y = lambda y: (EB_Y1 - y) * ppm
    for (id_, x, lab, st) in BTNS:
        size = (0.0078 if len(lab) > 9 else 0.0098) * ppm
        cv.mtext(lab, X(x), Y(-0.034 + BTN_Y), size, (0.97, 0.97, 0.95))
        cv.rect(X(x) - 0.0185 * ppm, Y(BTN_Y) - 0.0185 * ppm, 0.037 * ppm, 0.037 * ppm, None)
    cv.mtext('MASTER ALARM', X(ALARM_X), Y(-0.034 + BTN_Y), 0.0072 * ppm, (1.0, 0.85, 0.8))
    for x in (-0.28, 0.185, 1.05):
        cv.rect(X(x), 2, 1.5, H - 4, (0.15, 0.15, 0.16))
    return cv

def build_shield():
    b = O('shield')
    zf = -0.545
    plan = [(XL, zf), (XR, zf)]
    for i in range(6, -1, -1):
        P = JOINTS[i][0]
        nhs = []
        if i < 6: nhs.append(facet_basis(FACETS[i][2])[0])
        if i > 0: nhs.append(facet_basis(FACETS[i - 1][2])[0])
        nh = sum(nhs, Vector()).normalized()
        q = P - nh * 0.02
        plan.append((q.x, q.z))
    plan[2] = (XR, plan[2][1]); plan[-1] = (XL, plan[-1][1])
    ext_poly(b, 'hood', [(x, SHIELD_Y - HOOD_T, z) for x, z in plan], (0, HOOD_T, 0))
    # eyebrow face: plain slab with a printed label strip; the buttons stand on it
    cvs = strip_texture()
    material('strip', (1, 1, 1), 0.55, image=make_image('strip', cvs.col))
    a0, a1 = XL + 0.04, XR - 0.04
    with EBF:
        b.acc.add('hood', slab_geo(rect((a0, a1, EB_Y0, EB_Y1)), [], 0.05))
        b.quad('strip', a1 - a0, EB_Y1 - EB_Y0, (a0 + a1) / 2, (EB_Y0 + EB_Y1) / 2, 0.0006)
        for (id_, x, lab, st) in BTNS:
            b.box('bezel', 0.034, 0.034, 0.012, x, BTN_Y, 0.006, bevel=0.002)
        b.box('bezel', 0.062, 0.040, 0.012, ALARM_X, BTN_Y, 0.006, bevel=0.002)
    for (id_, x, lab, st) in BTNS:
        rgb, k = LENS[st]
        lens_material('lens.' + id_, rgb, k)
        cap = wpos(EBF, (x, BTN_Y, 0.015)); lens = wpos(EBF, (x, BTN_Y + 0.0085, 0.0195))
        EMPTIES['btn:' + id_] = cap
        PIVOTS['btnCap.' + id_] = cap; PIVOTS['btnLamp.' + id_] = lens
        PARENTS['btnCap.' + id_] = 'btn:' + id_; PARENTS['btnLamp.' + id_] = 'btn:' + id_
        with EBF:
            O('btnCap.' + id_).box('capdark', 0.027, 0.027, 0.008, x, BTN_Y, 0.015, bevel=0.002)
            O('btnLamp.' + id_).box('lens.' + id_, 0.016, 0.006, 0.002, x, BTN_Y + 0.0085, 0.0195, bevel=0)
    lens_material('lens.alarm', (1.0, 0.1, 0.05), 0.5)
    PIVOTS['alarmLamp'] = wpos(EBF, (ALARM_X, BTN_Y, 0.0165))
    with EBF:
        O('alarmLamp').box('lens.alarm', 0.052, 0.032, 0.011, ALARM_X, BTN_Y, 0.0165, bevel=0.004, segs=2)
    # HUD units: base, two posts, a dark frame and a tinted glass plate
    for xc in (0.0, 1.10):
        zh = -0.72
        b.box('hood', 0.24, 0.06, 0.16, xc, SHIELD_Y + 0.028, zh, bevel=0.006)
        for sx in (-1, 1):
            b.box('hood', 0.016, 0.11, 0.016, xc + sx * 0.085, SHIELD_Y + 0.11, zh - 0.02, bevel=0.002)
        b.box('stickmat', 0.20, 0.13, 0.012, xc, SHIELD_Y + 0.17, zh - 0.02, rx=math.radians(25), bevel=0.003)
        b.box('hudglass', 0.17, 0.105, 0.004, xc, SHIELD_Y + 0.17, zh - 0.011, rx=math.radians(25), bevel=0)

# ------------------------------------------------------------------ build: instrument panel, displays, FLIGHT MODE panel, wings
DISP = [  # name, x, row (local b), display w, h, bezel, material
    ('centreDisplay', 0.0, 0.0, 0.26, 0.21, 0.025, 'disp_centre'),
    ('displayLeft', -0.31, 0.0, 0.18, 0.18, 0.01, 'disp_left'),
    (None, -0.31, -0.21, 0.18, 0.18, 0.01, 'disp_eps'),
    (None, 1.10, 0.0, 0.18, 0.18, 0.01, 'disp_eclss'), (None, 1.31, 0.0, 0.18, 0.18, 0.01, 'disp_comm'),
    (None, 1.10, -0.21, 0.18, 0.18, 0.01, 'disp_nav'), (None, 1.31, -0.21, 0.18, 0.18, 0.01, 'disp_rcs'),
    (None, 0.45, 0.0, 0.18, 0.18, 0.01, 'disp_cw'), ('displayRight', 0.65, 0.0, 0.18, 0.18, 0.01, 'disp_right'),
    (None, 0.45, -0.21, 0.18, 0.18, 0.01, 'disp_apu'), (None, 0.65, -0.21, 0.18, 0.18, 0.01, 'disp_hyd'),
]
IP_A0, IP_A1 = -0.45, 1.55
IP_B0, IP_B1 = -0.42, (SHIELD_Y - HOOD_T - IP_O.y) / math.cos(TILT)
FM_W, FM_H = 0.34, 0.165
FM_BC = -0.2175
def build_panel():
    b = O('panel')
    with IPF:
        strips = [(0.175, 0.335, -0.415, 0.14), (0.775, 0.975, -0.415, 0.14)]   # the narrow end columns, where the surfaces converge toward the wings, stay plain
        items = []
        for k, s in enumerate(strips):
            items += snap_items(auto_cells(rect(s), 0.17, 0.14, 0.0, 0.016, seed=100 + k, minsize=0.04), 'ip', cw_one=(k == 0))
        outline = rect((IP_A0, IP_A1, IP_B0, IP_B1))
        b.acc.add('clay', slab_geo(outline, [hole_of(it) for it in items], 0.06))
        place_panels(b, items)
        for (nm, x, row, w, h, bz, mat) in DISP:
            b.box('bezel', w + 2 * bz, h + 2 * bz, 0.03, x, row, 0.01, bevel=0.004)
        for (nm, x, row, w, h, bz, mat) in DISP:
            if nm is None:
                b.quad(mat, w, h, x, row, 0.0252)
        for sx in (-1, 1):                    # five soft-keys on each side of centreDisplay
            for j in range(5):
                b.box('soft', 0.013, 0.013, 0.005, sx * 0.1425, 0.105 - (131 + 153 * j) / 826 * 0.21, 0.0275, bevel=0.002)
    for (nm, x, row, w, h, bz, mat) in DISP:
        if nm:
            PIVOTS[nm] = wpos(IPF, (x, row, 0.0252))
            with IPF:
                O(nm).quad(mat, w, h, x, row, 0.0252)
    # lower fascia down to the floor
    yb = ip_y(IP_B0); zb = ip_z(IP_B0)
    poly_panel(b, [(IP_A0, yb + 0.02, zb - 0.02), (IP_A1, yb + 0.02, zb - 0.02), (IP_A1, FY, -0.78), (IP_A0, FY, -0.78)], (0, 0, 1), thick=0.06, zone='ip', bays=False, seam=False, seed=130)
    # wing panels: outboard of each display block, angled 35 degrees toward the seat, joining the panel to the side console
    wa = math.radians(35)
    for s, hx, xw in ((-1, IP_A0, XL), (1, IP_A1, XR)):
        L = abs(hx - xw) / math.cos(wa)
        d = Vector((s * L * math.cos(wa), 0, L * math.sin(wa)))
        top = Vector((hx, ip_y(IP_B1), ip_z(IP_B1))); bot = Vector((hx, ip_y(IP_B0), ip_z(IP_B0)))
        poly_panel(b, [top, bot, bot + d, top + d], (-s * 0.5, 0.3, 0.8), thick=0.05, zone='ip', bays=False, seam=False, seed=140 + (s > 0))   # wing: converging surface, plain
        # footwell kick panel: closes the gap below the wing panel, from its lower edge down to the floor, so no sky shows by the feet
        poly_panel(b, [bot, bot + d, Vector((bot.x + d.x, FY, bot.z + d.z)), Vector((bot.x, FY, bot.z))], (-s * 0.5, 0.0, 0.8), thick=0.05, bays=False, seam=False)
        poly_panel(b, [(hx, yb + 0.02, zb - 0.02), (hx, bot.y, bot.z), (hx, FY, bot.z), (hx, FY, -0.78)], (s, 0, 0), thick=0.05, bays=False, seam=False)   # the triangle between kick panel and fascia

def flightmode_canvas():
    ppm = 1100
    W, H = int(FM_W * ppm), int(FM_H * ppm)
    cv = Canvas(W, H, PN_BASE)
    X = lambda a: (a + FM_W / 2) * ppm
    Y = lambda b_: (FM_BC + FM_H / 2 - b_) * ppm
    cv.outline(1.5, 1.5, W - 3, H - 3, (0.06, 0.06, 0.07), 2, r=5)
    cv.rect(2, 2, W - 4, 0.0165 * ppm * 1.15, (0.07, 0.07, 0.075))
    cv.mtext('FLIGHT MODE', X(-0.16), Y(FM_BC + FM_H / 2 - 0.0095), 0.0095 * ppm, (0.95, 0.95, 0.95), 'l')
    cv.mtext('F-01', X(0.16), Y(FM_BC + FM_H / 2 - 0.0095), 0.0075 * ppm, (0.8, 0.8, 0.8), 'r')
    cv.rect(X(-0.165), Y(-0.158), 0.33 * ppm, Y(-0.285) - Y(-0.158), (0.15, 0.15, 0.165), r=4)
    for (ax0, ax1) in ((-0.162, -0.034), (-0.026, 0.07), (0.077, 0.165)):
        cv.outline(X(ax0), Y(-0.16), (ax1 - ax0) * ppm, Y(-0.282) - Y(-0.16), (0.8, 0.8, 0.8), 1, r=3)
    cv.outline(X(-0.157), Y(-0.165), 0.044 * ppm, 0.0 + Y(-0.245) - Y(-0.165), (0.85, 0.12, 0.08), 2, r=3) if False else None
    cv.mtext('X  ENGINE CUT-OFF', X(-0.098), Y(-0.264), 0.0092 * ppm, (0.97, 0.97, 0.95))
    cv.mtext('F  MANUAL', X(0.022), Y(-0.264), 0.0092 * ppm, (0.97, 0.97, 0.95))
    cv.mtext('SPACE  LOCK', X(0.121), Y(-0.264), 0.0092 * ppm, (0.97, 0.97, 0.95))
    return cv

def build_flightmode():
    def cb(rect_):
        zf = 0.0087
        bp = O('panel')
        with IPF:
            bp.box('dash_dark', FM_W + 0.008, FM_H + 0.008, 0.012, 0, FM_BC, 0.0025, bevel=0)
            bp.panel('label2', FM_W, FM_H, 0, FM_BC, zf, rect_)
        by = -0.2095      # caps centred between the bay top and the label line
        # engine cut-off: lamp, bat toggle (pivot at its base), hinged red guard (pivot at the hinge)
        xt = -0.098
        lens_material('lens.cutoff', (1.0, 0.1, 0.05), 0.4)
        PIVOTS['cutoffLamp'] = wpos(IPF, (-0.148, by, zf + 0.002))
        PIVOTS['cutoffSwitch'] = wpos(IPF, (xt, by, zf + 0.004))
        PIVOTS['cutoffGuard'] = wpos(IPF, (xt, by + 0.022, zf + 0.020))
        with IPF:
            O('cutoffLamp').box('lens.cutoff', 0.013, 0.013, 0.004, -0.148, by, zf + 0.002, bevel=0.001)
            sw = O('cutoffSwitch')
            sw.box('steel', 0.016, 0.016, 0.004, xt, by, zf + 0.002, bevel=0.001)
            ov_cone(sw, 'steel', (xt, by, zf + 0.004), (xt, by + 0.004, zf + 0.020), 0.0048, 0.0028, 8)
            g = O('cutoffGuard')
            g.box('red', 0.040, 0.046, 0.003, xt, by, zf + 0.0265, bevel=0.001)
            for sx in (-1, 1):
                g.box('red', 0.003, 0.046, 0.026, xt + sx * 0.0185, by, zf + 0.0135, bevel=0)
        # MANUAL (cyan) and LOCK (amber) push buttons: housing + child cap
        for nm, x, rgb in (('assist', 0.022, (0.2, 0.9, 1.0)), ('retro', 0.121, (1.0, 0.62, 0.08))):
            lens_material(nm + 'CapMat', rgb, 3.0)
            PIVOTS[nm + 'Button'] = wpos(IPF, (x, by, zf + 0.005)); PIVOTS[nm + 'Cap'] = wpos(IPF, (x, by, zf + 0.011))
            PARENTS[nm + 'Cap'] = nm + 'Button'
            with IPF:
                O(nm + 'Button').box('bezel', 0.040, 0.040, 0.010, x, by, zf + 0.005, bevel=0.002)
                O(nm + 'Cap').box(nm + 'CapMat', 0.030, 0.030, 0.010, x, by, zf + 0.011, bevel=0.002)
    PN_CUSTOM.append(('flightmode', flightmode_canvas(), cb))

# ------------------------------------------------------------------ build: consoles
CON_Z0, CON_Z1, CON_Z2 = -0.47, 0.15, 0.35
def con_s(z):
    if z >= CON_Z1: return -0.50
    if z <= CON_Z0: return -0.10
    return -0.10 - (z - CON_Z0) * (0.40 / (CON_Z1 - CON_Z0))
CON_UI, CON_UM, CON_UW = 0.93, 1.06, 1.20
CON_RISE = (CON_UW - CON_UM) / math.tan(math.radians(35))

def build_side_console(s):
    name = 'consoleL' if s < 0 else 'consoleR'
    zone = 'conL' if s < 0 else 'conR'
    b = O(name)
    bo = O(name + '_outer')
    ui, um, uw = CON_UI, CON_UM, CON_UW
    X = lambda u: X0 + s * u
    zones = [(CON_Z0, CON_Z1), (CON_Z1, CON_Z2)]
    for k, (z0, z1) in enumerate(zones):
        y0, y1 = con_s(z0), con_s(z1)
        poly_panel(b, [(X(ui), y0, z0), (X(um), y0, z0), (X(um), y1, z1), (X(ui), y1, z1)], (0, 1, 0), thick=0.05, zone=zone, bays=False, seam=False, wmax=0.17, hmax=0.20, margin=0.012, seed=200 + k + 5 * (s > 0))
        poly_panel(b, [(X(um), y0, z0), (X(uw), y0 + CON_RISE, z0), (X(uw), y1 + CON_RISE, z1), (X(um), y1, z1)], (-s * 0.57, 0.82, 0), thick=0.05, zone=zone, bays=False, seam=False, wmax=0.20, hmax=0.20, margin=0.015, seed=210 + k + 5 * (s > 0))
    prof = [(CON_Z0, FY), (CON_Z2, FY), (CON_Z2, -0.50), (CON_Z1, -0.50), (CON_Z0, -0.10)]
    poly_panel(b, [(X(ui), y, z) for z, y in prof], (-s, 0, 0), thick=0.05, zone='wall', bays=False, seam=False, wmax=0.28, hmax=0.2, margin=0.03, seed=220 + (s > 0))
    prof2 = [(CON_Z0, FY), (CON_Z2, FY), (CON_Z2, -0.50 + CON_RISE), (CON_Z1, -0.50 + CON_RISE), (CON_Z0, -0.10 + CON_RISE)]
    poly_panel(bo, [(X(uw), y, z) for z, y in prof2], (s, 0, 0), thick=0.05, bays=False, seam=False)   # outer shell against the wall
    poly_panel(b, [(X(uw), FY, CON_Z2), (X(ui), FY, CON_Z2), (X(ui), -0.50, CON_Z2), (X(uw), -0.50 + CON_RISE, CON_Z2)], (0, 0, 1), thick=0.05, zone='wall', bays=False, seam=False, wmax=0.28, hmax=0.2, margin=0.03, seed=230 + (s > 0))

def build_centre_console():
    b = O('consoleC')
    xl, xr = X0 - 0.30, X0 + 0.30
    zf, za = -0.62, 0.25
    ya = -0.64
    yf = ya + 0.08
    def top_items(poly):
        its = []
        def add(a0, a1, b0, b1, kind, system):
            its.append(make_item((a0, a1, b0, b1), a1 - a0, b1 - b0, 'conC', False, kind, system))
        add(0.03, 0.21, -0.28, -0.04, 'keypad', 'KEYPAD A')
        add(0.22, 0.38, -0.26, -0.04, 'meter', 'ENTRY')
        add(0.39, 0.57, -0.28, -0.04, 'keypad', 'KEYPAD B')
        add(0.03, 0.30, -0.54, -0.31, 'sw', 'RCS')
        add(0.31, 0.58, -0.54, -0.31, 'sw', 'DOCKING')
        add(0.03, 0.30, -0.84, -0.57, 'sw', 'ENTRY')
        add(0.31, 0.58, -0.84, -0.57, 'rot', 'ENTRY')
        return [i for i in its if i]
    poly_panel(b, [(xl, yf, zf), (xr, yf, zf), (xr, ya, za), (xl, ya, za)], (0, 1, 0), thick=0.06, items=top_items)
    for s, xs in ((-1, xl), (1, xr)):
        poly_panel(b, [(xs, FY, zf), (xs, FY, za), (xs, ya, za), (xs, yf, zf)], (s, 0, 0), thick=0.05, zone='wall', bays=False, seam=False, wmax=0.28, hmax=0.2, margin=0.03, seed=301 + (s > 0))
    poly_panel(b, [(xl, FY, za), (xr, FY, za), (xr, ya, za), (xl, ya, za)], (0, 0, 1), thick=0.05, zone='wall', bays=False, seam=False, wmax=0.28, hmax=0.2, margin=0.03, seed=303)

# ------------------------------------------------------------------ build: hand controllers, throttle
def build_sticks():
    # commander's stick: between the knees, origin at the pivot ball at its base. The pilot's is static.
    for xs, name in ((0.0, 'stick'), (1.10, None)):
        zs = -0.40
        bb = O('panel')
        bb.strut('stickmat', (xs, FY, zs), (xs, -0.80, zs), 0.045, 0.035, n=12)      # pedestal
        b = O(name) if name else bb
        if name:
            PIVOTS[name] = (xs, -0.78, zs)
        b.sphere('stickmat', 0.03, xs, -0.78, zs)
        b.strut('stickmat', (xs, -0.78, zs), (xs, -0.56, zs), 0.02, 0.02, n=10)       # shaft
        b.box('stickmat', 0.04, 0.12, 0.05, xs, -0.50, zs, rx=math.radians(-12), bevel=0.01, segs=2)   # grip
        b.box('stickmat', 0.05, 0.05, 0.075, xs, -0.425, zs - 0.01, rx=math.radians(-12), bevel=0.012, segs=2)  # head
        b.box('stickmat', 0.012, 0.03, 0.02, xs, -0.46, zs - 0.045, bevel=0.004)           # trigger

THR_X = X0 - 0.995
THR_AX = 0.10                    # lever axis z (aft end of the quadrant)
def build_throttle():
    x = THR_X
    ang = math.atan(0.40 / (CON_Z1 - CON_Z0))
    nrm = Vector((0, math.cos(ang), math.sin(ang)))
    fwd = Vector((0, math.sin(ang), -math.cos(ang)))
    sp = lambda z: Vector((x, con_s(z), z))
    bc = O('consoleL')
    zm = -0.14
    bc.box('stickmat', 0.09, 0.012, 0.50 / math.cos(ang), x, con_s(zm) + 0.004, zm, rx=ang, bevel=0.003)       # quadrant plate
    c = sp(zm) + nrm * 0.0105
    bc.box('seam', 0.016, 0.004, 0.46 / math.cos(ang), c.x, c.y, c.z, rx=ang, bevel=0)                          # the slot
    for k in range(10):
        zk = 0.08 - 0.047 * k
        p = sp(zk) + nrm * 0.0115
        nm = 'tick.%d' % k
        PIVOTS[nm] = (p.x + 0.03, p.y, p.z)
        O(nm).box('tickwhite', 0.012 if k % 5 else 0.02, 0.003, 0.0035, p.x + 0.03, p.y, p.z, rx=ang, bevel=0)
    # lever: origin on its axis
    axis = sp(THR_AX) + nrm * 0.010
    PIVOTS['throttle'] = tuple(axis)
    b = O('throttle')
    d = (nrm * 0.78 + fwd * 0.62).normalized()
    c1 = axis + d * 0.17
    b.strut('stickmat', axis, c1, 0.011, 0.011, n=8)
    b.box('stickmat', 0.035, 0.05, 0.05, c1.x, c1.y + 0.01, c1.z, rx=0.3, bevel=0.01, segs=2)
    b.sphere('steel', 0.016, axis.x, axis.y, axis.z, n=8, m=4)

# ------------------------------------------------------------------ build: seats (slim; backs and headrests are a separate object so shot 6 can hide them)
def build_seat(xc):
    b = O('seats'); bk = O('seatBacks')
    r12 = math.radians(12)
    zf = lambda y: 0.12 + math.tan(r12) * y
    b.box('fabric', 0.46, 0.10, 0.34, xc, -0.75, -0.13, bevel=0.025, segs=2)
    yc = -0.38
    bk.box('fabric', 0.44, 0.62, 0.08, xc, yc, zf(yc) + 0.041, rx=r12, bevel=0.025, segs=2)
    for sx in (-1, 1):
        bk.box('fabric', 0.06, 0.58, 0.12, xc + sx * 0.205, yc, zf(yc) + 0.03, rx=r12, bevel=0.02, segs=2)
    bk.box('fabric', 0.26, 0.18, 0.08, xc, 0.0, zf(0.0) + 0.041, rx=r12, bevel=0.025, segs=2)
    bk.box('fabric2', 0.50, 0.66, 0.025, xc, yc, zf(yc) + 0.093, rx=r12, bevel=0.006)
    b.box('seatframe', 0.36, 0.05, 0.30, xc, -0.815, -0.12, bevel=0.008)
    for sx in (-1, 1):
        b.box('seatframe', 0.05, 0.34, 0.05, xc + sx * 0.16, -0.97, -0.12, bevel=0.006)
        b.box('seatframe', 0.04, 0.04, 1.25, xc + sx * 0.16, -1.13, 0.14, bevel=0.004)

# ------------------------------------------------------------------ floating-part check
def check_floating(parts_list, tol=0.003):
    from mathutils.bvhtree import BVHTree
    parts = []
    for mat, v, f in parts_list:
        pv = [Vector(p) for p in v]
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
    mv, mt = [], []
    for i in main:
        o = len(mv); mv += parts[i]['v']; mt += [(o + t[0], o + t[1], o + t[2]) for t in parts[i]['tris']]
    mbvh = BVHTree.FromPolygons(mv, mt)
    for g in floaters:
        gap = min((mbvh.find_nearest(q)[3] or 9) for i in g for q in parts[i]['v'])
        c = np.mean([parts[i]['c'] for i in g], axis=0)
        log(f'  floating: {len(g)} part(s) {sorted(set(parts[i]["mat"] for i in g))} near game ({c[0]:.2f}, {c[1]:.2f}, {c[2]:.2f}), gap {gap * 1000:.0f} mm')
    return len(floaters)

# ------------------------------------------------------------------ typed panels: draw the atlas, then add every panel's geometry
ATLAS_SIZE = int(arg('--atlas', 2048))
def pn_finish():
    OVA = Atlas(ATLAS_SIZE)
    for sp in PN_SPECS.values():
        OVA.add(sp['name'], pn_draw(sp))
    for name, cv, cb in PN_CUSTOM:
        OVA.add(name, cv)
    col_a, glow_a, hgt_a = OVA.pack()
    col_a, rough_a = wear_atlas(col_a, hgt_a)
    material('label2', (1, 1, 1), 0.5, 0.1, image=make_image('ov_atlas', col_a), emit_image=make_image('ov_glow', glow_a), emit_strength=1.6,
             bump_image=make_image('ov_height', hgt_a, srgb=False), bump_strength=0.7, uv_map='UVMap')
    for cell in PN_CELLS:
        with frame(cell['M'], cell['org']):
            pn_geometry(cell['b'], cell['sp'], OVA.rects[cell['sp']['name']], cell['D'])
    for name, cv, cb in PN_CUSTOM:
        cb(OVA.rects[name])
    log('console panels', len(PN_CELLS), 'unique faces', len(PN_SPECS))
    log('SWITCH CHECK (footprint inside face / no overlaps):', len(PN_FAILS), 'problems')
    for f in PN_FAILS[:60]: log('  ', f)

# ------------------------------------------------------------------ build everything
make_display_materials()
build_windows(); build_walls(); build_ceiling(); build_floor(); build_aft(); build_canopy(); build_cables()
build_shield(); build_panel(); build_flightmode()
build_side_console(-1); build_side_console(1); build_centre_console()
build_sticks(); build_throttle()
build_seat(0.0); build_seat(1.10)
pn_finish()
log('geometry built')

tri_total = 0
all_parts = []
OBJ_BY_NAME = {}
for name, bld in OBJS.items():
    me = mesh_from_acc(name, bld.acc, PIVOTS.get(name))
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    if name in PIVOTS:
        ob.location = G(PIVOTS[name])
    OBJ_BY_NAME[name] = ob
    tri_total += bld.acc.tris()
    all_parts += bld.acc.parts
for nm, pos in EMPTIES.items():
    e = bpy.data.objects.new(nm, None); e.empty_display_type = 'PLAIN_AXES'; e.empty_display_size = 0.01
    e.location = G(pos); col.objects.link(e); OBJ_BY_NAME[nm] = e
bpy.context.view_layer.update()
for child, parent in PARENTS.items():
    c, p = OBJ_BY_NAME[child], OBJ_BY_NAME[parent]
    c.parent = p; c.matrix_parent_inverse = p.matrix_world.inverted()
for name, bld in sorted(OBJS.items(), key=lambda kv: -kv[1].acc.tris())[:12]:
    log(f'  object {name}: {bld.acc.tris()} tris')
log(f'TRIANGLES total {tri_total} in {len(OBJS)} objects')
FLOATING = check_floating(all_parts)
log(f'FLOATING {FLOATING}')
log('textures (px, bytes):', {k: v for k, v in IMAGES.items()}, 'total bytes', sum(v[2] for v in IMAGES.values()))

def game_pos(ob):
    p = ob.matrix_world.translation
    return (round(p.x, 3), round(p.z, 3), round(-p.y, 3))
NAMED = ['displayLeft', 'centreDisplay', 'displayRight', 'cutoffGuard', 'cutoffSwitch', 'cutoffLamp', 'assistButton', 'assistCap', 'retroButton', 'retroCap', 'alarmLamp',
         'stick', 'throttle'] + ['tick.%d' % k for k in range(10)] + ['btn:' + b[0] for b in BTNS] + ['btnCap.' + b[0] for b in BTNS] + ['btnLamp.' + b[0] for b in BTNS]
missing = [n for n in NAMED if n not in OBJ_BY_NAME]
log('NAMED PARTS missing:', missing)
for n in NAMED:
    if n in OBJ_BY_NAME and not n.startswith(('btnCap', 'btnLamp', 'tick')):
        log(f'  part {n:14s} world game (x, y, z) = {game_pos(OBJ_BY_NAME[n])}')
log('  parts btnCap/btnLamp/tick: all present' if not missing else '  SOME MISSING')

# ---- the eye-to-display ray check: nothing may stand between the commander's eye and the corners of centreDisplay
def ray_check():
    dg = bpy.context.evaluated_depsgraph_get()
    bad = 0
    for sx in (-1, 1):
        for sy in (-1, 1):
            target = wpos(IPF, (sx * 0.13 * 0.99, sy * 0.105 * 0.99, 0.0252))
            o = Vector(G((0, 0, 0))); d = Vector(G(target)) - o; dist = d.length; d.normalize()
            ok, loc, nrm, idx, ob, mat = bpy.context.scene.ray_cast(dg, o, d, distance=dist + 0.01)
            hit_ok = (not ok) or ob.name == 'centreDisplay' or (loc - Vector(G(target))).length < 0.004
            if not hit_ok:
                bad += 1
            log(f'  ray to centreDisplay corner ({sx:+d},{sy:+d}): first hit {ob.name if ok else None} at {((loc - o).length if ok else 0):.3f} m (display at {dist:.3f})  {"OK" if hit_ok else "BLOCKED"}')
    return bad
def hole_scan():
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for ex in (0.0, 1.10):
        o = Vector(G((ex, 0.0, 0.0)))
        for yaw in range(-180, 180, 4):
            for pitch in range(-89, 60, 4):
                y, pi = math.radians(yaw), math.radians(pitch)
                dgame = Vector((math.sin(y) * math.cos(pi), math.sin(pi), -math.cos(y) * math.cos(pi)))
                d = Vector(G(dgame))
                ok, loc, nrm, idx, ob, mat = bpy.context.scene.ray_cast(dg, o, d, distance=30)
                if not ok:
                    out.append((ex, yaw, pitch, None, None))
                elif 'wall' not in ob.name and nrm.dot(d) > 0 and pitch < 0:
                    out.append((ex, yaw, pitch, ob.name, 'BACKFACE'))
    return out
if '--scan' in argv:
    log('WALLINFO zA L/R', JOINTS[0][0].z, JOINTS[6][0].z, 'wing end z', ip_z(IP_B0) + (XL - IP_A0) / math.cos(math.radians(35)) * math.sin(math.radians(35)) * 0, 'ip z b0', ip_z(IP_B0), ip_y(IP_B0), 'IP_B1', ip_y(IP_B1), ip_z(IP_B1))
    hs = hole_scan()
    log('HOLE SCAN misses/backfaces', len(hs))
    for h in [h for h in hs if h[2] < 0 and h[3] is None][:60]: log('  MISS', h)
def panel_scan():
    # each typed panel must sit on its surface: a ray dropped on its four corners and centre meets the printed face 3.5 mm down
    dg = bpy.context.evaluated_depsgraph_get(); bad = []
    for c in PN_CELLS:
        M = c['M']; n = M @ Vector((0, 0, 1)); xa = M @ Vector((1, 0, 0)); ya = M @ Vector((0, 1, 0)); fw, fh = c['sp']['fw'], c['sp']['fh']
        res = []
        for (ux, uy) in ((0, 0), (-1, -1), (1, -1), (-1, 1), (1, 1)):
            q = c['org'] + xa * (ux * (fw / 2 - 0.002)) + ya * (uy * (fh / 2 - 0.002)) + n * 0.012
            ok, loc, nrm, idx, ob, mat = bpy.context.scene.ray_cast(dg, Vector(G(q)), Vector(G(-n)), distance=0.2)
            d = (loc - Vector(G(q))).length if ok else None
            res.append((d, ob.name if ok else None))
        ds = [r[0] for r in res]
        if any(d is None or d < 0.0025 or d > 0.0045 for d in ds):
            bad.append((c['sp']['pid'], tuple(round(x, 2) for x in G(c['org'])), [(None if d is None else round(d * 1000, 1), nm) for d, nm in res][:3]))
    return bad
PBAD = panel_scan()
log('PANEL PLACEMENT SCAN:', len(PBAD), 'of', len(PN_CELLS), 'panels not sitting cleanly on their surface')
for pb in PBAD[:40]: log('  ', pb)
def leak_scan():
    plugs = []
    for k, q in enumerate(WIN_PLUGS):
        me = bpy.data.meshes.new('plug%d' % k); me.from_pydata([G(v) for v in q], [], [(0, 1, 2, 3)]); me.update()
        ob = bpy.data.objects.new('plug%d' % k, me); scene.collection.objects.link(ob); plugs.append(ob)
    bpy.context.view_layer.update()
    try:
        return _leak_scan()
    finally:
        for ob in plugs:
            bpy.data.objects.remove(ob, do_unlink=True)

def _leak_scan():
    """Full-sphere rays from both seat eyes plus head offsets (+-10 cm): every ray must hit something, except through the forward windows
    (open holes: yaw within 80 deg of forward, above the sill) and the side windows (they carry glass). Returns the leaking rays."""
    dg = bpy.context.evaluated_depsgraph_get()
    leaks = []
    offs = [(0, 0, 0)] + [(sx * 0.1, sy * 0.1, sz * 0.1) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    for ex in (0.0, 1.10):
        for off in offs:
            o = Vector(G((ex + off[0], off[1], off[2])))
            for yaw in range(-180, 180, 3):
                for pitch in range(-90, 91, 3):
                    y, pi = math.radians(yaw), math.radians(pitch)
                    d = Vector(G(Vector((math.sin(y) * math.cos(pi), math.sin(pi), -math.cos(y) * math.cos(pi)))))
                    ok, loc, nrm, idx, ob, mat = bpy.context.scene.ray_cast(dg, o, d, distance=50)
                    if ok:
                        continue
                    if True:
                        leaks.append((ex, tuple(round(v, 2) for v in off), yaw, pitch))
    return leaks
LEAKS = leak_scan()
log('LEAK SCAN (full sphere, head offsets):', len(LEAKS), 'rays escape outside the forward windows')
_bins = {}
for _e, _o, _y, _p in LEAKS:
    _bins.setdefault((_e, _y // 20 * 20, _p // 20 * 20), []).append((_o, _y, _p))
for _k, _v in sorted(_bins.items())[:40]:
    log('  leak bin eye x=%.2f yaw %d pitch %d: %d rays, e.g. %s' % (_k[0], _k[1], _k[2], len(_v), _v[0]))
if '--probe' in argv:
    dg_ = bpy.context.evaluated_depsgraph_get()
    for yawd in (30, 40, 50, 60):
        for pitd in (-20, -30, -40):
            y_, p_ = math.radians(yawd), math.radians(pitd)
            d_ = Vector(G(Vector((-math.sin(y_) * math.cos(p_), math.sin(p_), -math.cos(y_) * math.cos(p_)))))
            ok_, loc_, nrm_, idx_, ob_, mat_ = bpy.context.scene.ray_cast(dg_, Vector(G((0, 0, 0))), d_, distance=30)
            log('PROBE yaw', yawd, 'pitch', pitd, ob_.name if ok_ else None, ob_.data.materials[ob_.data.polygons[idx_].material_index].name if ok_ else None, [round(v, 2) for v in (loc_.x, loc_.z, -loc_.y)] if ok_ else None)
RAY_BAD = ray_check()
log('RAY CHECK blocked corners:', RAY_BAD)

def export_glb(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in col.objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = OBJ_BY_NAME['panel']
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                              export_cameras=False, export_lights=False, export_materials='EXPORT', export_image_format='AUTO',
                              export_normals=True, export_texcoords=True, export_tangents=False, export_extras=False)
    log('glb', path, os.path.getsize(path), 'bytes')
if arg('--out'):
    export_glb(arg('--out'))

# ------------------------------------------------------------------ sky, lights, cameras, renders
SUN_DIR = Vector((-0.25, 0.55, -0.80)).normalized()     # toward the sun (game): front, above, a little left
def sky_world_image(W=3072, H=1536):
    u = (np.arange(W) + 0.5) / W; v = (np.arange(H) + 0.5) / H
    lon = np.pi - u * 2 * np.pi; lat = (v - 0.5) * np.pi
    LON, LAT = np.meshgrid(lon, lat)
    dx = np.cos(LAT) * np.cos(LON); dy = np.cos(LAT) * np.sin(LON); dz = np.sin(LAT)
    el = dy                                    # Blender +Y = game forward (-Z) = UP the pad: the windows look at the sky
    k = np.clip((el - 0.45) / 0.55, 0, 1) ** 0.8                  # gradient across the part of the sky the windows see
    zen = np.array([0.12, 0.33, 0.72]); hor = np.array([0.72, 0.84, 0.97])
    sky = zen * k[..., None] + hor * (1 - k)[..., None]
    sdg = np.array(G(SUN_DIR))
    cs = dx * sdg[0] + dy * sdg[1] + dz * sdg[2]
    sky = sky * (0.78 + 0.5 * (0.5 - 0.5 * dx))[..., None]            # brighter toward one side (left)
    sky += np.array([1.0, 0.85, 0.6]) * (np.clip(cs, 0, 1) ** 24 * 0.5)[..., None]
    sky += np.array([1.0, 0.97, 0.9]) * (np.clip(cs, 0, 1) ** 3000 * 12)[..., None]
    S = 1024
    n = fbm(S, S, 4, 6, 9)
    q = (el + 0.12)
    px = ((dx / np.maximum(q, 0.08)) * 1.1 % 1.0 * (S - 1)).astype(int); py = ((dz / np.maximum(q, 0.08)) * 1.1 % 1.0 * (S - 1)).astype(int)
    cl = np.clip((n[py, px] - 0.47) * 4.0, 0, 1) * np.clip((el - 0.25) * 4, 0, 1)
    lightc = 0.82 + 0.18 * np.clip(cs, 0, 1)
    sky = sky * (1 - cl[..., None]) + np.array([0.95, 0.96, 0.98])[None, None, :] * (lightc * (1 - 0.35 * cl))[..., None] * cl[..., None]
    ground = np.array([0.34, 0.37, 0.3]) * (0.7 + 0.3 * fbm(H, W, 12, 3, 4))[..., None]
    img = sky                                  # sky all round: no ground, no horizon
    return make_image('world_sky', np.clip(img, 0, 1)[::-1])

def point_light(name, pos, watts, color, radius):
    l = bpy.data.lights.new(name, 'POINT'); l.energy = watts; l.color = color; l.shadow_soft_size = radius
    o = bpy.data.objects.new(name, l); o.location = G(pos); scene.collection.objects.link(o)
    return o

def cam_basis(pos, direction, up):
    z = -Vector(direction).normalized()
    x = Vector(up).cross(z).normalized()
    y = z.cross(x)
    return Matrix(((x.x, y.x, z.x), (x.y, y.y, z.y), (x.z, y.z, z.z))).to_euler()

def render_all(outdir):
    os.makedirs(outdir, exist_ok=True)
    scene.render.engine = 'CYCLES'
    cy = scene.cycles
    cy.samples = SAMPLES; cy.use_denoising = True; cy.denoiser = 'OPENIMAGEDENOISE'
    cy.max_bounces = 8; cy.diffuse_bounces = 4; cy.glossy_bounces = 4; cy.transmission_bounces = 4; cy.transparent_max_bounces = 16
    cy.sample_clamp_indirect = 5.0
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'; prefs.get_devices()
        for dv in prefs.devices: dv.use = True
        cy.device = 'GPU'
    except Exception as ex:
        log('GPU unavailable', ex); cy.device = 'CPU'
    scene.render.resolution_percentage = int(arg('--scale', 100))
    scene.view_settings.view_transform = 'AgX'; scene.view_settings.exposure = float(arg('--exposure', 0.0))
    try:
        scene.view_settings.look = arg('--look', 'AgX - High Contrast')
    except Exception as ex:
        log('look unavailable', ex)
    world = bpy.data.worlds.new('sky'); world.use_nodes = True
    env = world.node_tree.nodes.new('ShaderNodeTexEnvironment'); env.image = sky_world_image()
    world.node_tree.links.new(env.outputs['Color'], world.node_tree.nodes['Background'].inputs['Color'])
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = float(arg('--sky', 0.9))
    scene.world = world
    # sun from the front and above, shining through the windows
    sun = bpy.data.lights.new('sun', 'SUN'); sun.angle = 0.02; sun.energy = float(arg('--sun', 7.0)); sun.color = (1.0, 0.95, 0.85)
    sob = bpy.data.objects.new('sun', sun); scene.collection.objects.link(sob)
    sob.rotation_euler = Vector(G(-SUN_DIR)).to_track_quat('-Z', 'Y').to_euler()
    # soft area light above the centre console
    al = bpy.data.lights.new('consoleLight', 'AREA'); al.shape = 'RECTANGLE'; al.size = 1.0; al.size_y = 0.6; al.energy = float(arg('--area', 40))
    al.color = (1.0, 0.95, 0.9)
    ao = bpy.data.objects.new('consoleLight', al); ao.location = G((X0, 0.42, -0.15)); scene.collection.objects.link(ao)
    ao.visible_camera = False; ao.visible_glossy = False
    # fill so no corner is black: a second dim area light behind the seats
    af = bpy.data.lights.new('fillLight', 'AREA'); af.shape = 'RECTANGLE'; af.size = 1.6; af.size_y = 0.8; af.energy = float(arg('--fill', 8))
    afo = bpy.data.objects.new('fillLight', af); afo.location = G((X0, 0.6, 0.55)); scene.collection.objects.link(afo)
    afo.visible_camera = False; afo.visible_glossy = False
    # warm downlights under the canopy (above both seats and the console)
    for k, (lx, lz) in enumerate(((0.0, 0.15), (1.10, 0.15), (0.55, -0.35))):
        dl = bpy.data.lights.new('downlight%d' % k, 'AREA'); dl.shape = 'RECTANGLE'; dl.size = 0.3; dl.size_y = 0.2; dl.energy = float(arg('--down', 22)); dl.color = (1.0, 0.72, 0.45)
        dlo = bpy.data.objects.new('downlight%d' % k, dl); dlo.location = G((lx, 0.575, lz)); scene.collection.objects.link(dlo)
        dlo.visible_camera = False; dlo.visible_glossy = False
    studio = bpy.data.worlds.new('studio'); studio.use_nodes = True
    studio.node_tree.nodes['Background'].inputs['Color'].default_value = (0.035, 0.038, 0.045, 1); studio.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    cam_d = bpy.data.cameras.new('cam'); cam = bpy.data.objects.new('cam', cam_d); scene.collection.objects.link(cam); scene.camera = cam
    cam_d.sensor_fit = 'VERTICAL'; cam_d.sensor_height = 24.0; cam_d.clip_start = 0.03; cam_d.clip_end = 100

    def d(yaw, pitch):
        y, p = math.radians(yaw), math.radians(pitch)
        return Vector((math.sin(y) * math.cos(p), math.sin(p), -math.cos(y) * math.cos(p)))
    SH = [  # n, name, eye, dir, up, vfov, (w, h), pano
        (1, 'default', (0, 0, 0), d(0, 5), (0, 1, 0), 65, (1280, 800), False),
        (2, 'up', (0, 0, 0), d(0, 75), (0, 1, 0), 65, (1280, 800), False),
        (3, 'down', (0, 0, 0), d(0, -35), (0, 1, 0), 65, (1280, 800), False),
        (4, 'left', (0, 0, 0), d(-70, -10), (0, 1, 0), 65, (1280, 800), False),
        (5, 'right', (0, 0, 0), d(60, -15), (0, 1, 0), 65, (1280, 800), False),
        (6, 'photo-match', (X0, 0.25, 0.90), d(0, -12), (0, 1, 0), float(arg('--fisheye', 160)), (800, 1280), True),
        (8, 'manual-zoom', (0, 0, 0), (Vector(wpos(IPF, (0, 0, 0.0252)))).normalized(), (0, 1, 0), 22, (1280, 800), False),
        (9, 'close-eyebrow', (0, 0, 0), Vector(wpos(EBF, (0.02, 0.0, 0.015))).normalized(), (0, 1, 0), 24, (1600, 800), False),
        (10, 'close-flightmode', (0, 0, 0), Vector(wpos(IPF, (0.0, FM_BC, 0.0087))).normalized(), (0, 1, 0), 18, (1600, 800), False),
        (11, 'feet', (0, 0, 0), d(0, -68), (0, 1, 0), 75, (1280, 800), False),
        (12, 'feet-left', (0, 0, 0), d(-35, -58), (0, 1, 0), 75, (1280, 800), False),
        (13, 'feet-right', (0, 0, 0), d(35, -58), (0, 1, 0), 75, (1280, 800), False),
        (14, 'over-shoulder', (0.55, -0.2, 0.45), d(180, -3), (0, 1, 0), 80, (1280, 800), False),
        (15, 'seat-close', (0.55, 0.0, 0.5), d(-35, -22), (0, 1, 0), 55, (1280, 800), False),
        (16, 'roof-aft', (0, 0, 0), d(180, 62), (0, 1, 0), 85, (1280, 800), False),
        (17, 'ip-right-end', (0, 0, 0), Vector(wpos(IPF, (0.88, -0.1, 0.0))).normalized(), (0, 1, 0), 30, (1280, 800), False),
        (7, 'overview', (-1.9, 1.15, 0.05), (Vector((0.55, -0.15, 0.05)) - Vector((-1.9, 1.15, 0.05))).normalized(), (0, 1, 0), 52, (1280, 800), False),
    ]
    t_all = time.time()
    for n, name, eye, dirv, up, fov, (rw, rh), pano in SH:
        if ONLY and n not in ONLY: continue
        scene.render.use_border = False
        if pano:   # a true circular fisheye: render square and crop the sides to the portrait frame (like the photo)
            scene.render.resolution_x, scene.render.resolution_y = rh, rh
            scene.render.use_border = True; scene.render.use_crop_to_border = True
            m_ = (rh - rw) / 2 / rh
            scene.render.border_min_x, scene.render.border_max_x = m_, 1 - m_
            scene.render.border_min_y, scene.render.border_max_y = 0.0, 1.0
        else:
            scene.render.resolution_x, scene.render.resolution_y = rw, rh
        if pano:
            cam_d.type = 'PANO'
            for obj in (cam_d, getattr(cam_d, 'cycles', None)):
                if obj is not None and hasattr(obj, 'panorama_type'):
                    obj.panorama_type = 'FISHEYE_EQUIDISTANT'
            cam_d.fisheye_fov = math.radians(fov) if hasattr(cam_d, 'fisheye_fov') else 0
            if hasattr(cam_d, 'cycles') and hasattr(cam_d.cycles, 'fisheye_fov'):
                cam_d.cycles.fisheye_fov = math.radians(fov)
        else:
            cam_d.type = 'PERSP'
            cam_d.lens = 12.0 / math.tan(math.radians(fov / 2))
        cam.location = G(eye)
        cam.rotation_euler = cam_basis(cam.location, Vector(G(Vector(dirv))), Vector(G(Vector(up))))
        hidden = []
        if n == 7:
            for nm in ('wall_L', 'ceiling', 'consoleL_outer'):
                bpy.data.objects[nm].hide_render = True; hidden.append(nm)
        if n == 8:
            bpy.data.objects['centreDisplay'].data.materials[0] = MATS['disp_centre_manual']
        if n == 6:
            bpy.data.objects['seatBacks'].hide_render = True; hidden.append('seatBacks')
        scene.world = studio if n == 7 else world
        scene.render.filepath = os.path.join(outdir, f'{n}-{name}.png')
        t = time.time()
        bpy.ops.render.render(write_still=True)
        if n == 8:
            bpy.data.objects['centreDisplay'].data.materials[0] = MATS['disp_centre']
        for nm in hidden:
            bpy.data.objects[nm].hide_render = False
        log('shot', scene.render.filepath, f'{time.time() - t:.0f}s')
    log(f'RENDER TOTAL {time.time() - t_all:.0f}s')

if RENDER:
    render_all(SHOTS)
log('done')
