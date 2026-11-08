"""
Shared helpers for Role 1's Blender part models (SpaceB&E builder). Read README.md in this folder first: it is the
contract every model must follow so it snaps onto the stack and the outer skin like the existing parts.

Run a model script headless (Windows):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/<section>/<script>.py -- --out public/assets/models/builder/<section>/<slug>.glb [--shots DIR]

Everything here works in GAME coordinates (metres, x right, y up, z toward the viewer) and converts once to Blender
(x, -z, y); the glTF exporter (+Y up) maps it back, the same trick as scripts/blender/rover.py.
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

# ------------------------------------------------------------------ arguments
ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default

# The game's three stack sizes (src/builder/assembly.js: BASE_RADIUS 1.25 x SIZE_SCALE 0.75 / 1 / 1.35)
RADIUS = {'s': 0.9375, 'm': 1.25, 'l': 1.6875}

def G(p):
    """game (x, y, z) -> blender (x, -z, y)"""
    return (p[0], -p[2], p[1])

# ------------------------------------------------------------------ scene
def reset():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for d in list(coll):
            if d.users == 0:
                coll.remove(d)
    bpy.context.scene.unit_settings.system = 'METRIC'

def root(name):
    """The model's root: an empty at the origin (axial parts: the base centre on the axis; radial: the mount point)."""
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    return e

def group(name, parent):
    """An empty used to group pieces, e.g. group('slot_cycle', root) for a kit slot's inner piece."""
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    return e

# ------------------------------------------------------------------ materials (glTF PBR)
_mats = {}
def mat(name, color, metal=0.0, rough=0.5, emissive=None, alpha=1.0):
    """A Principled BSDF material; color is (r, g, b) in 0..1 sRGB-ish. Reuse names to share materials."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*color, 1.0)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emissive:
        b.inputs['Emission Color'].default_value = (*emissive, 1.0)
        b.inputs['Emission Strength'].default_value = 1.0
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    _mats[name] = m
    return m

# Common finishes, tuned to read well under the studio lights (keep metalness moderate: no environment map)
def white_paint():   return mat('white_paint', (0.88, 0.89, 0.90), 0.05, 0.55)
def aluminium():     return mat('aluminium', (0.74, 0.76, 0.78), 0.5, 0.38)
def al_li():         return mat('al_li', (0.66, 0.67, 0.66), 0.5, 0.42)
def stainless():     return mat('stainless', (0.80, 0.81, 0.82), 0.6, 0.25)
def carbon():        return mat('carbon', (0.06, 0.065, 0.07), 0.2, 0.45)
def copper():        return mat('copper', (0.72, 0.42, 0.24), 0.8, 0.35)
def dark_metal():    return mat('dark_metal', (0.16, 0.17, 0.18), 0.6, 0.45)
def foam_orange():   return mat('foam_orange', (0.80, 0.42, 0.16), 0.0, 0.85)
def gold_foil():     return mat('gold_foil', (0.86, 0.66, 0.24), 0.8, 0.3)
def ablator():       return mat('ablator', (0.33, 0.24, 0.17), 0.0, 0.9)

# ------------------------------------------------------------------ meshes
def _obj(name, bm, material, parent):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if parent is not None:
        o.parent = parent
    for p in me.polygons:
        p.use_smooth = True
    return o

def lathe(name, profile, material, parent=None, segments=64, cap_top=False, cap_bottom=False, x=0.0, z=0.0):
    """
    A surface of revolution round the game y axis. profile: [(r, y), ...] in game metres, bottom to top.
    Use it for tanks with domes, bells, cones, capsules, skirts. Normals are made consistent outward.
    """
    bm = bmesh.new()
    rings = []
    for (r, y) in profile:
        ring = []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            ring.append(bm.verts.new(G((x + r * math.cos(a), y, z - r * math.sin(a)))))
        rings.append(ring)
    for j in range(len(rings) - 1):
        for i in range(segments):
            a, b = rings[j][i], rings[j][(i + 1) % segments]
            c, d = rings[j + 1][(i + 1) % segments], rings[j + 1][i]
            try:
                bm.faces.new((a, b, c, d))
            except ValueError:
                pass
    if cap_bottom and profile[0][0] > 1e-4:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top and profile[-1][0] > 1e-4:
        bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(name, bm, material, parent)

def cylinder(name, r, y0, y1, material, parent=None, segments=48, x=0.0, z=0.0, caps=True):
    return lathe(name, [(r, y0), (r, y1)], material, parent, segments, caps, caps, x, z)

def ring(name, r, y, width, depth, material, parent=None, segments=64):
    """A ring frame / band on the outside of a cylinder of radius r: `width` tall (y), `depth` proud of the wall."""
    return lathe(name, [(r, y - width / 2), (r + depth, y - width / 2), (r + depth, y + width / 2), (r, y + width / 2)], material, parent, segments)

def box(name, size, center, material, parent=None):
    """An axis-aligned box: size (sx, sy, sz) and center (x, y, z) in game metres."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        gx, gy, gz = v.co.x * size[0] + center[0], v.co.y * size[1] + center[1], v.co.z * size[2] + center[2]
        v.co = Vector(G((gx, gy, gz)))
    return _obj(name, bm, material, parent)

def stringers(name, r, y0, y1, count, width, depth, material, parent=None):
    """Vertical hat stringers round a cylinder (one mesh)."""
    bm = bmesh.new()
    for i in range(count):
        a = 2 * math.pi * i / count
        c, s = math.cos(a), -math.sin(a)
        t = (-s, c)  # tangent in (x, z)
        corners = []
        for (dr, dt) in ((0, -width / 2), (depth, -width / 2), (depth, width / 2), (0, width / 2)):
            rx, rz = (r + dr) * c + dt * t[0], (r + dr) * s + dt * t[1]
            corners.append((rx, rz))
        lo = [bm.verts.new(G((px, y0, pz))) for (px, pz) in corners]
        hi = [bm.verts.new(G((px, y1, pz))) for (px, pz) in corners]
        for k in range(4):
            bm.faces.new((lo[k], lo[(k + 1) % 4], hi[(k + 1) % 4], hi[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(name, bm, material, parent)

def bevel(obj, width=0.01, segments=2, angle_deg=40):
    """An angle-limited bevel, applied (keeps edges from looking razor sharp)."""
    m = obj.modifiers.new('bevel', 'BEVEL')
    m.width, m.segments, m.limit_method = width, segments, 'ANGLE'
    m.angle_limit = math.radians(angle_deg)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=m.name)
    obj.select_set(False)

# ------------------------------------------------------------------ checks and export
def stats(root_obj):
    """(triangles, bbox_min, bbox_max) of everything under root, in GAME coordinates."""
    deps = bpy.context.evaluated_depsgraph_get()
    tris, lo, hi = 0, [1e9] * 3, [-1e9] * 3
    for o in [root_obj] + list(root_obj.children_recursive):
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(deps)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        for v in me.vertices:
            w = o.matrix_world @ v.co
            g = (w.x, w.z, -w.y)
            for k in range(3):
                lo[k], hi[k] = min(lo[k], g[k]), max(hi[k], g[k])
        ev.to_mesh_clear()
    return tris, lo, hi

def export(root_obj, out, max_tris=20000, expect_height=None, expect_radius=None):
    """Checks the contract (height, base radius, triangle budget), then writes a Draco-compressed GLB."""
    tris, lo, hi = stats(root_obj)
    print(f'[model] {os.path.basename(out)}: {tris} triangles, x {lo[0]:.3f}..{hi[0]:.3f}, y {lo[1]:.3f}..{hi[1]:.3f}, z {lo[2]:.3f}..{hi[2]:.3f}')
    if tris > max_tris:
        print(f'[model] WARNING: {tris} triangles is over the budget of {max_tris}')
    if expect_height is not None and abs(hi[1] - expect_height) > 0.02 * expect_height + 0.01:
        print(f'[model] WARNING: top at y {hi[1]:.3f}, the part is {expect_height} m tall')
    if expect_radius is not None and abs(max(hi[0], -lo[0]) - expect_radius) > 0.04 * expect_radius + 0.02:
        print(f'[model] note: widest x {max(hi[0], -lo[0]):.3f} vs the stack radius {expect_radius} (fine if it has rings or fittings)')
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root_obj] + list(root_obj.children_recursive):
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(out), export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14, export_draco_normal_quantization=10, export_draco_texcoord_quantization=12,
        export_materials='EXPORT', export_cameras=False, export_lights=False, export_extras=True,
    )
    size = os.path.getsize(os.path.abspath(out))
    print(f'[model] wrote {out} ({size / 1024:.0f} KB)')
    if size > 400 * 1024:
        print('[model] WARNING: over the 400 KB budget')
    return tris, size

def render_preview(path, height=4.0, radius=1.25, res=640):
    """A quick EEVEE picture from a 3/4 view, to compare with the reference photos."""
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = res
    scene.render.film_transparent = True
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    d = max(height, radius * 2) * 1.9
    cam.location = G((d * 0.75, height * 0.6, d * 0.75))
    target = Vector(G((0, height * 0.45, 0)))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    world = scene.world or bpy.data.worlds.new('w')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    scene.render.filepath = os.path.abspath(path)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(sun, do_unlink=True)
