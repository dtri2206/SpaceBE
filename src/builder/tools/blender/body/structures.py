"""
The body section's dry structures: skirts and the centerbody (their skin is the `construction` slot, so the ship shows
the chosen build: hat stringers, isogrid, orthogrid, corrugation or a composite sandwich), the SLS forward skirt with
its flight computers, the hot-staging lattices and the Super Heavy vented ring, and the hung LOX tank of the Delta IV /
ICPS upper stage on its composite truss. Sizes and heights come from sections/body/parts.json.
"""
import math
from bodylib import (Acc, V, M, TAU, polar, radial, tangent, lathe, cyl, sphere, capsule, torus, tube, bend, box, beam,
                     on_wall, curved_panel, wrap_on_cyl, rounded_rect2d, skin, flange, band, dome, dims, node, frame,
                     rings)
from slots import Vol, TankGeo, build_slots, KITS
from tanks import door, umbilical_plate, vent, valve, end_flanges


# ------------------------------------------------------------------ stage structure: skins by construction
def construction_skin(R, H, opt, paint='white', y0=0.03, y1=None):
    """The outer skin of a skirt / centerbody built the chosen way (the `construction` slot's piece)."""
    y1 = H - 0.03 if y1 is None else y1
    acc = Acc()
    e1, e2 = frame((0, 1, 0))
    circ = TAU * R
    if opt == 'corrugated':  # S-IC forward skirt and intertank: a corrugated 7075 skin, about 11 cm pitch
        n, amp = 96, 0.014
        seg = n * 4
        verts, faces = [], []
        for y in (y0, y1):
            for i in range(seg):
                a = TAU * i / seg
                r = R - amp + amp * math.cos(n * a)
                verts.append(V(r * math.cos(a), y, -r * math.sin(a)))
        for i in range(seg):
            j = (i + 1) % seg
            faces.append([i, j, seg + j, seg + i])
        acc.add(verts, faces, M(paint))
    elif opt == 'isogrid':
        rings(acc, [V(0, y0, 0), V(0, y1, 0)], [R, R], [e1, e1], [e2, e2], M('iso_white'), 96,
              u_rep=round(circ / 0.3), v_scale=1 / (0.3 * math.sqrt(3)))
    elif opt == 'orthogrid':
        rings(acc, [V(0, y0, 0), V(0, y1, 0)], [R, R], [e1, e1], [e2, e2], M('ortho_white'), 96,
              u_rep=round(circ / 0.3), v_scale=1 / 0.3)
    elif opt == 'composite':  # a sandwich of carbon skins on a honeycomb core, painted: smooth with panel joints
        rings(acc, [V(0, y0, 0), V(0, y1, 0)], [R, R], [e1, e1], [e2, e2], M(paint), 96)
        for k in range(8):
            on_wall(acc, 22.5 + 45 * k, R, (y0 + y1) / 2, (0.03, y1 - y0 - 0.02, 0.004), M('cream'))
    else:  # skin_stringer: a thin skin with hat-section stringers outside (S-II and S-IVB skirts)
        rings(acc, [V(0, y0, 0), V(0, y1, 0)], [R, R], [e1, e1], [e2, e2], M(paint), 96)
        n = int(circ / 0.18)
        for k in range(n):
            on_wall(acc, 360 * k / n, R - 0.002, (y0 + y1) / 2, (0.035, y1 - y0 - 0.04, 0.022), M(paint))
    return acc


def joints_piece(R, H, opt):
    """A circumferential splice of the skirt, on its +x side just inside the wall."""
    acc = Acc()
    y = H * 0.5
    r = R - 0.03
    curved_panel(acc, r, -25, 25, y - 0.07, y + 0.07, M('alu_cut' if opt == 'fsw' else 'alu'), seg=10, thick=0.008)
    if opt == 'riveted':
        for k in range(14):
            a = -23 + 46 * k / 13
            for dy in (-0.035, 0.035):
                p = polar(a, r, y + dy)
                cyl(acc, p, p - radial(a) * 0.012, 0.011, M('dark'), seg=6)
    elif opt == 'fsw':  # friction-stir weld: a smooth, bright bead
        curved_panel(acc, r - 0.009, -25, 25, y - 0.012, y + 0.012, M('steel'), seg=10, thick=0.004)
    else:  # bonded: a glue line
        curved_panel(acc, r - 0.009, -25, 25, y - 0.02, y + 0.02, M('amber'), seg=10, thick=0.003)
    return acc


def stage_structure(root, R, H, details, paint='white'):
    fr = Acc()
    end_flanges(fr, R, H, depth=0.09, t=0.035)
    fr.emit('frames', root)
    d = Acc()
    details(d)
    d.emit('detail', root)
    b = {'construction': lambda g, opt, kit: construction_skin(R, H, opt, paint),
         'joints': lambda g, opt, kit: joints_piece(R, H, opt)}
    build_slots(root, TankGeo(R, H, []), 'stage_structure', builders=b)


def forward_skirt_l(root):
    """A large forward skirt (S-II: hat stringers; S-IC: corrugated): LOX vent ports, an access door, an umbilical."""
    H, R = dims('forward_skirt_l')

    def det(d):
        for a in (150, 330):  # the louvred vent ports
            on_wall(d, a, R + 0.014, H * 0.55, (0.34, 0.26, 0.015), M('dark'))
            for k in range(4):
                on_wall(d, a, R + 0.029, H * 0.55 - 0.09 + 0.06 * k, (0.3, 0.02, 0.01), M('alu'))
        door(d, 250, R + 0.014, H * 0.45, 0.5, 0.6, 'frame', out=0.004)
        umbilical_plate(d, 20, R + 0.014, H * 0.5, 0.42, 0.3)
    stage_structure(root, R, H, det)
    return H, R


def aft_skirt_l(root):
    """A large aft skirt (S-IVB / S-II): hat stringers, hard points at 0/90/180/270 degrees for the APS pods and ullage
    motors, the heavier separation-plane flange at the bottom."""
    H, R = dims('aft_skirt_l')

    def det(d):
        flange(d, R + 0.012, R - 0.11, 0.0, 0.06, M('frame'), seg=72)
        for a in (0, 90, 180, 270):  # the hard points
            on_wall(d, a, R + 0.014, H * 0.5, (0.26, 0.5, 0.025), M('frame'))
            for dy in (-0.15, 0.15):
                p = polar(a, R + 0.04, H * 0.5 + dy)
                cyl(d, p, p + radial(a) * 0.02, 0.03, M('steel'), seg=8)
        door(d, 225, R + 0.014, H * 0.5, 0.45, 0.5, 'frame', out=0.004)
    stage_structure(root, R, H, det)
    return H, R


def centerbody_l(root):
    """Delta IV centerbody between the two big tanks: where the swing arms' umbilical plates connect."""
    H, R = dims('centerbody_l')

    def det(d):
        umbilical_plate(d, 270, R + 0.014, H * 0.5, 0.7, 0.5)
        umbilical_plate(d, 330, R + 0.014, H * 0.55, 0.36, 0.28)
        door(d, 200, R + 0.014, H * 0.5, 0.5, 0.6, 'frame', out=0.004)
        vent(d, 110, R + 0.01, H * 0.6)
    stage_structure(root, R, H, det)
    return H, R


# ------------------------------------------------------------------ the SLS forward skirt and its avionics
def avionics_pieces(R, H):
    """The avionics kit's pieces for a large forward skirt, mounted on brackets on the inner wall."""
    ri = R - 0.05
    yc = H * 0.5
    bh = min(0.5, H * 0.4)

    def bracket(acc, a, w, h):
        on_wall(acc, a, ri - 0.03, yc, (w + 0.06, h + 0.08, 0.025), M('alu'))

    def unit(acc, a, w, h, d, m, du=0.0, dy=0.0):
        p = polar(a, ri - 0.04 - d / 2, yc + dy) + tangent(a) * du
        box(acc, p, (w, h, d), M(m), (tangent(a), V(0, 1, 0), radial(a)))
        # cooling fins / connector strip on its face
        box(acc, p - radial(a) * (d / 2 + 0.005) + V(0, h * 0.35, 0), (w * 0.8, 0.03, 0.012), M('dark'), (tangent(a), V(0, 1, 0), radial(a)))

    def computer(opt):
        acc = Acc()
        n = 3 if opt == 'triple' else 2
        bracket(acc, 90, 0.42 * n, bh)
        for k in range(n):
            unit(acc, 90, 0.34, bh, 0.22, 'box', du=(k - (n - 1) / 2) * 0.42)
        return acc

    def imu(opt):
        acc = Acc()
        bracket(acc, 0, 0.36, 0.34)
        if opt == 'mems':
            unit(acc, 0, 0.14, 0.1, 0.12, 'box')
        elif opt == 'fog':  # fibre-optic gyro coils
            unit(acc, 0, 0.3, 0.26, 0.22, 'box_light')
            p = polar(0, ri - 0.2, yc + 0.2)
            torus(acc, p, 0.11, 0.025, M('gold'), seg=20, seg2=6, axis=(0, 1, 0))
            torus(acc, p + V(0, 0.03, 0), 0.11, 0.025, M('gold'), seg=20, seg2=6, axis=radial(0))
        else:  # ring-laser gyro block (rlg; the reused Ariane 4 unit looks the same, older beige case)
            unit(acc, 0, 0.3, 0.3, 0.26, 'box_beige' if opt == 'reused_sri' else 'box')
            p = polar(0, ri - 0.17, yc + 0.2)
            tri = [p + V(0.09 * math.cos(TAU * k / 3 + 0.5), 0, -0.09 * math.sin(TAU * k / 3 + 0.5)) for k in range(3)]
            tube(acc, tri + [tri[0]], 0.018, M('gold'), 5)
        return acc

    def radio(opt):
        acc = Acc()
        n = 2 if opt == 'dual' else 1
        bracket(acc, 270, 0.32 * n, bh * 0.8)
        for k in range(n):
            unit(acc, 270, 0.26, bh * 0.75, 0.16, 'box_light', du=(k - (n - 1) / 2) * 0.32)
            p = polar(270, ri - 0.1, yc + bh * 0.4) + tangent(270) * ((k - (n - 1) / 2) * 0.32)
            cyl(acc, p, p + V(0, 0.22, 0), 0.012, M('steel'), seg=6)
        return acc

    def navaid(opt):
        acc = Acc()
        a = 165
        bracket(acc, a, 0.26, 0.2)
        unit(acc, a, 0.22, 0.16, 0.16, 'box')
        p = polar(a, ri - 0.12, yc + 0.08)
        if opt == 'gps':
            cyl(acc, p, p + V(0, 0.03, 0), 0.1, M('white'), seg=16)
        elif opt == 'stellar':  # a star tracker looking out through a port
            cyl(acc, p + V(0, 0.02, 0), p + V(0, 0.02, 0) + (radial(a) * 0.8 + V(0, 0.6, 0)).normalized() * 0.26, 0.06, M('gold'), seg=12, r2=0.08)
        return acc

    def fts(opt):
        acc = Acc()
        a = 128
        bracket(acc, a, 0.32, 0.36)
        auto = opt == 'autonomous'
        unit(acc, a, 0.26, 0.3, 0.16, 'orange_box' if auto else 'box')
        if auto:
            for du in (-0.1, 0.1):
                unit(acc, a, 0.09, 0.18, 0.1, 'box', du=du, dy=-0.27)
        else:
            for du in (-0.08, 0.08):
                p = polar(a, ri - 0.1, yc + 0.17) + tangent(a) * du
                cyl(acc, p, p + V(0, 0.3, 0), 0.01, M('steel'), seg=6)
        return acc

    def cooling(opt):
        acc = Acc()
        if opt == 'coldplate':  # cold plates under the boxes, a coolant loop round the skirt (Saturn IU)
            for a in (90, 0, 270):
                curved_panel(acc, ri - 0.015, a - 14, a + 14, yc - bh * 0.6, yc + bh * 0.6, M('coldplate'), seg=6, thick=0.012)
            pts = [polar(a, ri - 0.03, yc - bh * 0.65) for a in range(0, 361, 15)]
            tube(acc, pts, 0.015, M('copper'), 6)
        else:  # ground air: the duct that blows conditioned air in through the umbilical until lift-off
            pts = [polar(a, ri - 0.04, H - 0.18) for a in range(-60, 241, 15)]
            tube(acc, pts, 0.05, M('glass_cloth'), 8)
        return acc
    return {'computer': lambda g, o, k: computer(o), 'imu': lambda g, o, k: imu(o), 'transponder': lambda g, o, k: radio(o),
            'navaid': lambda g, o, k: navaid(o), 'fts': lambda g, o, k: fts(o), 'cooling': lambda g, o, k: cooling(o)}


def sls_forward_skirt(root):
    """The SLS core stage's forward skirt: orange foam over aluminium, an umbilical plate, access doors; inside, the
    vehicle's flight computers, inertial units, radios and flight-termination boxes on brackets."""
    H, R = dims('avionics_skirt_l')
    sh = Acc()
    skin(sh, lambda y: R, [0.0, H], 96, lambda d, y: 'foam_et', u_rep=10, v_scale=0.5)
    sh.emit('shell', root)
    fr = Acc()
    end_flanges(fr, R, H, depth=0.09, t=0.035)
    for y in (0.06, H - 0.06):
        band(fr, R, y - 0.03, y + 0.03, 0.008, M('foam_dark'), seg=96)
    fr.emit('frames', root)
    d = Acc()
    umbilical_plate(d, 300, R, H * 0.5, 0.5, 0.34)
    for a in (40, 200):
        door(d, a, R, H * 0.5, 0.55, 0.6, 'foam_dark', out=0.004)
    vent(d, 120, R, H * 0.6)
    d.emit('detail', root)
    build_slots(root, TankGeo(R, H, []), 'avionics', builders=avionics_pieces(R, H))
    return H, R


# ------------------------------------------------------------------ hot staging
def shield_piece(R, opt, steel=False):
    """The heat shield on the dome below the joint (a shallow dome / cone plate), or nothing."""
    acc = Acc()
    if opt == 'none':
        return acc
    prof = [(R * 0.93, 0.04), (R * 0.75, 0.12), (R * 0.45, 0.22), (R * 0.15, 0.27), (0.0, 0.28)]
    lathe(acc, prof, M('steel' if steel else 'heat'), 48)
    lathe(acc, [(R * 0.93, 0.02), (R * 0.97, 0.02), (R * 0.97, 0.05), (R * 0.93, 0.05)], M('frame'), 48)
    return acc


def truss(root, R, H, bays, tube_r, m):
    """An open hot-staging lattice: two rings joined by a zigzag of tube struts (exhaust escapes between them)."""
    acc = Acc()
    for (y0, y1) in ((0.0, 0.08), (H - 0.08, H)):
        lathe(acc, [(R - 0.09, y0), (R, y0), (R, y1), (R - 0.09, y1), (R - 0.09, y0)], M(m), 72)
    rn = R - 0.045
    for k in range(bays):
        a0 = 360 * k / bays
        a1 = 360 * (k + 0.5) / bays
        a2 = 360 * (k + 1) / bays
        lo0, hi, lo1 = polar(a0, rn, 0.08), polar(a1, rn, H - 0.08), polar(a2, rn, 0.08)
        cyl(acc, lo0, hi, tube_r, M(m), seg=8, caps=False)
        cyl(acc, hi, lo1, tube_r, M(m), seg=8, caps=False)
        for p, up in ((lo0, 1), (hi, -1)):  # the end fittings
            box(acc, p + V(0, 0.035 * up, 0), (tube_r * 3.2, 0.07, tube_r * 3.2), M('frame'))
    acc.emit('frames', root)


def truss_hot_m(root):
    """The Soyuz (and N1) hot-staging lattice: the upper stage's engine lights inside it before separation."""
    H, R = dims('hotstage_truss_m')
    truss(root, R, H, 12, 0.03, 'soyuz')
    build_slots(root, TankGeo(R, H, []), 'truss_hotstage', builders={'shield': lambda g, o, k: shield_piece(R, o)})
    return H, R


def truss_hot_l(root):
    """The Proton hot-staging lattice (V95 alloy tubes), larger and stiffer."""
    H, R = dims('hotstage_truss_l')
    truss(root, R, H, 16, 0.042, 'grey')
    build_slots(root, TankGeo(R, H, []), 'truss_hotstage', builders={'shield': lambda g, o, k: shield_piece(R, o)})
    return H, R


def hotstage_ring(root):
    """Super Heavy's hot-staging ring: a brushed stainless band with big vents between posts, so Starship's engines can
    fire while it still sits on the booster; the shield over the booster's dome shows through the vents."""
    H, R = dims('hotstage_ring_l')
    sh = Acc()
    e1, e2 = frame((0, 1, 0))
    band_h = 0.17
    for (y0, y1) in ((0.0, band_h), (H - band_h, H)):
        rings(sh, [V(0, y0, 0), V(0, y1, 0)], [R, R], [e1, e1], [e2, e2], M('stainless'), 96, u_rep=24, v_scale=4)
        rings(sh, [V(0, y0, 0), V(0, y1, 0)], [R - 0.02, R - 0.02], [e1, e1], [e2, e2], M('steel'), 96, flip=True)
    n = 20
    post = 360 / n * 0.28
    for k in range(n):  # posts between the vents
        a = 360 * k / n
        curved_panel(sh, R, a - post / 2, a + post / 2, band_h, H - band_h, M('stainless'), seg=2, thick=0.02, u_rep=1, v_scale=4)
    sh.emit('shell', root)
    fr = Acc()
    for y in (0.0, H):
        flange(fr, R, R - 0.1, y, 0.03 if y == 0 else -0.03, M('steel'), seg=72)
    for k in range(n):  # a deflector plate behind each vent: the plume turns outward through it
        a = 360 * (k + 0.5) / n
        p0, p1 = polar(a, R - 0.28, band_h + 0.02), polar(a, R - 0.06, H - band_h - 0.02)
        beam(fr, p0, p1, 2 * math.pi * R / n * 0.55, 0.012, M('steel'), up=radial(a))
    for y in (band_h * 0.5, H - band_h * 0.5):  # weld seams
        band(fr, R, y - 0.006, y + 0.006, 0.003, M('steel'), seg=96)
    fr.emit('frames', root)
    build_slots(root, TankGeo(R, H, []), 'truss_hotstage', builders={'shield': lambda g, o, k: shield_piece(R, o, steel=True)})
    return H, R


# ------------------------------------------------------------------ the hung LOX tank (Delta IV / ICPS)
def dcss_lox(root):
    """The upper stage's LOX tank hung under the hydrogen tank on a black composite truss (refs/pd_icps.jpg, 5 m stage):
    a lengthened tank wrapped in a silver blanket, the bronze aft ring, red helium and hydrazine bottles on the truss,
    and the equipment shelf on the aft dome. Its top ring meets the hydrogen tank's aft ring at the stack radius."""
    H, R = dims('tank_l_lox_hung')
    rmax = R * 0.63
    rt = rmax - 0.06  # the tank wall under its blanket
    v = Vol('LOX', 0.42, 1.1, rt - 0.02, 0.32, 0.3)
    sh = Acc()
    lathe(sh, [(rt, v.y0), (rt, v.y1)], M('mli'), 64, u_rep=10, v_scale=3)
    sh.emit('shell', root)
    fr = Acc()
    lathe(fr, [(rt - 0.01, 0.30), (rmax, 0.30), (rmax, 0.42), (rt - 0.01, 0.42)], M('bronze'), 64)  # the aft ring
    lathe(fr, [(rt - 0.01, v.y1 - 0.03), (rt + 0.03, v.y1 - 0.03), (rt + 0.03, v.y1 + 0.03), (rt - 0.01, v.y1 + 0.03)], M('green'), 64)
    flange(fr, R, R - 0.12, H, -0.05, M('frame'), seg=72)  # the joint ring under the hydrogen tank
    # the truss: eight X bays of black composite struts from the forward ring up to the joint ring
    nb = 8
    for k in range(nb):
        a0, a1 = 360 * k / nb, 360 * (k + 1) / nb
        lo0, lo1 = polar(a0, rt + 0.04, v.y1), polar(a1, rt + 0.04, v.y1)
        hi0, hi1 = polar(a0, R - 0.08, H - 0.06), polar(a1, R - 0.08, H - 0.06)
        beam(fr, lo0, hi1, 0.075, 0.05, M('truss_black'), up=radial((a0 + a1) / 2))
        beam(fr, lo1, hi0, 0.075, 0.05, M('truss_black'), up=radial((a0 + a1) / 2))
        box(fr, polar(a0, R - 0.08, H - 0.1), (0.16, 0.1, 0.14), M('truss_black'), (radial(a0), V(0, 1, 0), tangent(a0)))
        box(fr, polar(a0, rt + 0.04, v.y1), (0.12, 0.1, 0.1), M('truss_black'), (radial(a0), V(0, 1, 0), tangent(a0)))
    # bottom: the equipment shelf on the aft dome (avionics boxes) and the outlet to the engine below
    for k, a in enumerate((20, 110, 200, 290)):
        box(fr, polar(a, 0.55, 0.12), (0.28, 0.14, 0.2), M('box_light' if k % 2 else 'box'), (radial(a), V(0, 1, 0), tangent(a)))
    lathe(fr, [(0.25, 0.05), (0.7, 0.05), (0.7, 0.08), (0.25, 0.08)], M('alu'), 32)
    fr.emit('frames', root)

    def bulk(geo, opt, kit):
        acc = Acc()
        dome(acc, rt, v.y1, v.top_d, M('mli'), seg=40, n=6)
        dome(acc, rt, v.y0, v.bot_d, M('mli'), down=True, seg=40, n=6)
        if opt == 'common':
            dome(acc, v.r * 0.98, (v.y0 + v.y1) / 2, 0.25, M('alu'), down=True, seg=28, n=5)
        return acc

    def press(geo, opt, kit):
        if opt != 'helium':
            from slots import press_piece
            return press_piece(geo, opt)
        acc = Acc()  # red bottles (helium, hydrazine) strapped to the truss, as on the ICPS
        for k in range(4):
            a = 45 + 90 * k
            for du in (-0.17, 0.17):
                p = polar(a, (rt + R) / 2 - 0.02, (v.y1 + H) / 2 - 0.05) + tangent(a) * du
                capsule(acc, p, 0.1, 0.42, M('red'), seg=12, n=3)
                for dy in (-0.08, 0.08):
                    lathe(acc, [(0.101, -0.025), (0.106, -0.02), (0.106, 0.02), (0.101, 0.025)], M('truss_black'), 12, c=p + V(0, dy, 0))
        return acc
    geo = TankGeo(R, H, [v], 'separate', 'hydrolox', wall=lambda y: rt)
    build_slots(root, geo, 'tank_h2', builders={'bulkhead': bulk, 'pressurisation': press})
    return H, R


MODELS = {
    'centerbody_l': ('centerbody_l', centerbody_l),
    'forward_skirt_l': ('forward_skirt_l', forward_skirt_l),
    'aft_skirt_l': ('aft_skirt_l', aft_skirt_l),
    'sls_forward_skirt': ('avionics_skirt_l', sls_forward_skirt),
    'truss_hot_m': ('hotstage_truss_m', truss_hot_m),
    'truss_hot_l': ('hotstage_truss_l', truss_hot_l),
    'hotstage_ring': ('hotstage_ring_l', hotstage_ring),
    'dcss_lox': ('tank_l_lox_hung', dcss_lox),
}
