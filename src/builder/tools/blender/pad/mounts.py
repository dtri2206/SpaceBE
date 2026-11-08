"""
Launch mounts, decks and trenches (priority 1 of the pad plan). Every mount is centred on the rocket's axis, built for
the reference ship (20 m x 2.5 m), its tower side on +x, and scaled by art.js uniformly with the ship's width (D / 2.5).
Sizes come from the ratio rules (README "Ground models", models.md): opening under the ship 1.3 D, table or ring 1.9 D,
raised mount 1.2-2.2 D high, trench 1.9 D wide and about 1.35 H long with the pad 1.2 D above its floor, mobile
platform deck 3 D across on pedestals 0.65 D, deck 0.75 D thick.
Real references: refs/ in the wave-4 pad folder (NASA photos): lc34_1 (LC-34 pedestal), trench_39a_2, deflector_39b_1/2,
ml_saturn_1, mlp_shuttle_1/2, mlp_rainbird_1/2, ariane5_ela3_2 (ELA-3 table and duct), soyuz_erect_1..3 (Gagarin's Start).
"""
import math
from padlib import Piece, T, Ry, Rx, Rz, REF_H, REF_D, REF_R, DEG

R, D = REF_R, REF_D
HOLE = 1.3 * D          # the opening under the ship (3.25 m)
RING = 1.9 * D          # a launch table or ring, outer (4.75 m)
TRENCH_W = 1.9 * D      # flame trench width (4.75 m)
RH = 8.5                # hardstand radius (art.js: max(8.5, 5.5 R))
TOWER_X = R + D + 0.65 * D   # reference tower centre: hull-to-tower gap 1 D, tower 1.3 D wide (5.375 m)


def polar(a, r):
    return (r * math.cos(a * DEG), -r * math.sin(a * DEG))


def octagon(r, rot=22.5):
    return [polar(rot + 45 * k, r) for k in range(8)]


def clip(pts, nx, nz, c):
    """Keeps the part of a polygon where nx*x + nz*z >= c."""
    out = []
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        da, db = nx * a[0] + nz * a[1] - c, nx * b[0] + nz * b[1] - c
        if da >= 0:
            out.append(a)
        if (da >= 0) != (db >= 0):
            t = da / (da - db)
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def scorch(p, cx, cz, along, across, ax=0.0, y=0.02, seed=1):
    """A ragged scorch blot on the ground: an ellipse with a deterministic wavy edge, longer along angle ax."""
    pts = []
    for i in range(28):
        t = 2 * math.pi * i / 28
        k = 1 + 0.18 * math.sin(3 * t + seed) + 0.1 * math.sin(7 * t + 2 * seed) + 0.06 * math.sin(13 * t + seed * 3)
        x, z = along / 2 * math.cos(t) * k, across / 2 * math.sin(t) * k
        c, s = math.cos(ax * DEG), math.sin(ax * DEG)
        pts.append((cx + x * c + z * s, cz - x * s + z * c))
    p.prism('scorch', pts, y - 0.015, y)


def poly_ring(p, mat, outer, r_hole, y0, y1, seg=4):
    """A slab whose outline is the polygon `outer` (centred on the axis) with a round hole: one prism per side."""
    n = len(outer)
    for k in range(n):
        c0, c1 = outer[k], outer[(k + 1) % n]
        a0 = math.degrees(math.atan2(-c0[1], c0[0]))
        a1 = math.degrees(math.atan2(-c1[1], c1[0]))
        if a1 < a0:
            a1 += 360
        arc = [polar(a1 - (a1 - a0) * i / seg, r_hole) for i in range(seg + 1)]
        p.prism(mat, [c0, c1] + arc, y0, y1)


def square(half):
    return [(half, half), (half, -half), (-half, -half), (-half, half)]


def hexagon(r, rot=30):
    return [polar(rot + 60 * k, r) for k in range(6)]


def square_frame(p, mat, ox, oz, hx, hz, y0, y1, cx=0.0, cz=0.0):
    """A rectangular frame: outer ox x oz round a hole hx x hz (all full sizes), centred at (cx, cz)."""
    h = y1 - y0
    tz, tx = (oz - hz) / 2, (ox - hx) / 2
    p.box(mat, ox, h, tz, cx, y0 + h / 2, cz + (oz - tz) / 2)
    p.box(mat, ox, h, tz, cx, y0 + h / 2, cz - (oz - tz) / 2)
    p.box(mat, tx, h, hz, cx + (ox - tx) / 2, y0 + h / 2, cz)
    p.box(mat, tx, h, hz, cx - (ox - tx) / 2, y0 + h / 2, cz)


def trench_hardstand(p, hs, w, slope=None, r=RH, closed_back=None, top='concrete', side='slope'):
    """
    A raised concrete hardstand with sloped sides, a flame trench of width w cut through it along z (both ways, or only
    toward +z when closed_back = z of the back wall), its walls lined with heat-proof brick near the ship.
    """
    slope = 1.0 * hs if slope is None else slope
    with p.node('hardstand'):
        return _trench_hardstand(p, hs, w, slope, r, closed_back, top, side)


def _trench_hardstand(p, hs, w, slope, r, closed_back, top, side):
    lo, hi = octagon(r + slope), octagon(r)
    if closed_back is None:
        for s in (1, -1):
            p.loft(side, clip(lo, s, 0, w / 2), clip(hi, s, 0, w / 2), 0, hs, top=top)
    else:
        for s in (1, -1):
            p.loft(side, clip(clip(lo, s, 0, w / 2), 0, 1, -closed_back), clip(clip(hi, s, 0, w / 2), 0, 1, -closed_back), 0, hs, top=top)
        # behind the back wall (z < closed_back) the hardstand is whole
        p.loft(side, clip(lo, 0, -1, -closed_back), clip(hi, 0, -1, -closed_back), 0, hs, top=top)
    L = 2 * (r + slope) + 3
    z0 = -L / 2 if closed_back is None else closed_back
    z1 = L / 2
    p.box('trench', w, 0.1, z1 - z0, 0, 0.05, (z0 + z1) / 2)
    # brick lining where the plume hits, and low kerbs along the trench's run-out
    for s in (-1, 1):
        zb0 = -7.0 if closed_back is None else closed_back + 0.05
        p.box('brick', 0.08, hs - 0.35, 7.0 - zb0, s * (w / 2 - 0.04), 0.1 + (hs - 0.35) / 2, (zb0 + 7.0) / 2)
        for zz in ((r + slope - 0.5, z1), (z0, -(r + slope - 0.5)) if closed_back is None else None):
            if zz is None:
                continue
            p.box('concrete_old', 0.35, 0.5, zz[1] - zz[0], s * (w / 2 + 0.175), 0.25, (zz[0] + zz[1]) / 2)
    if closed_back is not None:
        p.box('brick', w, hs - 0.35, 0.08, 0, 0.1 + (hs - 0.35) / 2, closed_back + 0.04)
    # scorched ground where the trench lets the fire out
    for zz in ((z1 - 1.0,) if closed_back is not None else (z1 - 1.0, z0 + 1.0)):
        scorch(p, 0, zz + (1.8 if zz > 0 else -1.8), 6.0, w * 1.7, ax=90, seed=int(abs(zz)))
    return z0, z1


def wedge_deflector(p, w, apex, run, base=0.3, rails=True):
    """The two-way flame deflector of LC-39 / LC-34: an inverted V of steel with a heat-proof face, on rail trucks."""
    pts = []
    for i in range(7):
        t = i / 6
        pts.append((base + (apex - base) * (1 - t) ** 1.45, -run * t))
    prof = [(base, -run)] + list(reversed(pts[:-1])) + [(apex, 0)] + [(y, -z) for (y, z) in pts[1:-1]] + [(base, run)]
    p.side_prism('ceramic', prof, -w / 2, w / 2)
    # the steel side girders and the cross frames under the faces
    for s in (-1, 1):
        p.side_prism('steel_dark', [(base - 0.05, -run - 0.05), (apex + 0.06, 0), (base - 0.05, run + 0.05)], s * w / 2 - (0.12 if s > 0 else 0), s * w / 2 + (0.0 if s > 0 else 0.12))
    for zz in (-run * 0.66, -run * 0.33, run * 0.33, run * 0.66):
        p.box('steel_dark', w, 0.12, 0.12, 0, base + 0.06, zz)
    # rail trucks and the rails it rolls in on
    for sx in (-1, 1):
        for zz in (-run * 0.7, 0.0, run * 0.7):
            p.box('steel_dark', 0.5, 0.22, 0.7, sx * (w / 2 - 0.45), 0.2, zz)
            for dz in (-0.22, 0.22):
                with p.at(T(sx * (w / 2 - 0.45), 0.16, zz + dz) @ Rz(90)):
                    p.cyl('steel', 0.1, -0.3, 0.3, seg=10)
        if rails:
            p.box('steel', 0.12, 0.08, 2 * run + 3.0, sx * (w / 2 - 0.45), 0.13, 0)


def ramp_deflector(p, w, apex, back, run, ribs=5):
    """
    Pad 39B's one-way flame deflector (2018): a curved steel ramp of box ribs and cross members, faced with heat-proof
    steel plates, turning the whole plume north (+z) down the trench (refs deflector_39b_1/2).
    """
    curve = []
    for i in range(9):
        t = i / 8
        curve.append((0.25 + (apex - 0.25) * (1 - t) ** 1.9, back + (run - back) * t))
    face = curve + [(0.25, run), (0.25, back - 0.6), (apex - 0.4, back - 0.6)]
    # the face: a thin curved plate on top of the ribs (thickness 0.12)
    plate = curve + [(y - 0.14, z + 0.05) for (y, z) in reversed(curve)]
    p.side_prism('steel_dark', plate, -w / 2, w / 2)
    for k in range(ribs):
        x = -w / 2 + 0.2 + (w - 0.4) * k / (ribs - 1)
        rib = [(y - 0.12, z) for (y, z) in curve] + [(0.25, run - 0.3), (0.25, back - 0.6), (apex - 0.4, back - 0.6)]
        rib = [(0.25, back - 0.6)] + [(apex - 0.4, back - 0.6)] + [(y - 0.12, z) for (y, z) in curve] + [(0.25, run - 0.2)]
        p.side_prism('grey', rib, x - 0.13, x + 0.13)
        # lightening holes in the rib, drawn as dark recessed panels on both faces
        for (y, z) in curve[1:-2:2]:
            yy = (y - 0.12 + 0.25) / 2
            if y - 0.12 - 0.25 > 0.7:
                for s in (-1, 1):
                    p.box('steel_dark', 0.02, (y - 0.12 - 0.25) * 0.45, 0.45, x + s * 0.135, yy, z)
    for (y, z) in curve[1:-1:2]:
        p.box('grey', w - 0.2, 0.16, 0.16, 0, max(0.4, (y - 0.12) * 0.55), z)
    p.box('grey', w, apex - 0.4 - 0.25, 0.3, 0, (apex - 0.4 + 0.25) / 2, back - 0.45)


def trench():
    """
    A flame trench through a raised hardstand (LC-39A/B, SLC-40, SLC-41, Wallops): hardstand 1.2 D above the trench
    floor, trench 1.9 D wide, brick-lined walls, the two-way wedge deflector and 39B's one-way ramp (show one), and the
    steel launch table that spans the trench when there is no mobile platform (mount = trench).
    """
    p = Piece('trench', 'rocket axis, on the ground', {'xyz': 'D'},
              'mount = trench (with node table) or under mlp / ml1 (hide table). Show one of deflector_wedge, deflector_ramp.')
    hs = 1.2 * D
    trench_hardstand(p, hs, TRENCH_W)
    # light poles and a drain at the hardstand's edge
    for a in (100, 260):
        x, z = polar(a, RH - 0.8)
        p.cyl('steel', 0.07, hs, hs + 5.5, x, z, seg=8)
        p.box('grey', 0.6, 0.25, 0.3, x, hs + 5.5, z)
    with p.node('deflector_wedge'):
        wedge_deflector(p, TRENCH_W - 0.2, hs - 0.25, 2.9)
    with p.node('deflector_ramp'):
        ramp_deflector(p, TRENCH_W - 0.2, hs - 0.15, -1.3, 6.0)
    with p.node('table'):
        ty0, tt = hs, 0.7
        o = TRENCH_W + 1.3
        square_frame(p, 'steel', o, o, HOLE, HOLE, ty0, ty0 + tt)
        for sx in (-1, 1):
            for sz in (-1, 1):
                p.box('steel_dark', 0.8, 0.12, 0.8, sx * (o / 2 - 0.4), ty0 + tt + 0.06, sz * (o / 2 - 0.4))
        # stiffener ribs on the table's faces and the clamp seats on top
        for k in range(7):
            f = -o / 2 + o * (k + 0.5) / 7
            for s in (-1, 1):
                p.box('steel_dark', 0.08, tt - 0.1, 0.05, f, ty0 + tt / 2, s * (o / 2 + 0.02))
                p.box('steel_dark', 0.05, tt - 0.1, 0.08, s * (o / 2 + 0.02), ty0 + tt / 2, f)
        for a in (22.5, 112.5, 202.5, 292.5):
            x, z = polar(a, HOLE / 2 + 0.35)
            p.box('steel_dark', 0.45, 0.12, 0.45, x, ty0 + tt + 0.06, z, ry=a)
        p.mark('table', (0, ty0 + tt, 0), parent='table')
    p.mark('deck', (0, hs, 0))
    return p, {'ship': (0, hs + 0.7, 0)}


# ------------------------------------------------------------------ the slab
def slab():
    """A bare concrete launch slab: hardstand, scorch, expansion joints, cable-trench covers, tie-down plates."""
    p = Piece('slab', 'rocket axis, on the ground', {'xyz': 'D'}, 'mount = slab. The ship stands on attach_deck.')
    hs = 0.45
    with p.node('hardstand'):
        p.prism('concrete_old', octagon(RH + 0.06), 0, hs - 0.06)
        p.prism('slab_top', octagon(RH), hs - 0.06, hs)
    for i in range(6):
        p.box('steel_dark', 0.85, 0.04, 0.7, 2.6 + i * 0.95, hs + 0.02, 0.0)
    for a in (45, 135, 225, 315):
        x, z = polar(a, 1.75)
        p.box('steel_dark', 0.5, 0.05, 0.5, x, hs + 0.025, z, ry=a)
        with p.at(T(x, 0, z) @ Ry(a)):
            for bx, bz in ((0.15, 0.15), (-0.15, 0.15), (0.15, -0.15), (-0.15, -0.15)):
                p.cyl('steel', 0.035, hs + 0.05, hs + 0.11, bx, bz, seg=6)
    for a in (110, 250):
        x, z = polar(a, 5.2)
        p.box('steel_dark', 1.2, 0.03, 0.5, x, hs + 0.012, z, ry=a)
    p.mark('deck', (0, hs, 0))
    return p, {'ship': (0, hs, 0)}


# ------------------------------------------------------------------ Starbase launch mounts
def mount_raised():
    """
    Starbase Pad 1's orbital launch mount: six steel legs on concrete plinths, a heavy table round a 1.3 D opening with
    twenty hold-down clamps, the booster quick-disconnect on the tower side, and (node plate) the water-cooled steel
    plate on the ground that is both the flame deflector and the deluge (fitted after Flight 1, 2023).
    """
    p = Piece('mount_raised', 'rocket axis, on the ground', {'xyz': 'D'},
              'mount = raised (Starbase Pad 1). Hide node plate when the pad has no water.')
    hs, top, tt = 0.45, 2.0 * D, 0.9
    with p.node('hardstand'):
        p.prism('concrete_old', octagon(RH + 0.06), 0, hs - 0.06)
        p.prism('concrete', octagon(RH), hs - 0.06, hs)
    r_leg = 2.55
    for k in range(6):
        a = 30 + 60 * k
        x, z = polar(a, r_leg)
        p.box('concrete_old', 1.1, 0.5, 1.1, x, hs + 0.25, z, ry=a, chamfer=0.08)
        p.lathe('steel_dark', [(0.5, hs + 0.5), (0.42, hs + 0.75), (0.4, top - tt - 0.3), (0.5, top - tt)], seg=20, x=x, z=z)
        p.box('steel_dark', 0.9, 0.12, 0.9, x, hs + 0.56, z, ry=a)
    # the table: a hexagonal steel ring, the twenty clamps round its opening, and a shield ring inside the opening
    hexo = hexagon(3.05)
    poly_ring(p, 'steel', hexo, HOLE / 2, top - tt, top, seg=5)
    p.lathe('steel_dark', [(HOLE / 2 + 0.01, top - tt - 0.05), (HOLE / 2 + 0.01, top + 0.02)], seg=40, caps=False)
    for k in range(6):
        a0, a1 = 30 + 60 * k, 90 + 60 * k
        (x0, z0), (x1, z1) = polar(a0, 3.07), polar(a1, 3.07)
        for f in (0.25, 0.5, 0.75):
            p.box('steel_dark', 0.08, tt - 0.12, 0.08, x0 + (x1 - x0) * f, top - tt / 2, z0 + (z1 - z0) * f)
        p.beam('steel_dark', (x0, top - 0.06, z0), (x1, top - 0.06, z1), 0.1)
    for k in range(20):
        a = 9 + 18 * k
        with p.at(Ry(a)):
            p.box('steel_dark', 0.42, 0.3, 0.24, HOLE / 2 + 0.3, top + 0.15, 0)
            p.box('steel', 0.16, 0.16, 0.2, HOLE / 2 + 0.06, top + 0.25, 0)
            p.cyl('steel', 0.05, top + 0.05, top + 0.42, HOLE / 2 + 0.52, 0, seg=6)
    # booster quick-disconnect on the tower side: a hooded housing on the table, its lines down a leg
    with p.at(T(2.35, top, 0)):
        p.box('grey', 0.9, 0.85, 1.25, 0, 0.42, 0, chamfer=0.05)
        p.box('steel_dark', 0.5, 0.35, 0.9, -0.55, 0.3, 0)
        for dz in (-0.35, 0, 0.35):
            p.tube('rubber', (0.2, 0.2, dz), (0.65, -tt - 0.2, dz), 0.07, seg=6)
    for dz in (-0.35, 0, 0.35):
        p.tube('steel', (2.95, top - tt - 0.2, dz), (2.95, hs, dz), 0.07, seg=6)
    with p.node('plate'):
        ph = hs + 0.3
        p.box('steel_dark', 5.4, 0.3, 5.4, 0, hs + 0.15, 0, chamfer=0.04)
        for k in range(-5, 6):
            p.box('steel', 0.06, 0.04, 5.2, k * 0.47, ph + 0.02, 0)
        for s in (-1, 1):
            p.box('steel', 5.2, 0.12, 0.2, 0, ph + 0.06, s * 2.6)
        for a in (45, 135, 225, 315):
            (x0, z0), (x1, z1) = polar(a, 3.6), polar(a, 6.2)
            p.tube('steel', (x0, ph - 0.12, z0), (x1, hs + 0.25, z1), 0.22, seg=10)
            p.cyl('steel_dark', 0.32, hs, hs + 0.5, x1, z1, seg=12)
    p.mark('deck', (0, top, 0))
    return p, {'ship': (0, top, 0)}


def mount_olm2():
    """
    Starbase Pad 2's launch mount (2025): a square table on four legs set on the walls of a dug flame trench, its deck
    water-cooled, a steel flame diverter under the opening turning the fire down the trench (+z).
    """
    p = Piece('mount_olm2', 'rocket axis, on the ground', {'xyz': 'D'}, 'mount = raised at Starbase Pad 2 (flame trench, no plate).')
    hs, top, tt = 2.0, 2.0 * D, 0.9
    trench_hardstand(p, hs, TRENCH_W, closed_back=-3.2)
    o = 5.2
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = sx * 2.65, sz * 2.0
            p.box('concrete_old', 1.0, 0.25, 1.0, x, hs + 0.12, z)
            p.box('steel_dark', 0.7, top - tt - hs - 0.25, 0.7, x, (hs + 0.25 + top - tt) / 2, z)
            p.beam('steel_dark', (x, hs + 0.4, z), (x - sx * 0.9, top - tt - 0.05, z), 0.28)
    ring_y0 = top - tt
    square_frame(p, 'steel', o, o, HOLE, HOLE, ring_y0, top)
    # the water-cooled deck: steel top plates with their coolant pipes and the clamp housings
    for s in (-1, 1):
        p.box('steel', o - 0.2, 0.08, 0.12, 0, top + 0.04, s * (o / 2 - 0.25))
        p.box('steel', 0.12, 0.08, o - 0.2, s * (o / 2 - 0.25), top + 0.04, 0)
        p.box('steel', o - 0.2, 0.08, 0.12, 0, top + 0.04, s * (HOLE / 2 + 0.2))
        p.box('steel', 0.12, 0.08, o - 0.2, s * (HOLE / 2 + 0.2), top + 0.04, 0)
    for k in range(16):
        a = 11.25 + 22.5 * k
        with p.at(Ry(a)):
            p.box('steel_dark', 0.4, 0.3, 0.26, HOLE / 2 + 0.55, top + 0.15, 0)
    for s in (-1, 1):
        p.tube('steel', (s * (o / 2 + 0.25), hs + 0.1, -2.8), (s * (o / 2 + 0.25), top - 0.2, -2.8), 0.12, seg=8)
        p.tube('steel', (s * (o / 2 + 0.25), top - 0.2, -2.8), (s * (o / 2 - 0.1), top - 0.2, -2.8), 0.12, seg=8)
    # the flame diverter: a curved steel ramp under the opening, down into the trench
    ramp_deflector(p, TRENCH_W - 0.15, hs - 0.1, -2.6, 4.2, ribs=4)
    p.mark('deck', (0, top, 0))
    return p, {'ship': (0, top, 0)}


# ------------------------------------------------------------------ LC-34's pedestal
def pedestal_lc34():
    """
    LC-34's launch pedestal (1961-68, Saturn I and IB, Apollo 1 and 7): a concrete table 2 D square and 1.2 D high on
    four corner piers, open on all four sides, a 1.2 D round opening, eight hold-down arms on top; the two-way wedge
    deflector rolled in under it on rails (refs lc34_1, lc34_2).
    """
    p = Piece('pedestal_lc34', 'rocket axis, on the ground', {'xyz': 'D'}, 'mount = pedestal at LC-34. deflector_wedge rolls on its rails (-x).')
    hs = 0.45
    with p.node('hardstand'):
        p.prism('concrete_old', octagon(RH + 0.06), 0, hs - 0.06)
        p.prism('concrete', octagon(RH), hs - 0.06, hs)
    half, top, slab_t = 2.45, hs + 1.2 * D, 0.62
    pier = 1.25
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.box('concrete_old', pier, top - slab_t - hs, pier, sx * (half - pier / 2), (hs + top - slab_t) / 2, sz * (half - pier / 2), chamfer=0.04)
            # the inner pilaster seen through the openings
            p.box('concrete_old', 0.35, top - slab_t - hs, 0.35, sx * (half - pier - 0.15), (hs + top - slab_t) / 2, sz * (half - pier / 2), chamfer=0.02)
    poly_ring(p, 'concrete_old', square(half + 0.08), 1.2 * D / 2, top - slab_t, top, seg=6)
    # the slab's soffit beams over the openings
    for s in (-1, 1):
        p.box('concrete_old', 2 * half - 2 * pier, 0.3, 0.5, 0, top - slab_t - 0.15, s * (half - 0.25))
        p.box('concrete_old', 0.5, 0.3, 2 * half - 2 * pier, s * (half - 0.25), top - slab_t - 0.15, 0)
    # eight hold-down arms round the opening
    with p.node('holddown'):
        for k in range(8):
            a = 22.5 + 45 * k
            with p.at(Ry(a)):
                r0 = 1.2 * D / 2 + 0.35
                p.box('steel_dark', 0.55, 0.28, 0.42, r0 + 0.1, top + 0.14, 0)
                p.box('steel_dark', 0.22, 0.55, 0.3, r0, top + 0.42, 0)
                p.box('steel', 0.42, 0.14, 0.26, r0 - 0.2, top + 0.68, 0)
    # rails out to where the deflectors were parked, and the deflector itself under the opening
    for s in (-1, 1):
        p.box('steel', 13.0, 0.06, 0.12, -4.5, hs + 0.03, s * 1.4)
    with p.node('deflector_wedge'):
        with p.at(T(0, hs, 0) @ Ry(90)):
            wedge_deflector(p, 3.6, top - slab_t - hs - 0.15, 2.4, base=0.2, rails=False)
    p.mark('deck', (0, top, 0))
    return p, {'ship': (0, top, 0)}


# ------------------------------------------------------------------ Gagarin's Start
def pit():
    """
    Gagarin's Start (and Plesetsk, Site 31): the launch ring on four concrete legs at the edge of a deep flame pit
    that opens out on one side (-x), a sloped deflector under the ship. The tulip arms are their own piece
    (soyuz_launcher, clamps = tulip) standing on attach_ring.
    """
    p = Piece('pit', 'rocket axis, on the ground', {'xyz': 'D'}, 'mount = deflector (flame pit). soyuz_launcher stands on attach_ring.')
    hs = 1.2
    pit_w = TRENCH_W * 1.3
    hi = octagon(RH)
    p.node('hardstand').__enter__()
    # the platform: the hardstand everywhere except the pit, which runs out to -x from under the ship
    p.prism('concrete_old', clip(hi, 1, 0, HOLE / 2), 0, hs - 0.06)
    p.prism('concrete', clip(hi, 1, 0, HOLE / 2), hs - 0.06, hs)
    for s in (1, -1):
        part = clip(clip(hi, -1, 0, -HOLE / 2), 0, s, pit_w / 2)
        p.prism('concrete_old', part, 0, hs - 0.06)
        p.prism('concrete', part, hs - 0.06, hs)
    L = RH + 12
    p.box('trench', L, 0.1, pit_w, HOLE / 2 - L / 2, 0.05, 0)
    # beyond the platform the pit is cut through the ground: concrete walls, earth banks falling away outside them
    for s in (-1, 1):
        x0, x1 = -L + HOLE / 2, -RH * 0.7
        p.side_prism('slope', [(0.0, s * (pit_w / 2 + 0.4)), (hs, s * (pit_w / 2 + 0.4)), (hs, s * (pit_w / 2 + 2.0)), (0.0, s * (pit_w / 2 + 2.0 + 2.6 * hs))], x0, x1)
        p.box('concrete_old', x1 - x0, hs, 0.4, (x0 + x1) / 2, hs / 2, s * (pit_w / 2 + 0.2))
    scorch(p, -L + HOLE / 2 + 5.0, 0, 9.0, pit_w * 0.9, seed=5, y=0.12)
    p.cur = p.nodes[0]
    # the deflector: a steel-faced concrete slope under the ship, falling away into the pit
    run = HOLE + 2.2
    p.front_prism('steel_dark', [(HOLE / 2 + 0.3, hs - 0.15), (HOLE / 2 + 0.3, 0.1), (HOLE / 2 - run, 0.1)], -pit_w / 2 + 0.1, pit_w / 2 - 0.1)
    for k in range(5):
        x = HOLE / 2 + 0.3 - run * (k + 0.5) / 5
        y = 0.1 + (hs - 0.25) * (x - (HOLE / 2 - run)) / run
        p.box('steel', 0.08, 0.06, pit_w - 0.3, x, y + 0.05, 0, rz=math.atan2(hs - 0.25, run))
    # four concrete legs and the steel launch ring over the pit's edge
    S, top = RING, hs + 1.2 * D
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.box('concrete_old', 0.8, top - 0.5 - hs, 0.8, sx * (S / 2 - 0.4), (hs + top - 0.5) / 2, sz * (S / 2 - 0.4), chamfer=0.04)
    square_frame(p, 'green', S, S, HOLE, HOLE, top - 0.5, top)
    for s in (-1, 1):
        p.box('steel_dark', S + 0.1, 0.1, 0.1, 0, top - 0.25, s * (S / 2 + 0.03))
        p.box('steel_dark', 0.1, 0.1, S + 0.1, s * (S / 2 + 0.03), top - 0.25, 0)
    p.railing('yellow', [(S / 2, S / 2), (S / 2, -S / 2), (-S / 2, -S / 2), (-S / 2, S / 2)], top, closed=True, step=1.2)
    p.mark('ring', (0, top, 0))
    p.mark('deck', (0, hs, 0))
    return p, {'ship': (0, top, 0)}


# ------------------------------------------------------------------ mobile launch platforms
def mlp_deck(p, x0, x1, hw, holes, ped_h, deck_h, rails=True):
    """
    A two-storey steel platform from x0 to x1 and -hw..hw, on six pedestals (node pedestals), with rectangular holes
    [(cx, cz, sx, sz)]. Returns the deck top.
    """
    y0, y1 = ped_h, ped_h + deck_h
    # the deck slab cut round its holes: a grid of boxes between the hole edges
    xs = sorted({x0, x1} | {h[0] - h[2] / 2 for h in holes} | {h[0] + h[2] / 2 for h in holes})
    zs = sorted({-hw, hw} | {h[1] - h[3] / 2 for h in holes} | {h[1] + h[3] / 2 for h in holes})
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if any(abs(cx - h[0]) < h[2] / 2 and abs(cz - h[1]) < h[3] / 2 for h in holes):
                continue
            w, d = xs[i + 1] - xs[i], zs[j + 1] - zs[j]
            p.box('grey', w, deck_h - 0.05, d, cx, y0 + (deck_h - 0.05) / 2, cz)
            p.box('deck', w, 0.05, d, cx, y1 - 0.025, cz)
    # hole linings (blast shields) and the panel lines of the two storeys on the sides
    for (cx, cz, sx, sz) in holes:
        square_frame(p, 'steel_dark', sx + 0.02, sz + 0.02, sx - 0.06, sz - 0.06, y0 + 0.05, y1 + 0.03, cx, cz)
    L = x1 - x0
    for y in (y0 + deck_h * 0.5, y1 - 0.06):
        p.box('steel_dark', L + 0.04, 0.1, 0.04, (x0 + x1) / 2, y, hw + 0.01)
        p.box('steel_dark', L + 0.04, 0.1, 0.04, (x0 + x1) / 2, y, -hw - 0.01)
        p.box('steel_dark', 0.04, 0.1, 2 * hw + 0.04, x0 - 0.01, y, 0)
        p.box('steel_dark', 0.04, 0.1, 2 * hw + 0.04, x1 + 0.01, y, 0)
    n = max(2, round(L / 1.25))
    for k in range(1, n):
        x = x0 + L * k / n
        for s in (-1, 1):
            p.box('steel_dark', 0.06, deck_h - 0.1, 0.05, x, y0 + deck_h / 2, s * (hw + 0.02))
    m = max(2, round(2 * hw / 1.25))
    for k in range(1, m):
        z = -hw + 2 * hw * k / m
        for x in (x0 - 0.02, x1 + 0.02):
            p.box('steel_dark', 0.05, deck_h - 0.1, 0.06, x, y0 + deck_h / 2, z)
    # doors and louvres on the storeys
    for s in (-1, 1):
        for f in (0.2, 0.55, 0.8):
            p.box('steel_dark', 0.7, 0.55, 0.03, x0 + L * f, y0 + deck_h * 0.25, s * (hw + 0.03))
    deck_rail(p, x0 + 0.1, x1 - 0.1, -hw + 0.1, hw - 0.1, y1)
    with p.node('pedestals'):
        for px in (x0 + 1.0, (x0 + x1) / 2, x1 - 1.0):
            for s in (-1, 1):
                p.box('concrete_old', 1.0, ped_h - 0.25, 1.0, px, (ped_h - 0.25) / 2, s * (hw - 0.9), chamfer=0.05)
                p.box('steel_dark', 0.85, 0.25, 0.85, px, ped_h - 0.125, s * (hw - 0.9))
    return y1


def deck_rail(p, x0, x1, z0, z1, y, h=1.1):
    p.railing('yellow', [(x0, z0), (x1, z0), (x1, z1), (x0, z1)], y, h=h, step=1.6, closed=True)


def saturn_holddown(p, a, r_rim, top):
    """A Saturn V hold-down arm on the deck at angle a: heavy base, column, and the arm over the stage's rim."""
    with p.at(Ry(a)):
        rb = r_rim + 0.55
        p.box('steel_dark', 0.62, 0.3, 0.72, rb, top + 0.15, 0, chamfer=0.03)
        p.front_prism('steel_dark', [(rb - 0.2, top + 0.3), (rb + 0.3, top + 0.3), (rb + 0.18, top + 0.72), (rb - 0.08, top + 0.8)], -0.22, 0.22)
        p.box('steel', 0.5, 0.18, 0.32, rb - 0.3, top + 0.8, 0, rz=-0.25)
        p.box('steel', 0.14, 0.26, 0.3, r_rim + 0.02, top + 0.7, 0)
        p.cyl('yellow', 0.05, top + 0.3, top + 0.62, rb + 0.22, 0.3, seg=6)


def tsm(p, x, z, a, h, top, w=0.9, d=1.1):
    """A tail service mast: a steel housing with its umbilical carrier and the blast hood that drops at liftoff."""
    with p.at(T(x, top, z) @ Ry(a)):
        p.box('grey', d, h, w, 0, h / 2, 0, chamfer=0.04)
        p.front_prism('grey', [(-d / 2, h), (d / 2, h), (d / 2 - 0.1, h + 0.45), (-d / 2 + 0.2, h + 0.3)], -w / 2 - 0.05, w / 2 + 0.05)
        p.box('steel_dark', 0.08, h * 0.45, w * 0.7, -d / 2 - 0.04, h * 0.55, 0)
        for dz in (-0.2, 0.2):
            p.tube('rubber', (-d / 2 - 0.02, h * 0.45, dz), (-d / 2 - 0.6, h * 0.2, dz), 0.06, seg=6)


def rainbird(p, x, z, a, top, h=1.1):
    """A 'rainbird' deck nozzle (Shuttle and SLS platforms): a riser with an elbow and a wide nozzle aimed at the hole."""
    with p.at(T(x, top, z) @ Ry(a)):
        p.cyl('steel', 0.12, 0, h, seg=10)
        p.box('steel_dark', 0.4, 0.12, 0.4, 0, 0.06, 0)
        p.tube('steel', (0, h, 0), (-0.45, h + 0.25, 0), 0.11, seg=10)
        p.tube('steel_dark', (-0.45, h + 0.25, 0), (-0.75, h + 0.4, 0), 0.13, r2=0.2, seg=10)


def mlp_saturn():
    """
    The Saturn V mobile launcher's base (LC-39A/B 1967-75): a two-storey steel platform 3 D across, its one square
    exhaust hole under the ship, four hold-down arms, three tail service masts, on six pedestals; the launch umbilical
    tower (tower_fixed) stands on its deck at attach_tower (ref ml_saturn_1).
    """
    p = Piece('mlp_saturn', 'rocket axis, at the pedestals\' feet (the trench hardstand)', {'xyz': 'D'},
              'mount = mlp with a tower on the deck (Saturn V). tower_fixed stands at attach_tower.')
    ped, dh = 0.65 * D, 0.75 * D
    x0, x1, hw = -HOLE / 2 - 1.0, TOWER_X + 0.65 * D + 0.5, 1.5 * D
    top = mlp_deck(p, x0, x1, hw, [(0, 0, HOLE, HOLE)], ped, dh)
    with p.node('holddown'):
        for a in (45, 135, 225, 315):
            saturn_holddown(p, a, R, top)
    with p.node('tsm'):
        for a in (0, 120, 240):
            x, z = polar(a, HOLE / 2 + 0.75)
            tsm(p, x, z, a, 0.45 * D, top, w=0.7, d=0.8)
    # deck hatches, a crane rail and the umbilical lines' trays toward the tower
    for (hx, hz) in ((-1.8, 2.6), (-1.6, -2.7), (3.0, 2.8), (3.2, -2.5)):
        p.box('steel_dark', 1.0, 0.04, 0.8, hx, top + 0.02, hz)
    for dz in (-0.6, 0.6):
        p.box('steel_dark', TOWER_X - 0.65 * D - HOLE / 2 - 0.3, 0.18, 0.35, (HOLE / 2 + TOWER_X - 0.65 * D) / 2, top + 0.09, dz)
    p.mark('deck', (0, top, 0))
    p.mark('tower', (TOWER_X, top, 0))
    return p, {'ship': (0, top, 0)}


def mlp_shuttle():
    """
    The Shuttle-era mobile launcher platform (MLP-1..3, 1981-2011; SLS uses ML-1): a two-storey steel platform 3 D
    across with three exhaust holes (the core and two strap-ons), two tail service masts with their blast hoods, six
    rainbird deck nozzles and eight hold-down posts for the strap-ons, on six pedestals (refs mlp_shuttle_1/2,
    mlp_rainbird_1/2). The fixed and rotating service structures stand on the pad, not on it.
    """
    p = Piece('mlp_shuttle', 'rocket axis, at the pedestals\' feet (the trench hardstand)', {'xyz': 'D'},
              'mount = mlp with the tower on the pad (Shuttle era). Hide node posts when the ship has no strap-ons.')
    ped, dh = 0.65 * D, 0.75 * D
    hw, hl = 1.5 * D, 1.85 * D
    holes = [(0, 0, HOLE, HOLE)] + [(-0.2, s * (HOLE / 2 + 0.35 + 0.55), 1.6, 1.1) for s in (1, -1)]
    top = mlp_deck(p, -hl, hl, hw, holes, ped, dh)
    with p.node('tsm'):
        for s in (1, -1):
            tsm(p, HOLE / 2 + 0.75, s * 1.15, 0, 1.15 * D, top, w=1.0, d=1.2)
    with p.node('rainbirds'):
        for (x, z) in ((-hl + 0.6, 2.9), (-hl + 0.6, -2.9), (hl - 0.6, 2.9), (hl - 0.6, -2.9), (-hl + 0.6, 0.0), (hl - 0.5, 0.0)):
            rainbird(p, x, z, math.degrees(math.atan2(-z, x)), top)
    with p.node('posts'):
        for s in (1, -1):
            cz = s * (HOLE / 2 + 0.35 + 0.55)
            for (dx, dz) in ((-0.55, -0.42), (0.55, -0.42), (-0.55, 0.42), (0.55, 0.42)):
                x, z = -0.2 + dx * 1.15, cz + dz * 1.0
                p.lathe('steel_dark', [(0.16, top), (0.11, top + 0.32), (0.13, top + 0.36), (0.0, top + 0.42)], seg=10, x=x, z=z)
    for (hx, hz) in ((-hl + 1.4, 1.6), (hl - 1.5, -1.8), (hl - 1.7, 1.9)):
        p.box('steel_dark', 1.0, 0.04, 0.8, hx, top + 0.02, hz)
    p.mark('deck', (0, top, 0))
    return p, {'ship': (0, top, 0)}


# ------------------------------------------------------------------ Ariane 5's ELA-3 table
def table_ela3():
    """
    ELA-3's mobile launch table (Ariane 5, 1996-2023): a steel table 3 D across on six legs, rolled on rails onto the
    pad over the flame ducts; three openings (the core and two strap-ons), two yellow umbilical masts with their arms,
    stairs and railings; the concrete flame duct runs out under it (+z) (ref ariane5_ela3_2).
    """
    p = Piece('table_ela3', 'rocket axis, on the ground', {'xyz': 'D'}, 'mount = mlp at ELA-3 (table on the duct). Hide node masts if a tower serves the ship.')
    hs = 1.15 * D
    trench_hardstand(p, hs, TRENCH_W, closed_back=-3.0)
    leg_h, dt = 1.2, 0.55
    y0, top = hs + leg_h, hs + leg_h + dt
    hx, hz = 1.5 * D, 1.2 * D
    sb = HOLE / 2 + 0.75
    holes = [(0, 0, HOLE * 0.85, HOLE * 0.85), (sb + 0.25, 0, 1.0, 1.5), (-sb - 0.25, 0, 1.0, 1.5)]
    xs = sorted({-hx, hx} | {h[0] - h[2] / 2 for h in holes} | {h[0] + h[2] / 2 for h in holes})
    zs = sorted({-hz, hz} | {h[1] - h[3] / 2 for h in holes} | {h[1] + h[3] / 2 for h in holes})
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if any(abs(cx - h[0]) < h[2] / 2 and abs(cz - h[1]) < h[3] / 2 for h in holes):
                continue
            p.box('grey', xs[i + 1] - xs[i], dt - 0.04, zs[j + 1] - zs[j], cx, y0 + (dt - 0.04) / 2, cz)
            p.box('deck', xs[i + 1] - xs[i], 0.04, zs[j + 1] - zs[j], cx, top - 0.02, cz)
    for (cx, cz, sx, sz) in holes:
        square_frame(p, 'steel_dark', sx + 0.02, sz + 0.02, sx - 0.06, sz - 0.06, y0, top + 0.02, cx, cz)
    # legs and cross bracing, the under-deck girders
    for lx in (-hx + 0.3, 0.0, hx - 0.3):
        for s in (-1, 1):
            if lx == 0.0:
                continue
            p.box('grey', 0.4, leg_h, 0.4, lx, hs + leg_h / 2, s * (hz - 0.3))
    for s in (-1, 1):
        for lx in (-hx + 0.3, hx - 0.3):
            p.xbrace_face('steel', (lx, hs + 0.1, s * (hz - 0.3)), (lx, hs + 0.1, -s * (hz - 0.3)), (lx, y0, -s * (hz - 0.3)), (lx, y0, s * (hz - 0.3)), 0.1)
        p.xbrace_face('steel', (-hx + 0.3, hs + 0.1, s * (hz - 0.3)), (hx - 0.3, hs + 0.1, s * (hz - 0.3)), (hx - 0.3, y0, s * (hz - 0.3)), (-hx + 0.3, y0, s * (hz - 0.3)), 0.1, n=1)
    for s in (-1, 1):
        p.box('steel_dark', 2 * hx, 0.18, 0.12, 0, y0 - 0.09, s * (hz - 0.3))
    # rail bogies and the rails it came in on (from -z, the assembly building)
    for lx in (-hx + 0.3, hx - 0.3):
        p.box('steel', 0.14, 0.08, 14.0, lx, hs + 0.04, -4.5)
    # the two umbilical masts at the strap-ons, yellow, with their arms reaching in
    with p.node('masts'):
        for s in (-1, 1):
            mx = s * (hx - 0.55)
            p.lattice('yellow', x=mx, z=-hz + 0.55, w=0.55, y0=top, y1=top + 3.6, bay=0.9, t=0.09)
            p.box('yellow', 0.8, 0.08, 0.8, mx, top + 3.62, -hz + 0.55)
            for yy in (top + 1.2, top + 2.6):
                p.truss('yellow', (mx, yy, -hz + 0.8), (s * (sb + 0.6), yy - 0.2, -0.55), 0.3, 0.3, panel=0.6, t=0.05)
                p.tube('rubber', (mx, yy - 0.25, -hz + 0.8), (s * (sb + 0.55), yy - 0.45, -0.5), 0.06, seg=6)
    # stairs from the pad to the deck at both ends, railings round the deck, the yellow water and fluid pipes
    for s in (-1, 1):
        p.stairs('grey', (s * (hx + 1.6), hs, hz - 0.6), (s * (hx + 0.1), top, hz - 0.6), width=0.8)
    p.railing('yellow', [(-hx + 0.1, -hz + 0.1), (hx - 0.1, -hz + 0.1), (hx - 0.1, hz - 0.1), (-hx + 0.1, hz - 0.1)], top, closed=True, step=1.4)
    for s in (-1, 1):
        p.tube('yellow', (s * (TRENCH_W / 2 + 2.5), hs + 0.25, -2.2), (s * (TRENCH_W / 2 + 2.5), hs + 0.25, 4.5), 0.13, seg=8)
        p.tube('yellow', (s * (TRENCH_W / 2 + 0.3), hs + 0.25, -2.2), (s * (TRENCH_W / 2 + 2.5), hs + 0.25, -2.2), 0.13, seg=8)
    p.mark('deck', (0, top, 0))
    return p, {'ship': (0, top, 0)}


# ------------------------------------------------------------------ gear at the ship's base
def holddown():
    """
    The gear that holds or feeds the ship's base, each kind in parts that art.js puts together at the ship's own grip
    height (the bottom of its lowest tank), the rocket on -x of each node's origin:
      - clamp_base, clamp_column (1 m tall: art stretches it), clamp_head (its origin at the grip): a Falcon 9-style
        hydraulic clamp whose jaw hooks the rim, its column 0.5 m out from the hull;
      - arm_saturn_base, arm_saturn_column, arm_saturn_head: a Saturn V hold-down arm (3.35 m real; four held the
        S-IC until all five F-1s were at full thrust), its hooded arm reaching 0.75 m in to the rim, a release pin;
      - post: an SLS / Shuttle hold-down post with its spherical bearing; tsm: a tail service mast 1.15 D tall with
        its blast hood (Shuttle 9.4 m / 8.4 m); mast_umbilical: the small umbilical mast of a bare pad.
    """
    p = Piece('holddown', 'each node on its own base (heads at the grip height); the rocket on -x of it', {'xyz': 'D'},
              'clamps = hold (clamp_*), release (arm_saturn_*); tower = tsm and platform TSMs (tsm). Columns stretch in y.')
    g = 1.2  # the reference grip height the parts are shown at
    # the clamp
    with p.node('clamp_base', (0, 0, 3.0)), p.at(T(0, 0, 3.0)):
        p.box('steel', 0.6, 0.35, 0.5, 0, 0.175, 0, chamfer=0.03)
        p.box('steel_dark', 0.7, 0.06, 0.6, 0, 0.03, 0)
        for dz in (-0.2, 0.2):
            for dx in (-0.22, 0.22):
                p.cyl('steel_dark', 0.03, 0.35, 0.4, dx, dz, seg=6)
    with p.node('clamp_column', (0, 0.35, 3.0)), p.at(T(0, 0.35, 3.0)):
        p.box('steel', 0.32, 1.0, 0.36, 0, 0.5, 0)
        p.box('steel_dark', 0.04, 1.0, 0.2, 0.17, 0.5, 0)
        p.cyl('steel_dark', 0.06, 0.0, 0.62, 0.3, 0.0, seg=8)
        p.cyl('steel', 0.035, 0.62, 0.98, 0.3, 0.0, seg=8)
    with p.node('clamp_head', (0, g, 3.0)), p.at(T(0, g, 3.0)):
        p.box('steel', 0.8, 0.16, 0.34, -0.31, -0.1, 0, chamfer=0.02)
        p.box('steel_dark', 0.1, 0.3, 0.34, -0.43, 0.05, 0)
        p.box('steel', 0.36, 0.16, 0.4, 0.0, -0.02, 0)
        p.box('steel_dark', 0.2, 0.08, 0.2, 0.3, -0.06, 0)
    # the Saturn V arm
    with p.node('arm_saturn_base', (0, 0, 0)):
        p.box('steel_dark', 1.0, 0.5, 0.9, 0, 0.25, 0, chamfer=0.04)
        for dz in (-0.46, 0.46):
            p.front_prism('steel_dark', [(-0.4, 0.5), (0.45, 0.5), (0.45, 0.62)], dz - 0.03, dz + 0.03)
        p.cyl('yellow', 0.07, 0.5, 0.9, 0.36, 0.3, seg=8)
    with p.node('arm_saturn_column', (0, 0.5, 0)), p.at(T(0, 0.5, 0)):
        p.box('steel_dark', 0.55, 1.0, 0.6, 0, 0.5, 0)
        for dz in (-0.31, 0.31):
            p.box('steel', 0.4, 1.0, 0.03, 0, 0.5, dz)
    with p.node('arm_saturn_head', (0, g, 0)), p.at(T(0, g, 0)):
        # the hood over the pivot, the arm reaching in to the rim, the jaw that clamps the stage's hold-down post
        p.front_prism('steel', [(-0.25, 0.05), (0.35, 0.05), (0.32, 0.42), (-0.05, 0.6), (-0.25, 0.45)], -0.37, 0.37)
        p.box('steel', 0.98, 0.24, 0.24, -0.4, 0.05, 0, chamfer=0.02)
        p.box('steel', 0.12, 0.42, 0.4, -0.87, -0.08, 0)
        p.box('steel_dark', 0.16, 0.12, 0.44, -0.87, 0.18, 0)
        with p.at(Rx(90)):
            p.cyl('steel_dark', 0.12, -0.4, 0.4, 0.05, -0.28, seg=10)
    # the Shuttle / SLS post, the tail service mast, the small umbilical mast
    with p.node('post', (0, 0, 6.0)), p.at(T(0, 0, 6.0)):
        p.box('steel_dark', 0.6, 0.12, 0.6, 0, 0.06, 0)
        p.lathe('steel_dark', [(0.2, 0.12), (0.13, 0.42), (0.16, 0.46)], seg=12)
        p.sphere('steel', 0.1, 0, 0.5, 0, seg=10, rings=6)
        p.box('yellow', 0.06, 0.25, 0.06, 0.22, 0.25, 0.22)
    with p.node('tsm', (0, 0, -3.0)):
        tsm(p, 0.0, -3.0, 0, 1.15 * D, 0.0, w=1.0, d=1.2)
    with p.node('mast_umbilical', (0, 0, -6.0)), p.at(T(0, 0, -6.0)):
        p.box('steel_dark', 0.6, 1.6, 0.6, 0, 0.8, 0)
        p.box('steel_dark', 0.9, 0.3, 0.35, -0.55, 1.3, 0)
        p.tube('rubber', (0.0, 1.0, 0.25), (-1.0, 1.1, 0.25), 0.07, seg=6)
        p.box('grey', 0.8, 0.12, 0.8, 0, 1.66, 0)
    return p, {'ship': (-3.0, -16.0, 0.0), 'frame': 9.0, 'views': ('detail',), 'ship_on': False}


PIECES = {
    'holddown': holddown,
    'slab': slab, 'trench': trench, 'mount_raised': mount_raised, 'mount_olm2': mount_olm2,
    'pedestal_lc34': pedestal_lc34, 'pit': pit, 'mlp_saturn': mlp_saturn, 'mlp_shuttle': mlp_shuttle,
    'table_ela3': table_ela3,
}
