"""
Fins, grid fin, the Starship aft flap and landing legs (tail section). One unit each: the game places the copies.

Run from the repo root (writes public/assets/models/builder/tail/<id>.glb):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/tail/gear.py -- [--only fin_l,...] [--shots DIR]

Radial contract: origin at the attachment point on the host's wall, +X pointing outward, +Y up.
- Fins keep the layout of the code-drawn fins (tail/art.js finArt): the root chord runs from y = -0.25 h to 0.75 h.
- Legs: one leg at a reference pose, hinge at the origin, the foot below and outward. Nodes: hinge, leg (plain) and the
  legs kit slots: slot_shock (honeycomb) + __hydraulic + __telescope, slot_pads (small) + __large + __dish,
  slot_probes (none: empty) + __probes + __loadcells. tail/art.js wrapModel copies it round the stage (x6 New Glenn,
  x4 New Shepard) and swings it about the hinge so the foot meets the ground.
"""
import os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tl  # noqa: E402
from tl import V, M, Acc, polar, TAU  # noqa: E402

_parts = json.load(open(os.path.join(tl.REPO, 'src', 'builder', 'sections', 'tail', 'parts.json'), encoding='utf-8'))
PARTS = {p['id']: p for p in (_parts['parts'] if isinstance(_parts, dict) else _parts)}


def wedge_fin(a, outline, t_root, t_tip, m, edge_m=None, span=1.0):
    """A fin plate in the x-y plane (x out from the wall, y up) with a double-wedge section: thickness t at the mid
    chord, sharp edges. outline: [(x, y)] clockwise or not; its leading edge is the top (the airflow comes from above
    on the climb... the fin's top edge faces the flow)."""
    # build it as a prism with a ridge: two halves (+z and -z) meeting at the outline, apex along the mid chord line
    pts = outline
    n = len(pts)
    cx = sum(p[0] for p in pts) / n
    cy = sum(p[1] for p in pts) / n
    verts, faces = [], []
    for s_ in (1, -1):
        base = len(verts)
        for (x, y) in pts:
            verts.append(V(x, y, 0.0))
        # ridge: the outline shrunk to the centroid, raised by the local thickness
        for (x, y) in pts:
            tt = t_root + (t_tip - t_root) * (x / max(1e-6, span))
            verts.append(V(cx + (x - cx) * 0.55, cy + (y - cy) * 0.55, s_ * tt / 2))
        for i in range(n):
            j = (i + 1) % n
            f = [base + i, base + j, base + n + j, base + n + i]
            faces.append(f if s_ > 0 else f[::-1])
        cap = [base + n + i for i in range(n)]
        faces.append(cap if s_ > 0 else cap[::-1])
    a.add(verts, faces, m)


def plate(a, outline, t, m, z0=0.0):
    """A flat plate in the x-y plane, thickness t centred on z0."""
    tl.prism(a, [outline], t, m, o=(0, 0, z0 + t / 2), U=(1, 0, 0), Vv=(0, 1, 0))


def build_fin(slug):
    d = PARTS[slug]
    h = d['height']
    tl.reset()
    root = tl.root(slug)
    a = Acc()
    if slug == 'fin_s':
        # Redstone: swept fin with an air rudder hinged on its trailing (lower) edge
        span = h * 0.62
        out = [(0, 0.75 * h), (span, 0.06 * h), (span, -0.12 * h), (0, -0.25 * h)]
        wedge_fin(a, out, 0.07, 0.03, M('white'), span=span)
        rud = [(span * 0.25, -0.16 * h), (span * 0.95, -0.13 * h), (span * 0.95, -0.36 * h), (span * 0.25, -0.33 * h)]
        plate(a, rud, 0.035, M('white'))
        tl.cyl(a, V(span * 0.22, -0.15 * h, 0), V(span * 0.97, -0.12 * h, 0), 0.02, M('dark'), 8)  # rudder hinge
        tl.box(a, V(0.05, 0.25 * h, 0), (0.1, h, 0.12), M('grey'))  # root fitting
    elif slug == 'fin_m':
        # Saturn IB: a swept trapezoid on a root fairing
        span = h * 0.6
        out = [(0, 0.75 * h), (span, 0.2 * h), (span, -0.2 * h), (0, -0.25 * h)]
        wedge_fin(a, out, 0.09, 0.04, M('white'), span=span)
        tl.box(a, V(0.06, 0.25 * h, 0), (0.12, h, 0.16), M('grey'))
    elif slug == 'fin_l':
        # Saturn V S-IC: a big trapezoidal fin with a thick wedge section, on its engine fairing
        span = h * 0.62
        out = [(0, 0.75 * h), (span, 0.12 * h), (span, -0.3 * h), (0, -0.25 * h)]
        wedge_fin(a, out, 0.2, 0.08, M('white'), span=span)
        tl.cyl(a, V(span * 0.02, 0.73 * h, 0), V(span, 0.13 * h, 0), 0.012, M('grey'), 6)  # leading edge strip
        tl.box(a, V(0.07, 0.25 * h, 0), (0.14, h, 0.24), M('grey'))
    elif slug == 'fin_aft_m':
        # New Shepard aft fin: a swept fin that swivels on a hydraulic actuator in a root fairing (drawn 1.5 x the
        # catalogue height, which reads true to the photos next to the booster)
        h = h * 1.5
        span = h * 0.45
        out = [(0.08, 0.55 * h), (span, 0.1 * h), (span, -0.12 * h), (0.08, -0.2 * h)]
        wedge_fin(a, out, 0.08, 0.04, M('offwhite'), span=span)
        tl.lathe(a, [(0.0, -0.3 * h), (0.11, -0.2 * h), (0.12, 0.4 * h), (0.0, 0.7 * h)], M('offwhite'), 16, (0.0, 0, 0))
        tl.cyl(a, V(0.04, 0.16 * h, 0), V(0.2, 0.16 * h, 0), 0.03, M('steel'), 10)  # the pivot shaft
    elif slug == 'fin_flap_l':
        # Starship aft flap: a big steel flap on a hinge line along the hull, black tiles on its windward face
        span = h * 0.36
        out = [(0.05, 0.92 * h), (span * 0.7, 0.86 * h), (span, 0.55 * h), (span, 0.02 * h), (0.05, 0.0)]
        plate(a, out, 0.1, M('stainless'), z0=-0.03)
        plate(a, [(x * 0.99 + 0.005, y) for (x, y) in out], 0.03, M('hex'), z0=0.035)
        tl.cyl(a, V(0.05, 0.0, 0), V(0.05, 0.92 * h, 0), 0.06, M('steel'), 10)        # hinge line
        tl.lathe(a, [(0.0, -0.02 * h), (0.09, 0.08 * h), (0.11, 0.5 * h), (0.09, 0.9 * h), (0.0, 0.96 * h)], M('stainless'), 14, a0=-math.pi / 2, a1=math.pi / 2)  # aerocover
        n0 = len(a.V)
        tl.box(a, V(0.02, 0.45 * h, 0), (0.04, 0.9 * h, 0.2), M('dark'))
    else:  # fin_grid_m: Falcon 9 titanium grid fin, deployed, on its hinge and actuator housing
        W, D, T, x0 = 1.2, 0.9, 0.26, 0.16
        ti = M('titanium')
        tl.box(a, V(0.09, T / 2, 0), (0.18, 0.5, 0.5), M('dark'))
        tl.box(a, V(0.16, T / 2, 0), (0.08, 0.1, 0.3), M('steel'))
        f = 0.04
        for (cx, cz, sx, sz) in ((x0 + D / 2, W / 2, D + f, f), (x0 + D / 2, -W / 2, D + f, f), (x0, 0, f, W), (x0 + D, 0, f, W)):
            tl.box(a, V(cx, T / 2, cz), (sx, T, sz), ti)
        step = 0.12
        for dirn in (1, -1):
            c = -2.0
            while c <= 2.0:
                # the line x - dirn z = c inside [x0, x0 + D] x [-W/2, W/2]
                lo = max(x0, (-W / 2 + c) if dirn > 0 else (c - W / 2))
                hi = min(x0 + D, (W / 2 + c) if dirn > 0 else (c + W / 2))
                if hi - lo > 0.03:
                    p0 = V(lo, T / 2, (lo - c) if dirn > 0 else (c - lo))
                    p1 = V(hi, T / 2, (hi - c) if dirn > 0 else (c - hi))
                    tl.beam(a, p0, p1, 0.008, T * 0.96, ti, up=V(0, 1, 0))
                c += step
    a.emit('fin', root)
    return root, h


LEGS = {
    # New Glenn: a long leg in a slim fairing, telescoping strut, broad foot; hinge low on the skirt
    'legs_glenn_l': dict(foot=(2.3, -2.9), strut_top=(0.0, 1.1), strut_at=0.55, width=0.42, depth=0.2, mat='white', pad=0.42),
    # New Shepard: short, stout legs that swing down, a big round pad
    'legs_shepard_m': dict(foot=(1.05, -2.05), strut_top=(0.0, 0.65), strut_at=0.5, width=0.3, depth=0.22, mat='offwhite', pad=0.36),
}


def build_leg(slug):
    d = PARTS[slug]
    h = d['height']
    c = LEGS[slug]
    tl.reset()
    root = tl.root(slug)
    fx, fy = c['foot']
    hinge, foot = V(0.06, 0.0, 0), V(fx, fy, 0)
    # plain: the hinge fitting on the wall and the leg itself (a tapered box beam inside an aerodynamic fairing)
    a = Acc()
    tl.box(a, V(0.05, 0.0, 0), (0.12, 0.3, c['width'] + 0.1), M('dark'))
    tl.cyl(a, V(0.08, 0.0, -c['width'] / 2 - 0.04), V(0.08, 0.0, c['width'] / 2 + 0.04), 0.05, M('steel'), 10)
    a.emit('hinge', root)
    b = Acc()
    axis = (foot - hinge).normalized()
    side = V(0, 0, 1)
    nrm = axis.cross(side).normalized()
    L = (foot - hinge).length
    sec = []  # a lofted, tapered section along the leg
    for k in range(5):
        t = k / 4
        w = c['width'] * (1 - 0.45 * t)
        dd = c['depth'] * (1 - 0.35 * t)
        p = hinge + axis * (L * t)
        sec.append([p + side * (w / 2) + nrm * (dd / 2), p - side * (w / 2) + nrm * (dd / 2), p - side * (w / 2) - nrm * (dd / 2), p + side * (w / 2) - nrm * (dd / 2)])
    verts, faces = [], []
    for k, ring_ in enumerate(sec):
        verts += ring_
    for k in range(len(sec) - 1):
        for i in range(4):
            j = (i + 1) % 4
            faces.append([k * 4 + i, k * 4 + j, (k + 1) * 4 + j, (k + 1) * 4 + i])
    faces.append([0, 3, 2, 1])
    faces.append([(len(sec) - 1) * 4 + i for i in range(4)])
    b.add(verts, faces, M(c['mat']))
    tl.box(b, foot + axis * (-0.12), (0.16, 0.16, c['width'] * 0.6), M('dark'), (axis, nrm, side))  # ankle
    b.emit('leg', root)
    # slot_shock: the strut from the stage wall to the leg, which takes the landing
    top = V(*c['strut_top'], 0) + V(0.06, 0, 0)
    at = hinge + axis * (L * c['strut_at'])
    for k, opt in enumerate(('honeycomb', 'hydraulic', 'telescope')):
        s = Acc()
        mid = top.lerp(at, 0.55)
        if opt == 'honeycomb':
            tl.cyl(s, top, mid, 0.07, M('alu'), 10)
            tl.cyl(s, mid, at, 0.045, M('steel'), 10)
            tl.cyl(s, top.lerp(at, 0.3), top.lerp(at, 0.5), 0.085, M('gold'), 6)
        elif opt == 'hydraulic':
            tl.cyl(s, top, mid, 0.075, M('steel'), 12)
            tl.cyl(s, mid, at, 0.04, M('stainless'), 10)
            tl.tube(s, [top + V(0, 0.05, 0.08), top.lerp(mid, 0.6) + V(0, 0, 0.09)], 0.012, M('cable'), 5)
        else:
            tl.cyl(s, top, top.lerp(at, 0.4), 0.08, M('carbon'), 10)
            tl.cyl(s, top.lerp(at, 0.4), top.lerp(at, 0.72), 0.062, M('carbon'), 10)
            tl.cyl(s, top.lerp(at, 0.72), at, 0.045, M('stainless'), 10)
        tl.box(s, top, (0.14, 0.14, 0.18), M('dark'))
        s.emit('slot_shock' if k == 0 else f'slot_shock__{opt}', root)
    # slot_pads: the foot
    for k, opt in enumerate(('small', 'large', 'dish')):
        s = Acc()
        rp = c['pad'] * (1.0 if opt == 'small' else 1.45)
        if opt == 'dish':
            tl.lathe(s, [(0.0, -0.02), (rp * 0.7, 0.0), (rp * 1.15, 0.1), (rp * 1.2, 0.14)], M('dark'), 24, foot + V(0, -0.12, 0))
        else:
            tl.lathe(s, [(0.0, 0.0), (rp, 0.0), (rp * 1.02, 0.06), (rp * 0.6, 0.12), (rp * 0.2, 0.16), (0.0, 0.16)], M('dark'), 24, foot + V(0, -0.14, 0))
        tl.cyl(s, foot + V(0, 0.02, 0), foot + V(0, -0.12, 0), 0.08, M('alu'), 10)
        s.emit('slot_pads' if k == 0 else f'slot_pads__{opt}', root)
    # slot_probes: nothing, touchdown probes hanging below the foot, or load cells on the leg
    for k, opt in enumerate(('none', 'probes', 'loadcells')):
        s = Acc()
        if opt == 'probes':
            p = foot + V(c['pad'] * 0.7, -0.1, 0)
            tl.cyl(s, p, p + V(0, -1.0, 0), 0.012, M('steel'), 6, caps=False)
            tl.sphere(s, p + V(0, -1.0, 0), 0.03, M('steel'), 8, 4)
        elif opt == 'loadcells':
            for f in (0.75, 0.88):
                tl.box(s, hinge + axis * (L * f) + nrm * (c['depth'] * 0.45), (0.1, 0.06, 0.1), M('amber'), (axis, nrm, side))
        s.emit('slot_probes' if k == 0 else f'slot_probes__{opt}', root)
    return root, h


def loft(a, pts_axis, widths, depths, side, nrm, m, offset=0.0):
    """A tapered box beam through the points pts_axis, `widths` across (side) and `depths` deep (along nrm)."""
    secs = []
    for p, w, d in zip(pts_axis, widths, depths):
        c = p + nrm * offset
        secs.append([c + side * (w / 2) + nrm * d, c - side * (w / 2) + nrm * d, c - side * (w / 2), c + side * (w / 2)])
    verts, faces = [], []
    for ring_ in secs:
        verts += ring_
    for k in range(len(secs) - 1):
        for i in range(4):
            j = (i + 1) % 4
            faces.append([k * 4 + i, k * 4 + j, (k + 1) * 4 + j, (k + 1) * 4 + i])
    faces.append([0, 3, 2, 1])
    faces.append([(len(secs) - 1) * 4 + i for i in range(4)])
    a.add(verts, faces, m)


def build_falcon_leg(slug):
    """
    Falcon 9 landing leg, one of four: a long, flat carbon-fibre leg folded flat along the tail (as on the pad and
    during the climb), hinged at its foot end low on the engine section, its telescoping pusher stowed inside, the
    small foot pad at its tip. pose_deployed (hidden by tail/art.js) is the same leg swung open for landing.
    Real: about 1.2 m wide at the hinge, an 18 m span open; here the leg is the part's 3.2 m.
    """
    d = PARTS[slug]
    L = d['height']
    tl.reset()
    root = tl.root(slug)
    up, out, side = V(0, 1, 0), V(1, 0, 0), V(0, 0, 1)
    a = Acc()
    tl.box(a, V(0.06, 0.08, 0), (0.12, 0.26, 0.62), M('dark'))                                 # hinge fitting
    tl.cyl(a, V(0.1, 0.06, -0.33), V(0.1, 0.06, 0.33), 0.045, M('alu'), 10)                     # hinge pin
    a.emit('hinge', root)
    b = Acc()
    n = 6
    pts = [V(0, 0.04 + (L - 0.04) * k / (n - 1), 0) for k in range(n)]
    widths = [0.58 - 0.3 * (k / (n - 1)) for k in range(n)]
    depths = [0.13 - 0.04 * (k / (n - 1)) for k in range(n)]
    loft(b, pts, widths, depths, side, out, M('carbon'), offset=0.035)                       # the leg (a flat carbon box)
    for f in (0.22, 0.5, 0.78):                                                              # light ribs on the outer face
        y = 0.04 + (L - 0.04) * f
        w = 0.58 - 0.3 * f
        tl.box(b, V(0.035 + 0.13 - 0.04 * f + 0.004, y, 0), (0.01, 0.03, w * 0.92), M('dark'))
    tl.box(b, V(0.12, L * 0.62, 0), (0.06, 0.12, 0.2), M('alu'))                              # pusher attach lug
    b.emit('leg', root)
    # slot_shock: the telescoping pusher with its crushable honeycomb core, stowed inside the leg
    for k, opt in enumerate(('honeycomb', 'hydraulic', 'telescope')):
        s_ = Acc()
        lo, hi = V(0.09, L * 0.3, 0), V(0.09, L * 0.95, 0)
        mid = lo.lerp(hi, 0.5)
        if opt == 'honeycomb':
            tl.cyl(s_, hi, mid, 0.055, M('alu'), 10)
            tl.cyl(s_, mid, lo, 0.04, M('steel'), 10)
            tl.cyl(s_, lo.lerp(hi, 0.55), lo.lerp(hi, 0.75), 0.065, M('gold'), 6)
        elif opt == 'hydraulic':
            tl.cyl(s_, hi, mid, 0.06, M('steel'), 10)
            tl.cyl(s_, mid, lo, 0.035, M('stainless'), 8)
        else:
            tl.cyl(s_, hi, lo.lerp(hi, 0.55), 0.06, M('carbon'), 10)
            tl.cyl(s_, lo.lerp(hi, 0.55), lo, 0.045, M('stainless'), 8)
        s_.emit('slot_shock' if k == 0 else f'slot_shock__{opt}', root)
    # slot_pads: the foot at the tip of the leg (on top while folded)
    tip = V(0.1, L, 0)
    for k, opt in enumerate(('small', 'large', 'dish')):
        s_ = Acc()
        rp = 0.16 if opt == 'small' else 0.24
        if opt == 'dish':
            tl.lathe(s_, [(0.0, 0.0), (0.16, 0.02), (0.24, 0.07), (0.25, 0.09)], M('dark'), 20, tip, axis=(0, 1, 0))
        else:
            tl.lathe(s_, [(0.0, 0.0), (rp, 0.0), (rp, 0.05), (rp * 0.5, 0.08), (0.0, 0.08)], M('dark'), 20, tip, axis=(0, 1, 0))
        s_.emit('slot_pads' if k == 0 else f'slot_pads__{opt}', root)
    for k, opt in enumerate(('none', 'probes', 'loadcells')):
        s_ = Acc()
        if opt == 'probes':
            tl.cyl(s_, tip + V(0.1, 0.0, 0.1), tip + V(0.1, 0.6, 0.1), 0.01, M('steel'), 6, caps=False)
        elif opt == 'loadcells':
            for f in (0.12, 0.2):
                tl.box(s_, V(0.2, L * f, 0), (0.06, 0.08, 0.12), M('amber'))
        s_.emit('slot_probes' if k == 0 else f'slot_probes__{opt}', root)
    # pose_deployed: the leg swung down and out for landing, propped by the extended pusher
    pd = Acc()
    ang = math.radians(118)  # from pointing up along the tail to about 28 degrees below the horizontal
    axis_d = V(math.sin(ang), math.cos(ang), 0)
    nrm_d = V(math.cos(ang), -math.sin(ang), 0) * -1
    ptsd = [V(0.06, 0.06, 0) + axis_d * ((L - 0.04) * k / (n - 1)) for k in range(n)]
    loft(pd, ptsd, widths, depths, side, nrm_d, M('carbon'))
    foot = ptsd[-1]
    tl.lathe(pd, [(0.0, 0.0), (0.16, 0.0), (0.16, 0.05), (0.08, 0.08), (0.0, 0.08)], M('dark'), 16, foot + V(0, -0.1, 0))
    top = V(0.06, L * 0.55, 0)
    tl.cyl(pd, top, ptsd[3], 0.05, M('alu'), 10)
    pd.emit('pose_deployed', root)
    return root, L


def main():
    only = tl.C.arg('--only')
    shots = tl.shots_arg()
    for slug in ('fin_s', 'fin_m', 'fin_l', 'fin_aft_m', 'fin_flap_l', 'fin_grid_m', 'legs_glenn_l', 'legs_shepard_m', 'legs_falcon_m'):
        if only and slug not in only.split(','):
            continue
        if slug not in PARTS:
            print(f'[model] skip {slug}: not in parts.json')
            continue
        root, h = build_falcon_leg(slug) if slug == 'legs_falcon_m' else build_leg(slug) if slug.startswith('legs') else build_fin(slug)
        tl.report_groups(root)
        tl.export(root, slug)
        if shots:
            os.makedirs(shots, exist_ok=True)
            tl.hide_except(root, {})
            tl.look(os.path.join(shots, f'{slug}.png'), (h * 0.3, 0, 0), (h * 0.6, h * 0.5, h * 2.2), ortho=h * 1.6)


main()
