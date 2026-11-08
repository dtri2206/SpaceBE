"""
The body section's tank generator: one set of functions builds every tank body of the section, from the part's real
dimensions scaled to the game size (README.md "Which size"), so the tanks share their construction and look consistent.
Heights, sizes and outside profiles are read from sections/body/parts.json (bodylib.part), so a model follows its data.

  barrel()    a stage tank barrel: one or two propellants, separate domes with an intertank or one common bulkhead,
              a wall that is the vehicle's skin at exactly the stack radius, painted / foam / bare finishes (roll
              patterns as real geometry edges), ring frames, weld lands, valves, vents, doors, stencils.
  cluster     a bundle of tanks round a centre tank (Saturn IB S-IB, Proton first stage), with its top frame.
  profiled    a skin that follows the part's hullProfile (N1 Block A cone, Soyuz Blok A), with tanks inside.

Wall construction (isogrid, orthogrid, waffle, integral stringers) is real geometry on the cut-away wall panel of the
`wall` slot; outside, a foam or painted skin hides it, as on the real stages. Finishes (bodylib.PALETTE): white paint,
cream, white foam, orange foam (ET, SLS, Vulcan), tan foam (Delta IV), cork, Tiodize copper (Atlas V CCB), Soyuz grey,
brushed stainless, carbon twill, MLI blankets. Each model carries its kit's inner pieces (slots.py).
"""
import math
from bodylib import (Acc, V, M, polar, radial, tangent, lathe, cyl, sphere, capsule, torus, tube, bend, box, beam,
                     on_wall, curved_panel, wrap_on_cyl, rounded_rect2d, stencil_vertical, skin, flange, band, dome,
                     profile_r, dims, part)
from slots import Vol, TankGeo, build_slots, feed_piece, press_piece, _coil


# ------------------------------------------------------------------ shared details
def end_flanges(acc, R, H, m='frame', depth=0.07, t=0.03, r_top=None):
    """The bolting flanges at both joints, flush with the skin and reaching inward: the next part seats on them."""
    flange(acc, R - 0.002, R - depth, 0.0, t, M(m), seg=96)
    rt = R if r_top is None else r_top
    flange(acc, rt - 0.002, rt - depth, H, -t, M(m), seg=96)


def valve(acc, deg, r, y, s=1.0):
    """A fill-and-drain valve housing on the wall (dark box with an amber port)."""
    on_wall(acc, deg, r, y, (0.22 * s, 0.16 * s, 0.04 * s), M('dark'))
    p = polar(deg, r + 0.04 * s, y)
    cyl(acc, p, p + radial(deg) * 0.025 * s, 0.035 * s, M('amber'), seg=10)


def vent(acc, deg, r, y, s=1.0):
    """A vent / relief valve outlet near the top of a tank."""
    on_wall(acc, deg, r, y, (0.16 * s, 0.24 * s, 0.035 * s), M('dark'))
    p = polar(deg, r + 0.035 * s, y + 0.03)
    cyl(acc, p, p + radial(deg) * 0.035 * s, 0.05 * s, M('steel'), seg=12)


def door(acc, deg, r, y, w, h, m='frame', out=0.003):
    """An access door: a thin frame outline proud of the skin."""
    outer = rounded_rect2d(0, 0, w, h, min(w, h) * 0.15)
    inner = rounded_rect2d(0, 0, w - 0.04, h - 0.04, min(w, h) * 0.12)
    wrap_on_cyl(acc, [outer, inner[::-1]], r, deg, y, M(m), out=out)


def umbilical_plate(acc, deg, r, y, w=0.5, h=0.35):
    """A ground umbilical plate: a dark plate with round connectors."""
    on_wall(acc, deg, r, y, (w, h, 0.03), M('dark'))
    for i in range(3):
        u = (i - 1) * w * 0.3
        p = polar(deg, r + 0.03, y) + tangent(deg) * u
        cyl(acc, p, p + radial(deg) * 0.035, min(w, h) * 0.13, M('steel'), seg=12)


def fairing_strip(acc, deg, r_of, y0, y1, w, d, m, n=8):
    """A half-round conduit fairing along the wall (follows a profiled wall r_of(y))."""
    nprof = 7
    verts, faces = [], []
    e_r, e_t = radial(deg), tangent(deg)
    for k in range(n + 1):
        y = y0 + (y1 - y0) * k / n
        p = polar(deg, r_of(y) - 0.006, y)
        for j in range(nprof):
            t = math.pi * j / (nprof - 1)
            verts.append(p + e_r * (d * math.sin(t)) + e_t * (w / 2 * math.cos(t)))
    for k in range(n):
        for j in range(nprof - 1):
            i0 = k * nprof + j
            faces.append([i0, i0 + nprof, i0 + nprof + 1, i0 + 1])
    acc.add(verts, faces, m)
    for y, s in ((y0, -1), (y1, 1)):  # end caps
        p = polar(deg, r_of(y) - 0.006, y)
        cap = [p + e_r * (d * math.sin(math.pi * j / (nprof - 1))) + e_t * (w / 2 * math.cos(math.pi * j / (nprof - 1))) for j in range(nprof)]
        acc.add(cap, [list(range(nprof)) if s < 0 else list(range(nprof))[::-1]], m)


def two_tanks(R, H, top_frac, build, d_top, d_mid, d_bot, labels, margin=0.06, gap=0.12, split=None):
    """Volumes of a two-propellant barrel. separate: the intertank holds both inner domes (pointing at each other);
    common: one bulkhead bulging down into the lower tank."""
    r = R - 0.03
    ys = H * (1 - top_frac) if split is None else split
    y1_top = H - margin - d_top
    y0_bot = margin + d_bot
    if build == 'separate':
        up = Vol(labels[0], ys + gap / 2 + d_mid, y1_top, r, d_top, d_mid)
        lo = Vol(labels[1], y0_bot, ys - gap / 2 - d_mid, r, d_mid, d_bot)
    else:
        up = Vol(labels[0], ys, y1_top, r, d_top, d_mid)
        lo = Vol(labels[1], y0_bot, ys - d_mid * 0.6, r, d_mid * 0.4, d_bot)
    return [up, lo], ys


def barrel(root, R, H, vols, build, kit, fuel, skin_ys, mat_of, frames=(), split=None, detail=None, inner=None,
           seg=96, dome_mat=('alu', 'alu'), builders=None, sandwich=None, u_rep=1.0, v_scale=1.0):
    """
    A barrel tank model. skin_ys/mat_of: the outer skin bands (bodylib.skin). frames: [(y0, y1, depth, matkey)] raised
    bands. detail(acc): the model's own fittings. inner(acc): extra inside parts. Returns (slot nodes, geo).
    """
    sh = Acc()
    skin(sh, lambda y: R, skin_ys, seg, mat_of, u_rep=u_rep, v_scale=v_scale)
    sh.emit('shell', root)
    fr = Acc()
    end_flanges(fr, R, H)
    for (y0, y1, dep, mk) in frames:
        band(fr, R, y0, y1, dep, M(mk), seg=seg)
    fr.emit('frames', root)
    if detail:
        d = Acc()
        detail(d)
        d.emit('detail', root)
    ins = Acc()
    if len(vols) > 1:  # the end domes (the inner ones belong to the bulkhead slot)
        top, bot = vols[0], vols[-1]
        dome(ins, top.r * 0.995, top.y1, top.top_d, M(dome_mat[0]), seg=40, n=7)
        dome(ins, bot.r * 0.995, bot.y0, bot.bot_d, M(dome_mat[1]), down=True, seg=40, n=7)
    if inner:
        inner(ins)
    ins.emit('inner', root)
    geo = TankGeo(R, H, vols, build, fuel, split=split)
    if sandwich is not None:  # whether "as built" is a honeycomb sandwich bulkhead (slots.bulkhead_piece)
        geo.fuel = 'hydrolox' if sandwich else fuel + '_single'
    return build_slots(root, geo, kit, builders=builders), geo


# ------------------------------------------------------------------ the barrel tank models
def titan2_tanks(root):
    """Titan II first stage (Gemini GLV, photo S65-14150): oxidizer tank above, fuel below; white with the black band
    and black roll panels low on the stage, UNITED STATES stencilled down the side."""
    H, R = dims('tank_m_storable_titan')
    vols, ys = two_tanks(R, H, 0.55, 'separate', 0.52 * R, 0.45 * R, 0.5 * R, ('N2O4', 'A-50'), gap=0.1)
    # measured on the photo (stage 1 tank section, bottom to top): black band at 30-39 %, black panels 5-30 %
    band_lo, band_hi, pan_lo = 0.297 * H, 0.39 * H, 0.055 * H
    it0, it1 = ys - 0.62, ys + 0.62

    def mat_of(deg, y):
        if band_lo < y < band_hi:
            return 'black'
        if pan_lo < y < band_lo and (abs(deg - 270) < 22.5 or abs(deg - 90) < 22.5):
            return 'black'
        return 'white'

    def detail(d):
        stencil_vertical(d, 'UNITED STATES', R, 291.0, H - 0.3, 0.32, 0.37, M('black'))
        band(d, R, it1 - 0.015, it1 + 0.015, 0.005, M('white'), seg=96)  # the one seam the photo shows
        valve(d, 200, R, it1 + 0.35)
        valve(d, 200, R, 0.75)
        vent(d, 160, R, H - 0.45)
        door(d, 330, R, ys, 0.42, 0.5, 'white')  # the intertank access door
    barrel(root, R, H, vols, 'separate', 'tank', 'storable', [0.0, pan_lo, band_lo, band_hi, H], mat_of,
           detail=detail, split=ys)
    return H, R


def pslv_ps2(root):
    """PSLV second stage (PS2, Vikas): one barrel with a common bulkhead at mid-height (look.bulkheadAt), the water tank
    wrapped round the base; white with a red aft ring and a blue band."""
    H, R = dims('tank_m_storable_ps2')
    at = part('tank_m_storable_ps2').get('look', {}).get('bulkheadAt', 0.5)
    vols, ys = two_tanks(R, H, 1 - at, 'common', 0.55 * R, 0.4 * R, 0.4 * R, ('N2O4', 'UH25'), margin=0.08)

    def mat_of(deg, y):
        if y < 0.16:
            return 'red'
        if 7.1 < y < 7.22:
            return 'blue'
        return 'white'

    def detail(d):
        band(d, R, ys - 0.015, ys + 0.015, 0.004, M('alu'), seg=96)  # the bulkhead weld land
        for y in (1.9, 5.9):
            band(d, R, y - 0.012, y + 0.012, 0.004, M('white'), seg=96)
        valve(d, 210, R, ys + 0.5)
        valve(d, 210, R, 0.55)
        vent(d, 150, R, H - 0.5)

    def inner(i):
        # the water tank for the gas generator: a torus round the base (the stage's identity)
        torus(i, V(0, 0.38, 0), R * 0.8, 0.17, M('alu'), seg=40, seg2=10)
        for a in (30, 150, 270):  # its supports
            beam(i, polar(a, R * 0.8, 0.22), polar(a, R - 0.04, 0.05), 0.04, 0.04, M('frame'))
    barrel(root, R, H, vols, 'common', 'tank_common', 'storable', [0.0, 0.16, 7.1, 7.22, H], mat_of,
           detail=detail, inner=inner, split=ys, sandwich=False)
    return H, R


def ariane5_epc(root):
    """Ariane 5 main stage (EPC): liquid oxygen above liquid hydrogen, one common bulkhead, thin white foam, the seams
    of the barrel sections, the booster attachment fittings low on the stage."""
    H, R = dims('tank_l_hydrolox_epc')
    vols, ys = two_tanks(R, H, 0.27, 'common', 0.62 * R, 0.5 * R, 0.55 * R, ('LOX', 'LH2'), margin=0.06)
    seams = [1.6 * k for k in range(1, 6)]

    def detail(d):
        for y in seams + [ys]:
            band(d, R, y - 0.015, y + 0.015, 0.004, M('foam_white'), seg=96)
        valve(d, 200, R, ys + 0.45)
        valve(d, 200, R, 0.6)
        vent(d, 160, R, H - 0.5)
        for a in (0, 180):  # the booster attachment fittings low on the stage (one per booster)
            on_wall(d, a, R, 0.35, (0.36, 0.42, 0.06), M('frame'))
    barrel(root, R, H, vols, 'common', 'tank_common_h2', 'hydrolox', [0.0, H], lambda d, y: 'foam_white',
           detail=detail, split=ys, sandwich=False, u_rep=8, v_scale=0.6)
    return H, R


def dcss_lh2(root):
    """The hydrogen tank of the Delta IV / SLS ICPS upper stage (5 m version), from refs/pd_icps.jpg: white foam barrel
    between cream rings, slatted skirts, the green umbilical strip, the tan aft dome below with the truss fittings."""
    H, R = dims('tank_l_lh2_upper')
    bands = [(0.0, 0.03, 'alu'), (0.03, 0.30, 'white_panel'), (0.30, 0.62, 'cream_foam'), (0.62, 0.69, 'cream'),
             (0.69, 4.52, 'foam_white'), (4.52, 4.59, 'cream'), (4.59, H - 0.04, 'white_panel'), (H - 0.04, H, 'alu')]
    ys_ = [b[0] for b in bands] + [H]

    def mat_of(deg, y):
        for (a, b, k) in bands:
            if a <= y <= b:
                return k
        return 'white'

    def detail(d):
        # the green umbilical / raceway strip along the tank, with its oval end plates (as on the ICPS)
        deg = 255
        on_wall(d, deg, R, 2.55, (0.2, 4.1, 0.035), M('green'))
        for y in (0.5, 4.6):
            wrap_on_cyl(d, [rounded_rect2d(0, 0, 0.36, 0.28, 0.13)], R + 0.035, deg, y, M('frame'), out=0.002)
        tube(d, [polar(deg + 1.2, R + 0.05, 0.55), polar(deg + 1.2, R + 0.05, 4.55)], 0.012, M('steel'), 6)
        door(d, 300, R, H - 0.35, 0.3, 0.26, 'dark')  # access door in the forward skirt
        vent(d, 120, R, H - 0.4)
        for k in range(8):  # the composite truss fittings under the aft ring
            a = 22.5 + 45 * k
            box(d, polar(a, R - 0.09, 0.07), (0.14, 0.12, 0.12), M('truss_black'), (radial(a), V(0, 1, 0), tangent(a)))
        band(d, R, 0.62, 0.69, 0.012, M('cream'), seg=96)
        band(d, R, 4.52, 4.59, 0.012, M('cream'), seg=96)
    r = R - 0.03
    v = Vol('LH2', 1.24, H - 0.08 - 0.62 * R, r, 0.62 * R, 0.707 * r * 0.98)

    def bulk(geo, opt, kit):
        # the aft dome wears sprayed tan foam (seen through the truss), the forward one bare aluminium
        acc = Acc()
        if opt == 'common':  # a common bulkhead would split this tank in two: drawn at mid-height
            dome(acc, v.r * 0.99, (v.y0 + v.y1) / 2, 0.5 * v.r, M('alu'), down=True, seg=32, n=6)
        dome(acc, v.r * 0.995, v.y1, v.top_d, M('alu'), seg=40, n=7)
        dome(acc, v.r * 0.995, v.y0, v.bot_d, M('foam_tan'), down=True, seg=40, n=7)
        return acc
    barrel(root, R, H, [v], 'separate', 'tank_h2', 'hydrolox', ys_, mat_of, detail=detail,
           builders={'bulkhead': bulk}, u_rep=24, v_scale=1 / 0.27)
    return H, R


def vulcan_tank(root):
    """Vulcan first stage: one orange-foam barrel, liquid oxygen above liquefied natural gas, a common bulkhead,
    orthogrid aluminium walls under the foam. The LO2 feed line runs outside (the separate feedline_external part)."""
    H, R = dims('tank_l_methalox_orthogrid')
    vols, ys = two_tanks(R, H, 0.57, 'common', 0.6 * R, 0.5 * R, 0.55 * R, ('LOX', 'LNG'), margin=0.06)
    seams = [1.9, 3.8, 5.7, 7.6]

    def detail(d):
        for y in seams + [ys]:
            band(d, R, y - 0.02, y + 0.02, 0.004, M('foam_dark'), seg=96)
        valve(d, 200, R, ys + 0.5)
        valve(d, 200, R, 0.6)
        vent(d, 160, R, H - 0.5)
        # the LO2 outlet: a short foam-covered stub where the outside feed line leaves the oxygen tank
        p = polar(0, R, ys - 0.25)
        cyl(d, p, p + radial(0) * 0.08, 0.13, M('foam_et'), seg=16)

    def feed(geo, opt, kit):
        if opt != 'single':
            return feed_piece(geo, opt)
        acc = Acc()
        up, lo = geo.vols
        # the oxygen leaves the bottom of the common bulkhead sideways to the outside line; the gas leaves the bottom
        a = up.at(0) + V(0, ys - up.bot_d + 0.05, 0)
        tube(acc, bend([a, V(0, ys - up.bot_d - 0.05, 0), polar(0, R * 0.45, ys - 0.25), polar(0, R - 0.05, ys - 0.25)], 0.12),
             0.09, M('steel'), 10)
        tube(acc, [V(0, lo.bottom + 0.03, 0), V(0, 0.0, 0)], 0.09, M('steel'), 10)
        cyl(acc, V(0, 0.22, 0), V(0, 0.42, 0), 0.14, M('amber'), seg=10)
        return acc
    barrel(root, R, H, vols, 'common', 'tank_common', 'methalox', [0.0, H], lambda d, y: 'foam_et',
           detail=detail, split=ys, sandwich=False, builders={'feedline': feed}, u_rep=10, v_scale=0.5)
    return H, R


def soyuz_block_i(root):
    """Soyuz third stage (Blok I): kerosene tank above with stringers outside, the instrument band with its six hatches,
    the oxygen tank below (blanket-wrapped domes); Soyuz grey."""
    H, R = dims('tank_m_kerolox_bloki')
    vols, ys = two_tanks(R, H, 0.38, 'separate', 0.42 * R, 0.33 * R, 0.45 * R, ('RG-1', 'LOX'), gap=0.08)
    b0, b1 = ys - 0.32, ys + 0.32  # the instrument band between the tanks

    def mat_of(deg, y):
        return 'soyuz_dark' if b0 < y < b1 else 'soyuz'

    def detail(d):
        n = 48  # external stringers on the kerosene tank (the ribbed upper part of Blok I)
        for k in range(n):
            a = 360 * k / n
            on_wall(d, a, R, (b1 + H - 0.06) / 2, (0.03, H - 0.06 - b1 - 0.04, 0.022), M('soyuz'))
        for y in (b0, b1):
            band(d, R, y - 0.025, y + 0.025, 0.012, M('soyuz_dark'), seg=96)
        for k in range(6):  # six hatches and a valve hatch in the instrument band
            door(d, 30 + 60 * k, R, ys, 0.34, 0.36, 'frame', out=0.004)
        valve(d, 0, R, ys, 0.9)
        valve(d, 200, R, 0.55)
        for y in (1.1, 2.0):
            band(d, R, y - 0.01, y + 0.01, 0.004, M('soyuz'), seg=96)

    def press(geo, opt, kit):
        if opt != 'helium':
            return press_piece(geo, opt)
        acc = Acc()  # Soyuz-2.1b: the helium vessels sit inside the oxygen tank (the lower one)
        lo = geo.vols[1]
        for a in (150, 180, 210):
            capsule(acc, polar(a, lo.r * 0.55, (lo.y0 + lo.y1) / 2), 0.12, 0.5, M('copv'), seg=12, n=3)
        return acc
    barrel(root, R, H, vols, 'separate', 'tank', 'kerolox', [0.0, b0, b1, H], mat_of, detail=detail, split=ys,
           dome_mat=('alu', 'mli'), builders={'pressurisation': press})
    return H, R


# ------------------------------------------------------------------ clusters
def _round_tank(acc, c, r, y0, y1, m, seg=24, top_d=None, bot_d=None, nose=None):
    """A cylindrical tank with round ends from y0 (bottom pole) to y1 (top pole) at (x, z) = c."""
    td = top_d if top_d is not None else r * 0.7
    bd = bot_d if bot_d is not None else r * 0.7
    prof = []
    for k in range(6):
        a = math.pi / 2 * k / 5
        prof.append((r * math.sin(a), y0 + bd * (1 - math.cos(a))))
    if nose:  # a pointed nose cone (Proton outer tanks)
        prof += [(r, y1 - nose), (r * 0.55, y1 - nose * 0.35), (r * 0.18, y1 - 0.04), (0.0, y1)]
    else:
        for k in range(6):
            a = math.pi / 2 * k / 5
            prof.append((r * math.cos(a), y1 - td * (1 - math.sin(a))))
    lathe(acc, prof, m, seg, c=V(c[0], 0, c[1]))


def _cluster_slots(root, geo, vols, centre, face_tank, r_face, lox_label, ring_r, ctr_r):
    """The cluster kit's pieces: in every tank, plus a cut-away of the layer on the outer tank facing +z."""

    def press(geo, opt, kit):
        acc = Acc()
        if opt in ('helium', 'heated'):
            for k in range(4):  # helium bottles in the top of the centre tank
                sphere(acc, polar(45 + 90 * k + 22.5, centre.r * 0.6, centre.y1), 0.13, M('titanium'), seg=12)
            if opt == 'heated':
                for k in range(2):
                    _coil(acc, V(-0.35 + 0.7 * k, 0, 0.0), 0.12, centre.bottom - 0.25, centre.bottom - 0.02, 3, 0.014, M('copper'))
        elif opt == 'autogenous':  # gas from the engines' heat exchangers, a diffuser at the top of each oxidizer tank
            for v in vols:
                if v.label != lox_label:
                    continue
                p = v.at(0) + V(0, v.y1 + v.top_d * 0.4, 0)
                cyl(acc, p - V(0, 0.1, 0), p + V(0, 0.06, 0), 0.06, M('alu_cut'), seg=10)
            tube(acc, [V(-0.3, centre.bottom, 0.0), V(-0.3, centre.y1, 0.0)], 0.022, M('gold'), 6)
        elif opt == 'nitrogen':
            for k in range(2):
                sphere(acc, polar(160 + 40 * k, centre.r * 0.5, centre.y1 + 0.1), 0.15, M('steel'), seg=12)
        return acc

    def baff(geo, opt, kit):
        acc = Acc()
        if opt == 'none':
            return acc
        for v in vols:
            for j in range(2):
                y = v.y0 + (v.y1 - v.y0) * (0.25 + 0.4 * j)
                if opt in ('baffled', 'pmd'):
                    lathe(acc, [(v.r * 0.97, y), (v.r * 0.7, y + 0.01)], M('alu'), 16, c=v.at(0))
            if opt in ('antivortex', 'pmd'):
                for a in (0, 90):
                    box(acc, v.at(0) + V(0, v.bottom + 0.14, 0), (v.r * 0.9, 0.24, 0.02), M('alu'), (radial(a), V(0, 1, 0), tangent(a)))
        return acc

    def ins(geo, opt, kit):
        acc, e = Acc(), Acc()
        m = {'bare': 'alu', 'foam': 'foam_tan', 'mli': 'gold'}[opt]
        yc = (face_tank.y0 + face_tank.y1) / 2
        curved_panel(e, r_face - 0.006, 215, 325, yc - 0.7, yc + 0.7, M(m), seg=8, thick=0.004 if opt == 'bare' else 0.025)
        acc.add([(x + face_tank.c[0], y, z + face_tank.c[1]) for (x, y, z) in e.V], e.F, M(m), e.UV)
        return acc

    def feed(geo, opt, kit):
        acc = Acc()
        for v in vols:
            n = 2 if opt == 'dual' else 1
            for j in range(n):
                dx = (j - (n - 1) / 2) * 0.12
                p = v.at(0) + V(dx, v.bottom + 0.02, 0)
                tube(acc, [p, V(p.x, 0.0, p.z)], 0.04, M('steel'), 8)
                cyl(acc, V(p.x, 0.06, p.z), V(p.x, 0.16, p.z), 0.065, M('amber'), seg=8)
        if opt == 'tunnel':
            cyl(acc, V(0, 0.0, 0), V(0, centre.bottom + 0.05, 0), 0.13, M('glass_cloth'), seg=12, caps=False)
        if opt == 'pogo':
            capsule(acc, V(0.2, 0.26, 0.0), 0.07, 0.26, M('steel'), seg=10)
        return acc
    build_slots(root, geo, 'tank_cluster', builders={'pressurisation': press, 'baffles': baff, 'insulation': ins, 'feedline': feed})


def sib_cluster(root):
    """Saturn IB first stage (S-IB) tanks: a Jupiter-size LOX tank in the centre, eight Redstone-size tanks round it
    (LOX white, RP-1 black, as on the early stages), the eight-armed spider beam across the top, the tail barrel below."""
    H, R = dims('tank_l_kerolox_cluster')
    rc, ro = 0.69, 0.46  # 2.67 m and 1.78 m tanks on a 6.53 m envelope, scaled 0.517
    ring_r = R - ro
    yb, yt = 0.32, H - 0.32
    ctr = Acc()
    _round_tank(ctr, (0, 0), rc, yb, yt - 0.04, M('white'), seg=32, top_d=rc * 0.6, bot_d=rc * 0.6)
    ctr.emit('piece_center_tank', root)
    tanks = []
    for k in range(8):
        a = 22.5 + 45 * k
        p = polar(a, ring_r)
        lox = k % 2 == 1
        acc = Acc()
        _round_tank(acc, (p.x, p.z), ro, yb - 0.06, yt, M('white' if lox else 'black'), seg=24, top_d=ro * 0.65, bot_d=ro * 0.65)
        for y in (1.6, 3.6, 5.6, 7.3):  # ring frames on the outer tanks
            lathe(acc, [(ro - 0.003, y - 0.02), (ro + 0.008, y), (ro - 0.003, y + 0.02)], M('alu' if lox else 'frame'), 24, c=V(p.x, 0, p.z))
        acc.emit(f'piece_outer_tank_{k + 1}', root)
        tanks.append(Vol('LOX' if lox else 'RP-1', yb - 0.06 + ro * 0.65, yt - ro * 0.65, ro - 0.02, ro * 0.65, ro * 0.65, (p.x, p.z)))
    # the spider beam: a hub and eight box beams over the outer tanks, an outer ring the stage above bolts to
    sb = Acc()
    lathe(sb, [(0.28, H - 0.3), (0.42, H - 0.3), (0.42, H), (0.28, H), (0.28, H - 0.3)], M('alu'), 16)
    for k in range(8):
        a = 22.5 + 45 * k
        beam(sb, polar(a, 0.4, H - 0.15), polar(a, R - 0.05, H - 0.15), 0.11, 0.3, M('alu'), up=V(0, 1, 0))
        box(sb, polar(a, ring_r, H - 0.34), (0.22, 0.08, 0.22), M('frame'))  # the tank hanger fitting
    lathe(sb, [(R - 0.08, H - 0.12), (R, H - 0.12), (R, H), (R - 0.08, H), (R - 0.08, H - 0.12)], M('alu'), 72)
    sb.emit('piece_spider_beam', root)
    # the tail barrel the tanks stand on (the thrust structure, fins and engines are the tail section's)
    tb = Acc()
    lathe(tb, [(R - 0.07, 0.0), (R, 0.0), (R, 0.22), (R - 0.07, 0.22), (R - 0.07, 0.0)], M('alu'), 72)
    lathe(tb, [(0.88, 0.0), (0.95, 0.0), (0.95, 0.36), (0.88, 0.36), (0.88, 0.0)], M('alu'), 32)
    for k in range(8):
        a = 22.5 + 45 * k
        beam(tb, polar(a, 0.95, 0.12), polar(a, R - 0.06, 0.12), 0.1, 0.18, M('frame'), up=V(0, 1, 0))
    tb.emit('frames', root)
    centre = Vol('LOX', yb + rc * 0.6, yt - 0.04 - rc * 0.6, rc - 0.02, rc * 0.6, rc * 0.6)
    vols = [centre] + tanks
    face = min(tanks, key=lambda v: (math.degrees(math.atan2(-v.c[1], v.c[0])) % 360 - 270) ** 2)
    _cluster_slots(root, TankGeo(R, H, vols, 'cluster', 'kerolox'), vols, centre, face, ro, 'LOX', ring_r, rc)
    return H, R


def proton_cluster(root):
    """Proton first stage: a central oxidizer tank and six outer fuel tanks (each narrow enough for a railway wagon)
    ending in their engine bays; the transfer ring on top and the frame the lattice above stands on."""
    H, R = dims('tank_l_storable_cluster')
    rc, ro = 0.94, 0.37  # 4.1 m and 1.6 m tanks on a 7.4 m envelope, scaled 0.457
    ring_r = R - ro
    ctr = Acc()
    _round_tank(ctr, (0, 0), rc, 0.35, H - 0.6, M('grey'), seg=40, top_d=rc * 0.5, bot_d=rc * 0.5)
    for y in (1.5, 3.0, 4.5, 6.0):
        lathe(ctr, [(rc - 0.003, y - 0.02), (rc + 0.01, y - 0.01), (rc + 0.01, y + 0.01), (rc - 0.003, y + 0.02)], M('frame'), 40)
    lathe(ctr, [(rc - 0.02, H - 1.0), (rc, H - 1.0), (rc, H - 0.14), (rc - 0.02, H - 0.14)], M('grey'), 40)  # transfer compartment
    ctr.emit('piece_center_tank', root)
    outer = []
    for k in range(6):
        a = 60 * k
        p = polar(a, ring_r)
        acc = Acc()
        _round_tank(acc, (p.x, p.z), ro, 0.42, H - 0.28, M('white'), seg=20, bot_d=ro * 0.5, nose=0.85)
        lathe(acc, [(ro, 0.0), (ro, 0.48), (ro * 0.7, 0.5)], M('grey'), 20, c=V(p.x, 0, p.z))  # the engine bay below
        for y in (1.6, 3.2, 4.8, 6.3):
            lathe(acc, [(ro - 0.003, y - 0.015), (ro + 0.007, y - 0.008), (ro + 0.007, y + 0.008), (ro - 0.003, y + 0.015)], M('frame'), 20, c=V(p.x, 0, p.z))
        for y in (0.7, 6.7):  # the struts that tie the outer tank to the centre one
            beam(acc, polar(a, rc, y), polar(a, ring_r - ro, y), 0.08, 0.08, M('frame'), up=V(0, 1, 0))
        acc.emit(f'piece_outer_tank_{k + 1}', root)
        outer.append(Vol('UDMH', 0.42 + ro * 0.5, H - 0.28 - 0.85, ro - 0.02, 0.85, ro * 0.5, (p.x, p.z)))
    fr = Acc()  # the top frame: beams from the transfer ring to an outer ring at the stack radius
    for k in range(6):
        a = 60 * k
        beam(fr, polar(a, rc - 0.02, H - 0.07), polar(a, R - 0.05, H - 0.07), 0.1, 0.14, M('frame'), up=V(0, 1, 0))
        beam(fr, polar(a, ring_r, H - 0.3), polar(a, ring_r, H - 0.12), 0.06, 0.06, M('frame'))
        beam(fr, polar(a + 30, rc - 0.02, H - 0.07), polar(a + 30, R - 0.05, H - 0.07), 0.08, 0.1, M('frame'), up=V(0, 1, 0))
    lathe(fr, [(R - 0.09, H - 0.14), (R, H - 0.14), (R, H), (R - 0.09, H), (R - 0.09, H - 0.14)], M('grey'), 72)
    lathe(fr, [(R - 0.06, 0.0), (R, 0.0), (R, 0.08), (R - 0.06, 0.08), (R - 0.06, 0.0)], M('frame'), 72)
    for k in range(6):  # pipes and conduits between the outer tanks (the cable_raceway part adds a long one)
        a = 60 * k + 30
        tube(fr, [polar(a, rc + 0.05, 0.1), polar(a, rc + 0.05, H - 1.0)], 0.035, M('grey'), 6)
    fr.emit('frames', root)
    centre = Vol('N2O4', 0.35 + rc * 0.5, H - 0.6 - rc * 0.5, rc - 0.02, rc * 0.5, rc * 0.5)
    vols = [centre] + outer
    face = min(outer, key=lambda v: (math.degrees(math.atan2(-v.c[1], v.c[0])) % 360 - 270) ** 2)
    _cluster_slots(root, TankGeo(R, H, vols, 'cluster', 'storable'), vols, centre, face, ro, 'N2O4', ring_r, rc)
    return H, R


# ------------------------------------------------------------------ profiled shells
def _profiled_skin(acc, profile, R, H, mat, seg=96, extra_ys=()):
    pts = sorted(set([p[1] * H for p in profile] + list(extra_ys)))
    lathe(acc, [(profile_r(profile, R, H, y), y) for y in pts], mat, seg)


def _ring_frame(acc, rr, y, m, w=0.02, d=0.007):
    lathe(acc, [(rr(y - w) - 0.003, y - w), (rr(y) + d, y), (rr(y + w) - 0.003, y + w)], m, 64)


def n1_block_a(root):
    """N1 first stage (Block A): a load-bearing cone with two spheres hung inside, the larger LOX sphere low and the
    kerosene sphere above; white (7L) with long conduit fairings over the propellant lines, many ring frames."""
    pid = 'tank_l_kerolox_spheres'
    H, R = dims(pid)
    prof = part(pid)['hullProfile']['profile']
    rr = lambda y: profile_r(prof, R, H, y)
    sh = Acc()
    _profiled_skin(sh, prof, R, H, M('n1'), seg=96, extra_ys=[0.5 * k for k in range(13)])
    sh.emit('shell', root)
    fr = Acc()
    flange(fr, rr(0) - 0.002, rr(0) - 0.08, 0.0, 0.03, M("frame"), seg=96)
    flange(fr, rr(H) - 0.002, rr(H) - 0.08, H, -0.03, M("frame"), seg=96)
    for k in range(1, 10):
        _ring_frame(fr, rr, 0.6 * k, M('n1'))
    fr.emit('frames', root)
    det = Acc()
    for a in (45, 135, 225, 315):  # four long conduit fairings over the lines, following the cone
        fairing_strip(det, a, rr, 0.08, H - 0.08, 0.16, 0.08, M('n1'), n=6)
    door(det, 270, rr(2.6), 2.6, 0.4, 0.5, 'frame')
    det.emit('detail', root)
    # the spheres and the conical skirts they hang from (the shell carries the load)
    lox = Vol('LOX', 1.58, 1.58, 1.45, 1.45, 1.45)
    rg1 = Vol('RG-1', 4.28, 4.28, 1.2, 1.2, 1.2)
    for (v, name) in ((lox, 'piece_sphere_lox'), (rg1, 'piece_sphere_rg1')):
        acc = Acc()
        sphere(acc, V(0, v.y0, 0), v.r, M('alu'), seg=40, rings_n=18)
        ye = v.y0 + v.r * 0.3
        re = math.sqrt(v.r ** 2 - (ye - v.y0) ** 2)
        lathe(acc, [(re, ye), (rr(ye + 0.3) - 0.02, ye + 0.3)], M('alu_cut'), 40)
        acc.emit(name, root)
    geo = TankGeo(R, H, [rg1, lox], 'spheres', 'kerolox', wall=lambda y: rr(y) - 0.03)

    def feed(geo, opt, kit):
        acc = Acc()
        lr = 0.04
        n = 4 if opt == 'dual' else 2
        for j in range(n):
            a = 80 + (j * (360 / n))
            # the kerosene lines leave the upper sphere and pass round the LOX sphere close to it, down to the engines
            pts = [polar(a, 0.25, rg1.bottom + 0.02), polar(a, 0.6, rg1.bottom - 0.08)]
            for k in range(6):
                t = math.radians(70 - 140 * k / 5)
                pts.append(polar(a, (lox.r + 0.06) * math.cos(t), lox.y0 + (lox.r + 0.06) * math.sin(t)))
            pts += [polar(a, 0.55, 0.06), polar(a, 0.55, 0.0)]
            tube(acc, bend(pts, 0.1, n=2), lr, M('steel'), 6)
            if opt == 'surge':
                sphere(acc, polar(a, 0.55, 0.18) + V(0.08, 0, 0), 0.07, M('steel'), seg=10)
            if opt == 'pogo' and j == 0:
                capsule(acc, polar(a, 0.75, 0.2), 0.06, 0.24, M('steel'), seg=10)
        tube(acc, [V(0, lox.bottom + 0.02, 0), V(0, 0.0, 0)], 0.07, M('steel'), 10)  # the LOX outlet
        if opt == 'tunnel':  # a tunnel through the LOX sphere carrying the kerosene down the middle
            cyl(acc, V(0, lox.bottom - 0.02, 0), V(0, lox.top + 0.05, 0), 0.12, M('glass_cloth'), seg=12, caps=False)
        return acc

    def ins(geo, opt, kit):
        acc = Acc()
        m = {'bare': 'alu', 'foam': 'foam_tan', 'mli': 'gold'}[opt]
        prof_ = []
        for k in range(7):  # a patch of the layer on the LOX sphere, facing +z
            t = math.radians(-35 + 70 * k / 6)
            prof_.append(((lox.r + 0.006) * math.cos(t), lox.y0 + (lox.r + 0.006) * math.sin(t)))
        lathe(acc, prof_, M(m), 10, a0=math.radians(240), a1=math.radians(300), u_rep=2, v_scale=2)
        return acc
    build_slots(root, geo, 'tank_spheres', builders={'feedline': feed, 'insulation': ins})
    return H, R


def soyuz_block_a(root):
    """Soyuz core stage (Blok A): waisted at the bottom for the boosters, widest at the load ring where the four
    boosters push, tapering to the top. Light grey."""
    pid = 'tank_m_kerolox_bloka'
    H, R = dims(pid)
    prof = part(pid)['hullProfile']['profile']
    rr = lambda y: profile_r(prof, R, H, y)
    y_ring = prof[-2][1] * H  # the load ring (the widest point of the profile)
    yi0, yi1 = prof[1][1] * H, prof[2][1] * H  # the intertank between the waist and the bulge
    sh = Acc()
    _profiled_skin(sh, prof, R, H, M('soyuz'), seg=96, extra_ys=[y_ring - 0.15, y_ring + 0.15, 9.6])
    sh.emit('shell', root)
    fr = Acc()
    flange(fr, rr(0) - 0.002, rr(0) - 0.08, 0.0, 0.03, M("frame"), seg=96)
    flange(fr, rr(H) - 0.002, rr(H) - 0.08, H, -0.03, M("frame"), seg=96)
    # the load ring: a stiff band where the boosters' ball joints push, with four sockets
    lathe(fr, [(rr(y_ring - 0.16) - 0.004, y_ring - 0.16), (rr(y_ring - 0.12) + 0.03, y_ring - 0.12),
               (rr(y_ring + 0.12) + 0.03, y_ring + 0.12), (rr(y_ring + 0.16) - 0.004, y_ring + 0.16)], M('soyuz_dark'), 96)
    for a in (0, 90, 180, 270):
        p = polar(a, R + 0.03, y_ring)
        cyl(fr, p, p + radial(a) * 0.07, 0.11, M('frame'), seg=14)
        cyl(fr, p + radial(a) * 0.07, p + radial(a) * 0.09, 0.06, M('steel'), seg=12)
    for y in (1.1, 2.2, 3.0, 5.3, 6.3, 7.2, 9.6, 10.3):
        _ring_frame(fr, rr, y, M('soyuz'), w=0.015, d=0.006)
    fr.emit('frames', root)
    det = Acc()
    for y in (yi0, yi1):
        _ring_frame(det, rr, y, M('soyuz_dark'), w=0.025, d=0.012)
    for a in (45, 135, 225, 315):
        yc = (yi0 + yi1) / 2
        door(det, a, rr(yc) + 0.003, yc, 0.36, 0.42, 'frame', out=0.004)
    valve(det, 200, rr(1.5), 1.5)
    vent(det, 160, rr(H - 0.6), H - 0.6)
    fairing_strip(det, 110, rr, 0.3, yi0 - 0.1, 0.1, 0.05, M('soyuz'), n=2)  # a cable duct on the waist
    det.emit('detail', root)
    lox = Vol('LOX', yi1 + 0.4, H - 0.65, rr(yi1) - 0.06, 0.48, 0.42)
    ker = Vol('RG-1', 0.55, yi0 - 0.45, rr(0) - 0.05, 0.4, 0.42)
    ins = Acc()
    dome(ins, lox.r, lox.y1, lox.top_d, M('alu'), seg=40, n=7)
    dome(ins, ker.r, ker.y0, ker.bot_d, M('alu'), down=True, seg=40, n=7)
    ins.emit('inner', root)
    geo = TankGeo(R, H, [lox, ker], 'separate', 'kerolox', wall=lambda y: rr(y) - 0.03, split=(yi0 + yi1) / 2)
    build_slots(root, geo, 'tank')
    return H, R


MODELS = {
    'titan2_tanks': ('tank_m_storable_titan', titan2_tanks),
    'pslv_ps2': ('tank_m_storable_ps2', pslv_ps2),
    'ariane5_epc': ('tank_l_hydrolox_epc', ariane5_epc),
    'dcss_lh2': ('tank_l_lh2_upper', dcss_lh2),
    'vulcan_tank': ('tank_l_methalox_orthogrid', vulcan_tank),
    'soyuz_block_i': ('tank_m_kerolox_bloki', soyuz_block_i),
    'sib_cluster': ('tank_l_kerolox_cluster', sib_cluster),
    'proton_cluster': ('tank_l_storable_cluster', proton_cluster),
    'n1_block_a': ('tank_l_kerolox_spheres', n1_block_a),
    'soyuz_block_a': ('tank_m_kerolox_bloka', soyuz_block_a),
}
