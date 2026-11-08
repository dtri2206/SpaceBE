"""
G3, the fairing generator (SpaceB&E builder, Role 1, nose section): payload fairings and shrouds from their real nose
curves (tangent ogive, von Karman, ogive with a spherical cap, biconic, cone with a spherical cap, blunt cone), with
their separation joints, access doors and tip, and the fairing kit's inner pieces.

Run from the repo root:
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/nose/fairings.py -- [--only fairing_falcon9] [--shots DIR]

How a cover meets the stack (hull.js, sections/nose/art.js): over a capsule that fits inside it, the cover is the top of
a payload fairing and the outer skin carries its cylinder on down round the capsule; on anything else it seats on the
standard docking ring (NECK) with a boat-tail that climbs to full radius at y = bt. The model carries both bases as
nodes the game picks between: form_shroud (a cylinder at the full radius from y = 0 to bt, open below) and form_neck
(the boat-tail from the docking ring). The nose curve starts at y = bt in both, so the outline is the same above.

Inner pieces (kit `fairing`): slot_split (the separation joints: two halves, __trisector for three), slot_acoustic
(acoustic blankets lining the inside; __none), slot_pushers (the real separation pushers; __pyro / __pneumatic).
"""
import os, sys, math
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nl  # noqa: E402
from nl import V, Acc, M, er, ea, polar, lathe, cyl, sphere, torus, tube, box, beam, patch, disc, band, ring_on, strip_along, Rev, fillet, resample, FRONT, NECK, DEG, RADIUS, TAU  # noqa: E402

# slug: part id, size, height, bt (boat-tail height), nose shape and its parameters, skin, seams, pushers (the real ones)
FAIRINGS = {
    'fairing_falcon9': dict(part='fairing_composite_l', size='l', H=5.2, bt=0.7, nose='ogive', tip=0.05, skin='white', pushers='pneumatic', doors=[(40, 0.35, 0.5, 0.42)], band=None),
    'fairing_atlas5': dict(part='nose_hammerhead_m', size='l', H=3.4, bt=0.7, nose='ogive', tip=0.2, skin='white', pushers='pyro', doors=[(30, 0.5, 0.42, 0.42)], hsplit=0.62),
    'fairing_bg54': dict(part='nose_pointed_l', size='l', H=3.9, bt=0.45, nose='ogive', tip=0.07, skin='white', pushers='pyro', doors=[(40, 0.3, 0.4, 0.4)]),
    'fairing_newglenn': dict(part='fairing_newglenn', size='l', H=4.8, bt=0.7, nose='ogive', tip=0.06, skin='white', pushers='pneumatic', doors=[(40, 0.35, 0.45, 0.45)]),
    'fairing_h2': dict(part='fairing_h2', size='m', H=3.2, bt=0.4, nose='ogive', tip=0.1, skin='white', pushers='pyro', doors=[(40, 0.4, 0.35, 0.35)], hinge=True),
    'fairing_h2b': dict(part='fairing_h2b', size='l', H=3.6, bt=0.6, nose='ogive', tip=0.1, skin='white', pushers='pyro', doors=[(40, 0.4, 0.4, 0.4)], hinge=True),
    'fairing_cz5': dict(part='fairing_cz5', size='l', H=4.5, bt=0.7, nose='vonk', tip=0.06, skin='white', pushers='pyro', doors=[(40, 0.35, 0.42, 0.42)]),
    'fairing_pslv': dict(part='fairing_pslv', size='m', H=2.9, bt=0.5, nose='cone_cap', angle=20.0, cap=0.34, skin='white_panel', pushers='pyro', doors=[(40, 0.4, 0.3, 0.3)]),
    'fairing_delta2': dict(part='nose_biconic_m', size='m', H=2.9, bt=0.36, nose='biconic', angles=(15.0, 20.0), mid=0.6, cap=0.23, skin='white', pushers='pyro', doors=[(40, 0.3, 0.3, 0.3)], rf_window=True),
    'fairing_soyuz2': dict(part='nose_blunt_m', size='m', H=2.9, bt=0.36, nose='cone_cap', angle=24.0, cap=0.22, cyl=0.2, skin='grey', pushers='pyro', doors=[(40, 0.3, 0.3, 0.3)]),
    'fairing_electron': dict(part='nose_pointed_s', size='s', H=2.2, bt=0.22, nose='ogive', tip=0.08, skin='carbon', pushers='pneumatic', doors=[]),
    'vostok_shroud': dict(part='vostok_shroud', size='m', H=2.2, bt=0.36, nose='cone_cap', angle=17.0, cap=0.2, cyl=0.12, skin='offwhite', pushers='pyro', doors=[], vostok=True),
    'nose_dragon1': dict(part='nose_dragon1', size='s', H=0.8, bt=0.0, nose='dragon1', skin='white', pushers=None, doors=[], small=True),
}
SEAM_AZ = 35.0  # the separation plane, turned so the seam is seen from the default camera


def nose_curve(sp, R, y0, H, n=40):
    """(r, y) points of the nose from its shoulder at y0 (radius R) to the tip at H."""
    L = H - y0
    kind = sp['nose']
    pts = []
    if kind in ('ogive', 'vonk'):
        tipr = sp.get('tip', 0.05) * R
        for k in range(n + 1):
            t = k / n
            x = t * L
            if kind == 'ogive':
                rho = (R * R + L * L) / (2 * R)
                r = math.sqrt(max(0.0, rho * rho - x * x)) + R - rho
            else:
                s = L - x
                th = math.acos(max(-1.0, min(1.0, 1 - 2 * s / L)))
                r = R / math.sqrt(math.pi) * math.sqrt(max(0.0, th - math.sin(2 * th) / 2))
            pts.append((r, y0 + x))
        # a spherical blunt tip of radius tipr tangent to the curve
        out = []
        for (r, y) in pts:
            if r < tipr * 1.3 and y > y0 + L * 0.5:
                break
            out.append((r, y))
        r1, y1 = out[-1]
        cy = H - tipr
        a0 = math.atan2(max(1e-6, y1 - cy), r1)
        for k in range(1, 7):
            a = a0 + (math.pi / 2 - a0) * k / 6
            out.append((tipr * math.cos(a), cy + tipr * math.sin(a)))
        out[-1] = (0.0, H)
        return out
    if kind == 'cone_cap':
        cylL = sp.get('cyl', 0.0) * L
        ang = math.radians(sp['angle'])
        rc = sp['cap'] * R
        pts.append((R, y0))
        if cylL:
            pts.append((R, y0 + cylL))
        # the cone from R down to where it meets the cap tangentially, the cap centred below H
        rt = rc * math.cos(ang)
        yb = y0 + cylL
        cone_len = (R - rt) / math.tan(ang)
        cap_c = H - rc
        y_t = cap_c + rc * math.sin(ang)
        # scale the cone to end at y_t (keeps the angle when the height allows, else steepens it)
        if yb + cone_len > y_t:
            pass
        yt = y_t
        pts.append((rt, yt))
        for k in range(1, 9):
            a = ang + (math.pi / 2 - ang) * k / 8
            pts.append((rc * math.cos(a), cap_c + rc * math.sin(a)))
        pts[-1] = (0.0, H)
        # a round shoulder where the cylinder meets the cone
        return fillet(pts, 0.12 * R, 5)
    if kind == 'biconic':
        a1, a2 = (math.radians(a) for a in sp['angles'])
        rm = sp['mid'] * R
        rc = sp['cap'] * R
        rt = rc * math.cos(a2)
        cap_c = H - rc
        y_t = cap_c + rc * math.sin(a2)
        l1 = (R - rm) / math.tan(a1)
        l2 = (rm - rt) / math.tan(a2)
        k = (y_t - y0) / (l1 + l2)  # fit the two cones between the shoulder and the cap (keeps their ratio)
        pts = [(R, y0), (rm, y0 + l1 * k), (rt, y_t)]
        for j in range(1, 9):
            a = a2 + (math.pi / 2 - a2) * j / 8
            pts.append((rc * math.cos(a), cap_c + rc * math.sin(a)))
        pts[-1] = (0.0, H)
        return fillet(pts, 0.1 * R, 4)
    if kind == 'dragon1':
        # Dragon 1's nose cone: a short ogive cap over the berthing port, from the cone's base ring (0.5 m)
        r0 = 0.5
        for k in range(n + 1):
            t = k / n
            pts.append((r0 * max(0.0, 1 - t ** 1.3) ** 0.75, y0 + L * t))
        pts[-1] = (0.0, H)
        return pts
    raise ValueError(kind)


def build(slug, shots=None):
    sp = FAIRINGS[slug]
    nl.reset()
    pd = nl.part_data(sp['part']) or {}
    size = pd.get('size', sp['size'])
    H = float(pd.get('height', sp['H']))
    R = RADIUS[size]
    bt = float((pd.get('hullProfile') or {}).get('bt', sp['bt']))
    root = nl.root(slug)
    body = Acc()
    skin = M(sp['skin'])
    if sp.get('small'):
        return build_small(slug, sp, H, R, shots)
    y0 = bt + 0.02 * H
    nose = nose_curve(sp, R, y0, H)
    prof = [(R, bt)] + nose
    rev = Rev(prof)
    lathe(body, prof, skin, 64, u_rep=8 if sp['skin'] == 'isogrid' else 1, v_scale=1.0 if sp['skin'] == 'isogrid' else 1.0)
    # separation seams (two halves): a raised rail down each side, and the horizontal joint at the base
    for k in range(2):
        strip_along(body, rev, FRONT + SEAM_AZ + 180 * k, 0.02, rev.L - (0.06 if sp['nose'] != 'cone_cap' else 0.1) * R, 0.04, 0.01, M('mid_grey'))
    ring_on(body, rev, 0.02, 0.03, 0.008, M('mid_grey'), 64)
    if sp.get('hsplit'):  # Atlas V 5-m: the horizontal joint between the nose and the cylinder halves
        ring_on(body, rev, rev.s_at_y(y0 + (H - y0) * (1 - sp['hsplit'])), 0.025, 0.006, M('mid_grey'), 64)
    if sp.get('hinge'):  # H-IIA: the halves hinge away at the base: hinge fittings
        for k in range(2):
            P, N, Tm, Ta = rev.frame_y(FRONT + SEAM_AZ + 90 + 180 * k, bt + 0.12, 0.0)
            box(body, P + N * 0.03, (0.18, 0.2, 0.06), M('dark'), (Ta, Tm, N))
    for (az, yf, w, h) in sp.get('doors', []):  # access doors
        patch(body, rev, FRONT + az, rev.s_at_y(bt + yf * (H - bt) * 0.5), w, h, skin, 0.002, 0.006, 2, 2, 1.0, 0.03, M('mid_grey'))
    if sp.get('rf_window'):  # Delta II: the fibreglass radio-frequency window band in the biconic
        s = rev.s_at_y(y0 + (H - y0) * 0.35)
        band(body, rev, s - 0.1, s + 0.1, M('offwhite'), 0.002, 64, az0=FRONT + SEAM_AZ + 10, az1=FRONT + SEAM_AZ + 170)
    if sp.get('vostok'):
        # Vostok-K shroud: the cut-outs over the sphere's hatches and windows (the ejection path), dark inside
        for (az, yf, rad) in ((0, 0.16, 0.14), (25, 0.04, 0.1), (150, 0.12, 0.12)):
            disc(body, rev, FRONT + az, rev.s_at_y(bt + yf * H * 0.5 + 0.2), rad, M('black'), 0.002, 0.0, 20, 1)
            disc(body, rev, FRONT + az, rev.s_at_y(bt + yf * H * 0.5 + 0.2), rad + 0.03, M('steel_m'), 0.002, 0.012, 20, 1, inner=rad)
    # the tip
    if sp['nose'] in ('ogive', 'vonk') and sp.get('tip', 0.05) <= 0.1:
        tip = [(r + 0.003, y) for (r, y) in nose if y > H - sp.get('tip', 0.05) * R * 1.6]
        if len(tip) > 2:
            lathe(body, tip, M('steel_m') if sp['skin'] != 'carbon' else M('dark'), 32)
    body.emit('body', root)
    # the two bases the game picks between
    a = Acc()
    lathe(a, [(R, 0.0), (R, bt)], skin, 64)
    lathe(a, [(R + 0.006, 0.0), (R + 0.006, 0.03), (R - 0.03, 0.03), (R - 0.03, 0.0)], M('dark'), 64)
    a.emit('form_shroud', root)
    a = Acc()
    lathe(a, fillet([(NECK, 0.0), (NECK + 0.03, 0.02), (R, bt), (R, bt + 0.001)], 0.05, 4), skin, 64)
    lathe(a, [(NECK + 0.012, 0.0), (NECK + 0.012, 0.03), (NECK - 0.02, 0.03), (NECK - 0.02, 0.0)], M('alu'), 48)
    a.emit('form_neck', root)
    slots(root, sp, rev, R, H, bt)
    nl.report_groups(root)
    tris, size_b = nl.export(root, slug, H, R)
    if shots:
        preview(root, slug, H, R, shots)
    return slug, tris, size_b


def slots(root, sp, rev, R, H, bt):
    """The fairing kit: separation joints, acoustic blankets, pushers."""
    def joints(n):
        acc = Acc()
        for k in range(n):
            az = FRONT + SEAM_AZ + 360 / n * k
            strip_along(acc, rev, az, 0.05, rev.L - 0.25 * R, 0.07, 0.035, M('amber'), off=-0.06)
        ring_on(acc, rev, 0.05, 0.05, 0.03, M('amber'), 48, off=-0.07)
        return acc
    joints(2).emit('slot_split', root)
    joints(3).emit('slot_split__trisector', root)
    acc = Acc()
    s0, s1 = 0.15, rev.L * 0.75
    for k in range(8):  # blanket panels on the inside of the shell, with gaps between them
        a0 = FRONT + k * 45 + 3
        band(acc, rev, s0, s1, M('mli_grey'), -0.05, 5, az0=a0, az1=a0 + 39, step=0.35)
    nl.node('slot_acoustic', root)  # the first option: no blankets
    acc.emit('slot_acoustic__blankets', root)
    real = sp.get('pushers') or 'pyro'

    def pushers(kind):
        acc = Acc()
        for k in range(4):
            az = FRONT + SEAM_AZ + 90 * k + 20
            P, N, Tm, Ta = rev.frame_y(az, bt + 0.25, -0.12)
            if kind == 'pneumatic':  # helium pistons that push the halves apart (Falcon 9, Electron)
                cyl(acc, P - Tm * 0.15, P + Tm * 0.15, 0.04, M('alu'), 10)
                cyl(acc, P + Tm * 0.15, P + Tm * 0.3, 0.018, M('steel_m'), 8)
                sphere(acc, P - Tm * 0.25 - N * 0.05, 0.06, M('carbon'), 10, 5)
            else:  # pyrotechnic thrusting bolts / spring packs at the base ring
                cyl(acc, P - Tm * 0.08, P + Tm * 0.08, 0.035, M('dark'), 8)
                box(acc, P + Tm * 0.1, (0.05, 0.04, 0.05), M('amber'))
        return acc
    pushers('pyro').emit('slot_pushers', root)
    pushers('pneumatic').emit('slot_pushers__pneumatic', root)


def build_small(slug, sp, H, R, shots):
    """Dragon 1's nose cone: a small cap over the berthing port, on its base ring (0.5 m)."""
    root = nl.root(slug)
    body = Acc()
    prof = [(0.5, 0.0), (0.5, 0.06)] + nose_curve(sp, 0.5, 0.06, H)[1:]
    lathe(body, prof, M('white'), 48)
    lathe(body, [(0.51, 0.0), (0.51, 0.03), (0.47, 0.03), (0.47, 0.0)], M('dark'), 48)
    rev = Rev(prof)
    patch(body, rev, FRONT + 180, rev.s_at_y(0.2), 0.16, 0.1, M('dark'), 0.002, 0.03, 2, 2)  # the hinge (jettisoned on Dragon 1)
    body.emit('body', root)
    nl.report_groups(root)
    tris, size_b = nl.export(root, slug, H, R)
    if shots:
        preview(root, slug, H, 0.5, shots)
    return slug, tris, size_b


def preview(root, slug, H, R, shots):
    os.makedirs(shots, exist_ok=True)
    nl.hide_except(root, {'pushers': FAIRINGS[slug].get('pushers'), 'acoustic': 'blankets'})
    for o in root.children:
        if o.name.startswith('form_neck'):
            o.hide_render = True
    nl.look(os.path.join(shots, f'{slug}_a.png'), (0, H * 0.5, 0), nl.cam_front(H, R))
    nl.show_all(root)
    for o in root.children:
        if o.name.startswith('form_shroud') or '__' in o.name or o.name == 'body':
            o.hide_render = o.name != 'body' and not o.name.startswith('form_neck') and '__' not in o.name and o.name.startswith('form_shroud')
    nl.look(os.path.join(shots, f'{slug}_b.png'), (0, H * 0.4, 0), nl.cam_front(H, R, az=FRONT + 120, pitch=-10))
    nl.show_all(root)


if __name__ == '__main__':
    only = nl.C.arg('--only')
    shots = nl.C.arg('--shots')
    todo = only.split(',') if only else list(FAIRINGS)
    results = [build(s, shots) for s in todo]
    for (s, t, b) in results:
        print(f'[fairings] {s}: {t} triangles, {b / 1024:.0f} KB')
