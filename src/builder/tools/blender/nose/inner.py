"""
Inner pieces for nose parts (the explanation card's exploded view): seats and couches, crew in suits, hatches, docking
mechanisms, landing systems (chutes, soft-landing rockets, airbags), window assemblies, stowage. Each function writes
into an Acc in GAME coordinates, sized from real hardware in metres times the part's scale factor f.
Kept low-poly on purpose: every piece counts toward the part's 20k-triangle budget.
"""
import math
from mathutils import Vector
from nl import V, Acc, M, er, ea, polar, lathe, cyl, sphere, torus, tube, box, beam, patch, disc, DEG, TAU, NECK, lerp  # noqa: F401


# ------------------------------------------------------------------ seats
SEAT_LINE = [(-0.86, 0.44), (-0.83, 0.29), (-0.42, 0.31), (0.0, 0.0), (0.70, 0.03), (0.78, 0.08), (0.96, 0.09)]


def _ribbon(acc, pts, O, Lx, Uy, Ww, w, t, m, w_end=None):
    """A bent plate: the (L, Y) polyline `pts`, `w` wide across Ww, `t` thick (toward -Uy)."""
    P = [O + Lx * L + Uy * Y for (L, Y) in pts]
    n = len(P)
    nrm = []
    for k in range(n):
        a = P[max(0, k - 1)]
        b = P[min(n - 1, k + 1)]
        tng = (b - a).normalized()
        nn = Ww.cross(tng).normalized()
        if nn.dot(Uy) < 0:
            nn = -nn
        nrm.append(nn)
    ws = [w] * n if w_end is None else [lerp(w, w_end, k / (n - 1)) for k in range(n)]
    top = [(P[k] - Ww * ws[k] / 2, P[k] + Ww * ws[k] / 2) for k in range(n)]
    bot = [(a - nrm[k] * t, b - nrm[k] * t) for k, (a, b) in enumerate(top)]
    verts, faces = [], []
    for k in range(n):
        verts += [top[k][0], top[k][1], bot[k][0], bot[k][1]]
    for k in range(n - 1):
        a = 4 * k
        b = 4 * (k + 1)
        faces += [[a, b, b + 1, a + 1], [a + 2, a + 3, b + 3, b + 2], [a, a + 2, b + 2, b], [a + 1, b + 1, b + 3, a + 3]]
    faces += [[0, 1, 3, 2], [4 * (n - 1), 4 * (n - 1) + 2, 4 * (n - 1) + 3, 4 * (n - 1) + 1]]
    acc.add(verts, faces, m)
    return P, nrm


def seat(acc, kind, O, az_long, f, mats=None, floor_y=None):
    """
    One seat with its hip point at O, the body lying on its back along az_long (hips -> head), facing +y.
    kind: strut (Apollo couch on crushable struts), contour (Mercury moulded couch), kazbek (Soyuz moulded liner on a
    shock absorber), ejection (Vostok / Gemini seat on rails with a rocket catapult), fixed (rigid seat on a frame),
    carbon (Dragon / Starliner carbon shell), recliner (New Shepard).
    """
    s = f
    Lx, Ww, Uy = er(az_long), ea(az_long), V(0, 1, 0)
    pts = [(L * s, Y * s) for (L, Y) in SEAT_LINE]
    pan_m = (mats or {}).get('pan', M('seat'))
    frame_m = (mats or {}).get('frame', M('frame'))
    fy = floor_y if floor_y is not None else O.y - 0.35 * s
    if kind in ('contour', 'kazbek'):
        P, nrm = _ribbon(acc, pts, O, Lx, Uy, Ww, 0.56 * s, 0.05 * s, pan_m)
        for side in (-1, 1):  # the moulded sides of the liner
            for k in range(len(P) - 1):
                a, b = P[k] + Ww * side * 0.27 * s, P[k + 1] + Ww * side * 0.27 * s
                box(acc, (a + b) / 2 + Uy * 0.06 * s, (0.04 * s, 0.14 * s, (b - a).length), pan_m, (Ww, Uy, (b - a).normalized()))
        if kind == 'kazbek':  # the Kazbek shock absorber under the seat pan, down to the floor
            cyl(acc, O - Uy * 0.02 * s, V(O.x, fy, O.z), 0.06 * s, frame_m, 10)
            cyl(acc, O + Lx * 0.45 * s, V(O.x, fy, O.z) + Lx * 0.45 * s, 0.035 * s, frame_m, 8)
        else:
            for L in (-0.3, 0.45):
                beam(acc, O + Lx * L * s, V(O.x, fy, O.z) + Lx * L * s, 0.05 * s, 0.4 * s, frame_m)
    elif kind == 'strut':
        _ribbon(acc, pts, O, Lx, Uy, Ww, 0.52 * s, 0.04 * s, pan_m)
        for side in (-1, 1):  # the couch frame tubes
            path = [O + Lx * L + Uy * (Y - 0.05 * s) + Ww * side * 0.27 * s for (L, Y) in pts[1:]]
            tube(acc, path, 0.022 * s, frame_m, 6)
        # the eight crushable struts (X-X, Y-Y, Z-Z attenuators) to the floor and the walls
        for side in (-1, 1):
            for L in (-0.35, 0.55):
                a = O + Lx * L * s + Ww * side * 0.25 * s - Uy * 0.04 * s
                cyl(acc, a, V(a.x, fy, a.z) + Ww * side * 0.12 * s, 0.03 * s, frame_m, 8)
                cyl(acc, a, a + Ww * side * 0.55 * s - Uy * 0.1 * s, 0.025 * s, frame_m, 8)
    elif kind == 'ejection':
        # an upright frame: the seat sits on two rails along the escape direction (toward the hatch), catapult behind
        _ribbon(acc, pts[2:], O, Lx, Uy, Ww, 0.5 * s, 0.05 * s, pan_m)
        for side in (-1, 1):
            a = O + Ww * side * 0.3 * s - Uy * 0.1 * s - Lx * 0.2 * s
            beam(acc, a, a + Lx * 1.25 * s, 0.05 * s, 0.05 * s, frame_m)
        cyl(acc, O - Uy * 0.12 * s + Lx * 0.05 * s, O - Uy * 0.12 * s + Lx * 1.1 * s, 0.07 * s, M('amber'), 10)
        box(acc, O + Lx * 0.82 * s + Uy * 0.16 * s, (0.3 * s, 0.14 * s, 0.38 * s), M('bag'), (Ww, Uy, Lx))  # chute pack in the headrest
        for side in (-1, 1):  # arm rests and leg restraints
            beam(acc, O + Ww * side * 0.28 * s + Uy * 0.1 * s, O + Ww * side * 0.28 * s + Uy * 0.1 * s + Lx * 0.45 * s, 0.05 * s, 0.05 * s, frame_m)
    elif kind == 'fixed':
        _ribbon(acc, pts, O, Lx, Uy, Ww, 0.5 * s, 0.035 * s, pan_m)
        for L in (-0.6, -0.2, 0.3, 0.7):
            for side in (-1, 1):
                a = O + Lx * L * s + Ww * side * 0.22 * s
                beam(acc, a, V(a.x, fy, a.z), 0.04 * s, 0.04 * s, frame_m)
    elif kind == 'carbon':
        _ribbon(acc, pts, O, Lx, Uy, Ww, 0.5 * s, 0.03 * s, M('carbon'), w_end=0.42 * s)
        cush = [(L, Y + 0.025 * s) for (L, Y) in pts[1:-1]]
        _ribbon(acc, cush, O, Lx, Uy, Ww, 0.4 * s, 0.025 * s, pan_m)
        cyl(acc, O - Uy * 0.02 * s + Lx * 0.15 * s, V(O.x, fy, O.z) + Lx * 0.15 * s, 0.07 * s, frame_m, 10)
    elif kind == 'recliner':
        _ribbon(acc, pts, O, Lx, Uy, Ww, 0.54 * s, 0.07 * s, pan_m)
        cyl(acc, O - Uy * 0.05 * s, V(O.x, fy, O.z), 0.08 * s, frame_m, 10)
        for side in (-1, 1):
            beam(acc, O + Ww * side * 0.3 * s + Uy * 0.1 * s, O + Ww * side * 0.3 * s + Uy * 0.1 * s + Lx * 0.5 * s, 0.06 * s, 0.06 * s, pan_m)


def crew_figure(acc, O, az_long, f, suit='suit_white', helmet=True, side=0.0):
    """A crew member lying in the seat (hips at O, head toward az_long, facing +y), in a suit or overalls."""
    s = f
    Lx, Ww, Uy = er(az_long), ea(az_long), V(0, 1, 0)
    m = M(suit)

    def P(L, Y, W=0.0):
        return O + Lx * L * s + Uy * Y * s + Ww * W * s
    tube(acc, [P(0.05, 0.11), P(0.35, 0.13), P(0.62, 0.14)], 0.0, m, 6, radii=[0.15 * s, 0.17 * s, 0.15 * s])
    for w in (-0.1, 0.1):
        tube(acc, [P(0.02, 0.1, w), P(-0.40, 0.42, w), P(-0.78, 0.38, w)], 0.0, m, 4, radii=[0.085 * s, 0.065 * s, 0.055 * s])
        box(acc, P(-0.83, 0.45, w), (0.1 * s, 0.22 * s, 0.1 * s), M('black'), (Ww, Uy, Lx))
    for w in (-0.22, 0.22):
        tube(acc, [P(0.56, 0.16, w), P(0.28, 0.24, w * 1.05), P(0.08, 0.27, w * 0.8)], 0.0, m, 4, radii=[0.06 * s, 0.05 * s, 0.045 * s])
    if helmet:
        sphere(acc, P(0.86, 0.17), 0.155 * s, m, 8, 5)
        sphere(acc, P(0.9, 0.24), 0.11 * s, M('visor'), 6, 3)
    else:
        sphere(acc, P(0.84, 0.15), 0.11 * s, M('suit_grey') if suit != 'suit_grey' else M('seat'), 8, 5)


# ------------------------------------------------------------------ hatches
def hatch_side(acc, rev, az, s_c, w, h, corner=0.08, inward=False, f=1.0):
    """The hatch door in its opening: a thick conforming slab just inside the skin (outward-opening doors seal on
    the outside of the frame; inward plug doors sit deeper and carry a bigger seal), with its handle and hinge."""
    t = 0.07 * f if inward else 0.045 * f
    off = -0.13 * f if inward else -0.075 * f
    patch(acc, rev, az, s_c, w, h, M('alu'), off, t, 8, 8, 1.0, corner, M('dark'), sink=0.0)
    patch(acc, rev, az, s_c, w * 0.62, h * 0.55, M('frame'), off + t - 0.02 * f, 0.012, 4, 4, 1.0, corner * 0.6)
    # handle and hinge bar
    Pc, N, Tm, Ta = rev.frame_s(az, s_c, off + t + 0.005 * f)
    box(acc, Pc + Ta * w * 0.22, (0.03 * f, 0.18 * f, 0.03 * f), M('dark'), (Ta, Tm, N))
    Ph, N2, Tm2, Ta2 = rev.frame_s(az - (w * 0.52 / max(0.2, rev.at_s(s_c)[0])) / DEG, s_c, off + t * 0.5)
    cyl(acc, Ph - Tm2 * h * 0.22, Ph + Tm2 * h * 0.22, 0.025 * f, M('frame'), 8)
    if inward:  # the pressure seal of a plug door
        patch(acc, rev, az, s_c, w * 1.06, h * 1.06, M('rubber'), off - 0.01 * f, 0.01 * f, 8, 8, 1.0, corner * 1.05)


def hatch_top(acc, y, r, f=1.0):
    """A round hatch across the top tunnel (Soyuz / Shenzhou style), with its handwheel and hinge."""
    lathe(acc, [(0.0, y), (r, y), (r, y + 0.05 * f), (r * 0.9, y + 0.07 * f), (0.0, y + 0.075 * f)], M('alu'), 24)
    torus(acc, (0, y + 0.1 * f, 0), r * 0.4, 0.015 * f, M('dark'), 16, 5)
    for k in range(3):
        a = k * 120
        beam(acc, polar(a, 0.0, y + 0.1 * f), polar(a, r * 0.4, y + 0.1 * f), 0.02 * f, 0.02 * f, M('dark'))
    cyl(acc, polar(0, r * 1.02, y + 0.03 * f) + V(0, 0, -r * 0.4), polar(0, r * 1.02, y + 0.03 * f) + V(0, 0, r * 0.4), 0.025 * f, M('frame'), 8)


# ------------------------------------------------------------------ docking mechanisms (at a capsule's or module's top)
def docking(acc, kind, y_top, r=NECK - 0.03, f=1.0):
    """
    The docking mechanism inside the top ring, its tip at y_top: probe_drogue (Apollo probe), ssvp (Soyuz probe and
    flange), apas (APAS-89/95: guide petals pointing inward), nds (NASA Docking System / IDSS: soft-capture ring on
    six struts, petals inward), cbm (berthing ring with 16 bolts, 4 capture latches and a square hatch).
    """
    s = max(0.6, r / 0.42)  # the mechanisms are drawn for a 0.84 m ring and scaled to the ring
    y0 = y_top - 0.32 * s
    if kind == 'probe_drogue':
        lathe(acc, [(r, y0), (r, y0 + 0.05 * s), (0.18 * s, y0 + 0.08 * s), (0.0, y0 + 0.08 * s)], M('frame'), 24)
        cyl(acc, (0, y0 + 0.08 * s, 0), (0, y0 + 0.2 * s, 0), 0.12 * s, M('alu'), 16)
        for k in range(3):
            a = k * 120 + 30
            tube(acc, [polar(a, 0.1 * s, y0 + 0.2 * s), polar(a, r * 0.9, y0 + 0.05 * s)], 0.018 * s, M('dark'), 6)
        cyl(acc, (0, y0 + 0.2 * s, 0), (0, y_top - 0.06 * s, 0), 0.035 * s, M('steel_m'), 10)
        lathe(acc, [(0.0, y_top - 0.08 * s), (0.06 * s, y_top - 0.06 * s), (0.0, y_top)], M('dark'), 12)
    elif kind == 'ssvp':
        lathe(acc, [(r, y0 + 0.12 * s), (r, y0 + 0.2 * s), (0.2 * s, y0 + 0.2 * s), (0.2 * s, y0 + 0.12 * s)], M('alu'), 24)
        for k in range(8):
            box(acc, polar(k * 45, r * 0.85, y0 + 0.24 * s), (0.05 * s, 0.07 * s, 0.05 * s), M('dark'))
        for k in range(2):
            cyl(acc, polar(k * 180 + 90, r * 0.75, y0 + 0.2 * s), polar(k * 180 + 90, r * 0.75, y0 + 0.3 * s), 0.02 * s, M('frame'), 6)
        cyl(acc, (0, y0, 0), (0, y0 + 0.2 * s, 0), 0.14 * s, M('frame'), 14)
        cyl(acc, (0, y0 + 0.2 * s, 0), (0, y_top - 0.05 * s, 0), 0.04 * s, M('steel_m'), 10)
        lathe(acc, [(0.0, y_top - 0.07 * s), (0.055 * s, y_top - 0.05 * s), (0.0, y_top)], M('dark'), 12)
    elif kind in ('apas', 'nds'):
        base = y0 + 0.1 * s
        lathe(acc, [(r, base - 0.06 * s), (r, base), (r * 0.72, base), (r * 0.72, base - 0.06 * s)], M('alu'), 32)
        ring_y = y_top - 0.09 * s
        # actuator struts from the base to the capture ring (six for NDS, the APAS differential with six rods too)
        for k in range(6):
            a0 = k * 60 + (12 if k % 2 else -12)
            a1 = k * 60 + (-18 if k % 2 else 18)
            cyl(acc, polar(a0, r * 0.82, base), polar(a1, r * 0.78, ring_y), 0.015 * s, M('frame'), 6)
        torus(acc, (0, ring_y, 0), r * 0.8, 0.022 * s, M('alu') if kind == 'nds' else M('steel_m'), 24, 4)
        # three guide petals leaning inward
        for k in range(3):
            a = k * 120
            ah = (14 if kind == 'nds' else 20)
            w = r * 0.8 * math.radians(ah)
            pts = [polar(a - ah, r * 0.8, ring_y), polar(a + ah, r * 0.8, ring_y), polar(a + ah * 0.2, r * 0.52, y_top), polar(a - ah * 0.2, r * 0.52, y_top)]
            u = (pts[1] - pts[0]).normalized()
            nrm = (pts[3] - pts[0]).cross(u).normalized()
            vs = pts + [p + nrm * 0.012 * s for p in pts]
            acc.add(vs, [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]], M('alu') if kind == 'nds' else M('steel_m'))
        for k in range(12 if kind == 'apas' else 6):  # structural hooks round the base ring
            box(acc, polar(k * (30 if kind == 'apas' else 60) + 15, r * 0.88, base + 0.03 * s), (0.04 * s, 0.06 * s, 0.04 * s), M('dark'))
    elif kind == 'cbm':
        lathe(acc, [(r, y_top - 0.14 * s), (r, y_top - 0.06 * s), (r * 0.78, y_top - 0.06 * s), (r * 0.78, y_top - 0.14 * s)], M('alu'), 32)
        for k in range(16):
            cyl(acc, polar(k * 22.5, r * 0.89, y_top - 0.06 * s), polar(k * 22.5, r * 0.89, y_top - 0.03 * s), 0.014 * s, M('dark'), 6)
        for k in range(4):  # capture latches
            a = k * 90 + 45
            beam(acc, polar(a, r * 0.8, y_top - 0.06 * s), polar(a, r * 0.62, y_top - 0.005 * s), 0.06 * s, 0.03 * s, M('frame'))
        hw = r * 0.62
        box(acc, (0, y_top - 0.12 * s, 0), (hw * 2, 0.04 * s, hw * 2), M('alu'))
        box(acc, (0, y_top - 0.095 * s, 0), (hw * 0.5, 0.02 * s, 0.05 * s), M('dark'))


# ------------------------------------------------------------------ landing systems
def chute_pack(acc, c, axis, r, L, f=1.0, mortar=False):
    """A packed parachute: a fabric bag (or a drogue mortar can) standing along `axis` from c."""
    c, d = Vector(c), Vector(axis).normalized()
    if mortar:
        cyl(acc, c, c + d * L, r, M('frame'), 10)
        lathe(acc, [(r * 1.02, 0.0), (r * 1.02, 0.03 * f), (0.0, 0.03 * f)], M('dark'), 10, c + d * L, d)
    else:
        lathe(acc, [(r * 0.85, 0.0), (r, L * 0.15), (r, L * 0.85), (r * 0.8, L), (0.0, L)], M('bag'), 8, c, d, cap0=True)
        torus(acc, c + d * L * 0.5, r * 1.01, 0.01 * f, M('dark'), 8, 3, axis=d)


def chutes_ring(acc, n_main, n_drogue, y, rr, r_bag, L, f=1.0, az0=0.0, axis_up=True):
    """Main chute bags and drogue mortars round the forward tunnel."""
    d = V(0, 1, 0)
    for k in range(n_main):
        a = az0 + k * 360 / n_main
        chute_pack(acc, polar(a, rr, y), d, r_bag, L, f)
    for k in range(n_drogue):
        a = az0 + 180 / max(1, n_main) + k * 360 / max(1, n_drogue)
        chute_pack(acc, polar(a, rr * 0.92, y + L * 0.2), d, r_bag * 0.5, L * 0.6, f, mortar=True)


def landing_rockets(acc, n, r_ring, y, f=1.0, length=0.32, rad=0.06):
    """Soft-landing solid motors in the base, nozzles down (Soyuz: six, Shenzhou: four)."""
    for k in range(n):
        a = k * 360 / n + 15
        c = polar(a, r_ring, y)
        cyl(acc, c + V(0, 0.04 * f, 0), c + V(0, length * f, 0), rad * f, M('steel_m'), 10)
        lathe(acc, [(rad * 0.45 * f, 0.0), (rad * 0.8 * f, 0.06 * f), (rad * 0.85 * f, 0.07 * f)], M('nozzle'), 10, c + V(0, 0.07 * f, 0), V(0, -1, 0))


def airbags(acc, n, r_ring, y, f=1.0, stowed=True):
    """Landing airbags folded in the base (Starliner six, Mengzhou)."""
    for k in range(n):
        a = k * 360 / n + 30
        c = polar(a, r_ring, y + 0.04 * f)
        box(acc, c, (0.5 * f, 0.08 * f, 0.36 * f), M('airbag'), (er(a), V(0, 1, 0), ea(a)))
        cyl(acc, c + V(0, 0.04 * f, 0), c + V(0, 0.12 * f, 0), 0.03 * f, M('frame'), 6)


def crush_pads(acc, centres, f=1.0):
    """Crushable honeycomb blocks (a hard landing's only cushion)."""
    for c in centres:
        box(acc, c, (0.3 * f, 0.12 * f, 0.3 * f), M('gold'))


def uprighting_bags(acc, n, r_ring, y, f=1.0):
    """Folded uprighting bags at the nose (Apollo three, Orion five)."""
    for k in range(n):
        a = k * 360 / n + 60
        sphere(acc, polar(a, r_ring, y), 0.09 * f, M('orange'), 8, 4, squash=0.6)


# ------------------------------------------------------------------ window assemblies
def window_block(acc, rev, az, s_c, w, h, f=1.0, taper=1.0, corner=0.02, round_=False):
    """A window as built: thick multi-pane glass in a frame, set into the wall behind the outer pane."""
    if round_:
        disc(acc, rev, az, s_c, w / 2, M('glass'), -0.07 * f, 0.065 * f, 16, 1, side_m=M('frame'), sink=0.0)
        disc(acc, rev, az, s_c, w / 2 + 0.035 * f, M('frame'), -0.09 * f, 0.03 * f, 16, 1, inner=w / 2, sink=0.0)
    else:
        patch(acc, rev, az, s_c, w, h, M('glass'), -0.07 * f, 0.065 * f, 2, 2, taper, corner, M('frame'), sink=0.0)
        patch(acc, rev, az, s_c, w + 0.07 * f, h + 0.07 * f, M('frame'), -0.1 * f, 0.03 * f, 2, 2, taper, corner)


def cupola(acc, y_top, r, f=1.0):
    """A glass dome in place of the docking port (Crew Dragon, Inspiration4)."""
    h = min(r * 0.8, 0.32)
    prof = [(r * math.cos(t * math.pi / 2), y_top - h + h * math.sin(t * math.pi / 2)) for t in [k / 6 for k in range(7)]]
    lathe(acc, prof, M('glass'), 24)
    lathe(acc, [(r * 1.05, y_top - h - 0.05), (r * 1.05, y_top - h + 0.02), (r * 0.98, y_top - h + 0.02), (r * 0.98, y_top - h - 0.05)], M('frame'), 24)
    for k in range(6):
        a = k * 60
        tube(acc, [polar(a, r * math.cos(t * math.pi / 2) * 1.01, y_top - h + h * math.sin(t * math.pi / 2)) for t in [j / 4 for j in range(4)]], 0.012, M('frame'), 4)


# ------------------------------------------------------------------ stowage (modules)
def stowage(acc, kind, y0, y1, r_in, f=1.0):
    """Cargo inside a module: bags (soft cargo transfer bags), racks (ISS-style racks round the wall), water_wall."""
    if kind == 'racks':
        n = 8
        for k in range(n):
            a = k * 360 / n
            c = polar(a, r_in * 0.78, (y0 + y1) / 2)
            box(acc, c, (0.42 * f, (y1 - y0) * 0.86, TAU * r_in * 0.78 / n * 0.85), M('offwhite'), (er(a), V(0, 1, 0), ea(a)))
    elif kind == 'water_wall':
        for k in range(10):
            a = k * 36
            c = polar(a, r_in * 0.82, (y0 + y1) / 2)
            box(acc, c, (0.18 * f, (y1 - y0) * 0.86, 0.5 * f), M('suit_blue'), (er(a), V(0, 1, 0), ea(a)))
    else:
        rows = max(1, int((y1 - y0) / (0.38 * f)))
        for j in range(rows):
            yy = y0 + (j + 0.5) * (y1 - y0) / rows
            for k in range(6):
                a = k * 60 + j * 30
                box(acc, polar(a, r_in * 0.62, yy), (0.5 * f, 0.3 * f, 0.4 * f), M('bag'), (er(a), V(0, 1, 0), ea(a)))
