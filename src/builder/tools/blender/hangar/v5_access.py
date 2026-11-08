"""Hangar v5 part "access" (access agent): getting people to the ship, visibly.

  node src/builder/tools/blender/hangar/v5lock.mjs blender -- "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup
       -P src/builder/tools/blender/hangar/build.py -- --v5 access [--bake] [--layout-only] --out public/assets/models/builder/hangar/v5

What it builds (all own geometry, Codex's additions_v4 style, baked by detail_v4.finish):
  access_stairtower_v5(_far)  fixed VAB stair tower against the -X tower, along the bl slot face (x -14..-9.2, z -2.65..-0.25):
                              blue W-columns, two 3 m flights per 6 m bay, landings with toe boards, double handrails,
                              red standpipes and a cable riser on the shaft face. Stacked ground..level 11.
  access_frstair_v5(_far)     straight double flight that rides on each fr deck segment (levels 01..10) just outside the
                              fr slot face, inside the open quarter, climbing towards the ship; blue corner post + red standpipe.
  access_crew_arm_v5          telescoping crew access arm: fixed truss bridge on the stair tower + sliding sleeve and
                              white room (windows, door, hatch seal, purge duct, cable trays). Node 'extend' slides on local +X.
The elevator group (shaft, zigzag stair_run flights, catwalk landings and their colliders) is mirrored to the front-right
corner with the base kit modules (all X-symmetric, so position x -> -x with the same rotation; never a negative scale).
--layout-only rewrites access.json from the existing GLB catalogue without modelling or baking.
"""
import math, json, os, sys, glob

BLUE = 0x426c8b
GLASS = 0x1f3440
LEVELS = [11 + 6 * i for i in range(11)]
# Fixed stair tower: centre and half sizes (world). Ship end at x=-9.2 carries the crew arm root.
TOWER_C = (-11.6, -1.45)
HX, HZ = 2.4, 1.2
# fr deck-riding stair: centre line x and its z stations (local = world at the closed pose, origin on the rocket axis).
FR_X = -0.8
# Crew arm root (world x, z), arm along +X. tip = extend.x + TIP; extension range keeps a sleeve overlap of >= 2.2 m.
ARM_ROOT = (-9.2, -1.1)
ARM_FIXED = 4.8
ARM_TIP = 2.5
ARM_EXT = (2.4, 6.6)
ARM_HALF = 0.9


def build(api):
    G = api['Geo']; start = api['start']; save = api['save']; marker = api['marker']; out = api['OUT']
    S = api['STEEL']; W = api['WHITE']; D = api['DARK']; Y = api['YELLOW']; R = api['RED']; DECK = api['DECK']
    catalog = api['catalog']

    # ------------------------------------------------------------------ helpers
    def abox(g, along_x, c, along, across, h, col):
        g.box((along, h, across) if along_x else (across, h, along), c, col)

    def far_rail(g, a, b, toe=True):
        """Distance copy: one broad top rail, a broad yellow toe band, end posts only (no sub-pixel members)."""
        ax, ay, az = a; bx, by, bz = b
        g.beam((ax, ay + 1.05, az), (bx, by + 1.05, bz), .09, W)
        if toe:
            g.beam((ax, ay + .09, az), (bx, by + .09, bz), .07, Y, .18)
        for x, y, z in (a, b):
            g.beam((x, y, z), (x, y + 1.08, z), .08, W)

    def flight(g, B, T, lat, w=1.0, far=False):
        """Steel stair flight from bottom nosing B to top landing edge T (centre line); lat = horizontal unit (lx, lz)."""
        bx, by, bz = B; tx, ty, tz = T
        n = max(2, round((ty - by) / .2)); rise = (ty - by) / n
        hx, hz = tx - bx, tz - bz; L = math.hypot(hx, hz); dx, dz = hx / L, hz / L; going = L / (n - 1)
        along_x = abs(dx) > .5; lx, lz = lat
        def P(s, y, o=0.0):
            return (bx + dx * s + lx * o, y, bz + dz * s + lz * o)
        for i in range(1, n):
            y = by + i * rise; s0 = (i - 1) * going
            if far:
                x, _, z = P(s0 + going / 2, 0); abox(g, along_x, (x, y - .03, z), going, w, .06, S)
            else:
                # Open bar grating tread: four bearing bars across the width plus a yellow nosing.
                for f in (.3, .55, .8):
                    x, _, z = P(s0 + going * f, 0); abox(g, along_x, (x, y - .025, z), .03, w, .045, S)
                x, _, z = P(s0 + .03, 0); abox(g, along_x, (x, y - .02, z), .05, w, .05, Y)
                for o in (-w / 2 + .02, w / 2 - .02):
                    x, _, z = P(s0 + going / 2, 0, o); abox(g, along_x, (x, y - .05, z), going, .03, .07, D)
        for side in (-1, 1):
            o = side * (w / 2 + .06)
            a = P(-going, by - .16, o); b = P(L, ty - .16, o)
            if far:
                g.beam(a, b, .12, D, .26)
                far_rail(g, P(0, by + rise, o), P(L, ty, o))
            else:
                g.channel(a, b, .22, D)
                g.rail(P(0, by + rise, side * (w / 2 + .03)), P(L, ty, side * (w / 2 + .03)))

    def landing(g, x0, x1, z0, z1, y, rails, far=False):
        """Bar grating landing on a channel frame; rails are (a, b) pairs given at deck level (they add toe boards)."""
        if far:
            g.box((x1 - x0, .08, z1 - z0), ((x0 + x1) / 2, y - .045, (z0 + z1) / 2), DECK)
        else:
            g.grating(x0, x1, z0, z1, y)
            for z in (z0, z1):
                g.channel((x0, y - .15, z), (x1, y - .15, z), .16, D)
            for x in (x0, x1):
                g.channel((x, y - .15, z0), (x, y - .15, z1), .16, D)
        for a, b in rails:
            far_rail(g, a, b) if far else g.rail(a, b)

    # ------------------------------------------------------------------ fixed stair tower (one 6 m bay)
    def stair_tower(far):
        name = 'access_stairtower_v5' + ('_far' if far else '')
        root = start(name); g = G()
        cx, cz = HX - .1, HZ - .1
        for x in (-cx, cx):
            for z in (-cz, cz):
                if far:
                    g.beam((x, 0, z), (x, 6, z), .28, BLUE)
                else:
                    g.ibeam((x, 0, z), (x, 6, z), .28, BLUE)
                    g.box((.46, .05, .46), (x, .025, z), D)
        # Flight A 0 -> 3 m rising towards the tower on the shaft side; flight B 3 -> 6 m back towards the ship.
        flight(g, (1.5, 0, -.6), (-1.5, 3, -.6), (0, 1), 1.0, far)
        flight(g, (-1.5, 3, .6), (1.5, 6, .6), (0, 1), 1.0, far)
        # Half landing against the -X tower, level landing at the ship end (+X), with a gate for the crew arm / deck.
        landing(g, -HX, -1.5, -HZ, HZ, 3, [((-HX, 3, -HZ), (-HX, 3, HZ)), ((-HX, 3, -HZ), (-1.5, 3, -HZ)), ((-HX, 3, HZ), (-1.5, 3, HZ))], far)
        landing(g, 1.5, HX, -HZ, HZ, 6, [((1.5, 6, -HZ), (HX, 6, -HZ)), ((HX, 6, -HZ), (HX, 6, -.5))], far)
        if not far:
            # X-bracing on the ship-end face below the level landing (the crew arm knee braces land here).
            for z0, z1 in ((-cz, cz), (cz, -cz)):
                g.angle((HX, .45, z0), (HX, 5.5, z1), .1, S)
            g.channel((HX, 2.9, -cz), (HX, 2.9, cz), .16, D)
        # Red standpipes and a cable riser on the shaft face, the face the consoles see.
        if far:
            g.pipe((-2.0, 0, -HZ - .24), (-2.0, 6, -HZ - .24), .13, R, 6)
            g.box((.5, 6, .14), (2.0, 3, -HZ - .2), W)
        else:
            g.pipe((-2.0, 0, -HZ - .24), (-2.0, 6, -HZ - .24), .11, R, 10)
            g.pipe((-1.62, 0, -HZ - .24), (-1.62, 6, -HZ - .24), .075, R, 8)
            for y in (.15, 5.85):
                g.pipe((-2.0, y - .04, -HZ - .24), (-2.0, y + .04, -HZ - .24), .17, R, 10)
            for y in (1.5, 4.5):
                g.box((.75, .09, .1), (-1.95, y, -HZ - .12), D)
            g.pipe((-2.0, 1.15, -HZ - .24), (-2.0, 1.15, -HZ - .62), .07, R, 8)
            g.box((.3, .3, .14), (-2.0, 1.15, -HZ - .68), R)
            for x in (1.74, 2.26):
                g.channel((x, 0, -HZ - .2), (x, 6, -HZ - .2), .09, W)
            for i in range(20):
                g.box((.5, .025, .05), (2.0, .15 + i * .3, -HZ - .25), S)
            for x, r in ((1.88, .04), (2.0, .05), (2.13, .035)):
                g.pipe((x, 0, -HZ - .17), (x, 6, -HZ - .17), r, D, 6)
            for y in (2.9, 5.85):
                g.box((.5, .07, .25), (2.0, y, -HZ - .08), D)
        g.mesh('body', root); save(name, root, True)

    # ------------------------------------------------------------------ fr deck-riding stair (authored at the closed pose)
    def fr_stair(far):
        name = 'access_frstair_v5' + ('_far' if far else '')
        root = start(name); g = G()
        x0, x1 = FR_X - .55, FR_X + .55
        rails0 = [((x0, 0, -13.95), (x0, 0, -12.95)), ((x0, 0, -13.95), (x1, 0, -13.95))]
        landing(g, x0, x1, -13.95, -12.95, 0, rails0, far)
        flight(g, (FR_X, 0, -12.95), (FR_X, 3, -9.75), (1, 0), 1.0, far)
        landing(g, x0, x1, -9.75, -8.75, 3, [((x0, 3, -9.75), (x0, 3, -8.75)), ((x1, 3, -9.75), (x1, 3, -8.75))], far)
        flight(g, (FR_X, 3, -8.75), (FR_X, 6, -5.55), (1, 0), 1.0, far)
        landing(g, x0, x1, -5.55, -4.95, 6, [((x0, 6, -5.55), (x0, 6, -4.95)), ((x0, 6, -4.95), (x1, 6, -4.95))], far)
        # Blue corner post (stacks into one column 11..71 m when the decks are closed) and a red standpipe.
        cx, cz = FR_X - .85, -14.15
        if far:
            g.beam((cx, 0, cz), (cx, 6, cz), .28, BLUE)
            g.pipe((cx - .38, 0, cz + .1), (cx - .38, 6, cz + .1), .12, R, 6)
        else:
            g.ibeam((cx, 0, cz), (cx, 6, cz), .28, BLUE)
            g.box((.46, .05, .46), (cx, .025, cz), D)
            g.pipe((cx - .38, 0, cz + .1), (cx - .38, 6, cz + .1), .1, R, 10)
            for y in (1.5, 4.5):
                g.box((.5, .08, .1), (cx - .2, y, cz + .1), D)
            g.pipe((cx - .38, .15, cz + .1), (cx - .38, .25, cz + .1), .15, R, 10)
            # Landing frames tie into the post; knee braces land on the deck's slot-face girder.
            g.channel((cx, -.15, cz), (x1, -.15, cz + .2), .16, D)
            for z, ya, yb in ((-13.45, -.1, -1.0), (-9.25, 2.88, -.9)):
                g.angle((x0 + .05, ya, z), (-.22, yb, z), .1, S)
            g.angle((x0 + .05, 5.88, -5.25), (-.22, 5.15, -5.25), .1, S)
            g.channel((cx, 2.85, cz), (x0, 2.85, -9.75), .12, D)
        g.mesh('body', root); save(name, root, True)

    # ------------------------------------------------------------------ crew access arm + white room
    def crew_arm():
        name = 'access_crew_arm_v5'
        root = start(name); marker(root, 'attach_root'); g = G()
        L, w = ARM_FIXED, .82; xs = [i * L / 4 for i in range(5)]
        g.grating(0, L, -.72, .72, 0)
        for z in (-w, w):
            g.channel((0, -.9, z), (L, -.9, z), .2, S)
            g.beam((0, 1.1, z), (L, 1.1, z), .07, W)
            g.beam((0, .55, z), (L, .55, z), .045, W)
            g.beam((0, .075, z), (L, .075, z), .05, Y, .15)
            for x in xs:
                g.angle((x, -.9, z), (x, 1.1, z), .08, S)
            for i, (a, b) in enumerate(zip(xs, xs[1:])):
                g.angle((a, -.85, z), (b, 1.05, z), .07, S) if i % 2 == 0 else g.angle((a, 1.05, z), (b, -.85, z), .07, S)
        for x in xs:
            g.beam((x, -.13, -w), (x, -.13, w), .1, D)
            g.beam((x, -.9, -w), (x, -.9, w), .08, D)
        for a, b in zip(xs, xs[1:]):
            g.beam((a, -.92, -w), (b, -.92, w), .045, S); g.beam((a, -.92, w), (b, -.92, -w), .045, S)
        # Slewing hinge at the tower and two knee braces down to the stair tower's ship-end face.
        g.pipe((.08, -1.25, 0), (.08, 1.55, 0), .16, D, 12)
        g.pipe((.08, -1.0, 0), (.08, -.75, 0), .24, Y, 12)
        for z in (-.6, .6):
            g.angle((.05, -3.3, z), (2.4, -.92, z * w / .6), .13, S)
        # Cable tray and purge / fire line along the arm.
        g.box((L, .04, .32), (L / 2, -.52, -1.03), W)
        for z in (-1.18, -.88):
            g.box((L, .12, .02), (L / 2, -.46, z), W)
        g.pipe((0, -.45, -1.03), (L, -.45, -1.03), .055, D, 6)
        g.pipe((0, -.45, -.96), (L, -.45, -.96), .035, D, 6)
        g.pipe((0, -.32, .98), (L, -.32, .98), .055, R, 8)
        for x in xs[1:]:
            g.box((.06, .3, .36), (x, -.55, -1.03), D)
        # Root landing inside the stair tower's ship-end column (between its level landings), so the arm can stop at
        # any height: the white-room floor sits ~1.1 m below the hatch. Top 3 cm under the arm floor (no z-fight when it
        # coincides with a tower landing).
        rx0, rx1, rz0, rz1 = -.9, -.05, -1.45, .75
        g.grating(rx0, rx1, rz0, rz1, -.03)
        for z in (rz0, rz1):
            g.channel((rx0, -.18, z), (rx1, -.18, z), .16, D)
        for x in (rx0, rx1):
            g.channel((x, -.18, rz0), (x, -.18, rz1), .16, D)
        g.rail((rx0, -.03, rz0 + .55), (rx0, -.03, rz1))
        g.rail((rx0, -.03, rz1), (rx1, -.03, rz1))
        g.rail((rx0 + .55, -.03, rz0), (rx1, -.03, rz0))
        g.mesh('fixed', root)
        # Caged ladder between the two tower landings around the arm height (posed by the sandbox: y = landing below,
        # Y scale = landing spacing / 6). Rungs face +Z, the cage hoops bulge to -Z (shaft side).
        lad = marker(root, 'ladder'); g = G()
        lx0, lx1, lz = -.72, -.22, -1.25
        for x in (lx0, lx1):
            g.channel((x, 0, lz), (x, 6, lz), .07, W)
        for i in range(20):
            g.pipe((lx0, .15 + i * .3, lz), (lx1, .15 + i * .3, lz), .02, S, 6)
        cx = (lx0 + lx1) / 2
        for y in (2.3, 3.3, 4.3, 5.3):
            for i in range(8):
                a = i * math.pi / 8; b = (i + 1) * math.pi / 8
                g.beam((cx + .36 * math.cos(a), y, lz - .36 * math.sin(a)), (cx + .36 * math.cos(b), y, lz - .36 * math.sin(b)), .025, Y)
        for a in (0, math.pi / 2, math.pi):
            g.beam((cx + .36 * math.cos(a), 2.3, lz - .36 * math.sin(a)), (cx + .36 * math.cos(a), 6, lz - .36 * math.sin(a)), .025, Y)
        g.mesh('ladder_body', lad)
        ext = marker(root, 'extend', (5.2, 0, 0)); g = G()
        # Telescoping sleeve walkway (rides on the fixed truss), then the white room at the tip.
        g.box((4.0, .07, 1.3), (-2.0, .045, 0), DECK)
        for z in (-.66, .66):
            g.rail((-4.0, .08, z), (0, .08, z))
            g.channel((-4.0, -.1, z * .9), (0, -.1, z * .9), .14, D)
            g.box((.32, .16, .18), (-3.8, -.1, z * 1.08), D)
        g.box((.3, .04, .5), (-2.0, -.17, -.62), W)
        g.pipe((-4.0, -.15, -.62), (0, -.15, -.62), .04, D, 6)
        h, hw = 2.5, ARM_HALF
        g.box((2.4, .1, 1.8), (1.2, .05, 0), DECK)
        for s in (-1, 1):
            z = s * hw
            g.box((2.4, 1.0, .06), (1.2, .5, z), W)
            g.box((2.4, .6, .06), (1.2, 2.2, z), W)
            for x in (.1, 1.2, 2.3):
                g.box((.2, .9, .06), (x, 1.45, z), W)
            for x in (.65, 1.75):
                g.box((.9, .9, .02), (x, 1.45, z), GLASS)
                g.box((.9, .05, .1), (x, 1.0, z + s * .02), D)
            g.box((2.4, .15, .02), (1.2, .075, z + s * .04), Y)
            # Exterior grab rail along each wall.
            g.beam((.2, 1.0, z + s * .12), (2.2, 1.0, z + s * .12), .04, Y)
            for x in (.2, 2.2):
                g.beam((x, 1.0, z + s * .05), (x, 1.0, z + s * .12), .035, Y)
        for s in (-1, 1):
            g.box((.06, h, .45), (0, h / 2, s * .675), W)
            g.box((.06, h, .4), (2.4, h / 2, s * .7), W)
            # Soft black hatch seal round the tip opening.
            g.box((.1, 2.0, .12), (2.45, 1.1, s * .56), D)
        g.box((.06, .4, .9), (0, 2.3, 0), W)
        g.box((.06, .4, 1.0), (2.4, 2.3, 0), W)
        g.box((.1, .12, 1.24), (2.45, 2.16, 0), D)
        g.box((.1, .08, 1.24), (2.45, .06, 0), D)
        g.box((2.5, .1, 1.9), (1.2, 2.55, 0), W)
        g.pipe((.15, 2.82, .45), (2.25, 2.82, .45), .16, W, 10)
        g.pipe((-.6, 2.82, .45), (.15, 2.82, .45), .12, W, 10)
        g.box((2.4, .06, .3), (1.2, 2.63, -.45), S)
        g.pipe((0, 2.7, -.45), (2.4, 2.7, -.45), .05, D, 6)
        marker(ext, 'attach_tip', (ARM_TIP, 0, 0))
        g.mesh('white_room', ext)
        save(name, root)

    layout_only = '--layout-only' in sys.argv
    frag_path = os.path.join(out, 'access.json')
    if layout_only:
        modules = json.load(open(frag_path, encoding='utf8')).get('modules', {})
    else:
        # Far copies and the thin ladder only need a 256 px atlas; this keeps the part under its 1.2 MB budget.
        # detail_v4 itself is untouched: its finish() is wrapped for this run only.
        detail = api['detail']; finish = detail.finish
        def small_far_atlas(ob, ident, out_dir, bake):
            finish(ob, ident, out_dir, bake)
            if '_far_' not in ident and not ident.endswith('_ladder_body'):
                return
            for node in ob.active_material.node_tree.nodes:
                im = getattr(node, 'image', None)
                if im is not None and im.name.startswith(ident) and im.size[0] > 256:
                    im.scale(256, 256); im.save()
        detail.finish = small_far_atlas
        try:
            stair_tower(False); stair_tower(True)
            fr_stair(False); fr_stair(True)
            crew_arm()
        finally:
            detail.finish = finish
        modules = {n: {**m, 'file': 'v5/' + m['file']} for n, m in catalog.items() if n.startswith('access_')}
        # GLBs embed their atlases; the external copies are reproducible, so drop our own.
        for f in glob.glob(os.path.join(out, 'textures', 'access_*')):
            os.remove(f)
    write_fragment(out, modules)


def write_fragment(out, modules):
    base = json.load(open(os.path.join(out, '..', 'layout.json'), encoding='utf8'))
    rnd = lambda v: [round(x, 4) for x in v]
    # Retract distance of the fr deck segment: follow the decks part if it has published it, else 6 m.
    retract, source = 6, 'default (decks.json had no fr retract yet)'
    try:
        decks = json.load(open(os.path.join(out, 'decks.json'), encoding='utf8'))
        for s in decks.get('segments', []):
            if s.get('id') == 'fr' and 'retracted' in s:
                retract, source = s['retracted'], 'decks.json segments.fr'
        for p in decks.get('placements', []):
            if p.get('segment') == 'fr' and p.get('dynamic') == 'wrapSegment' and 'retracted' in p and source.startswith('default'):
                retract, source = p['retracted'], 'decks.json fr placement'
    except (OSError, ValueError):
        pass

    hide, placements, colliders = [], [], []
    # 1. Elevator group: shaft, zigzag flights, landing bridges and return landings, mirrored to the front-right corner.
    group = [p for p in base['placements'] if p['module'] in ('elevator', 'stair_run') or
             (p['module'] == 'catwalk' and p['position'][0] < -15 and p['position'][2] < -8)]
    for p in group:
        hide.append(p['id'])
        q = {k: v for k, v in p.items()}
        q['id'] = 'access_m_' + p['id']; q['position'] = rnd([-p['position'][0], p['position'][1], p['position'][2]])
        placements.append(q)
    hide.append(next(p['id'] for p in base['placements'] if p['module'] == 'crew_arm'))
    hide += [p['id'] for p in base['wrap']['placements'] if p['module'] == 'wrap_stair_v4']
    for c in base['colliders']:
        if c['kind'] in ('elevator_landing', 'stairs') and c['center'][0] < -15:
            colliders.append({**c, 'center': rnd([-c['center'][0], c['center'][1], c['center'][2]])})
    hide_colliders = [{'kind': 'elevator_landing', 'region': {'min': [-18.5, -1, -10.5], 'max': [-15.5, 80, -8.5]}},
                      {'kind': 'stairs', 'region': {'min': [-20, -1, -13.5], 'max': [-16, 80, -11]}}]
    # Shaft walls (the +Z door side stays open) for the moved elevator.
    ex, ez = 17, -11
    for c, s in (((ex - 1.45, 37, ez), (.12, 74, 2.9)), ((ex + 1.45, 37, ez), (.12, 74, 2.9)), ((ex, 37, ez - 1.45), (2.9, 74, .12))):
        colliders.append({'kind': 'elevator', 'center': list(c), 'size': list(s)})

    # 2. Fixed stair tower: two 5.5 m ground bays (Y-scaled) then one 6 m bay per level up to level 11.
    bays = [(0.0, 11 / 12), (5.5, 11 / 12)] + [(float(y), 1.0) for y in LEVELS[:-1]]
    tx, tz = TOWER_C
    for i, (y, s) in enumerate(bays):
        placements.append({'id': f'access_stairtower_{i:02}', 'module': 'access_stairtower_v5', 'lod': 'access_stairtower_v5_far',
                           'position': [tx, y, tz], 'rotation': [0, 0, 0], 'scale': [1, round(s, 6), 1]})
        colliders.append({'kind': 'stairs', 'center': rnd([tx, y + 3 * s, tz]), 'size': rnd([3.0, 6 * s, 2.4]), 'decorative': True})
        colliders.append({'kind': 'landing', 'center': rnd([tx - (HX + 1.5) / 2, y + 3 * s - .06, tz]), 'size': rnd([HX - 1.5, .12, 2 * HZ])})
        colliders.append({'kind': 'landing', 'center': rnd([tx + (HX + 1.5) / 2, y + 6 * s - .06, tz]), 'size': rnd([HX - 1.5, .12, 2 * HZ])})

    # 3. fr deck-riding stairs, levels 01..10 (rising to 02..11): same dynamic/level/segment/axis/retracted as the fr deck.
    for l, y in enumerate(LEVELS[:-1]):
        ride = {'dynamic': 'wrapSegment', 'level': l, 'segment': 'fr', 'axis': [1, 0, 0], 'retracted': retract}
        placements.append({'id': f'access_frstair_{l:02}', 'module': 'access_frstair_v5', 'lod': 'access_frstair_v5_far',
                           'position': [0, y, 0], 'rotation': [0, 0, 0], 'scale': [1, 1, 1], **ride})
        for kind, c, s, dec in (('landing', (FR_X, y - .06, -13.45), (1.1, .12, 1.0), False), ('landing', (FR_X, y + 2.94, -9.25), (1.1, .12, 1.0), False),
                                ('landing', (FR_X, y + 5.94, -5.25), (1.1, .12, .6), False),
                                ('stairs', (FR_X, y + 1.5, -11.35), (1.2, 3.0, 3.2), True), ('stairs', (FR_X, y + 4.5, -7.15), (1.2, 3.0, 3.2), True)):
            col = {'kind': kind, 'center': rnd(c), 'size': list(s), 'dynamic': 'wrapSegment', 'level': l, 'segment': 'fr'}
            if dec:
                col['decorative'] = True
            colliders.append(col)

    # 4. Crew access arm (posed every frame by role1.hangar.access-v5.js poseCrew).
    placements.append({'id': 'access_crew_arm', 'module': 'access_crew_arm_v5', 'position': [ARM_ROOT[0], 35, ARM_ROOT[1]],
                       'rotation': [0, 0, 0], 'scale': [1, 1, 1], 'dynamic': 'crewArm'})

    frag = {
        'note': 'v5 part "access" (access agent). Generated by v5_access.py; do not edit by hand.',
        'modules': modules,
        'hidePlacements': hide,
        'placements': placements,
        'hideColliders': hide_colliders,
        'colliders': colliders,
        'elevator': {'position': [ex, 0, ez], 'stops': [0] + LEVELS, 'cabNode': 'pose_cab', 'doorFaces': '+Z', 'mirroredFrom': [-17, 0, -11]},
        'stairTower': {'centre': [tx, 0, tz], 'size': [2 * HX, 71, 2 * HZ], 'levelLanding': 'ship end (+X) at every level', 'groundEntry': [tx + 1.5, 0, tz - .6]},
        'frStairs': {'segment': 'fr', 'levels': list(range(10)), 'retracted': retract, 'retractSource': source},
        # Where people step from my stairs onto a deck through its slot-face rail (repeat at every level).
        # along = distance from the ship axis along that slot face (fr: along -Z, bl: along -X).
        'railGates': [
            {'segment': 'fr', 'along': 13.45, 'width': 1.1, 'what': 'fr deck stair, bottom landing (levels 01..10)'},
            {'segment': 'fr', 'along': 5.25, 'width': 0.7, 'what': 'fr deck stair, top landing onto the next level (levels 02..11)'},
            {'segment': 'bl', 'along': round(-(TOWER_C[0] + (HX + 1.5) / 2), 3), 'width': 1.0, 'what': 'stair tower level landing (levels 01..11)'},
        ],
        'crewArm': {'root': list(ARM_ROOT), 'hatchOffset': 1.1, 'landings': [0, 5.5] + LEVELS, 'ladderNode': 'ladder', 'ladderLength': 6, 'direction': [1, 0, 0], 'fixedLength': ARM_FIXED, 'tipLocal': ARM_TIP,
                    'extensionRange': list(ARM_EXT), 'halfWidth': ARM_HALF, 'cabinHeight': 2.5, 'extendNode': 'extend',
                    'note': 'tip x = root x + extend.x + tipLocal; floor = hatch - hatchOffset (snapped to a tower landing within 0.5 m), below the capsule top; ladder between the landings around the floor'},
    }
    with open(os.path.join(out, 'access.json'), 'w', encoding='utf8') as f:
        json.dump(frag, f, indent=1)
    print('[v5 access] wrote access.json:', len(placements), 'placements,', len(colliders), 'colliders, fr retract', retract, '(' + source + ')')
