"""
G4, the escape-system generator (SpaceB&E builder, Role 1, nose section): Mercury and Apollo towers (truss + solid
escape motor), the Soyuz SAS, the Orion LAS, the Shenzhou (CZ-2F) and Gaganyaan crew escape systems, each with its
real motors, nozzles and steering hardware.

Run from the repo root:
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/nose/towers.py -- [--only les_apollo] [--shots DIR]

Proportions: the parts keep their catalogue heights, so the real assemblies are compressed along the axis (the truss most,
about 0.55 of its scaled length, the motors less); radii, nozzle counts and cant angles are the real ones.
Truss towers stand on the capsule's docking ring (NECK). The shrouded systems (Soyuz, Orion, Shenzhou, Gaganyaan) are
covers like the fairings: form_shroud / form_neck bases (see fairings.py), the fairing's nose rising into the tower.

Inner pieces (kit `escape_tower`): slot_motor (the escape motor's nozzles and grain; __canted, __ring, __reverse,
__staged), slot_jettison (the tower jettison motor; __separate, __backup, __shared = none), slot_steering (__ballast,
__canards, __acm, __gridfins). The real hardware is the default (no suffix).
"""
import os, sys, math
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nl  # noqa: E402
from nl import V, Acc, M, er, ea, polar, lathe, cyl, sphere, torus, tube, box, beam, patch, disc, band, ring_on, strip_along, bell, Rev, fillet, resample, FRONT, NECK, DEG, RADIUS  # noqa: E402

TOWERS = {
    # truss towers: legs, base half-width, top half-width, motor span (m0, m1, radius), jettison (j0, j1, radius), nose start
    'les_mercury': dict(part='les_tower_mercury', size='s', H=2.6, legs=3, base=0.42, top=0.12, truss_top=1.22, motor=(1.25, 2.05, 0.13),
                        jet=(2.05, 2.33, 0.1), nose=2.33, real=dict(motor='canted', jettison='separate', steering='ballast'), nozzles=3, cant=22.0,
                        truss_m='red', case_m='alu'),
    'les_apollo': dict(part='les_tower_apollo', size='l', H=4.4, legs=4, base=0.33, top=0.2, truss_top=1.3, motor=(1.42, 3.3, 0.24),
                       jet=(3.3, 3.62, 0.2), nose=3.78, real=dict(motor='canted', jettison='separate', steering='canards'), nozzles=4, cant=35.0,
                       truss_m='red', case_m='white'),
    # shrouded systems: fairing cylinder top (yc), fairing cone top (yt) and its radius (rt)
    'las_soyuz': dict(part='las_soyuz', size='m', H=5.6, bt=0.55, yc=2.4, yt=3.3, rt=0.42, motor=(3.65, 5.2, 0.24), jet=(4.95, 5.2, 0.24), nose=5.2,
                      real=dict(motor='ring', jettison='separate', steering='gridfins'), fins_y=1.25, fairing_motors=True, truss=True),
    # Orion: the boost-protective cover hangs below the part's base round the crew module (form_shroud, shown only over
    # capsule_orion), then necks into the abort motor; the abort motor is long and slim as on the real LAS
    'las_orion': dict(part='las_orion', size='l', H=5.0, bt=0.6, ogive=0.55, rt=0.36, motor=(0.55, 3.65, 0.36), jet=(3.65, 4.15, 0.3), nose=4.42,
                      real=dict(motor='reverse', jettison='separate', steering='acm'), orion=True),
    'las_shenzhou': dict(part='las_shenzhou', size='m', H=4.5, bt=0.45, yc=1.95, yt=2.55, rt=0.3, motor=(2.62, 3.85, 0.2), jet=(3.85, 4.12, 0.17), nose=4.12,
                         real=dict(motor='canted', jettison='separate', steering='gridfins'), fins_y=0.95, hem=True),
    'las_gaganyaan': dict(part='las_gaganyaan', size='m', H=5.0, bt=0.45, yc=1.85, yt=2.65, rt=0.32, motor=(2.65, 4.0, 0.28), jet=(4.0, 4.38, 0.2), nose=4.38,
                          real=dict(motor='staged', jettison='separate', steering='gridfins'), fins_y=0.85, hem=True, ogive_fairing=True),
}
OPTIONS = {'motor': ['canted', 'ring', 'reverse', 'staged'], 'jettison': ['separate', 'backup', 'shared'], 'steering': ['ballast', 'canards', 'acm', 'gridfins']}
PAL = {'red': lambda: M('red'), 'alu': lambda: M('alu'), 'white': lambda: M('white')}


def nozzle(acc, throat, d, rt, re, L, m=None):
    """A bell nozzle from its throat along direction d (the exit downstream)."""
    bell(acc, throat, d, rt, re, L, m or M('nozzle'), 6 if rt < 0.025 else 8)


def canted_set(acc, n, y, r_ring, rt, re, L, cant, az0=0.0, up=False):
    """n nozzles round a ring, exhausting down (or up for reverse flow, then turned down) and canted out by `cant`."""
    for k in range(n):
        a = az0 + 360 * k / n
        d = (V(0, -1, 0) * math.cos(math.radians(cant)) + er(a) * math.sin(math.radians(cant))).normalized()
        nozzle(acc, polar(a, r_ring, y), d, rt, re, L)


def truss(acc, n, base, top, y0, y1, bays, m, r=0.025, start=90.0):
    """A tapering truss of n legs (n corners from `base` to `top` radius) with rings and X-bracing in each bay."""
    def corner(i, t):
        rr = base + (top - base) * t
        return polar(start + 360 * i / n, rr, y0 + (y1 - y0) * t)
    for i in range(n):
        cyl(acc, corner(i, 0), corner(i, 1), r * 1.25, m, 6, caps=False)
    for b in range(bays + 1):
        t = b / bays
        for i in range(n):
            cyl(acc, corner(i, t), corner((i + 1) % n, t), r * 0.8, m, 5, caps=False)
        if b == bays:
            break
        t2 = (b + 1) / bays
        for i in range(n):
            cyl(acc, corner(i, t), corner((i + 1) % n, t2), r * 0.6, m, 5, caps=False)
            cyl(acc, corner((i + 1) % n, t), corner(i, t2), r * 0.6, m, 5, caps=False)


def grid_fin(acc, c, out, up, w, h, m, cells=(3, 5)):
    """A lattice grid fin (frame and cross bars) folded flat: centred at c, facing `out`, `up` along its height."""
    c, out, up = V(*c) if not hasattr(c, 'x') else c, out.normalized(), up.normalized()
    side = up.cross(out).normalized()
    t = 0.04 * max(w, 0.4)
    for s_ in (-1, 1):
        box(acc, c + side * s_ * w / 2, (t * 0.6, h, t), m, (side, up, out))
        box(acc, c + up * s_ * h / 2, (w, t * 0.6, t), m, (side, up, out))
    nx, ny = cells
    for i in range(1, nx):  # the diagonal lattice drawn as two crossing families of bars
        x = -w / 2 + w * i / nx
        box(acc, c + side * x, (t * 0.3, h, t * 0.8), m, (side, up, out))
    for j in range(1, ny):
        y = -h / 2 + h * j / ny
        box(acc, c + up * y, (w, t * 0.3, t * 0.8), m, (side, up, out))
    box(acc, c + up * (h / 2 + 0.04) - out * 0.02, (w * 0.3, 0.08, 0.06), M('dark'), (side, up, out))  # the hinge


def build(slug, shots=None):
    sp = TOWERS[slug]
    nl.reset()
    pd = nl.part_data(sp['part']) or {}
    size = pd.get('size', sp['size'])
    H = float(pd.get('height', sp['H']))
    R = RADIUS[size]
    k = H / sp['H']  # the layout scales with a changed catalogue height
    S = {key: (tuple(x * k for x in v) if isinstance(v, tuple) else (v * k if key in ('truss_top', 'nose', 'yc', 'yt', 'ogive', 'fins_y') else v)) for key, v in sp.items()}
    for key in ('motor', 'jet'):  # radii do not scale with the height
        S[key] = (sp[key][0] * k, sp[key][1] * k, sp[key][2])
    root = nl.root(slug)
    body = Acc()
    rev = None
    if 'legs' in sp:
        truss_tower(body, S, H)
    else:
        rev = shroud_tower(body, root, S, H, R, pd)
    motor_case(body, S, H, slug)
    body.emit('body', root)
    slots(root, S, H, R, slug, rev)
    nl.report_groups(root)
    tris, size_b = nl.export(root, slug, H, R if 'legs' not in sp else None)
    if shots:
        preview(root, slug, H, R, shots)
    return slug, tris, size_b


def truss_tower(b, S, H):
    m = PAL[S['truss_m']]()
    n = S['legs']
    start = 90.0 if n == 3 else 45.0
    # the clamp ring on the capsule's docking ring and the leg fittings
    lathe(b, [(NECK + 0.01, 0.0), (NECK + 0.01, 0.04), (NECK - 0.04, 0.04), (NECK - 0.04, 0.0)], M('dark'), 48)
    for i in range(n):
        c = polar(start + 360 * i / n, S['base'], 0.06)
        box(b, c, (0.1, 0.08, 0.1), M('dark'))
    truss(b, n, S['base'], S['top'], 0.08, S['truss_top'], 3, m, 0.022 if n == 3 else 0.03, start)
    # the skirt where the truss meets the motor
    m0, m1, mr = S['motor']
    lathe(b, [(S['top'] + 0.03, S['truss_top'] - 0.02), (mr * 0.95, m0 + 0.02)], M('dark'), 24)


def shroud_tower(b, root, S, H, R, pd):
    """The fairing of a shrouded escape system: cylinder (or ogive) up to the tower, its two bases, grid fins and motors."""
    bt = float((pd.get('hullProfile') or {}).get('bt', S['bt']))
    skin = M('white')
    if S.get('orion'):
        return orion_cover(b, root, S, H, R)
    if 'ogive' in S:  # Orion: an ogive boost-protective cover rising straight into the abort motor
        y0, y1, rt = bt, S['ogive'], S['rt']
        L = y1 - y0
        pts = []
        for j in range(25):
            t = j / 24
            x = t * L
            # a tangent ogive from R down to rt
            Rr = R - rt
            rho = (Rr * Rr + L * L) / (2 * Rr)
            pts.append((rt + math.sqrt(max(0.0, rho * rho - x * x)) + Rr - rho, y0 + x))
        prof = [(R, bt)] + pts[1:]
    else:
        yc, yt, rt = S['yc'], S['yt'], S['rt']
        if S.get('ogive_fairing'):
            pts = [(R, bt), (R, yc)]
            L = yt - yc
            for j in range(1, 13):
                t = j / 12
                pts.append((rt + (R - rt) * math.sqrt(max(0.0, 1 - t ** 1.7)), yc + L * t))
            prof = fillet(pts, 0.1, 4)
        else:
            prof = fillet([(R, bt), (R, yc), (R * 0.97, yc + 0.06), (rt, yt)], 0.12, 4)
    rev = Rev(prof)
    lathe(b, prof, skin, 56)
    lathe(b, [(prof[-1][0], prof[-1][1]), (prof[-1][0] * 0.9, prof[-1][1] + 0.02), (0.0, prof[-1][1] + 0.02)], M('dark'), 32)
    for j in range(2):  # the fairing halves' seams
        strip_along(b, rev, FRONT + 35 + 180 * j, 0.02, rev.L - 0.05, 0.035, 0.008, M('mid_grey'))
    ring_on(b, rev, 0.02, 0.03, 0.008, M('mid_grey'), 64)
    if S.get('windows'):  # Orion's LAS cover: the window openings over the crew module's windows
        for a in (-28, 28, -44, 44):
            patch(b, rev, FRONT + a, rev.s_at_y(bt + 0.3), 0.22, 0.17, M('glass'), 0.003, 0.0, 3, 3, 1.0, 0.03)
        patch(b, rev, FRONT, rev.s_at_y(bt + 0.2), 0.45, 0.4, M('glass'), 0.003, 0.0, 4, 4, 1.0, 0.1)
    if S.get('fairing_motors'):  # Soyuz: the fairing's own solid motors (they pulled the capsule clear on MS-10)
        for az in (0, 180):
            for off in (-9, 9):
                a = FRONT + 90 + az + off
                c = polar(a, R + 0.035, S['yc'] - 0.55)
                cyl(b, c, c + V(0, 0.55, 0), 0.045, M('offwhite'), 10)
                nozzle(b, c, (V(0, -1, 0) + er(a) * 0.4).normalized(), 0.025, 0.05, 0.09)
    if S.get('hem'):  # high-altitude escape motors on the fairing's shoulder (Shenzhou, Gaganyaan)
        y = S['yc'] + 0.05
        for j in range(4):
            a = FRONT + 45 + 90 * j
            P, N, Tm, Ta = rev.frame_y(a, y, 0.0)
            patch(b, rev, a, rev.s_at_y(y), 0.22, 0.32, M('offwhite'), 0.0, 0.07, 2, 3, 1.0, 0.05)
            nozzle(b, P + N * 0.06 - Tm * 0.12, (-Tm + N * 0.5).normalized(), 0.025, 0.06, 0.12)
    # the two bases the game picks between (see fairings.py)
    a = Acc()
    lathe(a, [(R, 0.0), (R, bt)], skin, 64)
    lathe(a, [(R + 0.006, 0.0), (R + 0.006, 0.03), (R - 0.03, 0.03), (R - 0.03, 0.0)], M('dark'), 64)
    a.emit('form_shroud', root)
    a = Acc()
    lathe(a, fillet([(NECK, 0.0), (NECK + 0.03, 0.02), (R, bt), (R, bt + 0.001)], 0.05, 4), skin, 64)
    lathe(a, [(NECK + 0.012, 0.0), (NECK + 0.012, 0.03), (NECK - 0.02, 0.03), (NECK - 0.02, 0.0)], M('alu'), 48)
    a.emit('form_neck', root)
    if S.get('truss'):  # Soyuz: a short truss from the fairing's cone to the motor
        truss(b, 4, S['rt'] * 0.86, S['motor'][2] * 0.9, S['yt'], S['motor'][0], 1, M('alu'), 0.02, 45.0)
    return rev


def orion_cover(b, root, S, H, R):
    """Orion's launch abort system cover. Below y = 0 (the crew module's top) it follows capsule_orion's 32.5 degree
    wall a few cm out, down to the module's shoulder, with the window openings over the crew module's windows: the
    node form_shroud, which the game shows only when capsule_orion is the part below (sections/nose/art.js wrapModel).
    Above y = 0 it closes round the docking tunnel and necks into the abort motor. form_neck is a flat collar on the
    docking ring for any other capsule."""
    cd = nl.part_data('capsule_orion') or {}
    hc = float(cd.get('height', 2.25))
    Rc = RADIUS[cd.get('size', 'l')]
    pc = (cd.get('hullProfile') or {}).get('profile') or [[0.975, 0], [1, 0.03], [0.36, 0.78], [0.31, 0.85], [0.267, 0.9], [0.267, 1]]
    cap = [(rf * Rc, yf * hc - hc) for (rf, yf) in pc]
    i_sh = max(range(len(cap)), key=lambda i: cap[i][0])
    sh, ce = cap[i_sh], cap[i_sh + 1]  # the shoulder and the end of the straight conical wall
    half = math.atan2(sh[0] - ce[0], ce[1] - sh[1])  # the wall's half-angle from the axis
    gap = 0.05
    d = gap / math.cos(half)
    rv = NECK + 0.06  # round the docking tunnel and its ring
    p1 = (ce[0] + d, ce[1])
    y_v = p1[1] + (p1[0] - rv) / math.tan(half)
    pts = [(sh[0] + 0.015, sh[1]), p1, (rv, y_v), (rv, 0.06), (S["rt"], S["ogive"])]
    prof = resample(fillet(pts, 0.1, 6), 0.3)
    below = [p for p in prof if p[1] <= 0.0] + [(rv, 0.0)]
    above = [(rv, 0.0)] + [p for p in prof if p[1] > 0.0]
    skin = M('white')
    # the part above the crew module (always shown)
    lathe(b, above, skin, 56)
    rev_a = Rev(above)
    ring_on(b, rev_a, 0.05, 0.03, 0.008, M('mid_grey'), 48)
    # the cover round the crew module
    a = Acc()
    lathe(a, below, skin, 64)
    rev = Rev(below)
    for j in range(2):  # the cover's two halves
        strip_along(a, rev, FRONT + 35 + 180 * j, 0.03, rev.L - 0.02, 0.035, 0.008, M('mid_grey'))
    ring_on(a, rev, 0.03, 0.03, 0.006, M('mid_grey'), 64)
    lathe(a, [(sh[0] + 0.015, sh[1]), (sh[0] - 0.02, sh[1])], M('dark'), 64)  # its lower edge on the shoulder
    for (az, yf, w, h) in ((-28, 0.5, 0.24, 0.2), (28, 0.5, 0.24, 0.2), (-44, 0.42, 0.24, 0.2), (44, 0.42, 0.24, 0.2), (0, 0.4, 0.3, 0.3)):
        s = rev.s_at_y(yf * hc - hc)
        patch(a, rev, FRONT + az, s, w, h, M('glass'), 0.003, 0.0, 3, 3, 1.0, 0.04)
        patch(a, rev, FRONT + az, s, w + 0.05, h + 0.05, M('dark'), 0.002, 0.0, 3, 3, 1.0, 0.05)
    a.emit('form_shroud', root)
    # on any other capsule: a flat collar on the docking ring
    a = Acc()
    lathe(a, [(NECK - 0.02, 0.003), (rv, 0.003)], skin, 48)
    lathe(a, [(NECK + 0.012, 0.0), (NECK + 0.012, 0.03), (NECK - 0.02, 0.03), (NECK - 0.02, 0.0)], M('alu'), 48)
    a.emit('form_neck', root)
    return rev_a


def motor_case(b, S, H, slug):
    """The escape motor's case, the jettison motor, the nose cone and its tip."""
    m0, m1, mr = S['motor']
    j0, j1, jr = S['jet']
    case = M('white') if slug != 'les_mercury' else M('alu')
    lathe(b, [(mr * 0.6, m0 - 0.02), (mr, m0 + 0.04), (mr, m1)], case, 32)
    for y in (m0 + (m1 - m0) * 0.25, m1 - 0.04):
        lathe(b, [(mr + 0.006, y - 0.012), (mr + 0.006, y + 0.012)], M('dark'), 32)
    if slug == 'las_orion':
        # the abort motor's four bulged nozzle fairings near its top
        for j in range(4):
            a = FRONT + 45 + 90 * j
            box(b, polar(a, mr + 0.03, m1 - 0.22), (0.12, 0.26, 0.2), M('white'), (er(a), V(0, 1, 0), ea(a)))
    lathe(b, [(mr, m1), (jr, j0 + 0.04), (jr, j1)], M('steel_m') if slug == 'les_mercury' else case, 32)
    nose_y = S['nose']
    if j1 < nose_y:  # the pitch motor / canard section between the jettison motor and the nose
        lathe(b, [(jr, j1), (jr * 0.85, j1 + 0.02), (jr * 0.85, nose_y)], case, 32)
        rn = jr * 0.85
    else:
        rn = jr
    L = H - 0.06 - nose_y
    pts = []
    for j in range(13):
        t = j / 12
        pts.append((rn * (1 - t) ** 0.8 if slug != 'les_apollo' else rn * max(0.0, 1 - t ** 1.25) ** 0.85, nose_y + L * t))
    pts[-1] = (0.0, nose_y + L)
    lathe(b, pts, case if slug != 'les_mercury' else M('steel_m'), 32)
    if slug == 'les_apollo':  # the Q-ball on the tip and its probe
        sphere(b, (0, H - 0.08, 0), 0.06, M('steel_m'), 12, 6)
        cyl(b, (0, H - 0.04, 0), (0, H, 0), 0.006, M('steel_m'), 6)
    else:
        cyl(b, (0, nose_y + L - 0.01, 0), (0, H, 0), 0.008, M('steel_m'), 6)


def emit_all(root, key, build):
    """Plain slot_<key> = the kit's first option; slot_<key>__<option> for the others (README "Inner pieces")."""
    for i, o in enumerate(OPTIONS[key]):
        build(o).emit(f'slot_{key}' if i == 0 else f'slot_{key}__{o}', root)


def slots(root, S, H, R, slug, rev):
    real = S['real']
    m0, m1, mr = S['motor']
    j0, j1, jr = S['jet']

    def motor(kind):
        acc = Acc()
        cyl(acc, (0, m0 + 0.06, 0), (0, m1 - 0.06, 0), mr * 0.9, M('grain'), 16)
        cyl(acc, (0, m0 + 0.06, 0), (0, m1 - 0.05, 0), mr * 0.3, M('soot'), 10)
        n = S.get('nozzles', 4)
        sc = mr / 0.24
        if kind == 'canted':
            canted_set(acc, n, m0 - 0.0, mr * 0.55, 0.035 * sc, 0.08 * sc, 0.2 * sc, S.get('cant', 35.0), FRONT + 45)
        elif kind == 'ring':
            canted_set(acc, 12, m0 + (m1 - m0) * 0.45, mr * 0.98, 0.016 * sc, 0.038 * sc, 0.09 * sc, 40.0, FRONT)
            lathe(acc, [(mr + 0.02, m0 + (m1 - m0) * 0.45 - 0.05), (mr + 0.02, m0 + (m1 - m0) * 0.45 + 0.05)], M('dark'), 24)
        elif kind in ('reverse', 'staged'):
            canted_set(acc, 4, m1 - 0.12, mr * 1.02, 0.03 * sc, 0.075 * sc, 0.2 * sc, 28.0, FRONT + 45)
            if kind == 'staged':
                canted_set(acc, 4, m0 + 0.25, mr * 1.02, 0.02 * sc, 0.05 * sc, 0.12 * sc, 30.0, FRONT)
        return acc
    emit_all(root, 'motor', motor)

    def jett(kind):
        acc = Acc()
        if kind == 'shared':
            return acc
        cyl(acc, (0, j0 + 0.05, 0), (0, j1 - 0.02, 0), jr * 0.85, M('grain'), 12)
        sc = jr / 0.2
        canted_set(acc, 2 if slug == 'les_apollo' else 3 if slug == 'les_mercury' else 4, j0 + 0.08, jr * 1.0, 0.012 * sc, 0.03 * sc, 0.07 * sc, 60.0, FRONT + 90)
        if kind == 'backup':
            for s_ in (-1, 1):
                box(acc, (s_ * jr * 0.4, j1 - 0.03, 0), (0.05, 0.05, 0.05), M('amber'))
        return acc
    emit_all(root, 'jettison', jett)

    def steer(kind):
        acc = Acc()
        ny = S['nose']
        if kind == 'ballast':
            cyl(acc, (0, ny + 0.02, 0), (0, ny + 0.12, 0), jr * 0.5, M('dark'), 12)
        elif kind == 'canards':  # two canards folded flat against the nose section (Apollo)
            for s_ in (0, 180):
                a = FRONT + 90 + s_
                lathe(acc, [(jr * 0.85 + 0.01, ny - 0.18), (jr * 0.85 + 0.012, ny + 0.1)], M('white'), 8, az0=a - 32, az1=a + 32)
                box(acc, polar(a, jr * 0.85 + 0.02, ny + 0.08), (0.04, 0.05, 0.08), M('dark'), (er(a), V(0, 1, 0), ea(a)))
        elif kind == 'acm':  # the attitude control motor: a ring with eight valve ports
            y = j1 + 0.02 if slug != 'las_orion' else (j1 + S['nose']) / 2
            lathe(acc, [(jr + 0.02, y - 0.08), (jr + 0.02, y + 0.08)], M('mid_grey'), 24, cap0=False)
            for j in range(8):
                a = FRONT + 22.5 + 45 * j
                cyl(acc, polar(a, jr + 0.02, y), polar(a, jr + 0.05, y), 0.03, M('soot'), 8)
        elif kind == 'gridfins':
            if rev is not None and S.get('fins_y'):
                w, h = 0.5 * R / 1.25, 0.8 * R / 1.25
                for j in range(4):
                    a = FRONT + 45 + 90 * j
                    P, N, Tm, Ta = rev.frame_y(a, S['fins_y'], 0.03)
                    grid_fin(acc, P, N, Tm, w, h, M('steel_m'))
            else:  # small fins on the tower itself
                for j in range(4):
                    a = FRONT + 45 + 90 * j
                    grid_fin(acc, polar(a, jr + 0.04, (j0 + j1) / 2), er(a), V(0, 1, 0), 0.16, 0.22, M('steel_m'), (3, 4))
        return acc
    emit_all(root, 'steering', steer)


def preview(root, slug, H, R, shots):
    os.makedirs(shots, exist_ok=True)
    nl.hide_except(root, TOWERS[slug]['real'])
    for o in root.children:
        if o.name.startswith('form_neck'):
            o.hide_render = True
    nl.look(os.path.join(shots, f'{slug}_a.png'), (0, H * 0.5, 0), nl.cam_front(H, max(R, 1.0)))
    nl.show_all(root)


if __name__ == '__main__':
    only = nl.C.arg('--only')
    shots = nl.C.arg('--shots')
    todo = only.split(',') if only else list(TOWERS)
    results = [build(s, shots) for s in todo]
    for (s, t, b) in results:
        print(f'[towers] {s}: {t} triangles, {b / 1024:.0f} KB')
