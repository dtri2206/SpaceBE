"""
Strap-on boosters (tail section): five solid boosters and five liquid boosters from real rockets.

Run from the repo root (writes public/assets/models/builder/tail/<id>.glb):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/tail/boosters.py -- [--only srb_5seg_l,...] [--shots DIR]

Contract (models.md, NOTES.md): origin at the centre of the nozzle exit (y = 0), the booster's axis along +y, the side
that faces the core on -X (attach fittings there; the game adds the struts). Height = the part's catalogue height
(read from sections/tail/parts.json); the diameter keeps the real booster / core ratio of the rocket that uses it
(NOTES.md table), so the real height / diameter is not kept: the length is shared out with the nose, skirts and
nozzle keeping their real shape relative to the diameter, and the case or tank taking the rest.
Inner pieces:
  segmented kit (srb_5seg_l, srb_ua1205_l, srb_s200_l): slot_joint (capture) + __tworing; slot_nozzle (flex) + __lit
    + __fixed; slot_grain (star) + __bucket + __finocyl
  booster kit (srb_p120c_l, srb_3_m): slot_grain (star) + __highthrust + __longburn + __finocyl;
    slot_nozzle (fixed) + __tvc + __lit
  liquid boosters: no kit (plain nodes: engines, tank, nose).
"""
import os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tl  # noqa: E402
from tl import V, M, Acc, polar, TAU  # noqa: E402

_parts = json.load(open(os.path.join(tl.REPO, 'src', 'builder', 'sections', 'tail', 'parts.json'), encoding='utf-8'))
PARTS = {p['id']: p for p in (_parts['parts'] if isinstance(_parts, dict) else _parts)}

# Real booster / core diameter ratio at the game size of the rocket that uses it (sections/tail/NOTES.md)
DIAMETER = {'srb_5seg_l': 1.49, 'srb_ua1205_l': 2.5, 'srb_p120c_l': 2.13, 'srb_3_m': 1.6, 'srb_s200_l': 2.0,
            'booster_cbc_l': 3.375, 'booster_f9_m': 2.5, 'booster_blok_a_m': 1.71, 'booster_urm1_m': 2.5, 'booster_cz5_m': 2.26}

# Solid boosters: lengths in diameters (D), radii in case radii (r)
SOLIDS = {
    # SLS five-segment: ogive cap on a frustum, forward skirt, five segments, flared aft skirt with four hold-down
    # posts, a big flexible-bearing nozzle (exit about the case diameter)
    'srb_5seg_l': dict(kit='segmented', segs=5, nozzle=0.42, re=0.92, aft=0.72, flare=1.36, fwd=0.55, nose=1.25, nose_kind='frustum',
                       case='white', nose_m='white', posts=4, tunnel=True),
    # Titan IIIC/IIIE UA1205: five segments, conical nose, short aft closure, fixed nozzle steered by injecting N2O4
    'srb_ua1205_l': dict(kit='segmented', segs=5, nozzle=0.34, re=0.78, aft=0.22, flare=1.04, fwd=0.18, nose=0.95, nose_kind='cone',
                         case='white', nose_m='white', roll=True),
    # Ariane 6 / Vega-C P120C: one-piece carbon-fibre case, short ogive nose, flexible nozzle on electric actuators
    'srb_p120c_l': dict(kit='booster', segs=1, nozzle=0.3, re=0.56, aft=0.18, flare=1.0, fwd=0.08, nose=0.75, nose_kind='ogive',
                        case='carbon', nose_m='white'),
    # H3 SRB-3: one-piece case, pointed nose, fixed nozzle, a thrust strut fitting at the top
    'srb_3_m': dict(kit='booster', segs=1, nozzle=0.3, re=0.56, aft=0.18, flare=1.0, fwd=0.08, nose=1.05, nose_kind='pointed',
                    case='white', nose_m='white'),
    # LVM3 S200: three segments, long conical nose, flexible nozzle with actuators
    'srb_s200_l': dict(kit='segmented', segs=3, nozzle=0.36, re=0.68, aft=0.3, flare=1.06, fwd=0.22, nose=1.35, nose_kind='cone',
                       case='offwhite', nose_m='offwhite'),
}


def nose_profile(kind, r, y0, L, n=10):
    """Nose from the forward skirt (y0, radius r) to the tip (y0 + L)."""
    pts = []
    for k in range(n + 1):
        t = k / n
        if kind == 'cone':
            rr = r * (1 - t) + 0.06 * r * t
        elif kind == 'pointed':
            rr = r * math.cos(t * math.pi / 2) ** 1.25
        elif kind == 'frustum':  # Shuttle/SLS: a frustum then a rounded ogive cap
            rr = r * (1 - 0.38 * t / 0.4) if t < 0.4 else r * 0.62 * math.cos((t - 0.4) / 0.6 * math.pi / 2) ** 0.8
        else:  # ogive
            rr = r * math.sqrt(max(0.0, 1 - t ** 1.7))
        pts.append((max(rr, 0.0), y0 + L * t))
    if kind == 'cone':
        pts[-1] = (0.0, y0 + L)
        pts.insert(-1, (0.04 * r, y0 + L * 0.995))
    pts[-1] = (0.0, pts[-1][1])
    return pts


def nozzle_piece(a, r, yn, Ln, re, flex, actuators):
    """A solid-motor nozzle: carbon-phenolic exit cone from y = 0 to the aft dome at yn, with its throat housing."""
    rt = re * 0.42
    prof = [(re, 0.0), (re * 0.84, Ln * 0.3), (rt * 1.25, Ln * 0.82), (rt, Ln * 0.92), (rt * 1.5, yn + 0.02)]
    tl.lathe(a, prof, M('ablative'), 28)
    tl.lathe(a, [(re * 0.965, 0.0), (re * 0.81, Ln * 0.3), (rt * 1.15, Ln * 0.82)], M('soot'), 18, flip=True)
    tl.torus(a, V(0, 0.01, 0), re, 0.018 * r / 0.75, M('dark'), 28, 4)
    if flex:  # the flexible bearing: a dark laminated ring where the nozzle meets the case
        tl.lathe(a, [(rt * 1.5, yn - 0.06 * r), (rt * 1.7, yn - 0.03 * r), (rt * 1.7, yn + 0.02), (rt * 1.4, yn + 0.04)], M('rubber'), 20)
    for k in range(actuators):
        az = 90 * k + 45
        lo = polar(az, re * 0.78, Ln * 0.42)
        hi = polar(az, r * 0.82, yn + 0.05 * r)
        tl.cyl(a, hi, lo.lerp(hi, 0.45), 0.06 * r, M('steel'), 8)
        tl.cyl(a, lo.lerp(hi, 0.45), lo, 0.03 * r, M('stainless'), 6)


def build_solid(slug):
    d = PARTS[slug]
    h, D = d['height'], DIAMETER[slug]
    r = D / 2
    c = SOLIDS[slug]
    tl.reset()
    root = tl.root(slug)
    ln, la, lf, lnose = c['nozzle'] * D, c['aft'] * D, c['fwd'] * D, c['nose'] * D
    y_aft0 = ln                     # bottom of the aft skirt (the nozzle sticks out below it)
    y_case0 = y_aft0 + la           # bottom of the case
    y_case1 = h - lnose - lf        # top of the case
    y_nose = h - lnose
    a = Acc()
    case_m, nose_m = M(c['case']), M(c['nose_m'])
    # aft skirt (flared on the Shuttle-type boosters) with a dark base ring
    fl = c['flare'] * r
    tl.lathe(a, [(fl, y_aft0), (fl * 0.98, y_aft0 + la * 0.25), (r * 1.01, y_case0)], case_m, 40)
    tl.lathe(a, [(fl * 0.9, y_aft0), (fl + 0.01, y_aft0), (fl + 0.01, y_aft0 + 0.04 * D)], M('dark'), 40)
    tl.lathe(a, [(0.0, y_aft0 + 0.02 * D), (fl * 0.92, y_aft0 + 0.02 * D)], M('dark'), 32)  # aft heat shield
    # the case
    tl.lathe(a, [(r, y_case0), (r, y_case1)], case_m, 40)
    if c.get('roll'):  # Titan roll marks: black quarters on the top segment
        seg_len = (y_case1 - y_case0) / c['segs']
        for q in (0, 2):
            tl.lathe(a, [(r + 0.004, y_case1 - seg_len), (r + 0.004, y_case1)], M('black'), 8, a0=q * math.pi / 2, a1=(q + 1) * math.pi / 2)
    # forward skirt and nose
    tl.lathe(a, [(r, y_case1), (r, y_nose)], nose_m if c['case'] == 'carbon' else case_m, 40)
    tl.lathe(a, nose_profile(c['nose_kind'], r, y_nose, lnose), nose_m, 40)
    for y in (y_case0 + 0.02 * D, y_case1, y_nose):
        tl.lathe(a, [(r - 0.002, y - 0.012 * D), (r + 0.008 * D, y), (r - 0.002, y + 0.012 * D)], M('grey'), 40)
    # attach fittings on the core side (-X): forward thrust fitting, aft attach ring brackets
    tl.box(a, V(-r - 0.04 * D, y_case1 + lf * 0.5, 0), (0.1 * D, 0.14 * D, 0.16 * D), M('dark'))
    tl.lathe(a, [(r - 0.002, y_case0 + 0.1 * D), (r + 0.025 * D, y_case0 + 0.11 * D), (r + 0.025 * D, y_case0 + 0.16 * D), (r - 0.002, y_case0 + 0.17 * D)], M('grey'), 40)
    for zz in (-0.12 * D, 0.12 * D):
        tl.box(a, V(-r - 0.04 * D, y_case0 + 0.135 * D, zz), (0.09 * D, 0.08 * D, 0.06 * D), M('dark'))
    if c.get('posts'):  # hold-down posts under the aft skirt
        for k in range(c['posts']):
            p = polar(45 + 90 * k, fl * 0.86, y_aft0 + 0.05 * D)
            tl.box(a, p, (0.1 * D, 0.1 * D, 0.1 * D), M('dark'))
    if c.get('tunnel'):  # systems tunnel (cable tray) along the outside
        tl.box(a, V(0, (y_case0 + y_case1) / 2, r + 0.02 * D), (0.08 * D, y_case1 - y_case0, 0.05 * D), M('grey'))
    a.emit('case', root)

    # ---- inner pieces
    kit = c['kit']
    # nozzle variants
    yn = y_aft0 + 0.03 * D
    nz = {}
    if kit == 'segmented':
        order = [('flex', True, 2), ('lit', False, 0), ('fixed', False, 0)]
    else:
        order = [('fixed', False, 0), ('tvc', True, 2), ('lit', False, 0)]
    for i, (opt, flex, act) in enumerate(order):
        b = Acc()
        nozzle_piece(b, r, yn, ln, c['re'] * r, flex, act)
        if opt == 'lit':
            # liquid injection: a ring of injector valves round the exit cone, fed from an N2O4 tank on the outer side
            ring_y = ln * 0.5
            rr = c['re'] * r * 0.92
            tl.torus(b, V(0, ring_y, 0), rr + 0.03 * D, 0.012 * D, M('stainless'), 24, 4)
            for k in range(8):
                tl.box(b, polar(22.5 + 45 * k, rr + 0.04 * D, ring_y), (0.04 * D, 0.05 * D, 0.04 * D), M('amber'))
            tx = r + 0.11 * D
            tl.lathe(b, [(0.0, y_case0 - 0.05 * D), (0.09 * D, y_case0 + 0.1 * D), (0.09 * D, y_case1 - 0.2 * D), (0.0, y_case1 - 0.02 * D)], M('white'), 14, (tx, 0, 0))
            for y in (y_case0 + 0.4 * D, (y_case0 + y_case1) / 2, y_case1 - 0.6 * D):
                tl.box(b, V(r + 0.04 * D, y, 0), (0.08 * D, 0.06 * D, 0.1 * D), M('dark'))
            tl.tube(b, [V(tx, y_case0 - 0.04 * D, 0), V(tx, ring_y + 0.05 * D, 0), V(rr + 0.04 * D, ring_y, 0)], 0.02 * D, M('stainless'), 6)
        name = 'slot_nozzle' if i == 0 else f'slot_nozzle__{opt}'
        b.emit(name, root)
    # grain variants: one cast segment cut away, its bore pattern on the face
    yg0, yg1 = y_case0 + (y_case1 - y_case0) * 0.38, y_case0 + (y_case1 - y_case0) * 0.62
    grains = ['star', 'bucket', 'finocyl'] if kit == 'segmented' else ['star', 'highthrust', 'longburn', 'finocyl']
    for i, gk in enumerate(grains):
        b = Acc()
        rg = r * 0.9
        tl.lathe(b, [(rg, yg0), (rg, yg1)], M('grain'), 28, cap0=True)
        pts = bore(gk, rg)
        tl.prism(b, [tl.circle2d(0, 0, rg, 28), pts], 0.0, M('grain'), o=(0, yg1, 0))
        tl.prism(b, [pts], -0.002, M('soot'), o=(0, yg1, 0))
        b.emit('slot_grain' if i == 0 else f'slot_grain__{gk}', root)
    if kit == 'segmented':
        # field joints between the cast segments: capture feature (one band) or the old two-O-ring tang and clevis
        seg_len = (y_case1 - y_case0) / c['segs']
        for j, opt in enumerate(('capture', 'tworing')):
            b = Acc()
            for k in range(1, c['segs']):
                y = y_case0 + seg_len * k
                if opt == 'capture':
                    tl.lathe(b, [(r - 0.002, y - 0.03 * D), (r + 0.014 * D, y - 0.02 * D), (r + 0.014 * D, y + 0.02 * D), (r - 0.002, y + 0.03 * D)], M('grey'), 40)
                else:
                    for dy in (-0.022 * D, 0.022 * D):
                        tl.lathe(b, [(r - 0.002, y + dy - 0.01 * D), (r + 0.01 * D, y + dy), (r - 0.002, y + dy + 0.01 * D)], M('dark'), 40)
            b.emit('slot_joint' if j == 0 else 'slot_joint__tworing', root)
    return root, h, D


def bore(kind, rg):
    """The bore (hollow) cast into the propellant, as a 2D outline."""
    if kind in ('star', 'highthrust'):
        n = 11 if kind == 'star' else 14
        ro, ri = rg * (0.5 if kind == 'star' else 0.6), rg * (0.28 if kind == 'star' else 0.36)
        return [((ro if i % 2 == 0 else ri) * math.cos(math.pi * i / n), (ro if i % 2 == 0 else ri) * math.sin(math.pi * i / n)) for i in range(2 * n)]
    if kind == 'longburn':
        return tl.circle2d(0, 0, rg * 0.18, 16)
    if kind == 'bucket':
        return tl.circle2d(0, 0, rg * 0.42, 24)
    # finocyl: a round bore with fins
    pts = []
    for i in range(48):
        a = TAU * i / 48
        fin = (i % 8) in (0, 1)
        rr = rg * (0.66 if fin else 0.26)
        pts.append((rr * math.cos(a), rr * math.sin(a)))
    return pts


# ------------------------------------------------------------------ liquid boosters
def mini_engine(a, c, L, re, kind='regen', seg=20, exhaust=False):
    """A compact liquid engine standing with its nozzle exit at c and its gimbal L above."""
    c = V(*c)
    rt = re * 0.3
    bell = [(re, 0.0), (re * 0.8, L * 0.18), (re * 0.55, L * 0.38), (rt * 1.15, L * 0.56), (rt, L * 0.6)]
    m = M('regen') if kind == 'regen' else M('ablative')
    tl.lathe(a, bell, m, seg, c, u_rep=10)
    tl.lathe(a, [(r * 0.96, y) for (r, y) in bell[:4]], M('soot'), max(10, seg // 2), c, flip=True)
    tl.torus(a, c + V(0, 0.01 * L, 0), re + 0.01 * L, 0.012 * L, M('steel'), seg, 4)
    if kind == 'blanket':  # RS-68: ablative nozzle, a quilted silver blanket over the top half
        tl.lathe(a, [(re * 0.62, L * 0.34), (rt * 1.9, L * 0.62), (rt * 2.2, L * 0.8)], M('blanket'), seg, c, u_rep=8)
    tl.lathe(a, [(rt, L * 0.6), (rt * 1.8, L * 0.64), (rt * 1.8, L * 0.76), (rt * 1.3, L * 0.82), (rt * 0.9, L * 0.92), (rt * 0.7, L)], M('copper') if kind != 'blanket' else M('steel'), 14, c)
    tp = c + V(rt * 2.6, L * 0.66, 0)
    tl.lathe(a, [(0.0, 0.0), (rt * 0.9, 0.02 * L), (rt * 0.95, 0.2 * L), (rt * 0.6, 0.26 * L), (0.0, 0.27 * L)], M('steel'), 10, tp)
    if exhaust:
        tl.tube(a, [tp, tp + V(re * 0.3, -L * 0.2, 0), c + V(re + 0.05 * L, L * 0.12, 0)], 0.035 * L, M('dark'), 6)


def liquid_body(a, r, y0, y1, m, frames=(), u_rep=1):
    tl.lathe(a, [(r, y0), (r, y1)], m, 40, u_rep=u_rep)
    for f in frames:
        y = y0 + (y1 - y0) * f
        tl.lathe(a, [(r - 0.002, y - 0.025), (r + 0.012, y), (r - 0.002, y + 0.025)], M('grey'), 40)


def attach_fittings(a, r, ylo, yhi, D):
    for y in (ylo, yhi):
        tl.box(a, V(-r - 0.03 * D, y, 0), (0.07 * D, 0.1 * D, 0.14 * D), M('dark'))


def build_liquid(slug):
    d = PARTS[slug]
    h, D = d['height'], DIAMETER[slug]
    r = D / 2
    tl.reset()
    root = tl.root(slug)
    eng, tank, nose = Acc(), Acc(), Acc()
    if slug == 'booster_cbc_l':
        # Delta IV Common Booster Core: one RS-68 (ablative nozzle, silver blanket), white engine section, tan foam tank
        le, ye = 0.72 * D, 0.52 * D
        mini_engine(eng, (0, 0, 0), le, 0.24 * D, 'blanket', 28, exhaust=True)  # RS-68 exit 2.43 m on a 5.1 m core
        tl.lathe(tank, [(r * 0.86, le * 0.62), (r * 0.98, le * 0.62 + 0.1 * D), (r, le * 0.62 + 0.2 * D), (r, le * 0.62 + ye)], M('white'), 48)
        y_t0 = le * 0.62 + ye
        tl.lathe(tank, [(0.0, le * 0.62 + 0.01), (r * 0.86, le * 0.62 + 0.01)], M('blanket'), 32)
        tl.box(tank, polar(0, r + 0.01, le * 0.62 + ye * 0.55), (0.03, ye * 0.35, 0.5 * D), M('grey'))  # access panel
        y_n = h - 0.9 * D
        liquid_body(tank, r, y_t0, y_n, M('foam_tan'), (0.3, 0.62))
        tl.lathe(nose, nose_profile('cone', r, y_n, h - y_n), M('white'), 48)
        attach_fittings(tank, r, y_t0 + 0.2 * D, y_n - 0.3 * D, D)
    elif slug == 'booster_f9_m':
        # Falcon Heavy side booster: nine Merlins on an Octaweb, four folded carbon legs, four grid fins, nose cone
        le = 0.38 * D
        pts = [(0, 0)] + [(0.66 * math.cos(TAU * k / 8), 0.66 * math.sin(TAU * k / 8)) for k in range(8)]
        for (fx, fz) in pts:
            mini_engine(eng, (fx * r, 0, fz * r), le, 0.115 * D, 'regen', 14)
        ys = le * 0.95
        tl.lathe(tank, [(r * 0.97, ys), (r, ys + 0.05), (r, ys + 0.25 * D)], M('black'), 48)
        tl.lathe(tank, [(0.0, ys + 0.02), (r * 0.97, ys + 0.02)], M('plate'), 32)
        y_n = h - 0.95 * D
        liquid_body(tank, r, ys + 0.25 * D, y_n, M('white'), (0.5,))
        tl.lathe(tank, [(r + 0.004, ys + 0.25 * D), (r + 0.004, ys + 0.6 * D)], M('soot_steel'), 40)  # soot
        for k in range(4):  # folded legs, black carbon, at 45 degrees (Falcon 9 layout)
            az = 45 + 90 * k
            p0, p1 = polar(az, r + 0.05, ys + 0.1), polar(az, r + 0.05, ys + 0.1 + 0.33 * h)
            tl.beam(tank, p0, p1, 0.32 * D * 0.35, 0.09, M('carbon'), up=polar(az, 1))
            tl.box(tank, p0, (0.14, 0.2, 0.2), M('dark'), (polar(az, 1), V(0, 1, 0), polar(az + 90, 1)))
        for k in range(4):  # grid fins stowed flat, near the top
            az = 45 + 90 * k
            c = polar(az, r + 0.04, y_n - 0.25 * D)
            tl.box(tank, c, (0.05, 0.22 * D, 0.32 * D), M('titanium'), (polar(az, 1), V(0, 1, 0), polar(az + 90, 1)))
        tl.lathe(nose, nose_profile('ogive', r, y_n, h - y_n), M('white'), 48)
        attach_fittings(tank, r, ys + 0.5 * D, y_n - 0.4 * D, D)
    elif slug == 'booster_blok_a_m':
        # Energia Blok A (Zenit first stage): one RD-170, four chambers on one turbopump; conical nose
        le = 0.7 * D
        for k in range(4):
            p = polar(45 + 90 * k, 0.42 * r)
            mini_engine(eng, (p.x, 0, p.z), le, 0.19 * D, 'regen', 16)
        tl.lathe(eng, [(0.0, le * 0.75), (0.18 * D, le * 0.78), (0.18 * D, le * 1.0), (0.0, le * 1.02)], M('steel'), 16)
        ys = le * 0.9
        tl.lathe(tank, [(r * 0.94, ys), (r, ys + 0.2 * D), (r, ys + 0.4 * D)], M('dark'), 40)
        tl.lathe(tank, [(0.0, ys + 0.01), (r * 0.94, ys + 0.01)], M('plate'), 32)
        y_n = h - 1.4 * D
        liquid_body(tank, r, ys + 0.4 * D, y_n, M('grey'), (0.2, 0.45, 0.7))
        tl.lathe(nose, nose_profile('cone', r, y_n, h - y_n), M('grey'), 40)
        attach_fittings(tank, r, ys + 0.7 * D, y_n - 0.3 * D, D)
    elif slug == 'booster_urm1_m':
        # Angara URM-1: one RD-191 (one chamber, the quarter of an RD-170); short conical nose
        le = 0.62 * D
        mini_engine(eng, (0, 0, 0), le, 0.25 * D, 'regen', 28)
        ys = le * 0.9
        tl.lathe(tank, [(r * 0.9, ys), (r, ys + 0.15 * D), (r, ys + 0.3 * D)], M('dark'), 40)
        tl.lathe(tank, [(0.0, ys + 0.01), (r * 0.9, ys + 0.01)], M('plate'), 32)
        y_n = h - 0.95 * D
        liquid_body(tank, r, ys + 0.3 * D, y_n, M('green_grey'), (0.35, 0.7))
        tl.lathe(nose, nose_profile('cone', r, y_n, h - y_n), M('green_grey'), 40)
        attach_fittings(tank, r, ys + 0.6 * D, y_n - 0.3 * D, D)
    else:  # booster_cz5_m
        # Long March 5 booster: two YF-100s side by side, a slanted cone nose leaning toward the core
        le = 0.6 * D
        for s_ in (-1, 1):
            mini_engine(eng, (0, 0, s_ * 0.24 * D), le, 0.19 * D, 'regen', 18, exhaust=True)
        ys = le * 0.9
        tl.lathe(tank, [(r * 0.9, ys), (r, ys + 0.15 * D), (r, ys + 0.3 * D)], M('white'), 40)
        tl.lathe(tank, [(0.0, ys + 0.01), (r * 0.9, ys + 0.01)], M('plate'), 32)
        y_n = h - 1.45 * D
        liquid_body(tank, r, ys + 0.3 * D, y_n, M('white'), (0.25, 0.5, 0.75))
        n0 = len(nose.V)
        tl.lathe(nose, nose_profile('cone', r, y_n, h - y_n), M('white'), 40)
        for i in range(n0, len(nose.V)):  # shear the cone so its tip leans in over the core side (-X)
            x, y, z = nose.V[i]
            t = (y - y_n) / (h - y_n)
            nose.V[i] = (x - 0.62 * r * t, y, z)
        attach_fittings(tank, r, ys + 0.6 * D, y_n - 0.2 * D, D)
    eng.emit('engines', root)
    tank.emit('tank', root)
    nose.emit('nose', root)
    return root, h, D


def preview(root, h, D, slug, shots):
    tl.hide_except(root, {})
    t = (0, h * 0.45, 0)
    tl.look(os.path.join(shots, f'{slug}.png'), t, (h * 1.2, h * 0.45, h * 1.0), ortho=h * 1.08)
    tl.look(os.path.join(shots, f'{slug}_base.png'), (0, D * 0.6, 0), (D * 2.2, D * 1.6, D * 2.4))


def main():
    only = tl.C.arg('--only')
    shots = tl.shots_arg()
    for slug in list(SOLIDS) + ['booster_cbc_l', 'booster_f9_m', 'booster_blok_a_m', 'booster_urm1_m', 'booster_cz5_m']:
        if only and slug not in only.split(','):
            continue
        if slug not in PARTS:
            print(f'[model] skip {slug}: not in parts.json')
            continue
        root, h, D = build_solid(slug) if slug in SOLIDS else build_liquid(slug)
        tl.report_groups(root)
        tl.export(root, slug, height=h)
        if shots:
            os.makedirs(shots, exist_ok=True)
            preview(root, h, D, slug, shots)


main()
