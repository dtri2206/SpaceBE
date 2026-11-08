"""
Inner pieces of the body section's kits (the explanation card pulls them apart), built for each modelled part where they
really sit. Every modelled part carries its own pieces (no shared library): `build_slots(root, geo, kit, real)` makes
slot_<key> for the as-built choice and slot_<key>__<optionId> for every other option of the kit (an empty node when the
option has nothing to show, e.g. baffles: none).

Directions the explanation card slides them out (bay/internalsArt.js and sections/body/art.js): pressurisation -x,
baffles +x, insulation +z, feed lines down and -z, bulkhead up, the new wall slot back-left (-x, -z). The pieces sit on
those sides so they leave the part cleanly.
"""
import math
from bodylib import (Acc, V, M, TAU, polar, radial, tangent, lathe, cyl, sphere, capsule, torus, tube, bend, bellows,
                     box, beam, curved_panel, dome, node)

# The kits, read from the data so the pieces always match its slots and options.
def _load_kits():
    """The kits as the game has them (sections/body/internals.json): {kit: {slot key: [option ids]}}, first = default."""
    import json, os
    from bodylib import REPO
    with open(os.path.join(REPO, 'src', 'builder', 'sections', 'body', 'internals.json'), encoding='utf-8') as f:
        data = json.load(f)
    return {kid: {s['key']: [o['id'] for o in s.get('options', [])] for s in kit.get('slots', [])} for kid, kit in data['kits'].items()}


KITS = _load_kits()


class Vol:
    """One propellant volume: a barrel from y0 (bottom equator) to y1 (top equator) of radius r, with domes of depth
    bot_d / top_d beyond (a sphere: y0 = y1 = centre, depths = r). c = (x, z) of its axis (cluster tanks)."""

    def __init__(self, label, y0, y1, r, top_d, bot_d, c=(0.0, 0.0)):
        self.label, self.y0, self.y1, self.r, self.top_d, self.bot_d, self.c = label, y0, y1, r, top_d, bot_d, c

    @property
    def bottom(self):
        return self.y0 - self.bot_d

    @property
    def top(self):
        return self.y1 + self.top_d

    def at(self, y, x=0.0, z=0.0):
        return V(self.c[0] + x, y, self.c[1] + z)

    def mid(self):
        return (self.bottom + self.top) / 2


class TankGeo:
    """What the slot builders need to know about a tank part. vols: top to bottom. wall(y): the inside of the skin."""

    def __init__(self, R, H, vols, build='separate', fuel='kerolox', wall=None, split=None):
        self.R, self.H, self.vols, self.build, self.fuel = R, H, vols, build, fuel
        self.wall = wall or (lambda y: R - 0.03)
        self.split = split

    def biggest(self):
        return max(self.vols, key=lambda v: (v.top - v.bottom) * v.r * v.r)


# ------------------------------------------------------------------ helpers
def _emit(acc, name, parent):
    return acc.emit(name, parent)


def _ring_baffle(acc, v, y, m, seg=28, w=0.22):
    """An annular baffle plate inside volume v at height y (follows a dome if y is beyond the barrel)."""
    r = _vol_r(v, y) * 0.97
    if r < 0.12:
        return
    lathe(acc, [(r, y), (r * (1 - w), y + 0.01)], m, seg, c=v.at(0))  # a thin plate (the material is two-sided)


def _vol_r(v, y):
    """Inner radius of volume v at height y."""
    if v.y0 <= y <= v.y1:
        return v.r
    if y > v.y1:
        t = (y - v.y1) / max(1e-6, v.top_d)
    else:
        t = (v.y0 - y) / max(1e-6, v.bot_d)
    return v.r * math.sqrt(max(0.0, 1 - min(1.0, t) ** 2))


def _copv(acc, c, r, L, m=None):
    capsule(acc, c, r, L, m or M('copv'), seg=12, n=3)
    # the metal boss and port at the top
    cyl(acc, c + V(0, L / 2 - 0.01, 0), c + V(0, L / 2 + 0.05, 0), r * 0.25, M('steel'), seg=8)


def _coil(acc, c, r, y0, y1, turns, rt, m, seg=10):
    pts = []
    n = int(turns * 10)
    for i in range(n + 1):
        a = TAU * turns * i / n
        pts.append(V(c.x + r * math.cos(a), lerp_(y0, y1, i / n), c.z - r * math.sin(a)))
    tube(acc, pts, rt, m, 5)


def lerp_(a, b, t):
    return a + (b - a) * t


def _prevalve(acc, p, r, m=None):
    """A prevalve body on a line at point p (the yellow-anodised valve housings of the S-IC and ET lines)."""
    cyl(acc, p - V(0, r * 1.4, 0), p + V(0, r * 1.4, 0), r * 1.6, m or M('amber'), seg=10)
    box(acc, p + V(r * 1.9, 0, 0), (r * 1.4, r * 1.6, r * 1.6), M('dark'))


# ------------------------------------------------------------------ bulkhead
def bulkhead_piece(geo, opt, kit):
    acc = Acc()
    vols = geo.vols
    sep = opt == 'separate'
    seg = 32
    if len(vols) == 1:
        v = vols[0]
        dome(acc, v.r * 0.995, v.y1, v.top_d, M('alu'), down=False, seg=seg, n=6)
        dome(acc, v.r * 0.995, v.y0, v.bot_d, M('alu'), down=True, seg=seg, n=6)
        return acc
    if sep:
        for up, lo in zip(vols, vols[1:]):
            dome(acc, up.r * 0.99, up.y0, up.bot_d, M('alu'), down=True, seg=seg, n=6)
            dome(acc, lo.r * 0.99, lo.y1, lo.top_d, M('alu'), down=False, seg=seg, n=6)
        return acc
    # one common bulkhead between the first two volumes: it bulges down into the lower tank
    up, lo = vols[0], vols[1]
    y = geo.split if geo.split is not None else (up.y0 + lo.y1) / 2
    r = min(up.r, lo.r) * 0.99
    d = up.bot_d
    thin = opt == 'thin'
    sandwich = opt in ('honeycomb', 'common') or (opt == 'as_built' and geo.fuel == 'hydrolox')
    dome(acc, r, y, d, M('alu_cut' if thin else 'alu'), down=True, seg=seg, n=6)
    if sandwich:
        gap = 0.1 if opt == 'honeycomb' else 0.07
        # the second skin above, and the honeycomb core showing in a cut-away wedge (120 degrees)
        dome(acc, r * 0.985, y + gap, d * 0.97, M('alu'), down=True, seg=seg, n=6)
        prof = []
        for k in range(7):
            a = math.pi / 2 * k / 6
            prof.append((r * 0.99 * math.cos(a), y + gap * 0.5 - d * 0.985 * math.sin(a)))
        lathe(acc, prof[::-1], M('honeycomb'), 12, a0=math.radians(200), a1=math.radians(320), u_rep=3, v_scale=2.0)
    return acc


# ------------------------------------------------------------------ wall stiffening (a cut-away wall panel)
WALL_DEG = (125.0, 175.0)


def wall_piece(geo, opt):
    acc = Acc()
    v = geo.biggest()
    yc = (v.y0 + v.y1) / 2
    hh = min(1.3, max(0.6, (v.y1 - v.y0) * 0.7))
    y0, y1 = yc - hh / 2, yc + hh / 2
    r = geo.wall(yc) - 0.005
    d0, d1 = WALL_DEG
    curved_panel(acc, r, d0, d1, y0, y1, M('alu_cut'), seg=10, thick=0.012)
    rib = M('alu')
    depth = 0.05 if opt == 'waffle' else 0.04
    ri = r - 0.012
    span = math.radians(d1 - d0) * ri  # panel width (m)

    def at(u, y):  # u: metres along the arc from d0
        a = d0 + math.degrees(u / ri)
        return polar(a, ri - depth / 2, y)

    def rib_seg(u0, ya, u1, yb, w=0.022):
        p0, p1 = at(u0, ya), at(u1, yb)
        beam(acc, p0, p1, w, depth, rib, up=radial(d0 + math.degrees((u0 + u1) / 2 / ri)))

    if opt == 'integral':  # integrally machined stringers and ring frames (Titan II, Saturn S-IC)
        n = 6
        for i in range(n + 1):
            u = span * i / n
            rib_seg(u, y0, u, y1, 0.018)
        for y in (y0 + 0.04, yc, y1 - 0.04):
            rib_seg(0, y, span, y, 0.05)
    elif opt == 'orthogrid':
        s = 0.18
        nu, nv = max(2, int(span / s)), max(2, int(hh / s))
        for i in range(nu + 1):
            rib_seg(span * i / nu, y0, span * i / nu, y1)
        for j in range(nv + 1):
            rib_seg(0, y0 + hh * j / nv, span, y0 + hh * j / nv)
    elif opt == 'waffle':  # a square grid of deep, thick ribs milled from thick plate, wider apart than orthogrid
        s = 0.26
        nu, nv = max(2, int(span / s)), max(2, int(hh / s))
        for i in range(nu + 1):
            rib_seg(span * i / nu, y0, span * i / nu, y1, 0.032)
        for j in range(nv + 1):
            rib_seg(0, y0 + hh * j / nv, span, y0 + hh * j / nv, 0.032)
    else:  # isogrid: ribs at 0, 60 and 120 degrees with a node every 0.24 m (Delta II, Delta IV, Atlas V)
        a = 0.26
        h_ = a * math.sqrt(3) / 2
        rows = int(hh / h_)
        hh_ = rows * h_
        for j in range(rows + 1):
            rib_seg(0, y0 + j * h_, span, y0 + j * h_)
        for sgn in (1, -1):
            k = -2 * rows - 2
            while k * a / 2 < span + hh_:
                # the rib through (k a / 2, 0) at 60 degrees (slope sgn * sqrt 3 in (u, y)), clipped to 0..span
                ua, ub = k * a / 2, k * a / 2 + sgn * hh_ / math.sqrt(3)
                ts = sorted([(0 - ua) / (ub - ua), (span - ua) / (ub - ua)])
                t0, t1 = max(0.0, ts[0]), min(1.0, ts[1])
                if t1 - t0 > 1e-3:
                    rib_seg(lerp_(ua, ub, t0), y0 + hh_ * t0, lerp_(ua, ub, t1), y0 + hh_ * t1, 0.02)
                k += 2
    return acc


# ------------------------------------------------------------------ pressurisation
def press_piece(geo, opt, real_hint=None):
    acc = Acc()
    top = geo.vols[0]
    low = geo.vols[-1]
    if opt in ('helium', 'heated'):
        # composite-overwrapped bottles hung inside the top tank, on the -x side (Falcon 9, S-IC: on the baffles)
        n = 3
        rr = min(0.1 * geo.R, top.r * 0.13)
        L = min(rr * 4.2, (top.y1 - top.y0) * 0.8 + top.top_d * 0.5)
        yc = top.y1 - L / 2 + min(top.top_d * 0.4, 0.15)
        for k in range(n):
            a = 150 + 30 * k
            p = top.at(0) + polar(a, top.r * 0.55, yc)
            p.y = yc
            _copv(acc, p, rr, L)
        # the pressurant line down the wall to the bottom
        p0 = top.at(0) + polar(180, top.r * 0.55, yc - L / 2)
        p1 = low.at(0) + polar(180, geo.wall(low.y0) - 0.06, low.y0 + 0.2) if low is not top else None
        if p1 is not None:
            tube(acc, bend([p0, V(p0.x, p0.y - 0.15, p0.z), V(p1.x, p0.y - 0.3, p1.z), p1], 0.08), 0.022, M('steel'), 6)
        if opt == 'heated':  # the heat exchanger on the engine end: the gas warms in a coil before it enters the tank
            c = low.at(0) + V(-0.25 * geo.R, 0, 0)
            _coil(acc, c, 0.14 * geo.R, max(0.08, low.bottom + 0.05), max(0.08, low.bottom + 0.05) + 0.25, 4, 0.016, M('copper'))
    elif opt == 'autogenous':
        # gas tapped from the engine, a line up the wall, and a diffuser at the top of each tank (S-IC GOX diffuser)
        for v in geo.vols:
            p = v.at(0) + V(-0.2 * v.r, v.top - v.top_d * 0.45 - 0.08, 0)
            cyl(acc, p - V(0, 0.12, 0), p + V(0, 0.12, 0), 0.07 * geo.R, M('alu_cut'), seg=12)
            for dy in (-0.1, 0.0, 0.1):
                lathe(acc, [(0.07 * geo.R, dy - 0.012), (0.085 * geo.R, dy), (0.07 * geo.R, dy + 0.012)], M('dark'), 12, c=p)
            q = v.at(0) + polar(180, geo.wall(v.y1) - 0.06, p.y)
            tube(acc, [p + V(0, 0.12, 0), p + V(0, 0.2, 0), q + V(0, 0.2, 0), q, V(q.x, max(0.05, low.bottom), q.z)], 0.02, M('gold'), 6)
    elif opt == 'nitrogen':
        # two nitrogen spheres and the evaporator coil that boils liquid nitrogen into pressurising gas (Soyuz)
        rr = 0.17 * geo.R
        for k, a in enumerate((165, 195)):
            p = top.at(0) + polar(a, top.r * 0.5, top.y1 - rr * 1.2)
            sphere(acc, p, rr, M('steel'), seg=14)
        c = low.at(0) + V(-0.3 * geo.R, 0, 0)
        _coil(acc, c, 0.12 * geo.R, max(0.1, low.bottom + 0.1), max(0.1, low.bottom + 0.1) + 0.3, 5, 0.014, M('alu_cut'))
    elif opt == 'cold_helium':
        # titanium spheres submerged in the hydrogen, near its bottom (S-IVB: eight spheres)
        h2 = next((v for v in geo.vols if 'H2' in v.label), low)
        rr = min(0.11 * geo.R, (h2.y1 - h2.y0 + h2.bot_d) * 0.15)
        n = 6
        y = h2.y0 + rr * 1.6 if h2.y1 - h2.y0 > rr * 3 else h2.y0 + rr * 0.6
        for k in range(n):
            a = 120 + 120 * k / (n - 1)
            p = h2.at(0) + polar(a, h2.r * 0.62, y)
            sphere(acc, p, rr, M('titanium'), seg=12)
        tube(acc, [h2.at(0) + polar(120, h2.r * 0.62, y), h2.at(0) + polar(120 + 120, h2.r * 0.62, y)], 0.012, M('steel'), 5)
    return acc


# ------------------------------------------------------------------ baffles
def baffle_piece(geo, opt):
    acc = Acc()
    if opt == 'none':
        return acc
    for v in geo.vols:
        span = v.y1 - v.y0
        if opt in ('baffled', 'pmd'):
            n = 3 if span > 1.2 else (2 if span > 0.5 else 1)
            for k in range(n):
                y = v.y0 + span * (0.2 + 0.55 * k / max(1, n - 1)) if n > 1 else v.y0 + span * 0.4
                _ring_baffle(acc, v, y, M('alu'))
        if opt in ('antivortex', 'pmd'):
            # the cruciform anti-vortex baffle over the outlet (S-IC LOX tank, ET)
            h = min(0.35, v.bot_d * 0.8 + 0.1)
            w = v.r * 0.45
            yb = v.bottom + 0.02
            for a in (0, 90):
                box(acc, v.at(0, 0, 0) + V(0, yb + h / 2, 0), (w * 2, h, 0.02), M('alu'), (radial(a), V(0, 1, 0), tangent(a)))
            if opt == 'pmd':
                # screen channels along the wall to the outlet: liquid stays in them by surface tension
                for a in (45, 135, 225, 315):
                    top_y = v.y0 + span * 0.5
                    p0 = v.at(0) + polar(a, v.r * 0.9, top_y)
                    p1 = v.at(0) + polar(a, v.r * 0.55, v.y0 - v.bot_d * 0.6)
                    p2 = v.at(0) + V(0, yb + 0.04, 0)
                    for (a_, b_) in ((p0, p1), (p1, p2)):
                        beam(acc, a_, b_, 0.09, 0.03, M('alu_cut'))
    return acc


# ------------------------------------------------------------------ insulation (a cut-away of the layer, on the +z side)
INS_DEG = (245.0, 295.0)


def insulation_piece(geo, opt):
    acc = Acc()
    v = geo.biggest()
    yc = (v.y0 + v.y1) / 2
    hh = min(1.4, max(0.6, (v.y1 - v.y0) * 0.6))
    y0, y1 = yc - hh / 2, yc + hh / 2
    r = geo.wall(yc)
    d0, d1 = INS_DEG
    if opt == 'bare':  # the bare wall, primed: only a thin sheet
        curved_panel(acc, r - 0.006, d0, d1, y0, y1, M('alu'), seg=10, thick=0.004)
    elif opt in ('foam', 'foam_white'):
        key = 'foam_white' if opt == 'foam_white' else ('foam_et' if geo.fuel == 'hydrolox' else 'foam_tan')
        curved_panel(acc, r - 0.004, d0, d1, y0, y1, M(key), seg=10, thick=0.035, u_rep=1.5, v_scale=1.2)
        curved_panel(acc, r - 0.042, d0 + 2, d1 - 2, y0 + 0.05, y1 - 0.05, M('yellow'), seg=10, thick=0.004)  # primer
    elif opt == 'tiodize':  # bare aluminium with the copper-tan conversion finish (Atlas V): a thin coat on the wall
        curved_panel(acc, r - 0.006, d0, d1, y0, y1, M('tiodize'), seg=10, thick=0.004, u_rep=1, v_scale=0.7)
    elif opt == 'foam_tan':  # the tan-brown spray-on foam of Delta IV and H-IIA
        curved_panel(acc, r - 0.004, d0, d1, y0, y1, M('foam_tan'), seg=10, thick=0.035, u_rep=1.5, v_scale=1.2)
        curved_panel(acc, r - 0.042, d0 + 2, d1 - 2, y0 + 0.05, y1 - 0.05, M('yellow'), seg=10, thick=0.004)
    elif opt == 'mli':
        curved_panel(acc, r - 0.004, d0, d1, y0, y1, M('mli' if geo.fuel != 'kerolox' else 'gold'), seg=10, thick=0.02, u_rep=6, v_scale=4)
    elif opt == 'internal':  # foam tiles glued inside the wall, lined with glass cloth (S-IVB)
        nu, nv = 4, max(3, int(hh / 0.3))
        for i in range(nu):
            for j in range(nv):
                a0 = d0 + (d1 - d0) * i / nu + 0.6
                a1 = d0 + (d1 - d0) * (i + 1) / nu - 0.6
                ya = y0 + hh * j / nv + 0.012
                yb = y0 + hh * (j + 1) / nv - 0.012
                curved_panel(acc, r - 0.01, a0, a1, ya, yb, M('tile'), seg=3, thick=0.03)
        curved_panel(acc, r - 0.044, d0, d1, y0, y1, M('glass_cloth'), seg=10, thick=0.003)
    return acc


# ------------------------------------------------------------------ feed lines
FEED_DEG = 105.0


def feed_piece(geo, opt):
    acc = Acc()
    R = geo.R
    vols = geo.vols
    steel, amber = M('steel'), M('amber')
    lr = max(0.05, 0.055 * R)  # line radius (S-IC: 17 in LOX lines on a 10 m stage, scaled)
    bottom = max(0.02, vols[-1].bottom)

    def line_down(p_top, offset_deg=None, dual_shift=0.0):
        """From the upper tank's outlet down through the lower tank(s) to the bottom of the part."""
        x = p_top.x + dual_shift
        pts = [V(x, p_top.y, p_top.z), V(x, 0.02, p_top.z)]
        tube(acc, pts, lr, steel, 10)
        for t in (0.82, 0.25):  # bellows near the outlet and near the engine
            yb = lerp_(0.02, p_top.y, t)
            bellows(acc, V(x, yb - 0.08, p_top.z), V(x, yb + 0.08, p_top.z), lr * 1.05, M('alu_cut'), folds=3, seg=10)
        _prevalve(acc, V(x, 0.18, p_top.z), lr)

    def dome_y(v, rad):
        """Height of v's bottom dome surface at radius rad from its axis."""
        f = min(0.98, rad / max(1e-6, v.r))
        return v.y0 - v.bot_d * math.sqrt(1 - f * f)

    def outlet(v, deg, rad, lrr):
        """A straight outlet line from v's bottom dome down to the bottom of the part, with its prevalve."""
        p = v.at(0) + polar(deg, rad, 0.0)
        y0 = dome_y(v, rad) + 0.03
        tube(acc, [V(p.x, y0, p.z), V(p.x, 0.0, p.z)], lrr, steel, 10)
        if y0 > 0.3:
            _prevalve(acc, V(p.x, min(0.2, y0 * 0.5), p.z), lrr)
        return p

    if len(vols) == 1:
        # one propellant (an upper-stage tank): the sump at the bottom of the dome, the feed duct leaving it and hugging
        # the dome out to the side, then down to the engine (one compact piece, so the card's marker sits on it)
        v = vols[0]
        sump_r = 0.11 * R
        cyl(acc, v.at(0) + V(0, v.bottom + 0.01, 0), v.at(0) + V(0, v.bottom + 0.3, 0), sump_r, M('alu_cut'), seg=14)
        lathe(acc, [(sump_r * 1.7, v.bottom + 0.3), (sump_r * 0.6, v.bottom + 0.38)], M('alu'), 14, c=v.at(0))  # anti-vortex cap
        n = 2 if opt == 'dual' else 1
        for k in range(n):
            deg = FEED_DEG + 180 * k
            low = (lr * 1.9 if opt == 'tunnel' else lr) + 0.02  # the duct's underside stays above the part's base
            path = [v.at(0) + V(0, max(low, v.bottom + 0.04), 0)]
            for f in (0.15, 0.3, 0.45, 0.58):
                path.append(v.at(0) + polar(deg, f * v.r, max(low, dome_y(v, f * v.r) - lr - 0.03)))
            end_p = path[-1]
            path.append(V(end_p.x, 0.0, end_p.z))
            tube(acc, bend(path, 0.1, n=3), lr, steel, 10)
            _prevalve(acc, V(end_p.x, max(lr * 1.6, end_p.y * 0.45), end_p.z), lr)
            if opt == 'tunnel':  # one propellant: the tunnel is the insulated duct round the line
                tube(acc, bend(path, 0.1, n=3), lr * 1.9, M('glass_cloth'), 10)
        if opt == 'pogo':
            p0 = path[-2]
            capsule(acc, V(p0.x, max(lr * 3.8, p0.y * 0.5), p0.z) + polar(FEED_DEG + 90, 0.18, 0), lr * 2.2, lr * 7, M('steel'), seg=12)
        return acc

    up, lo = vols[0], vols[1]
    top_out = up.at(0) + V(0, up.bottom + 0.02, 0)
    if opt == 'tunnel':
        # an insulated tunnel through the lower tank, the line inside (S-IC: five LOX tunnels through the RP-1 tank)
        rt = 0.13 * R
        cyl(acc, V(top_out.x, lo.bottom - 0.02, top_out.z), V(top_out.x, lo.top + 0.03, top_out.z), rt, M('glass_cloth'), seg=14, caps=False)
        line_down(top_out)
    else:
        n = 2 if opt == 'dual' else 1
        for k in range(n):
            line_down(top_out, dual_shift=(k - (n - 1) / 2) * 0.32 * R)
    outlet(lo, FEED_DEG, 0.45 * lo.r, lr * 0.9)  # the lower tank's own outlet (fuel), on the -z side
    if opt == 'pogo':
        # a gas-filled accumulator on the oxidizer line near the engine inlet (S-II from Apollo 14; Titan II standpipes)
        capsule(acc, V(top_out.x + 0.22 * R, 0.45, top_out.z), lr * 2.0, lr * 7.5, M('steel'), seg=12)
        tube(acc, [V(top_out.x + lr, 0.45, top_out.z), V(top_out.x + 0.22 * R - lr * 2, 0.45, top_out.z)], lr * 0.5, steel, 6)
    return acc


# ------------------------------------------------------------------ the whole kit
BUILDERS = {
    'bulkhead': lambda geo, opt, kit: bulkhead_piece(geo, opt, kit),
    'wall': lambda geo, opt, kit: wall_piece(geo, opt),
    'pressurisation': lambda geo, opt, kit: press_piece(geo, opt),
    'baffles': lambda geo, opt, kit: baffle_piece(geo, opt),
    'insulation': lambda geo, opt, kit: insulation_piece(geo, opt),
    'feedline': lambda geo, opt, kit: feed_piece(geo, opt),
}


def build_slots(root, geo, kit, builders=None, skip=()):
    """slot_<key> = the kit's FIRST option's look (the game shows it when no variant matches the fitted option, README),
    slot_<key>__<opt> for every other option. The real stage's own choices come from its shape's options
    (sections/body/section.json). builders: {key: f(geo, opt, kit) -> Acc} to override a slot's pieces for this part."""
    b = dict(BUILDERS)
    b.update(builders or {})
    made = {}
    for key, options in KITS[kit].items():
        if key in skip or key not in b:
            continue
        for k, opt in enumerate(options):
            name = f'slot_{key}' if k == 0 else f'slot_{key}__{opt}'
            made[name] = _emit(b[key](geo, opt, kit), name, root)
    return made
