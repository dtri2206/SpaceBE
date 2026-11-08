"""Hangar v5 part "decks": the 270-degree wrap decks, their tracks and the decks fragment JSON.

Run (one Blender at a time, through the lock):
  node src/builder/tools/blender/hangar/v5lock.mjs blender -- "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup
       -P src/builder/tools/blender/hangar/build.py -- --v5 decks [--bake] --out public/assets/models/builder/hangar/v5

One quadrant module (deck_quad_v5 + deck_quad_v5_far) authored in the fr quadrant: x 0..14, z -14..0.
In this file s = -z, so the quadrant is x 0..14, s 0..14 and the notch is the disc x^2+s^2 < 36.
Local edge A runs along +X (s = 0), local edge B along -Z (x = 0). Placed 11 levels x 3 segments with
three.js Y rotations fr 0 / br 270 / bl 180; per-segment opt_* nodes pick the edge treatment:
  fr  A = seam with br (plain joint)          B = slot face   -> opt_edgeB_slot, opt_cornercut
  br  A = seam with bl (owns the cover)       B = seam with fr (owns the cover) -> opt_edgeA_seam, opt_edgeB_seam, opt_corner
  bl  A = slot face                           B = seam with br (plain joint) -> opt_edgeA_slot, opt_corner
The fr segment has no outer front-right corner (x, s in [8, 14]): retracted 6.5 m along +X it would
otherwise cut through the elevator tower that moves to (17, 0, -11).
Never writes layout.json; reads it only to hide the old under-platform lamps.
"""
import bpy, math, json, os

R = 6.0            # notch radius; the smooth collar band (sandbox) fills hull..R
HALF = 14.0        # square outer boundary
CUT = 8.0          # outer corner x, s in [CUT, HALF] lives in opt_corner / opt_cornercut
RETRACT = 6.5      # clears any outline up to 6.5 m (the notch is 6 m)
LEVELS = [11 + 6 * i for i in range(11)]
SEGMENTS = [
    dict(id='fr', arc=[0, 90], rotation=0, slideAxis=[1, 0, 0], showNodes=['opt_edgeB_slot', 'opt_cornercut']),
    dict(id='br', arc=[270, 360], rotation=270, slideAxis=[0, 0, 1], showNodes=['opt_edgeA_seam', 'opt_edgeB_seam', 'opt_corner']),
    dict(id='bl', arc=[180, 270], rotation=180, slideAxis=[-1, 0, 0], showNodes=['opt_edgeA_slot', 'opt_corner']),
]
# Edge roles (brief table). A seam is covered by exactly one node, owned by br.
SEAMS = [
    dict(id='fr|br', angle=0, owner='br', node='opt_edgeB_seam', joint=['fr', 'A']),
    dict(id='br|bl', angle=270, owner='br', node='opt_edgeA_seam', joint=['bl', 'B']),
]
SLOT_FACES = [dict(segment='fr', edge='B', angle=90, node='opt_edgeB_slot'), dict(segment='bl', edge='A', angle=180, node='opt_edgeA_slot')]
BAKED = {'body', 'opt_edgeA_slot', 'opt_edgeB_slot', 'opt_corner'}
DT = .03             # deck top: 3 cm above the level so retracted decks never share a plane with the tower catwalks
# Rail gates on the slot faces (stair step-off points from the access part), as (u0, u1) metres from the ship axis
# along the slot line, identical at every level. Edge B is fr's slot face (-Z axis), edge A is bl's (-X axis).
GATES = {'B': [], 'A': []}

TOP = 0x9aa4a5       # light grey deck plate, as in the NASA cutaway
BEAMC = 0x98a4a8     # under-deck beam paint (light grey, painted metalness, so the undersides read from the floor)
UNDER = 0x7a868a     # plate underside / edges (lifted: the player mostly sees undersides)
RAILC = 0xc6cdcc     # handrails
YEL = 0xe0a722       # NASA safety yellow I-beams and toe boards
ORANGE = 0xc2512c    # orange-red electrical panels
TRAY = 0xb9c0bf
COVER = 0x77817f


def build(api):
    G = api['Geo']; C = api['C']; rgb = api['rgb']
    STEEL = api['STEEL']; WHITE = api['WHITE']; DARK = api['DARK']; BLUE = 0x426c8b
    out = api['OUT']
    # Stair step-off points come from the access part's fragment (railGates: segment, along = metres from the ship
    # axis along the slot line, width). Read-only; rerun this script when they change.
    try:
        access = json.load(open(os.path.join(out, 'access.json'), encoding='utf8'))
        for gate in access.get('railGates', []):
            edge = {'fr': 'B', 'bl': 'A'}.get(gate['segment'])
            if edge: GATES[edge].append((round(gate['along'] - gate['width'] / 2, 3), round(gate['along'] + gate['width'] / 2, 3)))
    except (OSError, ValueError, KeyError) as error:
        print('[v5 decks] no rail gates from access.json:', error)
    print('[v5 decks] rail gates', GATES)

    def P(x, y, s):
        return (x, y, -s)

    def solid(g, verts, faces, colors, metal=.28):
        """Geo.solid with one colour per face (verts in game coordinates)."""
        i = len(g.v); g.v.extend([C.G(v) for v in verts]); g.f.extend([tuple(i + j for j in f) for f in faces])
        g.col.extend([rgb(c) for c in colors]); g.surface.extend([metal] * len(faces))

    def prism(g, poly, y0, y1, top=TOP, rest=UNDER):
        """Closed plate from a polygon of (x, s) points."""
        n = len(poly)
        verts = [P(x, y0, s) for x, s in poly] + [P(x, y1, s) for x, s in poly]
        faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        solid(g, verts, faces, [rest, top] + [rest] * n)

    def outside(p):
        return p[0] * p[0] + p[1] * p[1] >= R * R - 1e-9

    def circle_cut(a, b):
        if abs(a[0] - b[0]) < 1e-9:
            x = a[0]; return (x, math.sqrt(max(0, R * R - x * x)))
        s = a[1]; return (math.sqrt(max(0, R * R - s * s)), s)

    def clip(x0, x1, s0, s1):
        """Panel rectangle minus the notch disc; None when wholly inside the notch."""
        rect = [(x0, s0), (x1, s0), (x1, s1), (x0, s1)]
        flags = [outside(p) for p in rect]
        if all(flags): return rect
        if not any(flags): return None
        k = flags.index(True); rect = rect[k:] + rect[:k]; flags = flags[k:] + flags[:k]
        poly = []
        for i in range(4):
            a, b = rect[i], rect[(i + 1) % 4]
            if flags[i]: poly.append(a)
            if flags[i] and not flags[(i + 1) % 4]:
                poly.append(circle_cut(a, b)); exit_at = len(poly) - 1
            elif not flags[i] and flags[(i + 1) % 4]:
                p = circle_cut(a, b)
                f0 = math.atan2(poly[exit_at][1], poly[exit_at][0]); f1 = math.atan2(p[1], p[0])
                steps = max(1, math.ceil(abs(f1 - f0) / math.radians(3)))
                for k2 in range(1, steps):
                    f = f0 + (f1 - f0) * k2 / steps; poly.append((R * math.cos(f), R * math.sin(f)))
                poly.append(p)
        clean = []
        for q in poly:
            if not clean or abs(q[0] - clean[-1][0]) + abs(q[1] - clean[-1][1]) > 1e-6: clean.append(q)
        while len(clean) > 2 and abs(clean[0][0] - clean[-1][0]) + abs(clean[0][1] - clean[-1][1]) <= 1e-6: clean.pop()
        return clean

    def ishape(depth, flange, tf, tw):
        d, f = depth / 2, flange / 2
        return [(-f, -d), (f, -d), (f, -d + tf), (tw / 2, -d + tf), (tw / 2, d - tf), (f, d - tf), (f, d), (-f, d), (-f, d - tf), (-tw / 2, d - tf), (-tw / 2, -d + tf), (-f, -d + tf)]

    def girder(g, a, b, depth, flange, col, far, ytop=-.06):
        """I-beam (near) or box (far) between two (x, s) points with its top flange at ytop."""
        y = ytop - depth / 2
        pa, pb = P(a[0], y, a[1]), P(b[0], y, b[1])
        if far: g.beam(pa, pb, flange, col, depth)
        else: g.profile(pa, pb, ishape(depth, flange, max(.018, depth * .045), max(.012, depth * .025)), 1, col)

    def sweep(g, pts, shape, col):
        """Profile swept along a path of game-coordinate points (shared rings, no per-segment caps)."""
        from mathutils import Vector
        n = len(shape); verts = []
        for i, p in enumerate(pts):
            a = Vector(pts[max(0, i - 1)]); b = Vector(pts[min(len(pts) - 1, i + 1)])
            t = (b - a).normalized(); u = t.cross(Vector((0, 1, 0))).normalized(); v = t.cross(u).normalized()
            verts.extend([tuple(Vector(p) + u * x + v * y) for x, y in shape])
        faces = [tuple(reversed(range(n))), tuple(range((len(pts) - 1) * n, len(pts) * n))]
        for i in range(len(pts) - 1):
            for j in range(n):
                faces.append((i * n + j, i * n + (j + 1) % n, (i + 1) * n + (j + 1) % n, (i + 1) * n + j))
        solid(g, verts, faces, [col] * len(faces), .28)

    def rail(g, a, b, inward, far, toe=True, gaps=()):
        """Double handrail with posts and a toe board along the edge a->b ((x, s) points on the edge line).
        gaps: (d0, d1) distances from a along the run left open as gates, each closed by an end post."""
        ax, as_ = a; bx, bs = b; L = math.hypot(bx - ax, bs - as_)
        ix, is_ = inward
        post = .075 if far else .05; rw = .075 if far else .045
        spacing = 3.0 if far else 1.6
        off = .06
        runs, d = [], 0.0
        for g0, g1 in sorted((max(0, a0), min(L, a1)) for a0, a1 in gaps if a1 > 0 and a0 < L):
            if g0 - d > .05: runs.append((d, g0))
            d = max(d, g1)
        if L - d > .05: runs.append((d, L))
        at = lambda dist, o: (ax + (bx - ax) * dist / L + ix * o, as_ + (bs - as_) * dist / L + is_ * o)
        for d0, d1 in runs:
            n = max(1, math.ceil((d1 - d0) / spacing))
            for i in range(n + 1):
                x, s = at(d0 + (d1 - d0) * i / n, off); g.box((post, 1.10, post), P(x, DT + .55, s), RAILC)
            pa, pb = at(d0, off), at(d1, off)
            for h in (1.07, .53):
                g.beam(P(pa[0], DT + h, pa[1]), P(pb[0], DT + h, pb[1]), rw, RAILC)
            if toe:
                t0, t1 = at(d0, .025), at(d1, .025)
                g.beam(P(t0[0], DT + .055, t0[1]), P(t1[0], DT + .055, t1[1]), .03 if far else .02, YEL, .11)

    def lamp(g, lens, x, s, along_x, far):
        size = (1.1, .1, .3) if along_x else (.3, .1, 1.1)
        g.box(size, P(x, -.47, s), DARK)
        if not far:
            for d in (-.42, .42):
                g.box((.04, .14, .04), P(x + (d if along_x else 0), -.37, s + (0 if along_x else d)), DARK)
        lsize = (.9, .025, .18) if along_x else (.18, .025, .9)
        lens.box(lsize, P(x, -.53, s), WHITE)

    def tray(g, a, b, far):
        """Cable tray hung under the joists; a, b are (x, s) on its centreline."""
        ax, as_ = a; bx, bs = b; L = math.hypot(bx - ax, bs - as_); dx, ds = (bx - ax) / L, (bs - as_) / L; nx, ns = -ds, dx
        y = -.5
        if far:
            g.beam(P(ax, y, as_), P(bx, y, bs), .6, TRAY, .12); return
        for side in (-.3, .3):
            g.beam(P(ax + nx * side, y, as_ + ns * side), P(bx + nx * side, y, bs + ns * side), .03, TRAY, .12)
        for k in range(int(L / .6) + 1):
            x = ax + dx * k * .6; s = as_ + ds * k * .6
            g.beam(P(x - nx * .3, y - .05, s - ns * .3), P(x + nx * .3, y - .05, s + ns * .3), .03, TRAY, .02)
        for side, col in ((-.15, DARK), (0, 0x3a3f3c), (.12, 0x4b3a33)):
            g.beam(P(ax + nx * side, y - .02, as_ + ns * side), P(bx + nx * side, y - .02, bs + ns * side), .07, col, .05)
        for k in range(int(L / 2.4) + 1):  # hanger rods
            x = ax + dx * k * 2.4; s = as_ + ds * k * 2.4
            for side in (-.3, .3): g.box((.025, .1, .025), P(x + nx * side, -.43, s + ns * side), DARK)

    def cabinet(g, x, s, w, h, d, along_x, col=WHITE, far=False):
        size = (w, h, d) if along_x else (d, h, w)
        g.box(size, P(x, h / 2, s), col)
        if not far:
            g.box((size[0] + .06, .08, size[2] + .06), P(x, .04, s), DARK)  # plinth
            g.box((size[0] * .9 if along_x else size[0] + .01, .05, size[2] + .01 if along_x else size[2] * .9), P(x, h * .8, s), 0x8f9897)  # vent band

    def panel(g, x, s, facing_x, far):
        """Orange-red electrical panel on a short stand, facing the walkway."""
        size = (.14, 1.5, .7) if facing_x else (.7, 1.5, .14)
        g.box(size, P(x, .95, s), ORANGE)
        if not far:
            for yy in (.55, .85, 1.15):
                g.box((.16, .05, .5) if facing_x else (.5, .05, .16), P(x, yy + .1, s), 0x7a2f1d)
            g.box((.06, .2, .06), P(x, .1, s), DARK)

    # ------------------------------------------------------------------ the quadrant module
    def deck(far):
        name = 'deck_quad_v5_far' if far else 'deck_quad_v5'
        root = api['start'](name)
        api['marker'](root, 'attach_slide'); api['marker'](root, 'segment_deck')
        meshes = {}

        # body: plate, beam grid, ring, joints, outer edges, lamps, trays, equipment
        g = G(); lens = G()
        for ix in range(7):
            for js in range(7):
                x0, s0 = ix * 2, js * 2
                if x0 >= CUT and s0 >= CUT: continue
                poly = clip(x0, x0 + 2, s0, s0 + 2)
                if poly: prism(g, poly, -.06, DT)
        # Secondary joists along s (I-beams .35 deep); primaries along x (.8 deep); deep girders on the corner lines.
        for x in (2, 4, 6, 8, 10, 12):
            s0 = math.sqrt(max(0, R * R - x * x)) + (.05 if x < R else .3)
            s1 = 13.6 if x < CUT else CUT
            girder(g, (x, s0), (x, s1), .35, .16, BEAMC, far)
        for s in (3.5,):
            girder(g, (math.sqrt(R * R - s * s) + .05, s), (13.6, s), .35, .16, BEAMC, far)
        girder(g, (.36, 12.0), (CUT, 12.0), .35, .16, BEAMC, far)
        for s, x1 in ((1.5, 13.75), (6.0, 13.75), (10.5, CUT), (13.75, CUT)):
            x0 = math.sqrt(max(0, R * R - s * s)) + .05 if s < R else .36
            girder(g, (x0, s), (x1, s), .8, .3, BEAMC, far)
        girder(g, (13.75, .36), (13.75, CUT), .8, .3, BEAMC, far)          # outer edge toward the tower
        girder(g, (CUT, CUT), (CUT, 13.75), .8, .3, BEAMC, far)             # corner lines (edge girders on fr)
        girder(g, (CUT, CUT), (13.75, CUT), .8, .3, BEAMC, far)
        # Joint girders just inside edges A and B (every segment; the slot fascia sits outside them).
        girder(g, (.5, R), (.5, 13.75), .6, .26, BEAMC, far)
        girder(g, (R, .5), (13.75, .5), .6, .26, BEAMC, far)
        # Curved yellow I-beam ring under the notch edge (concentric with the collar fascia).
        arc = [P((R + .16) * math.cos(math.radians(a)), -.43, (R + .16) * math.sin(math.radians(a))) for a in [i * 3 for i in range(31)]]
        sweep(g, arc, [(-.16, -.37), (.16, -.37), (.16, .37), (-.16, .37)] if far else ishape(.74, .32, .035, .02), YEL)
        # Bogies on the two carriage primaries (they ride the deck_track_v5 rails, top at y -1.06).
        for s in (1.5, 6.0):
            for x in (13.05, 13.7):
                g.box((.5, .2, .4), P(x, -.96, s), DARK)
                if not far:
                    for dx in (-.2, .2): g.pipe(P(x + dx, -1.0, s - .24), P(x + dx, -1.0, s + .24), .055, 0x2a3034, 8)
        # Outer edges toward the towers / rear (rails, toe boards).
        rail(g, (HALF, 0), (HALF, CUT), (-1, 0), far)
        rail(g, (0, HALF), (CUT, HALF), (0, -1), far)
        # Under-deck lamps: rows parallel to both inner edges and a few in the field.
        for v in (7.5, 10.0, 12.7):
            lamp(g, lens, 1.25, v, False, far); lamp(g, lens, v, 1.25, True, far)
        for v in (8.75, 11.25):  # second rows under both inner edges
            lamp(g, lens, 3.0, v - 1.15 if v < 10 else v, False, far); lamp(g, lens, v, 3.0, True, far)
        for x, s in ((4.2, 10.2), (10.2, 4.2), (7.0, 7.0)):
            lamp(g, lens, x, s, True, far)
        tray(g, (7.0, .7), (7.0, CUT - .2), far)
        tray(g, (.7, 9.0), (CUT - .2, 9.0), far)
        # Deck-top equipment near the outer edges; the slot walkways stay clear.
        cabinet(g, 12.95, 2.7, 1.2, 1.1, .65, False, far=far)
        panel(g, 13.55, 4.5, True, far)
        cabinet(g, 13.05, 6.2, .8, .75, .6, False, far=far)
        cabinet(g, 2.7, 12.95, 1.2, 1.1, .65, True, far=far)
        panel(g, 4.6, 13.55, False, far)
        cabinet(g, 6.3, 13.05, .8, .75, .6, True, far=far)
        if not far:
            for x, s in ((13.4, 1.2), (1.2, 13.4)):  # small grey junction boxes on the posts
                g.box((.3, .4, .2), P(x, .75, s), 0x6d7778)
        meshes['body'] = g.mesh('body', root)
        meshes['lens'] = lens.mesh('lens', root, True)

        # Slot faces: deep yellow I-beam fascia with stiffeners, double rail, toe board.
        for edge in ('A', 'B'):
            g = G()
            def E(u, w):  # u along the edge (6..14), w inward from the edge line
                return (w, u) if edge == 'B' else (u, w)
            a, b = E(R, .16), E(HALF, .16)
            g.profile(P(a[0], -.53, a[1]), P(b[0], -.53, b[1]), ishape(.94, .32, .035, .02), 1, YEL)
            step = 2.0 if far else 1.0
            u = R + .5
            while u < HALF - .2:
                c = E(u, .08); g.box((.016, .86, .13) if edge == 'A' else (.13, .86, .016), P(c[0], -.53, c[1]), YEL)
                if not far:
                    c2 = E(u, .24); g.box((.016, .86, .13) if edge == 'A' else (.13, .86, .016), P(c2[0], -.53, c2[1]), YEL)
                u += step
            inward = (1, 0) if edge == 'B' else (0, 1)
            rail(g, E(R, 0), E(HALF, 0), inward, far, gaps=[(u0 - R, u1 - R) for u0, u1 in GATES[edge]])
            if not far:  # kick-plate brackets and a grey cap strip on the plate edge
                a2, b2 = E(R, .03), E(HALF, .03)
                g.beam(P(a2[0], DT + .006, a2[1]), P(b2[0], DT + .006, b2[1]), .06, 0x8a9394, .012)
            meshes['opt_edge' + edge + '_slot'] = g.mesh('opt_edge' + edge + '_slot', root)
        # Seam cover plates (br owns both; fr's edge A and bl's edge B stay bare joints).
        for edge in ('A', 'B'):
            g = G()
            def E2(u, w):
                return (w, u) if edge == 'B' else (u, w)
            a, b = E2(R, 0), E2(HALF, 0)
            g.beam(P(a[0], DT + .006, a[1]), P(b[0], DT + .006, b[1]), .4, COVER, .012)
            if not far:
                u = R + .5
                while u < HALF:
                    for w in (-.14, .14):
                        c = E2(u, w); g.box((.05, .02, .05), P(c[0], DT + .015, c[1]), 0x5d6664)
                    u += 1.0
            meshes['opt_edge' + edge + '_seam'] = g.mesh('opt_edge' + edge + '_seam', root)
        # Outer corner (br, bl) and the cut-corner rails (fr).
        g = G()
        for x0 in (8, 10, 12):
            for s0 in (8, 10, 12):
                prism(g, [(x0, s0), (x0 + 2, s0), (x0 + 2, s0 + 2), (x0, s0 + 2)], -.06, DT)
        for x in (10, 12):
            girder(g, (x, CUT + .15), (x, 13.6), .35, .16, BEAMC, far)
        girder(g, (CUT + .15, 12.0), (13.6, 12.0), .35, .16, BEAMC, far)
        for s in (10.5, 13.75):
            girder(g, (CUT + .15, s), (13.75, s), .8, .3, BEAMC, far)
        girder(g, (13.75, CUT + .15), (13.75, 13.75), .8, .3, BEAMC, far)
        rail(g, (HALF, CUT), (HALF, HALF), (-1, 0), far)
        rail(g, (CUT, HALF), (HALF, HALF), (0, -1), far)
        cabinet(g, 12.6, 12.95, 1.2, 1.1, .65, True, far=far)
        panel(g, 13.55, 10.8, True, far)
        tray(g, (CUT + .2, 9.0), (13.3, 9.0), far)
        meshes['opt_corner'] = g.mesh('opt_corner', root)
        g = G()
        rail(g, (HALF, CUT), (CUT, CUT), (0, -1), far)
        rail(g, (CUT, CUT), (CUT, HALF), (-1, 0), far)
        meshes['opt_cornercut'] = g.mesh('opt_cornercut', root)
        save(name, root, meshes)

    # ------------------------------------------------------------------ the fixed track (kit)
    def track():
        name = 'deck_track_v5'; root = api['start'](name); g = G()
        for s in (1.5, 6.0):
            g.profile(P(12.3, -1.34, s), P(21.2, -1.34, s), ishape(.42, .28, .025, .016), 1, STEEL)
            g.box((8.9, .07, .08), P(16.75, -1.095, s), 0x5b6264)                # rail head, top at -1.06
            for x in (12.45, 21.05):                                              # end stops
                g.box((.25, .3, .32), P(x, -.93, s), YEL)
                g.box((.26, .1, .33), P(x, -.93, s), DARK)
        for x in (14.45, 19.55):                                                  # cross girders on the tower
            g.beam(P(x, -1.8, .2), P(x, -1.8, 9.2), .3, BLUE, .6)
            for s in (3.0, 9.0):
                g.box((.3, .5, .3), P(x + (-.2 if x < 17 else .2), -1.8, s), DARK)  # clips to the columns
            for s in (1.5, 6.0):
                g.box((.4, .1, .4), P(x, -1.5, s), DARK)                           # bearing plates
        for s in (1.5, 6.0):                                                       # cable festoon / energy chain
            g.beam(P(13.0, -1.12, s + .45), P(21.0, -1.12, s + .45), .14, 0x2c3236, .06)
        meshes = {'body': g.mesh('body', root)}
        save(name, root, meshes, kit=True)

    def save(name, root, meshes, kit=False):
        bpy.context.view_layer.update()
        bake = '--bake' in api['sys'].argv
        for node, ob in meshes.items():
            if node in BAKED:
                api['detail'].finish(ob, name + '_' + node, out, bake)
                # Budget: only the deck bodies keep 512 px atlases; edges, corner and track bake down to 256 px.
                if node != 'body' or kit:
                    for tex in ob.data.materials[0].node_tree.nodes:
                        im = getattr(tex, 'image', None)
                        if im and im.name.startswith(name + '_' + node) and im.size[0] > 256:
                            im.scale(256, 256)
                            try: im.save(quality=85)
                            except TypeError: im.save()
            elif node == 'lens':
                me = ob.data; me.materials.clear()
                m = bpy.data.materials.new('deck_v5_lens'); m.use_nodes = True; m.use_backface_culling = True
                b = m.node_tree.nodes.get('Principled BSDF')
                b.inputs['Base Color'].default_value = (.85, .93, 1, 1); b.inputs['Roughness'].default_value = .4
                b.inputs['Emission Color'].default_value = (.86, .94, 1, 1); b.inputs['Emission Strength'].default_value = 1.9
                me.materials.append(m)
                for attr in list(me.color_attributes): me.color_attributes.remove(attr)
            else:
                me = ob.data
                if 'Surface' in me.color_attributes: me.color_attributes.remove(me.color_attributes['Surface'])
                m = me.materials[0]
                if m.name.startswith('hangar_steel'):
                    m.name = 'deck_v5_paint'
                    b = m.node_tree.nodes.get('Principled BSDF'); b.inputs['Metallic'].default_value = .25; b.inputs['Roughness'].default_value = .62
        tris, lo, hi = C.stats(root); assert tris <= 60000, (name, tris)
        file = ('kit/' if kit else '') + name + '.glb'
        _, size = C.export(root, os.path.join(out, file), max_tris=60000); assert size <= 4 * 1024 * 1024
        api['catalog'][name] = {'file': 'v5/' + file, 'triangles': tris, 'bytes': size, 'bounds': {'min': lo, 'max': hi}}

    deck(False); deck(True); track()

    # ------------------------------------------------------------------ fragment
    layout = json.load(open(os.path.join(out, '..', 'layout.json'), encoding='utf8'))
    lamps = [p['id'] for p in layout['placements'] if p['module'] == 'lamp' and p['position'][1] < 75]

    def rot(x, z, deg):
        a = math.radians(deg); return (x * math.cos(a) + z * math.sin(a), -x * math.sin(a) + z * math.cos(a))

    placements = []; colliders = []
    for l, y in enumerate(LEVELS):
        for s in SEGMENTS:
            placements.append({'id': f"deck_{l:02}_{s['id']}", 'module': 'deck_quad_v5', 'lod': 'deck_quad_v5_far', 'position': [0, y, 0],
                               'rotation': [0, s['rotation'], 0], 'scale': [1, 1, 1], 'dynamic': 'wrapSegment', 'level': l,
                               'segment': s['id'], 'axis': s['slideAxis'], 'retracted': RETRACT})
            placements.append({'id': f"deck_track_{l:02}_{s['id']}", 'module': 'deck_track_v5', 'position': [0, y, 0],
                               'rotation': [0, s['rotation'], 0], 'scale': [1, 1, 1]})
            boxes = [(10, -4, 8, 8), (4, -10, 8, 8)] + ([] if s['id'] == 'fr' else [(11, -11, 6, 6)])
            for x, z, w, d in boxes:
                cx, cz = rot(x, z, s['rotation']); sw, sd = (d, w) if s['rotation'] % 180 else (w, d)
                colliders.append({'kind': 'deck_v5', 'center': [round(cx, 4), round(y + DT - .12, 4), round(cz, 4)], 'size': [sw, .24, sd],
                                  'dynamic': 'wrapSegment', 'level': l, 'segment': s['id']})
    fragment = {
        'version': 5, 'part': 'decks',
        'notes': 'Hangar v5 wrap decks: one quadrant module (fr authoring) x 11 levels x 3 segments; smooth collar bands are drawn by sandbox/role1.hangar.decks-v5.js with collarSmooth.mjs.',
        'modules': api['catalog'],
        'placements': placements,
        'hideModules': ['wrap_deck_v4', 'wrap_deck_v4_far', 'wrap_track_v4'],
        'hidePlacements': lamps,
        'segments': [{'id': s['id'], 'arc': s['arc'], 'rotation': s['rotation'], 'slideAxis': s['slideAxis'], 'retracted': RETRACT,
                      'module': 'deck_quad_v5', 'lod': 'deck_quad_v5_far', 'seamCoverIds': [], 'showNodes': s['showNodes']} for s in SEGMENTS],
        'seams': SEAMS, 'slotFaces': SLOT_FACES,
        'openSector': {'center': 135, 'width': 90, 'direction': [-0.7071, 0, -0.7071]},
        'collar': {'notchRadius': R, 'outerRadius': R + .04, 'clearance': .25, 'slideLimits': [.35, R], 'ML_TOP': 7,
                   'sampleStep': 1.5, 'fineStep': 1, 'probeDepth': .3, 'fasciaDepth': .45, 'toeHeight': .13,
                   'slotBeam': {'depth': .94, 'flange': .32, 'top': -.06}, 'rail': {'offset': .06, 'top': 1.07, 'mid': .53,
                            'gates': {'fr': [list(g) for g in GATES['B']], 'bl': [list(g) for g in GATES['A']]}}, 'deckTop': DT},
        'dropV4WrapColliders': True,
        'colliders': colliders,
    }
    with open(os.path.join(out, 'decks.json'), 'w', encoding='utf8') as f:
        json.dump(fragment, f, separators=(',', ':'))
    print('[v5 decks] fragment:', len(placements), 'placements,', len(colliders), 'colliders,', len(lamps), 'old lamps hidden')
    for k, v in api['catalog'].items(): print('[v5 decks]', k, v['triangles'], 'tris', v['bytes'], 'bytes')
