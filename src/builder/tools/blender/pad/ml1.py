"""
LC-39B's Mobile Launcher 1 (SLS, Artemis): NASA's own model (github.com/nasa/NASA-3D-Resources, public domain, in the
repo as public/assets/nasa/mobile_launcher.glb), re-cut for the pad card:
  - scaled to the reference ship: across as the SLS core (8.4 m) becomes the ship's 2.5 m, so the ship fits the
    exhaust hole as the core does (ML-1 stays its real 5.7 x 4.9 D), up so the tower stands 1.10 H above the deck;
  - split into `base` (the two-storey platform on its pedestals, everything on the deck) and `tower` (the umbilical tower
    with its arms), so art.js scales the tower with the ship's height and leaves the platform alone;
  - attach_deck on the ship's axis at the deck top, attach_tower at the tower's foot.
Origin: the rocket's axis at the pedestals' feet (the hardstand), tower on +x (NASA's model already has it there).
"""
import bpy, bmesh, os, json
from mathutils import Vector
import padlib as P

SRC = os.path.join(P.HERE, '..', '..', '..', '..', '..', 'public', 'assets', 'nasa', 'mobile_launcher.glb')
DECK_U = 0.338      # the deck top in the model's units (measured: the platform's top slice)
HOLE_X_U = 0.20     # the exhaust hole's size along x in model units (the SLS core's direction)
TOWER_U = (0.293, 0.555)  # the tower's x span in model units
LOW_U = 0.08          # deck fittings lower than this (about 0.85 m at the reference size) stay with the platform


class Imported:
    def __init__(self, slug, anchor, scale, notes):
        self.slug, self.anchor, self.scale, self.notes = slug, anchor, scale, notes
        self.attach, self.extra = {}, {}
        self.root = None

    def build(self):
        return self.root


def ml1():
    P.C.reset()
    for im in list(bpy.data.images):
        if im.users == 0:
            bpy.data.images.remove(im)
    piece = Imported('ml1', 'rocket axis at the pedestals\' feet (the trench hardstand); tower on +x', {'base': 'D', 'tower': 'H+D'},
                     'mount = mlp at LC-39B (NASA ML-1). Scale tower.y to the 1.10 H rule; the base keeps its height.')
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(SRC))
    src = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
    # bake the file's 0.01 scale into the mesh: model units from here on
    src.data.transform(src.matrix_world)
    src.matrix_world.identity()
    sxz = 1.12 * P.REF_D / HOLE_X_U          # as the SLS core (8.4 m) over its 9.4 m hole: 14 m per unit
    sy = 1.1 * P.REF_H / (2.464 - DECK_U)    # the tower 1.10 H above the deck
    # cut the mesh at the deck (members that run through it are split there), then everything above the deck goes to
    # the tower except the low things standing on the deck (under about 0.85 m: railings, posts, hatches), which stay
    # with the platform; the platform must end at the deck
    bm = bmesh.new()
    bm.from_mesh(src.data)
    geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=(0, 0, DECK_U + 0.002), plane_no=(0, 0, 1))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-5)
    bm.faces.ensure_lookup_table()
    tower_faces = []
    for f in bm.faces:
        c = f.calc_center_median()
        if c.z > DECK_U + 0.003:
            hi = max(v.co.z for v in f.verts)
            if hi > DECK_U + LOW_U or c.x > TOWER_U[0] - 0.03:
                tower_faces.append(f)
    tower_set = {f.index for f in tower_faces}
    root = bpy.data.objects.new('ml1', None)
    bpy.context.scene.collection.objects.link(root)
    parts = {}
    for name, keep in (('base', lambda i: i not in tower_set), ('tower', lambda i: i in tower_set)):
        b2 = bm.copy()
        b2.faces.ensure_lookup_table()
        kill = [f for f in b2.faces if not keep(f.index)]
        bmesh.ops.delete(b2, geom=kill, context='FACES')
        loose = [v for v in b2.verts if not v.link_faces]
        bmesh.ops.delete(b2, geom=loose, context='VERTS')
        me = bpy.data.meshes.new('m_' + name)
        b2.to_mesh(me)
        b2.free()
        for m in src.data.materials:
            me.materials.append(m)
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)
        o.parent = root
        parts[name] = o
        if name == 'base':
            mod = o.modifiers.new('planar', 'DECIMATE')
            mod.decimate_type = 'DISSOLVE'
            mod.angle_limit = 0.0175  # 1 degree: only coplanar faces merge
            bpy.context.view_layer.objects.active = o
            o.select_set(True)
            bpy.ops.object.modifier_apply(modifier=mod.name)
            o.select_set(False)
    bm.free()
    bpy.data.objects.remove(src, do_unlink=True)
    # NASA's colour map is dark for the studio's lights: lift it toward ML-1's grey paint (a fixed curve, stable output)
    import numpy as np
    for im in bpy.data.images:
        if im.name.startswith('mobilelauncher') and im.size[0] > 0:
            px = np.array(im.pixels[:], dtype=np.float32).reshape(-1, 4)
            px[:, :3] = np.clip(px[:, :3] * 1.75 + 0.06, 0, 1)
            im.pixels.foreach_set(px.ravel())
            im.update()
            if im.file_format == 'JPEG' or not im.name.endswith('_o'):
                im.filepath_raw = os.path.join(P.TMP, im.name + ('.png' if im.file_format == 'PNG' else '.jpg'))
                im.save()
                im.pack()
    # scale: blender x, y across (game x, -z), z up. The tower's origin at its foot on the deck, so art.js can scale it
    deck_y = DECK_U * sy
    tx = (TOWER_U[0] + TOWER_U[1]) / 2
    for name, o in parts.items():
        me = o.data
        for v in me.vertices:
            v.co = Vector((v.co.x * sxz, v.co.y * sxz, v.co.z * sy))
        if name == 'tower':
            off = Vector((tx * sxz, 0, deck_y))
            for v in me.vertices:
                v.co -= off
            o.location = off
        me.update()
    base_top = max((v.co.z for v in parts['base'].data.vertices), default=0.0)
    print(f'[pad] ml1: platform top {base_top:.2f} m, deck {deck_y:.2f} m')
    assert base_top <= deck_y + 1.0, f'ml1: the platform reaches {base_top:.2f} m, above its deck {deck_y:.2f} m + 1 m'
    for nm, pos in (('attach_deck', (0, 0, deck_y)), ('attach_tower', (tx * sxz, 0, deck_y))):
        e = bpy.data.objects.new(nm, None)
        bpy.context.scene.collection.objects.link(e)
        e.parent = root
        e.location = pos
    piece.attach = {'deck': [0.0, round(deck_y, 3), 0.0], 'tower': [round(tx * sxz, 3), round(deck_y, 3), 0.0]}
    piece.extra = {'source': 'NASA 3D Resources: Mobile Launcher (public domain)', 'scale_xz_m_per_unit': round(sxz, 2), 'scale_y_m_per_unit': round(sy, 2)}
    root['pad'] = json.dumps({'slug': 'ml1', 'anchor': piece.anchor, 'scale': piece.scale, 'ref': {'H': P.REF_H, 'D': P.REF_D}, 'attach': piece.attach})
    piece.root = root
    return piece, {'ship': (0.0, deck_y, 0.0), 'frame': 9.0}


PIECES = {'ml1': ml1}
