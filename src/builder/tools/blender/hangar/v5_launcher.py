"""Hangar v5 part "launcher": a scaled NASA mobile launcher base, seen from the front-left diagonal.

Run (through the lock, from the repo root):
  node src/builder/tools/blender/hangar/v5lock.mjs blender -- "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/hangar/build.py -- --v5 launcher --bake --out public/assets/models/builder/hangar/v5

Game coordinates, metres, origin on the floor at the rocket axis. Contract kept from the original mobile_launcher:
footprint +-8 m, top deck at Y = 7 with `attach_deck` at [0, 7, 0]. Nothing rises above Y 7.4 within r < 6.5 m of
the axis (ships are up to ~6 m in outline radius with boosters); the script measures this on every face and stores
it in launcher.json.

Design (decided with the lead from the human's brief):
- a two-storey steel box (Y 2.2..7) on six pedestals, with stiffened panels, storey belt, doors, louvres,
  umbilical plates, pipe risers, hazard stripes and a deck-edge railing with toe boards;
- the FRONT-LEFT corner (it faces the console bank) is a 45-degree hero face 6.8 m from the axis. Cutting the corner
  keeps the deck edge as close to the ship as the 6.5 m clearance allows, so far more of the ship's base shows from
  the consoles, and it gives the bank a facade square to its view. A switch-back stair climbs that face from the
  floor to the deck (floor -> upper-storey door -> deck), with lamps; no front cut-out blocks;
- low tail-service masts, white boxes, orange-red panels and red standpipes on the deck edge, all outside r = 6.5.
Writes only launcher_ml_v5.glb and launcher.json; deletes its own baked atlas copies afterwards (the GLB embeds them).
"""
import bpy, math, json, os, sys, glob

NAME = 'launcher_ml_v5'
TOP, BOT, MID = 7.0, 2.2, 4.6        # deck, underside of the box, storey belt
H = 7.75                             # box half-width; proud details stay inside +-8.05
CH = 9.62                            # hero chamfer: x + z = -CH (6.80 m from the axis)
R_CLEAR, Y_CLEAR = 6.5, 7.4          # contract: nothing above Y_CLEAR inside R_CLEAR
S2 = math.sqrt(.5)

PANEL, STIFF, COPE = 0xb4bcbd, 0x8d999d, 0x5b6a70
DOOR, FRAME, GLASS, RECESS = 0x7d8c91, 0x45535a, 0x18242a, 0x1c262a
CONCRETE, PED, ORANGE, BLUEP, GREYP, STRIPE = 0x6b716f, 0x7a8588, 0xb44a2c, 0x3d6585, 0x8a9497, 0x202427
CABINET = 0xc4cbc9


def frame(ox, oz, deg):
    """Local (a, y, c) -> world. Local +X = (cos, 0, -sin), local +Z = (sin, 0, cos) (a proper Y rotation)."""
    co, si = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return lambda p: (ox + p[0] * co + p[2] * si, p[1], oz - p[0] * si + p[2] * co)


def build(api):
    G, C, start, marker, out = api['Geo'], api['C'], api['start'], api['marker'], api['OUT']
    S, W, D, DK, Y, RD = api['STEEL'], api['WHITE'], api['DARK'], api['DECK'], api['YELLOW'], api['RED']
    detail, catalog = api['detail'], api['catalog']
    bake = '--bake' in sys.argv

    def view(g, f):
        """A Geo that writes into g through the transform f (all Geo helpers end in solid())."""
        class X(G):
            def solid(self, verts, faces, color):
                G.solid(self, [f(v) for v in verts], faces, color)
        x = X(); x.v, x.f, x.col, x.surface = g.v, g.f, g.col, g.surface
        return x

    def prism(g, poly, y0, y1, col):
        n = len(poly); verts = [(x, y, z) for y in (y0, y1) for x, z in poly]
        g.solid(verts, [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)], col)

    def quad_prism(g, q, c0, c1, col):
        """Prism of a 2D quad (a, y) between local depths c0 and c1."""
        verts = [(x, y, c) for c in (c0, c1) for x, y in q]
        g.solid(verts, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], col)

    def hazard(g, x0, x1, y0, y1, c=0., pitch=.44):
        """Yellow band with 45-degree dark stripes, proud of the local surface z = c (outward is -z)."""
        if x1 - x0 < .2: return
        g.box((x1 - x0, y1 - y0, .03), ((x0 + x1) / 2, (y0 + y1) / 2, c - .015), Y)
        h, wd, s = y1 - y0, pitch / 2, x0 + .04
        while s + wd + h <= x1 - .04:
            quad_prism(g, [(s, y0), (s + wd, y0), (s + wd + h, y1), (s + h, y1)], c - .03, c - .041, STRIPE)
            s += pitch

    # ------------------------------------------------------------------ wall features (framed geos)
    def door(g, lg, x, y0, h=2.05, lamp=None):
        g.box((1.0, h, .04), (x, y0 + h / 2, -.02), DOOR)
        for dx in (-.56, .56): g.box((.12, h + .1, .13), (x + dx, y0 + (h + .1) / 2, -.065), FRAME)
        g.box((1.24, .1, .13), (x, y0 + h + .05, -.065), FRAME)
        g.box((.3, .42, .012), (x + .18, y0 + h * .72, -.046), GLASS)
        g.box((.07, .22, .06), (x - .34, y0 + h * .48, -.07), S)
        g.box((.88, .24, .012), (x, y0 + .16, -.046), S)
        g.box((.46, .11, .012), (x - .1, y0 + h * .88, -.046), Y)          # small sign plate
        if lamp is not None:                                              # wall pack beside the door
            lx, ly = lamp
            g.box((.34, .2, .2), (lx, ly, -.1), D)
            lg.box((.26, .03, .14), (lx, ly - .11, -.11), 0xffffff)

    def louvre(g, x, yc, w=1.3, h=.86):
        g.box((w, h, .012), (x, yc, -.006), RECESS)
        for dx in (-w / 2, w / 2): g.box((.08, h + .08, .1), (x + dx, yc, -.05), FRAME)
        for dy in (-h / 2, h / 2): g.box((w + .08, .08, .1), (x, yc + dy, -.05), FRAME)
        shape = [(-.015, -.04), (-.1, .04), (-.1, .022), (-.015, -.058)]   # (local z, -dy): sloped rain slats
        for i in range(int(h / .11)):
            yy = yc - h / 2 + .09 + i * .11
            g.profile((x - w / 2 + .04, yy, 0), (x + w / 2 - .04, yy, 0), shape, 1, GREYP)

    def umbilical(g, x, yc):
        g.box((1.05, .78, .06), (x, yc, -.03), D)
        g.box((1.05, .07, .065), (x, yc + .46, -.035), Y)
        cols = [S, Y, BLUEP, RD, S, BLUEP]
        for i, (dx, dy) in enumerate([(dx, dy) for dy in (.17, -.17) for dx in (-.32, 0, .32)]):
            g.pipe((x + dx, yc + dy, -.06), (x + dx, yc + dy, -.2), .062, cols[i], 8)
            g.box((.2, .2, .03), (x + dx, yc + dy, -.07), FRAME)

    def panel(g, x, yc, w=.86, h=.86):
        g.box((w, h, .035), (x, yc, -.0175), 0x838e91)
        g.box((w * .5, .05, .05), (x, yc - h * .3, -.05), FRAME)
        for dx in (-w / 2 + .06, w / 2 - .06):
            for dy in (-h / 2 + .06, h / 2 - .06): g.box((.05, .05, .05), (x + dx, yc + dy, -.05), FRAME)

    def riser(g, x, col, y0=.02, y1=TOP - .25):
        g.pipe((x, y0, -.32), (x, y1, -.32), .075, col, 8)
        y = BOT + .5
        while y < y1:
            g.box((.08, .07, .3), (x, y, -.16), FRAME); y += 1.25
        g.pipe((x, y1, -.32), (x, y1, 0), .075, col, 8)

    def pipes(g, x0, x1, ys=(6.42, 6.62)):
        for y, col in zip(ys, (BLUEP, GREYP)): g.pipe((x0, y, -.24), (x1, y, -.24), .06, col, 8)
        x = x0 + .4
        while x < x1:
            g.box((.06, ys[-1] - ys[0] + .2, .06), (x, sum(ys) / 2, -.17), FRAME); x += 1.6

    def face(g, lg, L, feats, door_gaps=(), with_pipes=True):
        """One wall: local x in [-L/2, L/2], wall surface at z = 0, outward -z, Y absolute."""
        # bottom hazard band, skipping doorways on the lower storey
        cuts = sorted(door_gaps); x = -L / 2
        for a, b in cuts: hazard(g, x, a, BOT + .02, BOT + .34); x = b
        hazard(g, x, L / 2, BOT + .02, BOT + .34)
        g.box((L + .04, .2, .16), (0, MID, -.08), D)                       # storey belt
        g.box((L + .06, .06, .21), (0, MID + .13, -.105), COPE)
        g.box((L + .1, .2, .22), (0, TOP - .08, -.09), COPE)               # deck-edge coping
        g.box((L + .02, .05, .1), (0, BOT + .02, -.05), FRAME)             # bottom edge angle
        busy = []
        for kind, x, storey, *rest in feats:
            w = {'door': 1.3, 'louvre': 1.45, 'umbilical': 1.2, 'panel': 1.0, 'riser': .3, 'cabinet': .6}[kind]
            busy.append((x - w / 2 - .06, x + w / 2 + .06, storey))
        n = max(2, round(L / 1.12))
        for i in range(1, n):
            x = -L / 2 + i * L / n
            for st, (y0, y1) in enumerate(((BOT + .36, MID - .1), (MID + .2, TOP - .18))):
                if any(a <= x <= b and (s == st or s == 'all') for a, b, s in busy): continue
                g.box((.1, y1 - y0, .07), (x, (y0 + y1) / 2, -.035), STIFF)
        for kind, x, storey, *rest in feats:
            base = BOT if storey == 0 else MID
            if kind == 'door': door(g, lg, x, base, *rest)
            elif kind == 'louvre': louvre(g, x, base + 1.25)
            elif kind == 'umbilical': umbilical(g, x, base + 1.2)
            elif kind == 'panel': panel(g, x, base + 1.2)
            elif kind == 'riser': riser(g, x, rest[0])
            elif kind == 'cabinet': g.box((.5, .72, .2), (x, base + 1.0, -.1), RD); g.box((.38, .5, .012), (x, base + 1.04, -.205), 0x7c2a22)
        if with_pipes: pipes(g, -L / 2 + .3, L / 2 - .3)

    # ------------------------------------------------------------------ geometry
    root = start(NAME)
    shell, base, stairs, deck, lamps, reds = G(), G(), G(), G(), G(), G()
    K = CH - H                                   # 1.87: the hero face runs from (-H, -K) to (-K, -H)
    hero = frame(-CH / 2, -CH / 2, 45)           # local x runs to the front (viewer's left), local +z into the box
    walls = {'hero': (hero, (2 * H - CH) * math.sqrt(2)), 'front': (frame((H - K) / 2, -H, 0), H + K),
             'left': (frame(-H, (H - K) / 2, 90), H + K), 'right': (frame(H, 0, 270), 2 * H), 'back': (frame(0, H, 180), 2 * H)}

    # Core: the two-storey box as one closed pentagonal prism (square minus the front-left corner).
    poly = [(-H, -K), (-K, -H), (H, -H), (H, H), (-H, H)]
    prism(shell, poly, BOT, TOP, PANEL)
    for x, z in poly: shell.box((.24, TOP - BOT, .24), (x * .985, (TOP + BOT) / 2, z * .985), COPE)

    # Hero face: centre door on the lower storey, upper door on the stair landing, two pipe risers.
    side_feats = [('louvre', -2.7, 0), ('umbilical', .3, 0), ('louvre', 3.1, 0), ('panel', -2.9, 1), ('louvre', .2, 1), ('panel', 3.0, 1)]
    hero_feats = [('door', .18, 0, 2.0, (1.0, BOT + 1.65)), ('umbilical', -2.35, 0), ('louvre', 2.55, 0), ('cabinet', -1.2, 0),
                  ('door', -2.8, 1, 1.95, (-1.95, MID + 1.6)), ('louvre', 1.65, 1), ('panel', 3.05, 1),
                  ('riser', 3.8, 'all', RD), ('riser', -3.8, 'all', BLUEP)]
    big_feats = [('louvre', -5.2, 0), ('umbilical', -2.6, 0), ('louvre', 0, 0), ('panel', 2.6, 0), ('louvre', 5.2, 0),
                 ('louvre', -4.2, 1), ('panel', -1.4, 1), ('panel', 1.4, 1), ('louvre', 4.2, 1)]
    for key, (f, L) in walls.items():
        g, lg = view(shell, f), view(lamps, f)
        if key == 'hero': face(g, lg, L, hero_feats, door_gaps=[(.18 - .66, .18 + .66)], with_pipes=False)
        elif key == 'front': face(g, lg, L, side_feats)
        elif key == 'left': face(g, lg, L, [(k, -x, s, *r) for k, x, s, *r in side_feats])   # mirror image of the front
        else: face(g, lg, L, big_feats)

    # Pedestals (mount mechanisms) and the girders under the box. Symmetric about the viewing diagonal.
    peds = [(-1.7, -6.3), (-6.3, -1.7), (6.3, -6.3), (-6.3, 6.3), (6.3, 6.3), (2.6, 2.6)]
    for px, pz in peds:
        base.box((2.2, .3, 2.2), (px, .15, pz), CONCRETE)
        for deg, (ox, oz) in ((0, (px, pz - 1.1)), (90, (px - 1.1, pz)), (180, (px, pz + 1.1)), (270, (px + 1.1, pz))):
            hazard(view(base, frame(ox, oz, deg)), -1.08, 1.08, .03, .27, 0, .4)
        base.box((1.3, 1.5, 1.3), (px, 1.05, pz), PED)
        for dx in (-.62, .62):
            for dz in (-.62, .62): base.box((.18, 1.5, .18), (px + dx, 1.05, pz + dz), D)
        for dx, dz in ((0, -.66), (0, .66), (-.66, 0), (.66, 0)):
            base.box((.5 if dx else .06, 1.2, .06 if dx else .5), (px + dx * 1.05, 1.0, pz + dz * 1.05), FRAME)
        base.box((1.9, .14, 1.9), (px, 1.87, pz), D)
        base.box((1.45, .19, 1.45), (px, 2.105, pz), S)
    for a, b in [((-6.3, 6.3), (6.3, 6.3)), ((6.3, 6.3), (6.3, -6.3)), ((-6.3, 6.3), (-6.3, -1.7)), ((6.3, -6.3), (-1.7, -6.3)),
                 ((-6.3, -1.7), (-1.7, -6.3)), ((2.6, 2.6), (6.3, 6.3)), ((2.6, 2.6), (-6.3, -1.7)), ((2.6, 2.6), (-1.7, -6.3))]:
        base.ibeam((a[0], 1.98, a[1]), (b[0], 1.98, b[1]), .42, D)
    # Soffit lamps under the hero edge glow on the floor below the stair.
    hb = view(base, hero); hl = view(lamps, hero)
    for a in (-2.6, 2.6):
        hb.box((1.3, .08, .26), (a, BOT - .05, .55), D); hl.box((1.15, .02, .16), (a, BOT - .1, .55), 0xffffff)

    # ------------------------------------------------------------------ hero stair (local frame of the hero face)
    st, sl = view(stairs, hero), view(lamps, hero)
    OUT_B, IN_B = (-2.08, -1.1), (-1.06, -.07)          # outer and inner bands (local z), 1.0 m flights

    def flight(a0, a1, y0, y1, band, rails=((True, None), (True, None))):
        n = round((y1 - y0) / .2); run = (a1 - a0) / n; c0, c1 = band
        for i in range(1, n):
            a, y = a0 + i * run, y0 + i * (y1 - y0) / n
            st.box((abs(run) + .04, .045, c1 - c0 - .08), (a + run / 2, y - .022, (c0 + c1) / 2), S)
            st.box((.05, .05, c1 - c0 - .08), (a, y - .02, (c0 + c1) / 2), Y)                  # yellow nosing
        s0 = .14 / ((y1 - y0) / abs(a1 - a0)) if y0 < .1 else 0          # floor flight: stringer starts on the floor
        for c in (c0 + .04, c1 - .04): st.channel((a0 + (s0 if a1 > a0 else -s0), y0 + (.1 if y0 < .1 else -.14), c), (a1, y1 - .14, c), .2, D)
        for (on, skip), c in zip(rails, (c0 + .04, c1 - .04)):
            if not on: continue
            if skip is None: st.rail((a0, y0, c), (a1, y1, c)); continue
            for p, q in ((a0, skip[0]), (skip[1], a1)):
                yp = y0 + (y1 - y0) * (p - a0) / (a1 - a0); yq = y0 + (y1 - y0) * (q - a0) / (a1 - a0)
                if abs(q - p) > .3: st.rail((p, yp, c), (q, yq, c))

    def landing(poly2, y, rails):
        prism(st, poly2, y - .14, y, DK)
        for (a, c), (b, d) in zip(poly2, poly2[1:] + poly2[:1]):
            st.beam((a, y - .2, c), (b, y - .2, d), .1, D, .14)                                     # edge channels
        for p, q in rails: st.rail((p[0], y, p[1]), (q[0], y, q[1]))

    # floor -> upper-storey landing (outer band), then landing -> deck (inner band, against the wall)
    flight(2.36, -2.2, 0, MID, OUT_B, rails=((True, None), (True, (.85, -.5))))
    flight(-2.2, .2, MID, TOP, IN_B)
    L_poly = [(-2.2, -.04), (-2.2, -2.08), (-2.42, -2.08), (-3.42, -1.08), (-3.42, -.04)]
    landing(L_poly, MID, [((-2.42, -2.04), (-3.42, -1.08)), ((-3.42, -1.08), (-3.42, -.1))])
    S_poly = [(-.45, -.04), (-.45, -1.1), (.8, -1.1), (.8, -.04)]
    landing(S_poly, BOT, [((-.45, -1.1), (-.45, -.1)), ((.8, -1.1), (.8, -.1))])
    T_poly = [(.2, 0), (.2, -1.08), (1.32, -1.08), (1.32, 0)]
    landing(T_poly, TOP, [((.2, -1.04), (1.32, -1.04)), ((1.32, -1.04), (1.32, -.05))])
    for a, c in ((-2.42, -2.0), (-3.38, -1.08)): st.ibeam((a, 0, c), (a, MID - .14, c), .16, D)       # landing posts
    for a in (-.45, .8): st.ibeam((a, 0, -1.08), (a, BOT - .14, -1.08), .14, D)
    for a in (.3, 1.22):                                                                           # top landing knee braces
        st.beam((a, TOP - 1.1, .02), (a, TOP - .2, -1.0), .1, D)
    # Lamp post on the top landing and a stair light on the landing post.
    st.pipe((1.28, TOP, -1.04), (1.28, TOP + 1.45, -1.04), .045, D, 8)
    st.box((.36, .18, .3), (1.28, TOP + 1.5, -.92), D); sl.box((.3, .03, .24), (1.28, TOP + 1.4, -.9), 0xffffff)
    st.pipe((-3.3, MID, -.95), (-3.3, MID + 1.55, -.95), .04, D, 8)
    st.box((.26, .16, .22), (-3.3, MID + 1.6, -.85), D); sl.box((.2, .03, .16), (-3.3, MID + 1.51, -.83), 0xffffff)

    # ------------------------------------------------------------------ deck top
    deck.box((1.9, .012, 1.9), (0, TOP + .006, 0), 0x0d1113)                                       # exhaust opening
    for i in range(7): deck.box((.045, .03, 1.86), (-.81 + i * .27, TOP + .02, 0), D)
    for dx, dz, sx, sz in ((0, -1.03, 2.22, .16), (0, 1.03, 2.22, .16), (-1.03, 0, .16, 1.9), (1.03, 0, .16, 1.9)):
        deck.box((sx, .016, sz), (dx, TOP + .008, dz), Y)
    for k in range(-6, 7, 2):                                                                      # plate seams
        lo = max(-H + .1, -CH - k + .25)
        for x0, x1 in (((lo, -1.15), (1.15, H - .1)) if abs(k) < 1.2 else ((lo, H - .1),)):
            if x1 - x0 > .3:
                deck.box((x1 - x0, .01, .04), ((x0 + x1) / 2, TOP + .005, k), 0x4a585e)
                deck.box((.04, .01, x1 - x0), (k, TOP + .005, (x0 + x1) / 2), 0x4a585e)
    for x, z in ((3.6, 3.6), (-3.6, 3.6), (3.6, -3.6)):                                             # flush service hatches
        deck.box((1.0, .014, 1.0), (x, TOP + .007, z), 0x6a7a80)
        deck.box((.16, .02, .06), (x, TOP + .01, z - .3), D)
    # Deck-edge railing with toe boards; the hero edge leaves a gap where the stair arrives.
    E = H - .25; Kc = CH - .2 * math.sqrt(2) - E          # rail line inset .25 from the sides, .2 from the hero face
    P = [(-E, -Kc), (-Kc, -E), (E, -E), (E, E), (-E, E)]
    for a, b in zip(P[1:], P[2:] + P[:1]): deck.rail((a[0], TOP, a[1]), (b[0], TOP, b[1]))
    hd = view(deck, hero); ae = (E - Kc) * S2
    for a0, a1 in ((-ae, .12), (1.4, ae)): hd.rail((a0, TOP, .2), (a1, TOP, .2))
    # Floodlight poles at the five corners, aimed at the ship; red obstruction lights on top.
    for x, z in [(-7.15, -1.85), (-1.85, -7.15), (7.3, -7.3), (7.3, 7.3), (-7.3, 7.3)]:
        r = math.hypot(x, z); ux, uz = -x / r, -z / r
        deck.pipe((x, TOP, z), (x, TOP + 1.8, z), .06, D, 8)
        deck.box((.42, .3, .42), (x + ux * .12, TOP + 1.9, z + uz * .12), D)
        lamps.box((.3, .2, .3), (x + ux * .34, TOP + 1.88, z + uz * .34), 0xffffff)
        reds.box((.1, .1, .1), (x, TOP + 2.1, z), 0xffffff)
    # Two low tail-service masts behind the ship (symmetric about the viewing diagonal).
    for tx, tz in ((4.3, 6.4), (6.4, 4.3)):
        r = math.hypot(tx, tz); t = view(deck, frame(tx, tz, math.degrees(math.atan2(-tx, -tz))))    # local +z to the axis
        t.box((1.5, 1.3, 1.2), (0, TOP + .65, .2), CABINET)
        t.box((1.3, .06, .02), (0, TOP + 1.0, -.41), Y)
        for dx in (-.5, .5):
            for dz in (-.3, .5): t.ibeam((dx, TOP + 1.3, dz), (dx, TOP + 2.15, dz), .1, D)
        t.box((1.2, .1, 1.0), (0, TOP + 2.15, .1), D)
        t.beam((-.5, TOP + 1.35, .5), (.5, TOP + 2.1, .5), .05, D); t.beam((.5, TOP + 1.35, .5), (-.5, TOP + 2.1, .5), .05, D)
        t.box((.3, .3, r - 6.75 - .8), (0, TOP + 1.85, .6 + (r - 6.75 - .8) / 2), Y)               # short umbilical arm
        t.box((.6, .5, .08), (0, TOP + 1.85, r - 6.75 - .2 + .04), D)
        for dx in (-.15, .15): t.pipe((dx, TOP + 1.85, r - 6.75 - .16), (dx, TOP + 1.85, r - 6.75 - .05), .06, S, 8)
        t.pipe((-.4, TOP + .9, .82), (-.4, TOP + 1.7, .82), .05, BLUEP, 8)
    # Deck-edge equipment, all outside r = 6.5 and away from the hero edge.
    for x, z in ((6.85, -2.6), (-2.6, 6.85), (-5.4, 6.8), (6.8, -5.4)):
        sx, sz = (1.1, .75) if abs(x) > abs(z) else (.75, 1.1)
        deck.box((sx, .95, sz), (x, TOP + .475, z), CABINET); deck.box((sx + .02, .06, sz + .02), (x, TOP + .78, z), Y)
    for x, z in ((6.7, 1.8), (1.8, 6.7)):
        deck.box((.28, 1.35, .7) if x > z else (.7, 1.35, .28), (x, TOP + .675, z), ORANGE)
        deck.box((.02, .5, .4) if x > z else (.4, .5, .02), (x - .15 if x > z else x, TOP + .9, z if x > z else z - .15), 0x2a2f31)
    for x, z in ((7.1, -6.3), (-6.3, 7.1)):
        deck.pipe((x, TOP, z), (x, TOP + 1.0, z), .08, RD, 8); deck.box((.3, .14, .3), (x, TOP + .8, z), RD)
    deck.box((4.6, .22, .4), (.7, TOP + .11, 7.15), D); deck.box((.4, .22, 4.6), (7.15, TOP + .11, .7), D)    # cable trays
    for i in range(6):
        deck.box((.05, .05, .42), (-1.4 + i * .85, TOP + .25, 7.15), S); deck.box((.42, .05, .05), (7.15, TOP + .25, -1.4 + i * .85), S)

    # ------------------------------------------------------------------ clearance check (on the authored faces)
    def min_r(pts):
        inside, n = False, len(pts)
        for i in range(n):
            (x1, z1), (x2, z2) = pts[i], pts[(i + 1) % n]
            if (z1 > 0) != (z2 > 0) and 0 < x1 + (0 - z1) * (x2 - x1) / (z2 - z1): inside = not inside
        if inside: return 0.
        best = 1e9
        for i in range(n):
            (x1, z1), (x2, z2) = pts[i], pts[(i + 1) % n]; dx, dz = x2 - x1, z2 - z1; l = dx * dx + dz * dz
            t = 0 if l == 0 else max(0, min(1, -(x1 * dx + z1 * dz) / l))
            best = min(best, math.hypot(x1 + t * dx, z1 + t * dz))
        return best
    worst, offenders = -1e9, 0
    for g in (shell, base, stairs, deck, lamps, reds):
        for face_ in g.f:
            pts = [g.v[i] for i in face_]
            if min_r([(p[0], -p[1]) for p in pts]) < R_CLEAR:
                top = max(p[2] for p in pts); worst = max(worst, top); offenders += top > Y_CLEAR
    print(f'[launcher] max Y inside r<{R_CLEAR}: {worst:.3f} (faces above {Y_CLEAR}: {offenders})')
    assert offenders == 0, 'something rises above the deck inside the ship clearance'

    # ------------------------------------------------------------------ meshes, bake, export
    meshes = [g.mesh(n, root) for n, g in (('shell', shell), ('base', base), ('stairs', stairs), ('deck', deck))]
    glow = []
    for n, g, col, strength in (('lamps', lamps, (1, .84, .6), 1.7), ('lamps_red', reds, (1, .12, .07), 2.0)):
        ob = g.mesh(n, root, True); m = ob.data.materials[0].copy(); m.name = 'launcher_v5_' + n
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Emission Color'].default_value = (*col, 1); bsdf.inputs['Emission Strength'].default_value = strength
        bsdf.inputs['Base Color'].default_value = (*col, 1)
        vp = m.node_tree.nodes.get('Vertex paint')
        if vp: m.node_tree.nodes.remove(vp)
        ob.data.materials[0] = m; glow.append(ob)
        for attr in ('Color', 'Surface'): ob.data.color_attributes.remove(ob.data.color_attributes[attr])
    marker(root, 'attach_deck', (0, TOP, 0))
    marker(root, 'stair_foot', hero((2.45, 0, -1.62)))
    marker(root, 'stair_top', hero((.75, TOP, -.55)))
    bpy.context.view_layer.update()
    for ob in meshes: detail.finish(ob, NAME + '_' + ob.name, out, bake)
    tris, lo, hi = C.stats(root)
    per = {ob.name: len(ob.data.polygons) for ob in meshes + glow}
    path = os.path.join(out, NAME + '.glb'); _, size = C.export(root, path, max_tris=30000)
    assert tris <= 30000 and size <= 1100 * 1024, (tris, size)
    catalog[NAME] = {'file': 'v5/' + NAME + '.glb', 'triangles': tris, 'bytes': size, 'bounds': {'min': lo, 'max': hi}}
    print('[launcher]', NAME, tris, 'triangles', size, 'bytes', per, 'bounds', [round(v, 3) for v in lo], [round(v, 3) for v in hi])
    # The GLB embeds its atlases; drop our external copies (reproducible with --bake).
    for f in glob.glob(os.path.join(out, 'textures', NAME + '_*')): os.remove(f)

    # ------------------------------------------------------------------ fragment
    hx = lambda a, c: [round(v, 3) for v in hero((a, 0, c))[::2]]
    fragment = {
        'about': 'Hangar v5 launcher part (v5_launcher.py). Scaled NASA mobile launcher base; front-left corner is the hero face.',
        'modules': {NAME: catalog[NAME]},
        'launcherModule': NAME,
        'launcher': {
            'deckTop': TOP, 'attachDeck': [0, TOP, 0], 'boxUnderside': BOT, 'storeyBelt': MID,
            'footprint': {'box': [-H, H], 'withDetails': [-8.1, 8.1]}, 'heroChamfer': {'line': 'x + z = -%.2f' % CH, 'distance': round(CH * S2, 3), 'normal': [-S2, 0, -S2]},
            'clearance': {'radius': R_CLEAR, 'maxY': Y_CLEAR, 'measuredMaxY': round(worst, 3)},
            'pedestals': [[x, 0, z] for x, z in peds],
            'stair': {'foot': [round(v, 3) for v in hero((2.45, 0, -1.62))], 'landings': {'lowerDoor': BOT, 'upperDoor': MID, 'deck': TOP}, 'top': [round(v, 3) for v in hero((.75, TOP, -.55))]},
        },
        'placements': [],
        'hideColliders': [{'kind': 'ml', 'region': {'min': [-9, 0, -9], 'max': [9, 8, 9]}}],
        'colliders': [],
    }
    col = fragment['colliders']
    yc, ys = (BOT + TOP) / 2, TOP - BOT
    for (x0, x1, z0, z1) in ((-H, H, -K, H), (-K, H, -H, -K), (-5.6, -K, -4.02, -K), (-4.02, -K, -5.6, -4.02), (-7.2, -5.6, -2.42, -K), (-2.42, -K, -7.2, -5.6)):
        col.append({'kind': 'ml', 'center': [(x0 + x1) / 2, yc, (z0 + z1) / 2], 'size': [x1 - x0, ys, z1 - z0]})
    for x, z in peds: col.append({'kind': 'ml', 'center': [x, 1.1, z], 'size': [2.2, 2.2, 2.2]})
    # The stair tower in front of the hero face: three small decorative envelopes along the flights.
    for a0, a1, c0, c1, y0, y1 in ((-2.2, 2.36, -2.08, -1.1, 0, MID), (-3.42, -2.2, -2.08, -.04, 0, MID), (-2.2, 1.32, -1.06, -.04, MID, TOP)):
        pts = [hero((a, 0, c))[::2] for a in (a0, a1) for c in (c0, c1)]
        lo = [max(-8.05, min(p[i] for p in pts)) for i in (0, 1)]; hi = [min(8.05, max(p[i] for p in pts)) for i in (0, 1)]
        col.append({'kind': 'stairs', 'center': [round((lo[0] + hi[0]) / 2, 3), (y0 + y1) / 2, round((lo[1] + hi[1]) / 2, 3)],
                    'size': [round(hi[0] - lo[0], 3), y1 - y0, round(hi[1] - lo[1], 3)], 'decorative': True})
    with open(os.path.join(out, 'launcher.json'), 'w', encoding='utf8') as fh: json.dump(fragment, fh, indent=2)
    print('[launcher] wrote launcher.json')
