"""
Towers and arms (priority 2 of the pad plan), built for the reference ship (20 m x 2.5 m). A tower's origin is the
centre of its base on the deck it stands on, its face toward the rocket on -X. art.js scales a tower's `body` node in
height (H / 20; the code's ratio rules give the exact top) and moves its `head` to the new top unscaled; arms are
`pose_` nodes on their pivots, placed by the art at the heights it fits to the ship (the umbilical swing arms of the
Saturn launch umbilical tower and the Shuttle service structure, the strongback's clamps, the chopsticks).
Real references: refs/ml_saturn_1 (Saturn V launch umbilical tower, 1967), shuttle_pad_1/2 and rss_shuttle_1/2
(Shuttle fixed and rotating service structures), crew_arm_1/2 (SLC-41 crew access tower), soyuz_gantry_1 and
soyuz_erect_1..3 (Soyuz gantry and support arms), delta2_slc17_1/2 (SLC-17 mobile service tower), antares_0a_1 (TEL).
Starbase: no public-domain photo; built from published descriptions (nine-section square tower, carriage, two catch
arms, ship quick-disconnect arm, 146 m beside a 121-124 m ship).
"""
import math
from padlib import Piece, T, Ry, Rx, Rz, REF_H, REF_D, REF_R, DEG

R, D, H = REF_R, REF_D, REF_H
TW = 1.3 * D                    # tower width (3.25 m)
TOWER_X = R + D + TW / 2        # reference distance of a tower's centre from the ship's axis (5.375 m)
GAP = TOWER_X - TW / 2 - R      # tower face to hull (2.5 m)


def polar(a, r):
    return (r * math.cos(a * DEG), -r * math.sin(a * DEG))


# ------------------------------------------------------------------ shared pieces
def swing_arm(p, name, pivot, length, paint='paint', hoses=3, width=0.75, depth=0.62, parent=None):
    """
    An umbilical swing arm as node `name` (pose_): a box truss from its hinge at `pivot` (on the tower face) out along
    -x to the ship, a grating walkway on top, the hose bundle under it, the umbilical carrier plate at the tip.
    Swung back, it turns about y on the hinge (+90 lays it along the tower face).
    """
    px, py, pz = pivot
    with p.node(name, pivot, parent=parent):
        with p.at(T(px, py, pz)):
            p.truss(paint, (0, 0, 0), (-length + 0.15, 0, 0), width, depth, panel=0.62, t=0.075)
            p.box('deck', length - 0.15, 0.04, width - 0.1, -(length - 0.15) / 2, depth / 2 + 0.03, 0)
            for s in (-1, 1):
                p.beam('yellow', (0, depth / 2 + 0.95, s * (width / 2 - 0.03)), (-length + 0.25, depth / 2 + 0.95, s * (width / 2 - 0.03)), 0.04)
                for k in range(int(length / 0.9) + 1):
                    x = -0.1 - k * 0.9
                    if x < -length + 0.2:
                        break
                    p.box('yellow', 0.04, 0.95, 0.04, x, depth / 2 + 0.5, s * (width / 2 - 0.03))
            # the hinge post and its bearing blocks
            p.cyl('steel_dark', 0.12, -depth / 2 - 0.25, depth / 2 + 0.25, 0.05, -width / 2 + 0.08, seg=10)
            # hoses: insulated propellant lines in a sagging bundle under the arm, to the carrier plate
            for k in range(hoses):
                z = -0.18 + 0.18 * k
                pts = [(0.0, -depth / 2 - 0.12, z), (-length * 0.35, -depth / 2 - 0.32, z), (-length * 0.7, -depth / 2 - 0.3, z), (-length + 0.18, -0.15, z)]
                for a, b in zip(pts, pts[1:]):
                    p.tube('white' if k == 1 else 'rubber', a, b, 0.07, seg=8)
            p.box('steel_dark', 0.16, 0.7, 0.82, -length + 0.1, 0, 0, chamfer=0.02)
            p.box('grey', 0.3, 0.2, 0.5, -length + 0.3, depth / 2 + 0.12, 0)


def crew_arm_geo(p, length, room=1.5, y=0.0):
    """The crew access arm (local: hinge at x = 0, the ship at -x): enclosed walkway and the white room at its end."""
    walk = max(0.4, length - room)
    with p.node('walkway', (0, y, 0), parent='pose_arm'):
        p.box('white', walk, 1.9, 1.3, -walk / 2, y + 0.95, 0)
        for s in (-1, 1):
            p.box('glass', walk - 0.2, 0.35, 0.03, -walk / 2, y + 1.3, s * 0.665)
            for k in range(int(walk / 0.8) + 1):
                p.box('grey_light', 0.05, 1.9, 0.03, -0.05 - k * 0.8, y + 0.95, s * 0.665)
        p.box('grey', walk, 0.12, 1.4, -walk / 2, y + 1.96, 0)
        p.truss('grey', (0, y - 0.35, 0), (-walk, y - 0.35, 0), 1.2, 0.55, panel=0.6, t=0.06)
    with p.node('white_room', (-walk, y, 0), parent='pose_arm'):
        x0 = -walk
        p.box('white', room, 2.1, 1.8, x0 - room / 2, y + 1.05, 0, chamfer=0.03)
        p.box('grey', room + 0.1, 0.12, 1.9, x0 - room / 2, y + 2.14, 0)
        p.box('steel_dark', 0.04, 1.6, 0.9, x0 - room - 0.01, y + 0.9, 0)        # the doorway on the ship's side
        p.box('grey', 0.25, 1.75, 1.15, x0 - room - 0.12, y + 0.95, 0, chamfer=0.02)  # the soft seal round the hatch
        p.box('glass', 0.03, 0.4, 1.0, x0 - room / 2, y + 1.55, 0.905)


def crew_arm():
    """
    The crew access arm (Apollo, Shuttle, SLC-39A and SLC-41 today): an enclosed walkway from the tower to the white
    room that seals round the capsule's hatch. Origin: the hinge on the tower face, the ship on -x, the floor at y = 0.
    art.js scales `walkway` along x to reach the hull and moves `white_room` to its end; `pose_arm` swings it back.
    """
    p = Piece('crew_arm', 'the hinge on the tower face, 0.7 m below the walkway floor (attach_floor); ship on -x', {'x': 'gap'},
              'access = arm. Scale walkway in x to (gap - 1.5 m); white_room sits at its end; pose_arm turns about y.')
    y = 0.7  # the walkway floor 0.7 m above the piece's origin (its hinge post and truss below the floor clear y = 0)
    with p.node('pose_arm', (0, y, 0)):
        p.cyl('steel_dark', 0.14, y - 0.6, y + 2.4, 0.0, -0.75, seg=10)
    crew_arm_geo(p, GAP, y=y)
    p.mark('floor', (0, y, 0))
    return p, {'ship': (-GAP - R, -12.0, 0), 'frame': 6.0, 'views': ('detail', 'side'), 'ground': False}


# ------------------------------------------------------------------ the umbilical tower
def tower_fixed():
    """
    A fixed umbilical (launch) tower: square steel lattice 1.3 D wide, 1.10 H above its deck, floors every storey,
    stairs and a lift, propellant lines up the rocket face, hammerhead crane on top (node head; the Saturn V tower's
    25 t crane), an optional lightning mast (top_mast), three umbilical swing arms (pose_arm_1..3). Paint: material
    `paint` (Saturn red by default; art.js recolours white, grey or dark per complex).
    """
    p = Piece('tower_fixed', 'centre of its base on its deck, face toward the rocket on -x', {'y': 'H', 'xz': 'D'},
              'tower = fixed (and under rss). Scale body.y to the 1.10 H rule; head and top_mast ride on the top; arms by art.')
    top = 1.1 * H
    w = TW
    hw = w / 2
    n = 8
    st = top / n
    with p.node('body'):
        for cx, cz in ((-hw, -hw), (hw, -hw), (hw, hw), (-hw, hw)):
            p.box('paint', 0.32, top, 0.32, cx, top / 2, cz)
        for i in range(n + 1):
            y = i * st
            t = 0.24 if i in (0, n) else 0.2
            for s in (-1, 1):
                p.box('paint', w, t, t, 0, y, s * hw)
                p.box('paint', t, t, w, s * hw, y, 0)
            if 0 < i < n:
                # the storey's floor (grating), with the stair well cut out in one corner
                p.box('deck', w - 0.3, 0.06, w * 0.55, 0, y + 0.1, -w * 0.225 + 0.075 + 0.0)
                p.box('deck', w * 0.45, 0.06, w * 0.45 - 0.15, -w * 0.275 + 0.075, y + 0.1, w * 0.275 - 0.075)
        for i in range(n):
            a, b = i * st, (i + 1) * st
            for s in (-1, 1):
                p.xbrace_face('paint', (-hw, a, s * hw), (hw, a, s * hw), (hw, b, s * hw), (-hw, b, s * hw), 0.13)
            p.xbrace_face('paint', (hw, a, -hw), (hw, a, hw), (hw, b, hw), (hw, b, -hw), 0.13)
            # the rocket face keeps K-bracing so arms can pass: a diagonal pair from mid-height
            m = (a + b) / 2
            p.beam('paint', (-hw, a, -hw), (-hw, m, 0), 0.12)
            p.beam('paint', (-hw, a, hw), (-hw, m, 0), 0.12)
            # stairs zig-zagging up the corner well
            d = 1 if i % 2 == 0 else -1
            p.stairs('grey', (hw - 0.45 - (1.3 if d > 0 else 0), a + 0.13, hw - 0.5), (hw - 0.45 - (0 if d > 0 else 1.3), b + 0.13, hw - 0.5), width=0.8, rise=0.22)
        # lift shaft (clad) and the lines up the rocket face: cryogenic (white, insulated), fuel, gas, cable tray
        p.box('grey_light', 0.95, top + 1.2, 0.95, hw - 0.62, (top + 1.2) / 2, -hw + 0.62)
        for k in range(1, n):
            p.box('steel_dark', 0.97, 0.06, 0.97, hw - 0.62, k * st + 1.0, -hw + 0.62)
        for z, r, m in ((-0.95, 0.12, 'white'), (-0.62, 0.09, 'steel'), (-0.36, 0.06, 'steel'), (0.95, 0.11, 'white')):
            p.cyl(m, r, 0.0, top - 0.4, -hw - 0.22, z, seg=10)
            for k in range(1, n):
                p.box('steel_dark', 0.3, 0.06, 0.06, -hw - 0.11, k * st - 0.3, z)
        p.box('steel_dark', 0.12, top, 0.42, hw + 0.08, top / 2, 0.55)
        # the base: heavier members and the footing plates
        for cx, cz in ((-hw, -hw), (hw, -hw), (hw, hw), (-hw, hw)):
            p.box('steel_dark', 0.7, 0.2, 0.7, cx, 0.1, cz)
        p.railing('yellow', [(-hw, -hw), (hw, -hw), (hw, hw), (-hw, hw)], top + 0.12, closed=True, step=1.1, h=1.05, t=0.04)
    with p.node('head', (0, top, 0)):
        with p.at(T(0, top, 0)):
            p.box('deck', w + 0.3, 0.1, w + 0.3, 0, 0.12, 0)
            # the hammerhead crane: turret, jib over the rocket, counter-jib, machinery house and the yellow cab
            p.cyl('paint', 0.42, 0.15, 1.35, 0.3, 0.0, seg=12)
            p.truss('paint', (2.0, 1.55, 0), (-4.6, 1.55, 0), 0.55, 0.6, panel=0.65, t=0.08)
            p.box('paint', 1.5, 0.75, 0.9, 1.35, 2.1, 0)
            p.box('yellow', 0.85, 0.75, 0.75, 0.3, 2.1, 0.75, chamfer=0.03)
            p.box('glass', 0.05, 0.3, 0.6, -0.13, 2.2, 0.75)
            p.box('steel_dark', 0.35, 0.5, 0.35, -4.2, 1.0, 0)
            p.tube('wire', (-4.2, 1.25, 0), (-4.2, 0.4, 0), 0.02, seg=4)
            p.cyl('steel', 0.05, 0.2, 2.6, -hw + 0.3, hw - 0.3, seg=6)
            p.box('steel', 0.5, 0.05, 0.05, -hw + 0.3, 2.6, hw - 0.3)
    with p.node('top_mast', (0, top, 0)):
        with p.at(T(0, top, 0)):
            p.lathe('steel', [(0.3, 2.7), (0.22, 3.4)], seg=10)
            p.lathe('white', [(0.2, 3.4), (0.09, 0.3 * H + 2.7), (0.0, 0.3 * H + 2.9)], seg=10)
            for s in (-1, 1):
                p.beam('steel', (s * 0.6, 0.15, s * 0.6), (0, 2.75, 0), 0.08)
                p.beam('steel', (s * 0.6, 0.15, -s * 0.6), (0, 2.75, 0), 0.08)
    for k, f in enumerate((0.3, 0.58, 0.84), 1):
        swing_arm(p, f'pose_arm_{k}', (-hw - 0.05, round(H * f, 2), 0.0), GAP)
    return p, {'ship': (-TOWER_X, 0, 0), 'frame': 9.0}


# ------------------------------------------------------------------ the strongback
def strongback():
    """
    SpaceX's transporter-erector-launcher 'strongback' (SLC-40, LC-39A, SLC-4E): a white steel truss as tall as the
    ship (1.02 H) beside it, three clamp arms (pose_clamp_1..3) holding the stages, the umbilical lines up its face,
    hinged at its foot (pose_frame turns about z: it leans back about 4 degrees before launch), on its transporter
    frame with the two big lifting pistons (node base).
    """
    p = Piece('strongback', 'centre of its foot, face toward the rocket on -x', {'y': 'H', 'xz': 'D'},
              'tower = strongback. pose_frame turns about z on the hinge (-4 deg = leaned back); scale body.y to 1.02 H.')
    dep, wid, y0, top = 1.0, 2.0, 0.4, 1.02 * H
    hx, hz = dep / 2, wid / 2
    hinge = (hx, y0, 0)
    with p.node('pose_frame', hinge):
        with p.node('body', (0, y0, 0), parent='pose_frame'):
            hgt = top - y0
            n = 10
            st = hgt / n
            for cx, cz in ((-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz)):
                p.box('white', 0.22, hgt, 0.22, cx, y0 + hgt / 2, cz)
            for i in range(n + 1):
                y = y0 + i * st
                for s in (-1, 1):
                    p.box('white', dep, 0.14, 0.14, 0, y, s * hz)
                    p.box('white', 0.14, 0.14, wid, s * hx, y, 0)
            for i in range(n):
                a, b = y0 + i * st, y0 + (i + 1) * st
                f = 1 if i % 2 else -1
                for s in (-1, 1):
                    p.beam('white', (-hx * f, a, s * hz), (hx * f, b, s * hz), 0.11)
                    p.xbrace_face('white', (s * hx, a, -hz), (s * hx, a, hz), (s * hx, b, hz), (s * hx, b, -hz), 0.1)
            # the umbilical lines: two big hoses and a cable bundle up the face, quick-disconnect plates at the stages
            for z, r, m in ((-0.55, 0.11, 'rubber'), (-0.25, 0.09, 'rubber'), (0.62, 0.07, 'steel_dark')):
                p.cyl(m, r, y0 + 0.3, top - 1.0, -hx - 0.18, z, seg=8)
                for k in range(1, n):
                    p.box('steel_dark', 0.25, 0.05, 0.05, -hx - 0.08, y0 + k * st, z)
            for yq in (0.25 * H, 0.66 * H, 0.95 * H):
                p.box('steel_dark', 0.35, 0.6, 0.8, -hx - 0.3, yq, -0.4, chamfer=0.02)
            p.box('white', dep + 0.2, 0.2, wid + 0.2, 0, top, 0)
        for k, f in enumerate((0.22, 0.52, 0.82), 1):
            yy = round(H * f, 2)
            reach = 0.75
            with p.node(f'pose_clamp_{k}', (-hx, yy, 0), parent='pose_frame'):
                with p.at(T(-hx, yy, 0)):
                    p.box('white', reach, 0.32, 0.32, -reach / 2, 0, 0)
                    p.beam('white', (0, -0.5, 0), (-reach * 0.7, -0.1, 0), 0.16)
                    p.box('steel_dark', 0.14, 0.75, 1.15, -reach - 0.07, 0, 0)
                    for s in (-1, 1):
                        p.box('steel_dark', 0.35, 0.6, 0.1, -reach - 0.25, 0, s * 0.53)
    with p.node('base'):
        p.box('grey', 3.6, 0.6, wid + 0.6, hx + 1.6, 0.3, 0, chamfer=0.04)
        for s in (-1, 1):
            p.box('steel_dark', 3.4, 0.25, 0.2, hx + 1.6, 0.6, s * (hz + 0.2))
            for k in range(4):
                with p.at(T(hx + 0.3 + k * 0.95, 0.28, s * (hz + 0.4)) @ Rx(90)):
                    p.cyl('rubber', 0.27, -0.1, 0.1, seg=12)
            # the lifting pistons, from the transporter up to the frame at about 0.3 H
            p.tube('steel_dark', (hx + 2.9, 0.6, s * (hz - 0.2)), (hx + 1.6, 3.2, s * (hz - 0.2)), 0.2, seg=10)
            p.tube('steel', (hx + 1.6, 3.2, s * (hz - 0.2)), (hx + 0.3, 0.3 * H, s * (hz - 0.2)), 0.12, seg=10)
        p.box('steel_dark', 0.5, 0.5, wid + 0.2, hx + 0.1, y0, 0)
    return p, {'ship': (-hx - 0.75 - R, 0, 0), 'frame': 7.0}


# ------------------------------------------------------------------ Starbase's catch tower
def catch_tower():
    """
    Starbase's integration tower ('Mechazilla'): a square dark-steel lattice of nine stacked sections with heavy
    X-bracing, the carriage (pose_carriage, rides up and down the tower) carrying the two catch arms ('chopsticks',
    pose_chopstick_a/b, turning about y on their hinges) and the ship quick-disconnect arm (pose_arm_qd); a lightning rod
    and weather mast on top (head). At reference the tower stands on the ground beside a 5 m mount: top 26 m
    (mount top + 1.05 H).
    """
    p = Piece('catch_tower', 'centre of its base on the ground, face toward the rocket on -x', {'y': 'H', 'xz': 'D'},
              'tower = catch. body.y to (mount top + 1.05 H) / 26; pose_carriage moves in y; chopsticks turn about y.')
    w, top = TW + 0.6, 5.0 + 1.05 * H
    hw = w / 2
    n = 9
    st = top / n
    with p.node('body'):
        for cx, cz in ((-hw, -hw), (hw, -hw), (hw, hw), (-hw, hw)):
            p.box('steel_dark', 0.42, top, 0.42, cx, top / 2, cz)
        for i in range(n + 1):
            y = i * st
            for s in (-1, 1):
                p.box('steel_dark', w, 0.3, 0.3, 0, y, s * hw)
                p.box('steel_dark', 0.3, 0.3, w, s * hw, y, 0)
        for i in range(n):
            a, b = i * st, (i + 1) * st
            for s in (-1, 1):
                p.xbrace_face('steel_dark', (-hw, a, s * hw), (hw, a, s * hw), (hw, b, s * hw), (-hw, b, s * hw), 0.2)
                p.xbrace_face('steel_dark', (s * hw, a, -hw), (s * hw, a, hw), (s * hw, b, hw), (s * hw, b, -hw), 0.2)
            if i % 3 == 2:
                p.box('deck', w - 0.4, 0.06, w - 0.4, 0, b - 0.1, 0)
        # the carriage rails on the rocket face, the elevator shaft and the lines inside
        for s in (-1, 1):
            p.box('steel', 0.18, top - 1.0, 0.25, -hw - 0.2, (top - 1.0) / 2 + 0.5, s * (hw - 0.35))
        p.box('grey', 1.1, top + 0.8, 1.1, hw - 0.7, (top + 0.8) / 2, hw - 0.7)
        for z in (-0.4, 0.0):
            p.cyl('steel', 0.13, 0.0, top - 0.5, hw - 0.4, z, seg=10)
        p.box('steel_dark', w + 0.6, 0.5, w + 0.6, 0, top + 0.25, 0)
    with p.node('head', (0, top + 0.5, 0)):
        with p.at(T(0, top + 0.5, 0)):
            p.railing('yellow', [(-hw - 0.2, -hw - 0.2), (hw + 0.2, -hw - 0.2), (hw + 0.2, hw + 0.2), (-hw - 0.2, hw + 0.2)], 0.0, closed=True, step=1.2, h=1.05, t=0.04)
            p.lathe('steel', [(0.18, 0.0), (0.12, 1.2), (0.05, 3.8), (0.0, 4.0)], seg=8, x=0.4, z=0.4)
            p.cyl('steel', 0.05, 0.0, 2.2, -hw + 0.4, hw - 0.4, seg=6)
            for k in range(3):
                p.box('white', 0.2, 0.1, 0.2, -hw + 0.4 + 0.25 * (k - 1), 2.2, hw - 0.4)
            p.box('grey', 0.9, 0.6, 0.7, hw - 0.6, 0.3, -hw + 0.6)
    yc = 5.0 + 0.82 * H
    with p.node('pose_carriage', (0, yc, 0)):
        with p.at(T(0, yc, 0)):
            cw = w + 1.0
            for s in (-1, 1):
                p.box('grey', cw, 2.2, 0.3, 0, 0, s * (cw / 2 - 0.15))
                p.box('grey', 0.3, 2.2, cw, s * (cw / 2 - 0.15), 0, 0)
            p.box('steel_dark', cw + 0.1, 0.18, cw + 0.1, 0, 1.15, 0)
            p.box('steel_dark', cw + 0.1, 0.18, cw + 0.1, 0, -1.15, 0)
            # the arms' hinge housings on the rocket face
            for s in (-1, 1):
                p.box('steel_dark', 0.8, 2.5, 0.8, -cw / 2 - 0.3, 0, s * (hw - 0.1), chamfer=0.05)
    L = 7.6
    for nm, s in (('pose_chopstick_a', -1), ('pose_chopstick_b', 1)):
        piv = (-hw - 0.95, yc, s * (hw - 0.1))
        with p.node(nm, piv, parent='pose_carriage'):
            with p.at(T(*piv)):
                # a heavy steel box beam tapering toward its tip, its side webs cut with lightening openings
                p.front_prism('grey', [(0.0, -0.6), (-L, -0.25), (-L, 0.3), (0.0, 0.55)], -0.3, 0.3)
                for k in range(1, 9):
                    x = -L * k / 9.5
                    hh = 0.62 - 0.4 * (k / 9.5)
                    for sz in (-1, 1):
                        p.front_prism('steel_dark', [(x + 0.28, -hh * 0.75), (x - 0.28, -hh * 0.75), (x, hh * 0.75)], sz * 0.3 - 0.01, sz * 0.3 + 0.01)
                p.box('steel', L - 0.4, 0.1, 0.42, -L / 2, 0.36, 0, rz=math.atan2(0.25, L))
                p.box('yellow', 0.6, 0.18, 0.28, -L + 1.6, 0.6, -s * 0.12)
                p.box('yellow', 0.6, 0.18, 0.28, -L + 3.2, 0.6, -s * 0.12)
                p.cyl('steel_dark', 0.2, -1.0, 1.0, 0.0, 0.0, seg=10)
    qy = 5.0 + 0.6 * H
    swing_arm(p, 'pose_arm_qd', (-hw - 0.05, qy, 0.0), GAP + 0.6 - 0.6, paint='steel_dark', hoses=3, width=1.0, depth=0.9)
    return p, {'ship': (-(R + 2.2) - hw - 0.25, 5.0, 0), 'frame': 10.0}


# ------------------------------------------------------------------ the Soyuz gantry (one half)
def soyuz_gantry():
    """
    One half of the Soyuz service gantry (Gagarin's Start, Plesetsk): a tapering green steel lattice 0.95 H tall,
    hinged at its outer foot (attach_hinge: it swings back about z, lowered before launch), with yellow work floors
    reaching toward the ship at every level. art.js draws two halves either side of the ship.
    """
    p = Piece('soyuz_gantry', 'centre of its base, face toward the rocket on -x (one half)', {'y': 'H', 'xz': 'D'},
              'tower = gantry: two copies (turned 180 deg about the ship). Hinge at attach_hinge (outer foot), turn about z.')
    dep, wid0, wid1, top = 1.4, 4.0, 2.4, 0.95 * H
    n = 8
    st = (top - 0.3) / n
    y0 = 0.3
    hx = dep / 2

    def hz(y):
        return (wid0 + (wid1 - wid0) * (y - y0) / (top - y0)) / 2
    with p.node('body'):
        for sx in (-1, 1):
            for sz in (-1, 1):
                p.beam('green', (sx * hx, y0, sz * hz(y0)), (sx * hx, top, sz * hz(top)), 0.26)
        for i in range(n + 1):
            y = y0 + i * st
            for sx in (-1, 1):
                p.box('green', 0.18, 0.18, 2 * hz(y), sx * hx, y, 0)
            for sz in (-1, 1):
                p.box('green', dep, 0.18, 0.18, 0, y, sz * hz(y))
        for i in range(n):
            a, b = y0 + i * st, y0 + (i + 1) * st
            for sx in (-1, 1):
                p.xbrace_face('green', (sx * hx, a, -hz(a)), (sx * hx, a, hz(a)), (sx * hx, b, hz(b)), (sx * hx, b, -hz(b)), 0.12)
            for sz in (-1, 1):
                f = 1 if i % 2 else -1
                p.beam('green', (-hx * f, a, sz * hz(a)), (hx * f, b, sz * hz(b)), 0.12)
            # a work floor toward the ship, yellow grating and railing, its inner edge cut round the hull
            yf = b - 0.05
            wz = hz(yf) * 0.9
            p.box('deck', dep, 0.08, 2 * wz, 0, yf, 0)
            p.box('yellow', 0.85, 0.12, 2 * wz, -hx - 0.42, yf, 0)
            p.railing('yellow', [(-hx - 0.85, -wz), (-hx, -wz)], yf, h=1.0, step=0.85, t=0.04)
            p.railing('yellow', [(-hx - 0.85, wz), (-hx, wz)], yf, h=1.0, step=0.85, t=0.04)
        # the ladder and cable runs inside
        p.box('steel_dark', 0.12, top - y0, 0.4, hx - 0.15, (top + y0) / 2, 0)
        p.box('green', dep + 0.3, 0.3, 2 * hz(top) + 0.3, 0, top, 0)
    with p.node('foot'):
        p.box('steel_dark', dep + 0.4, y0 + 0.1, wid0 + 0.3, 0.1, (y0 + 0.1) / 2, 0)
        for s in (-1, 1):
            with p.at(T(hx + 0.25, y0, s * (wid0 / 2 - 0.25)) @ Rx(90)):
                p.cyl('steel', 0.22, -0.2, 0.2, seg=12)
    p.mark('hinge', (hx + 0.25, y0, 0))
    return p, {'ship': (-hx - 0.9 - R, 0, 0), 'frame': 6.0}


# ------------------------------------------------------------------ the Soyuz support arms ('tulip')
def soyuz_launcher():
    """
    The R-7 launch system's four support arms (Gagarin's Start, Plesetsk, Vostochny, ELS, clamps = tulip): green steel
    trusses hinged on the launch ring that hold the rocket by its sides, their V-shaped heads doubling as work platforms;
    counterweights below the hinges swing them back as the rocket rises (no motors). Origin: the rocket's axis at the
    ring top (where the ship stands). Each arm is pose_arm_1..4 on its hinge, its own +x pointing outward: turning it
    about its z by about -35 degrees opens it.
    """
    p = Piece('soyuz_launcher', 'rocket axis, 1.8 m below the ring top (attach_ring, where the ship stands)', {'xyz': 'D'},
              'clamps = tulip. pose_arm_k: hinge 0.3 m above the ring, local +x outward; rotate about local z (negative opens).')
    px, gy, rg = 2.0, 2.4, R + 0.06
    Y0 = 1.8  # the ring top stands 1.8 m above the piece's origin, so the counterweights hanging below it clear y = 0
    for k in range(4):
        a = 45 + 90 * k
        x, z = polar(a, px)
        with p.node(f'pose_arm_{k + 1}', (x, Y0 + 0.3, z), rot_y=a):
            with p.at(T(x, Y0 + 0.3, z) @ Ry(a)):
                tip = (-(px - rg), gy, 0.0)
                # the arm: a tapered lattice truss from the hinge up to the ship's side
                # four chords: inner pair toward the ship, outer pair behind, narrowing to the head
                A = [(0.0, 0.0, 0.55), (0.0, 0.0, -0.55), (0.55, 0.0, 0.55), (0.55, 0.0, -0.55)]
                B = [(tip[0] + 0.2, tip[1] - 0.3, 0.25), (tip[0] + 0.2, tip[1] - 0.3, -0.25), (tip[0] + 0.55, tip[1] - 0.3, 0.25), (tip[0] + 0.55, tip[1] - 0.3, -0.25)]
                for a_, b_ in zip(A, B):
                    p.beam('green', a_, b_, 0.2)
                lerp = lambda u, v, f: tuple(u[i] + (v[i] - u[i]) * f for i in range(3))
                for i in range(6):
                    f0, f1 = i / 6, (i + 1) / 6
                    P0 = [lerp(A[j], B[j], f0) for j in range(4)]
                    P1 = [lerp(A[j], B[j], f1) for j in range(4)]
                    for (j, k) in ((0, 1), (2, 3), (0, 2), (1, 3)):
                        p.beam('green', P1[j], P1[k], 0.08)
                        p.beam('green', P0[j] if i % 2 else P0[k], P1[k] if i % 2 else P1[j], 0.07)
                # the V head: two prongs cradling the ship, a small platform with its railing, the grip pad
                for s in (-1, 1):
                    p.beam('green', (tip[0] + 0.3, tip[1] - 0.25, s * 0.2), (tip[0] + 0.05, tip[1] + 0.35, s * 0.55), 0.12)
                p.box('yellow', 0.6, 0.06, 1.0, tip[0] + 0.4, tip[1] + 0.05, 0)
                p.railing('yellow', [(tip[0] + 0.7, -0.5), (tip[0] + 0.7, 0.5)], tip[1] + 0.08, h=0.9, step=0.5, t=0.035)
                p.box('steel_dark', 0.16, 0.5, 0.5, tip[0] + 0.02, tip[1] - 0.1, 0)
                # the hinge and the counterweight lever below it
                with p.at(Rx(90)):
                    p.cyl('steel_dark', 0.16, -0.5, 0.5, seg=10)
                p.beam('green', (0.0, 0.0, 0.0), (1.05, -1.25, 0.0), 0.2)
                p.box('concrete_old', 1.0, 0.9, 1.1, 1.2, -1.6, 0.0, chamfer=0.05)
        with p.at(Ry(a)):
            p.box('steel_dark', 0.7, 0.3, 1.1, px + 0.1, Y0 + 0.15, 0)
    p.mark('ring', (0, Y0, 0))
    return p, {'ship': (0, Y0, 0), 'frame': 5.0, 'views': ('34', 'detail', 'side')}


# ------------------------------------------------------------------ mobile service tower
def mst():
    """
    An enclosed mobile service tower (Vostochny, ELS, ELA-4, Sriharikota; SLC-17's open tower): a steel frame 3 D
    square and 1.15 H tall clad in white panels, the ship's side open behind two tall door leaves (pose_door_a/b, turn
    about y on their outer edges), work floors inside, a crane under the roof (head), wheel bogies on two rails. Origin:
    the centre of its base; in the service position that is the ship's axis; rolled back, art.js moves it along +x.
    """
    p = Piece('mst', 'centre of its base (the ship axis when closed round it); doors on -x', {'y': 'H', 'xz': 'D'},
              'tower = mst. body.y to 1.15 H; head rides on top; doors pose_door_a/b about y; bogies stay.')
    F, top, y0 = 3 * D, 1.15 * H, 0.7
    hf = F / 2
    n = 8
    st = (top - y0) / n
    with p.node('body'):
        for cx, cz in ((-hf, -hf), (hf, -hf), (hf, hf), (-hf, hf)):
            p.box('grey', 0.45, top - y0, 0.45, cx, (top + y0) / 2, cz)
        for i in range(n + 1):
            y = y0 + i * st
            for s in (-1, 1):
                p.box('grey', F, 0.22, 0.25, 0, y, s * hf)
                p.box('grey', 0.25, 0.22, F, s * hf, y, 0)
            if 0 < i < n:
                # a work floor with the ship's opening (a square hole 1.3 D) and its folding inner platforms
                hole = 1.3 * D / 2 + 0.1
                for (cx, cz, w, d) in ((0, (hf + hole) / 2, F - 0.4, hf - hole), (0, -(hf + hole) / 2, F - 0.4, hf - hole), ((hf + hole) / 2, 0, hf - hole, 2 * hole), (-(hf + hole) / 2, 0, hf - hole, 2 * hole)):
                    p.box('deck', w, 0.08, d, cx, y, cz)
        # cladding: white panels on three sides, ribbed; the ship's side (-x) open between the door leaves
        for i in range(n):
            a, b = y0 + i * st, y0 + (i + 1) * st
            for s in (-1, 1):
                p.box('white', F - 0.3, st - 0.12, 0.08, 0, (a + b) / 2, s * (hf + 0.12))
            p.box('white', 0.08, st - 0.12, F - 0.3, hf + 0.12, (a + b) / 2, 0)
            for k in range(1, 6):
                f = -hf + F * k / 6
                for s in (-1, 1):
                    p.box('grey_light', 0.06, st - 0.12, 0.04, f, (a + b) / 2, s * (hf + 0.17))
                p.box('grey_light', 0.04, st - 0.12, 0.06, hf + 0.17, (a + b) / 2, f)
        p.box('grey', F + 0.5, 0.45, F + 0.5, 0, top + 0.22, 0)
        p.front_prism('white', [(-hf - 0.25, top + 0.44), (hf + 0.25, top + 0.44), (hf + 0.25, top + 1.1), (-hf - 0.25, top + 1.6)], -hf - 0.25, hf + 0.25)
        # the stair tower on the back
        p.lattice('grey', x=hf + 0.9, z=-hf + 0.9, w=1.4, y0=y0, y1=top, bay=2.3, t=0.12)
    with p.node('head', (0, top, 0)):
        p.box('steel_dark', F * 0.75, 0.55, 0.55, -0.2, top - 0.5, 0)
        p.box('yellow', 0.7, 0.6, 0.6, -0.2, top - 0.95, 0.4)
    for nm, s in (('pose_door_a', -1), ('pose_door_b', 1)):
        piv = (-hf, y0, s * hf)
        with p.node(nm, piv):
            p.box('white', 0.14, top - y0 - 0.1, hf - 0.05, -hf - 0.1, (top + y0) / 2, s * hf / 2)
            for k in range(1, 4):
                p.box('grey_light', 0.04, top - y0 - 0.2, 0.06, -hf - 0.19, (top + y0) / 2, s * hf * k / 4)
            for k in range(1, n):
                p.box('grey_light', 0.04, 0.08, hf - 0.1, -hf - 0.19, y0 + k * st, s * hf / 2)
    with p.node('bogies'):
        for cx in (-hf + 0.9, hf - 0.9):
            for s in (-1, 1):
                p.box('steel_dark', 1.6, 0.55, 0.8, cx, 0.3, s * (hf - 0.6))
                for dx in (-0.5, 0.5):
                    with p.at(T(cx + dx, 0.3, s * (hf - 0.6)) @ Rx(90)):
                        p.cyl('steel', 0.28, -0.3, 0.3, seg=12)
        for s in (-1, 1):
            p.box('grey', F + 0.45, 0.3, 0.6, 0, y0 - 0.1, s * (hf - 0.6))
    return p, {'ship': (0, 0, 0), 'frame': 8.0}


# ------------------------------------------------------------------ rotating service structure
def rss():
    """
    The Shuttle's rotating service structure (LC-39A/B 1981-2011; Site 110's rotating tower is the same idea): an
    enclosed steel box from about 0.28 H to 0.93 H, the payload changeout room's doors on its face toward the ship,
    turning 120 degrees on a hinge column beside the fixed tower, its far end on a wheel truck on a curved rail.
    Origin: the hinge column's foot. pose_rss turns about y (0 = mated round the ship; art.js swings it -120 deg).
    """
    p = Piece('rss', 'the hinge column foot; mated, the box runs along -x beside the ship (+z side faces it)', {'y': 'H', 'xz': 'D'},
              'tower = rss (with tower_fixed). pose_rss turns about y on the hinge; rail is a 120 deg arc.')
    Dr = 2.6
    Lr = (TOWER_X - TW / 2 - 0.1) + R + 1.2
    yb, yt = 0.28 * H, 0.93 * H
    with p.node('hinge'):
        p.cyl('steel', 0.35, 0.0, yt + 0.4, seg=14)
        for y in (yb, (yb + yt) / 2, yt):
            p.cyl('steel_dark', 0.48, y - 0.25, y + 0.25, seg=14)
        p.box('concrete_old', 1.2, 0.4, 1.2, 0, 0.2, 0)
    with p.node('pose_rss'):
        # the frame: columns, floor beams, X-bracing, then panels on the outside and the PCR doors on the ship's face
        n = 6
        st = (yt - yb) / n
        for x in (0.0, -Lr * 0.33, -Lr * 0.66, -Lr):
            for s in (-1, 1):
                p.box('grey', 0.22, yt - yb, 0.22, x, (yb + yt) / 2, s * Dr / 2)
        for i in range(n + 1):
            y = yb + i * st
            for s in (-1, 1):
                p.box('grey', Lr, 0.16, 0.18, -Lr / 2, y, s * Dr / 2)
            if 0 < i < n:
                p.box('deck', Lr, 0.06, Dr, -Lr / 2, y + 0.05, 0)
        for i in range(n):
            a, b = yb + i * st, yb + (i + 1) * st
            p.xbrace_face('grey', (0, a, -Dr / 2), (-Lr * 0.5, a, -Dr / 2), (-Lr * 0.5, b, -Dr / 2), (0, b, -Dr / 2), 0.1)
            p.xbrace_face('grey', (-Lr * 0.5, a, -Dr / 2), (-Lr, a, -Dr / 2), (-Lr, b, -Dr / 2), (-Lr * 0.5, b, -Dr / 2), 0.1)
        for i in range(n):
            a, b = yb + i * st, yb + (i + 1) * st
            p.box('white', Lr - 0.2, st - 0.1, 0.06, -Lr / 2, (a + b) / 2, -Dr / 2 - 0.1)
            for k in range(1, 7):
                p.box('grey_light', 0.05, st - 0.1, 0.04, -Lr * k / 7, (a + b) / 2, -Dr / 2 - 0.15)
        p.box('grey_light', Lr * 0.55, (yt - yb) * 0.62, 0.08, -Lr * 0.62, yb + (yt - yb) * 0.45, Dr / 2 + 0.06)   # PCR doors
        p.box('steel_dark', 0.06, (yt - yb) * 0.62, 0.1, -Lr * 0.62, yb + (yt - yb) * 0.45, Dr / 2 + 0.1)
        p.box('grey', Lr + 0.2, 0.4, Dr + 0.2, -Lr / 2, yt + 0.2, 0)
        p.box('grey', Lr + 0.2, 0.3, Dr + 0.2, -Lr / 2, yb - 0.15, 0)
        # the outer support legs down to the wheel truck on the rail
        for s in (-1, 1):
            p.box('grey', 0.4, yb, 0.4, -Lr + 0.4, yb / 2, s * (Dr / 2 - 0.3))
            p.beam('grey', (-Lr + 0.4, 0.6, s * (Dr / 2 - 0.3)), (-Lr * 0.6, yb - 0.3, s * (Dr / 2 - 0.3)), 0.16)
        p.box('steel_dark', 1.3, 0.6, Dr, -Lr + 0.4, 0.3, 0)
    with p.node('rail'):
        p.torus('steel', Lr - 0.4, 0.07, 0, 0.05, 0, seg=36, seg2=4, arc=130, a0=55)
    return p, {'ship': (-(TOWER_X - TW / 2 - 0.1) , 0, R + 0.2 + Dr / 2), 'frame': 9.0}


PIECES = {
    'tower_fixed': tower_fixed, 'crew_arm': crew_arm, 'strongback': strongback, 'catch_tower': catch_tower,
    'soyuz_gantry': soyuz_gantry, 'soyuz_launcher': soyuz_launcher, 'mst': mst, 'rss': rss,
}
