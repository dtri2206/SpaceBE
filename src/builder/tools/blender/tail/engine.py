"""
Liquid rocket engine generator (tail section): engine_s, engine_m, engine_l (one engine per pump size, shared by every
fuel), their vacuum-bell versions (engine_<size>_vac) and low-detail copies for big clusters (engine_<size>_lod).

Run from the repo root (writes public/assets/models/builder/tail/engine_*.glb):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/tail/engine.py -- [--only engine_m] [--shots DIR]

Contract (../README.md, tail models.md): origin at the centre of the nozzle exit (y = 0), gimbal mounting pad on top at
y = the part height (S 1.65 m, M 2.2 m, L 2.97 m). Real proportions, from real engines:
  - sea-level bell: exit diameter about 0.55 x the engine length (F-1 0.64, H-1 0.55, RS-25 0.53, RS-68 0.47),
    expansion ratio 16 (Merlin 1D, F-1), a 70 % Rao bell (throat arc 0.382 Rt, start angle 32 deg, exit 9 deg),
    contraction ratio 3 (chamber radius 1.75 x the throat), the bell about 54 % of the length;
  - vacuum bell: exit diameter about 0.72 x the length, expansion ratio 60, bell about 70 % of the length.
Inner pieces (the engine kit in sections/tail/internals.json) are nodes slot_<key> (the first option's look) and
slot_<key>__<optionId> (another option's look); the game shows one per key:
  slot_cycle (gg) + __tapoff __sc __sc_fuel __ffsc __expander __expander_bleed __electric __pressure
  slot_injector (coaxial) + __swirl __pintle __impinging
  slot_chamber (channels) + __tubes __film __ablative
  slot_contour (bell, throat to the skirt joint) + __conical (hides nozzleExt) + __aerospike (hides nozzleExt and chamber)
  slot_nozzleExt (regen) + __radiative __carbon __extendable __ablative
  slot_igniter (spark) + __pyro __tea_teb __ampoule
  slot_stability (none: empty) + __baffles __cavities
Plain nodes (always shown): gimbal_block (bearing, thrust post, mounting pad), actuators (two hydraulic gimbal
actuators at 90 degrees), ducts (oxygen and fuel inlets with gimbal bellows).
"""
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tl  # noqa: E402
from tl import V, M, Acc, polar, TAU  # noqa: E402

HEIGHT = {'s': 1.65, 'm': 2.2, 'l': 2.97}  # sections/tail/parts.json engine_s / engine_m / engine_l


def geometry(He, vac):
    """Every station of the engine in metres (y up from the nozzle exit)."""
    g = {}
    if vac:
        Re, eps, Lb, thn, the, cr, Lcyl, tp = 0.36, 60.0, 0.70, 40.0, 6.0, 1.8, 0.055, 0.78
    else:
        Re, eps, Lb, thn, the, cr, Lcyl, tp = 0.275, 16.0, 0.54, 38.0, 8.0, 1.75, 0.075, 1.0
    g['Re'], g['Rt'] = Re * He, Re * He / math.sqrt(eps)
    g['Lb'] = Lb * He
    g['Rc'] = cr * g['Rt']
    g['bell'] = tl.rao_bell(g['Rt'], g['Re'], g['Lb'], thn, the, n=10)
    g['yT'] = g['Lb']
    conv = tl.converging(g['Rt'], g['Rc'], n=3)
    g['conv'] = conv
    g['yC'] = g['yT'] + conv[-1][1]          # bottom of the chamber's cylinder
    g['yI'] = g['yC'] + Lcyl * He            # injector face
    g['yH'] = g['yI'] + 0.03 * He            # top of the injector head ring
    g['yD'] = g['yH'] + (0.05 if vac else 0.055) * He  # top of the oxygen dome
    g['yG'] = He - 0.07 * He                 # bottom of the gimbal bearing
    g['tp'] = tp                             # turbomachinery scale
    g['xs'] = (0.40 if vac else 0.52) * g['Lb']  # skirt joint, downstream of the throat
    g['ys'] = g['yT'] - g['xs']
    g['rs'] = tl.bell_r_at(g['bell'], g['xs'])
    g['He'] = He
    g['vac'] = vac
    return g


def bell_y(g, x):
    return g['yT'] - x


def bell_prof(g, x0, x1, extra=0.0):
    """The bell between x0 and x1 (downstream of the throat) as a lathe profile [(r, y)] walking upward."""
    pts = [(r + extra, bell_y(g, x)) for (r, x) in g['bell'] if x0 - 1e-9 <= x <= x1 + 1e-9]
    if not pts or abs(pts[0][1] - bell_y(g, x0)) > 1e-6:
        pts.insert(0, (tl.bell_r_at(g['bell'], x0) + extra, bell_y(g, x0)))
    if abs(pts[-1][1] - bell_y(g, x1)) > 1e-6:
        pts.append((tl.bell_r_at(g['bell'], x1) + extra, bell_y(g, x1)))
    return pts[::-1]  # bottom (exit side) first


def band_prof(prof_fn, y, w, h):
    """A hat band (stiffening ring) round a lathe surface: its own small lathe."""
    r = prof_fn(y)
    return [(r, y - w / 2), (r + h, y), (r, y + w / 2)]


# ------------------------------------------------------------------ plain pieces
def inlet_points(g):
    He = g['He']
    yb = He - (0.07 if g['vac'] else 0.115) * He
    return {'ox': polar(35, 0.17 * He, yb), 'fu': polar(-35, 0.17 * He, yb), 'yb': yb}


def gimbal_block(g, parent):
    He, a = g['He'], Acc()
    dark, steel = M('dark'), M('steel')
    # thrust post from the oxygen dome up to the bearing
    tl.lathe(a, [(g['Rc'] * 0.55, g['yD'] - 0.01 * He), (0.05 * He, g['yG'] - 0.015 * He), (0.045 * He, g['yG'])], dark, 16)
    # bearing: a cross block on two pairs of trunnion pins, lower yoke on x, upper yoke on z
    yb = g['yG'] + 0.03 * He
    tl.box(a, V(0, yb, 0), (0.07 * He, 0.045 * He, 0.07 * He), steel)
    tl.cyl(a, V(-0.062 * He, yb, 0), V(0.062 * He, yb, 0), 0.012 * He, steel, 10)
    tl.cyl(a, V(0, yb, -0.062 * He), V(0, yb, 0.062 * He), 0.012 * He, steel, 10)
    for s in (-1, 1):
        tl.box(a, V(s * 0.05 * He, yb - 0.02 * He, 0), (0.018 * He, 0.06 * He, 0.05 * He), dark)
        tl.box(a, V(0, yb + 0.016 * He, s * 0.05 * He), (0.05 * He, 0.04 * He, 0.018 * He), dark)
    # mounting pad bolted to the thrust structure
    tl.lathe(a, [(0.0, He - 0.022 * He), (0.075 * He, He - 0.022 * He), (0.075 * He, He), (0.0, He)], dark, 20)
    a.emit('gimbal_block', parent)


def actuators(g, parent):
    """Two hydraulic gimbal actuators at 90 degrees (pitch and yaw), from the thrust structure to the injector head."""
    He, a = g['He'], Acc()
    steel, dark, cable = M('steel'), M('dark'), M('cable')
    for az in (135, 225):
        lo = polar(az, g['Rc'] * 1.12, g['yH'] - 0.012 * He)
        hi = polar(az, 0.25 * He, He - 0.045 * He)
        mid = lo.lerp(hi, 0.42)
        tl.cyl(a, hi, mid, 0.022 * He, steel, 10)                      # cylinder
        tl.cyl(a, mid, lo, 0.010 * He, M('stainless'), 8)             # rod
        tl.box(a, lo, (0.03 * He, 0.03 * He, 0.03 * He), dark)        # lower clevis on the injector head ring
        tl.box(a, hi + V(0, 0.022 * He, 0), (0.035 * He, 0.04 * He, 0.035 * He), dark)  # upper clevis on the thrust structure
        sv = hi.lerp(mid, 0.45) + (polar(az + 90, 1.0) * 0.026 * He)
        tl.box(a, sv, (0.03 * He, 0.045 * He, 0.03 * He), dark)       # servo-valve block
        tl.tube(a, [sv + V(0, 0.02 * He, 0), sv + V(0, 0.06 * He, 0), polar(az + 12, 0.27 * He, He - 0.004 * He)], 0.005 * He, cable, 5)
    # lugs on the injector head ring the rods pull on
    a.emit('actuators', parent)


def ducts(g, parent):
    """Oxygen and fuel inlets from the stage: flanges at the top and gimbal bellows."""
    He, a = g['He'], Acc()
    ip = inlet_points(g)
    for key in ('ox', 'fu'):
        p = ip[key]
        top = V(p.x, He - 0.006 * He, p.z)
        tl.cyl(a, top, top + V(0, -0.016 * He, 0), 0.036 * He, M('dark'), 10)
        tl.bellows(a, top + V(0, -0.016 * He, 0), p, 0.026 * He, M('steel'), folds=3, seg=10, depth=0.14)
    a.emit('ducts', parent)


# ------------------------------------------------------------------ turbomachinery helpers
def tp_body(a, g, c, s=1.0, turbine_up=False, seg=8):
    """A single-shaft turbopump standing vertical at c (bottom): turbine, fuel pump volute, oxygen pump volute."""
    He = g['He'] * g['tp'] * s
    P = [(0.0, 0), (0.054, 0.004), (0.056, 0.04), (0.035, 0.05), (0.06, 0.08), (0.033, 0.116),
         (0.066, 0.138), (0.062, 0.17), (0.034, 0.185), (0.0, 0.205)]
    if turbine_up:
        P = [(r, 0.205 - h) for (r, h) in P][::-1]
    tl.lathe(a, [(r * He, h * He) for (r, h) in P], M('steel'), seg, c)
    # volute discharge flanges
    yf = 0.087 if not turbine_up else 0.205 - 0.087
    yo = 0.152 if not turbine_up else 0.205 - 0.152
    tl.box(a, c + V(0, yf * He, 0.058 * He), (0.03 * He, 0.03 * He, 0.03 * He), M('dark'))
    tl.box(a, c + V(0, yo * He, -0.062 * He), (0.032 * He, 0.032 * He, 0.03 * He), M('dark'))
    return {'fuel_out': c + V(0, yf * He, 0.07 * He), 'ox_out': c + V(0, yo * He, -0.075 * He),
            'top': c + V(0, 0.205 * He, 0), 'bottom': c, 'turb': c + V(0, (0.02 if not turbine_up else 0.185) * He, 0),
            'r': 0.06 * He, 'h': 0.205 * He}


def tp_pos(g, az=0.0, s=1.0):
    He = g['He']
    r = g['Rc'] + 0.085 * He * g['tp'] * s
    y0 = g['yC'] - (0.1 if g['vac'] else 0.02) * He
    return polar(az, r, y0)


def route(a, pts, r, m, seg=6, rad=None, n=1):
    tl.tube(a, tl.bend(pts, rad if rad is not None else r * 2.5, n), r, m, seg)


def inlets_to(a, g, ox_end, fu_end, m_fu=None):
    """Continue the two inlet ducts down to the pumps."""
    He = g['He']
    ip = inlet_points(g)
    r = 0.028 * He
    for key, end, m in (('ox', ox_end, M('steel')), ('fu', fu_end, m_fu or M('steel'))):
        p = ip[key]
        mid = V(p.x, max(end.y + 0.03 * He, p.y - 0.04 * He), p.z)
        route(a, [p, mid, V(end.x, mid.y, end.z), end], r, m, 8, n=2)


def discharge_ox(a, g, frm):
    """Oxygen pump discharge into the side of the oxygen dome."""
    He = g['He']
    to = polar(-60, g['Rc'] * 0.75, g['yH'] + 0.02 * He)
    route(a, [frm, frm + V(0, 0.0, -0.03 * He), V(to.x * 1.25, to.y, to.z * 1.25), to], 0.02 * He, M('steel'), 8)


def discharge_fuel(a, g, frm, side=0.0):
    """Fuel pump discharge down the side of the bell to the coolant inlet manifold at the skirt joint."""
    He = g['He']
    ys = g['ys'] + 0.012 * He
    rs = g['rs'] + 0.03 * He
    az = 22 + side
    end = polar(az, rs, ys)
    mid = polar(az, tl.bell_r_at(g['bell'], g['yT'] - (g['yT'] - 0.05 * He)) + 0.04 * He, g['yT'] - 0.05 * He)
    route(a, [frm, frm + V(0, -0.03 * He, 0.02 * He), V(mid.x, frm.y - 0.08 * He, mid.z), mid, end], 0.019 * He, M('steel'), 8)


def exhaust_duct(a, g, frm, az=0.0, r0=0.024, r1=0.034, y_end=0.1):
    """Turbine exhaust pipe down beside the bell, ending in a small flared outlet (Merlin, F-1 style)."""
    He = g['He']
    pts = [frm]
    for f in (0.0, 0.25, 0.5, 0.75, 1.0):
        y = lerp(frm.y - 0.04 * He, y_end * He, f)
        x = g['yT'] - y
        rb = tl.bell_r_at(g['bell'], max(0.0, x)) if y < g['yT'] else g['Rc']
        pts.append(polar(az, rb + (r1 + 0.012) * He, y))
    pts = tl.bend(pts, 0.05 * He, 1)
    radii = [lerp(r0, r1, k / (len(pts) - 1)) * He for k in range(len(pts))]
    tl.tube(a, pts, 0, M('dark'), 8, radii=radii)
    end = pts[-1]
    tl.lathe(a, [(r1 * He, 0), (r1 * 1.35 * He, -0.03 * He)], M('soot_steel'), 8, end + V(0, 0.001, 0))


def lerp(a, b, t):
    return a + (b - a) * t


# ------------------------------------------------------------------ slot_cycle variants
def cycle_gg(g, parent, name='slot_cycle', tapoff=False, sc=False):
    He, a = g['He'], Acc()
    c = tp_pos(g)
    t = tp_body(a, g, c)
    inlets_to(a, g, t['top'], t['fuel_out'] + V(0.0, 0.04 * He, 0.04 * He))
    discharge_ox(a, g, t['ox_out'])
    discharge_fuel(a, g, t['fuel_out'])
    if tapoff:
        # hot gas tapped from the chamber wall near the injector, to the turbine (BE-3)
        tap = polar(-20, g['Rc'] * 1.0, g['yI'] - 0.02 * He)
        route(a, [tap, polar(-20, g['Rc'] * 1.25, tap.y), polar(-20, g['Rc'] * 1.3, t['turb'].y + 0.02 * He), t['turb'] + V(-0.02 * He, 0.02 * He, -0.05 * He)], 0.013 * He, M('copper'), 8)
        tl.box(a, polar(-20, g['Rc'] * 1.3, (tap.y + t['turb'].y) / 2), (0.03 * He, 0.035 * He, 0.03 * He), M('dark'))
    else:
        # gas generator: a small combustor with its own injector dome, beside the turbine
        gc = c + V(0.075 * He * g['tp'], 0.0, 0.055 * He * g['tp'])
        tl.lathe(a, [(0.0, 0.0), (0.016 * He, 0.004 * He), (0.022 * He, 0.02 * He), (0.022 * He, 0.065 * He), (0.012 * He, 0.08 * He), (0.0, 0.084 * He)], M('stainless'), 12, gc)
        route(a, [gc + V(0, 0.01 * He, 0), gc + V(-0.03 * He, -0.005 * He, 0), t['turb'] + V(0.03 * He, 0, 0.02 * He)], 0.012 * He, M('steel'), 8)
        tl.box(a, gc + V(0, 0.095 * He, 0), (0.026 * He, 0.02 * He, 0.026 * He), M('dark'))  # GG valve
    exhaust_duct(a, g, t['bottom'] + V(0.01 * He, 0.01 * He, 0), az=4)
    a.emit(name, parent)


def preburner(a, g, base, h=0.075, r=0.03, m=None):
    He = g['He'] * g['tp']
    tl.lathe(a, [(0.0, 0), (r * 0.8 * He, 0.004 * He), (r * He, 0.016 * He), (r * He, h * He), (r * 0.6 * He, (h + 0.016) * He), (0.0, (h + 0.02) * He)], m or M('stainless'), 12, base)
    return base + V(0, (h + 0.02) * He, 0)


def hot_duct(a, g, frm, side_az, r=0.03):
    """A thick hot-gas duct from a turbine outlet into the top of the injector head (staged combustion)."""
    He = g['He']
    to = polar(side_az, g['Rc'] * 0.55, g['yD'] - 0.01 * He)
    route(a, [frm, frm + V(0, 0.035 * He, 0), V(to.x * 1.6, to.y + 0.01 * He, to.z * 1.6), to], r * He, M('inconel'), 8, 0.05 * He, n=2)


def cycle_sc(g, parent):
    """Oxidiser-rich staged combustion (RD-180, NK-33): one turbopump, a preburner on top of the turbine, the turbine
    exhaust ducted into the main injector: no exhaust pipe."""
    He, a = g['He'], Acc()
    c = tp_pos(g) + V(0, -0.03 * He, 0)
    t = tp_body(a, g, c, turbine_up=True)
    inlets_to(a, g, t['ox_out'] + V(0.0, 0.05 * He, -0.02 * He), t['fuel_out'] + V(0, 0.04 * He, 0.03 * He))
    pb = preburner(a, g, t['top'] + V(0, -0.005 * He, 0))
    hot_duct(a, g, t['top'] + V(-0.03 * He, -0.02 * He, 0), 0, r=0.034)
    discharge_fuel(a, g, t['fuel_out'])
    route(a, [t['ox_out'], t['ox_out'] + V(-0.02 * He, 0.0, -0.02 * He), pb + V(-0.01 * He, -0.01 * He, -0.02 * He)], 0.014 * He, M('steel'), 8)
    a.emit('slot_cycle__sc', parent)


def cycle_two(g, parent, name, rs25):
    """Two turbopumps on two shafts, each with its own preburner (RS-25: fuel-rich both, hot-gas manifold; Raptor
    full flow: one fuel-rich, one oxygen-rich, symmetric). No exhaust pipe."""
    He, a = g['He'], Acc()
    outs = []
    for k, az in enumerate((0, 180)):
        c = tp_pos(g, az, 0.95) + V(0, (-0.045 if rs25 else 0.0) * He, 0)
        t = tp_body(a, g, c, s=0.95, turbine_up=True)
        pb = preburner(a, g, t['top'] + V(0, -0.004 * He, 0), h=0.06 if rs25 else 0.085, r=0.032 if rs25 else 0.03,
                       m=M('stainless') if (rs25 or k == 0) else M('inconel'))
        hot_duct(a, g, pb + V(0, -0.012 * He, 0), az, r=0.03 if rs25 else 0.028)
        outs.append(t)
    ip = inlet_points(g)
    # fuel to the 0-degree pump, oxygen round the dome to the 180-degree pump
    route(a, [ip['fu'], ip['fu'] + V(0, -0.03 * He, 0), outs[0]['fuel_out'] + V(0, 0.05 * He, 0.03 * He)], 0.026 * He, M('steel'), 10)
    route(a, [ip['ox'], polar(90, 0.2 * He, ip['ox'].y - 0.02 * He), polar(150, 0.23 * He, ip['ox'].y - 0.03 * He), outs[1]['ox_out'] + V(0, 0.05 * He, 0)], 0.026 * He, M('steel'), 10)
    discharge_fuel(a, g, outs[0]['fuel_out'])
    if rs25:
        # the hot-gas manifold: the big structure the two turbines bolt to, round the main injector
        tl.lathe(a, [(g['Rc'] * 1.05, g['yI'] - 0.01 * He), (g['Rc'] * 1.32, g['yI'] + 0.005 * He), (g['Rc'] * 1.36, g['yH'] + 0.025 * He), (g['Rc'] * 0.9, g['yD'] - 0.005 * He)], M('inconel'), 20)
    a.emit(name, parent)


def cycle_expander(g, parent, bleed=False):
    """Expander (RL10) and expander bleed (LE-9): no gas generator; hydrogen warmed in the chamber jacket drives the
    turbine. A jacket outlet manifold near the injector, a loop to the turbine; the bleed version dumps the turbine
    exhaust through a small nozzle beside the bell."""
    He, a = g['He'], Acc()
    c = tp_pos(g, 0, 0.85) + V(0, 0.02 * He, 0)
    t = tp_body(a, g, c, s=0.85)
    inlets_to(a, g, t['top'], t['fuel_out'] + V(0, 0.04 * He, 0.03 * He))
    discharge_ox(a, g, t['ox_out'])
    discharge_fuel(a, g, t['fuel_out'])
    # jacket outlet manifold round the top of the chamber, its hot hydrogen to the turbine
    y = g['yI'] - 0.012 * He
    tl.torus(a, V(0, y, 0), g['Rc'] * 1.06, 0.011 * He, M('stainless'), 20, 6)
    route(a, [polar(-25, g['Rc'] * 1.06, y), polar(-25, g['Rc'] * 1.35, y - 0.01 * He), t['turb'] + V(-0.02 * He, 0, -0.04 * He)], 0.014 * He, M('stainless'), 8)
    if bleed:
        exhaust_duct(a, g, t['bottom'] + V(0.01 * He, 0.005 * He, 0), az=4, r0=0.015, r1=0.022, y_end=0.32)
    a.emit('slot_cycle__expander_bleed' if bleed else 'slot_cycle__expander', parent)


def cycle_electric(g, parent):
    """Electric pump-fed (Rutherford): two pumps each spun by its own motor, a battery cable, no turbine or exhaust."""
    He, a = g['He'], Acc()
    ip = inlet_points(g)
    for k, (az, key) in enumerate(((22, 'ox'), (-22, 'fu'))):
        c = polar(az, g['Rc'] + 0.07 * He, g['yC'] + 0.0 * He)
        # motor can (ribbed) under the pump volute
        tl.lathe(a, [(0.0, 0), (0.04 * He, 0), (0.042 * He, 0.006 * He), (0.042 * He, 0.07 * He), (0.03 * He, 0.075 * He)], M('black'), 12, c)
        tl.torus(a, c + V(0, 0.035 * He, 0), 0.043 * He, 0.004 * He, M('dark'), 12, 3)
        tl.lathe(a, [(0.03 * He, 0.075 * He), (0.05 * He, 0.085 * He), (0.05 * He, 0.11 * He), (0.025 * He, 0.12 * He), (0.022 * He, 0.14 * He)], M('steel'), 12, c)
        top = c + V(0, 0.14 * He, 0)
        route(a, [ip[key], V(ip[key].x, top.y + 0.04 * He, ip[key].z), top], 0.024 * He, M('steel'), 10)
        to = polar(az * 2.5, g['Rc'] * 0.7, g['yH'] + 0.015 * He)
        route(a, [c + V(0, 0.097 * He, 0), c + V(-0.05 * He, 0.1 * He, 0), to], 0.014 * He, M('steel'), 8)
    # inverter box and the battery cable bundle to the stage
    tl.box(a, polar(0, g['Rc'] + 0.06 * He, g['yT'] + 0.03 * He), (0.05 * He, 0.06 * He, 0.07 * He), M('dark'))
    route(a, [polar(0, g['Rc'] + 0.06 * He, g['yT'] + 0.06 * He), polar(0, g['Rc'] + 0.13 * He, g['yI']), polar(10, 0.22 * He, He - 0.01 * He)], 0.012 * He, M('cable'), 6)
    a.emit('slot_cycle__electric', parent)


def cycle_pressure(g, parent):
    """Pressure-fed (AJ10): no pump. Tank pressure pushes both propellants straight through two valves into the
    injector; a small pressurant line feeds the valve actuators."""
    He, a = g['He'], Acc()
    ip = inlet_points(g)
    for key, az in (('ox', 40), ('fu', -40)):
        v = polar(az, g['Rc'] * 1.25, g['yH'] + 0.03 * He)
        route(a, [ip[key], V(ip[key].x, v.y + 0.025 * He, ip[key].z), v + V(0, 0.025 * He, 0)], 0.026 * He, M('steel'), 10)
        tl.sphere(a, v, 0.03 * He, M('amber'), 12)                                  # ball valve body
        tl.box(a, v + polar(az, 0.03 * He), (0.03 * He, 0.03 * He, 0.03 * He), M('dark'))  # its actuator
        route(a, [v, v + V(0, -0.02 * He, 0), polar(az, g['Rc'] * 0.92, g['yH'] - 0.005 * He)], 0.02 * He, M('steel'), 8)
    route(a, [polar(0, g['Rc'] * 1.3, g['yH'] + 0.05 * He), polar(0, 0.2 * He, He - 0.05 * He), polar(0, 0.2 * He, He - 0.01 * He)], 0.006 * He, M('stainless'), 6)
    a.emit('slot_cycle__pressure', parent)


# ------------------------------------------------------------------ injector head (plain), slot_injector, slot_igniter, slot_stability
def injector_head(g, parent):
    """Injector head ring and oxygen dome: always shown (every injector sits under the same dome)."""
    He, Rc, a = g['He'], g['Rc'], Acc()
    tl.lathe(a, [(0.0, g['yI'] + 0.004 * He), (Rc * 1.06, g['yI'] + 0.004 * He), (Rc * 1.1, g['yI'] + 0.01 * He), (Rc * 1.1, g['yH']),
                 (Rc * 0.98, g['yH'] + 0.004 * He), (Rc * 0.8, g['yH'] + 0.03 * He), (Rc * 0.45, g['yD'] - 0.006 * He),
                 (0.0, g['yD'])], M('inconel'), 22)
    a.emit('injector_head', parent)


def injector(g, parent, kind):
    """The injector plate under the dome, its face toward the chamber (seen in the exploded view)."""
    He, Rc, a = g['He'], g['Rc'], Acc()
    y = g['yI']
    face = M('copper')
    tl.lathe(a, [(0.0, y - 0.004 * He), (Rc * 0.96, y - 0.004 * He), (Rc * 0.96, y + 0.004 * He), (0.0, y + 0.004 * He)], face, 20)
    y -= 0.004 * He
    if kind == 'pintle':
        tl.lathe(a, [(0.0, y - 0.06 * He), (0.012 * He, y - 0.06 * He), (0.014 * He, y - 0.05 * He), (0.016 * He, y - 0.01 * He), (0.03 * He, y - 0.003 * He), (0.03 * He, y)], M('steel'), 12)
    elif kind == 'impinging':
        for (fr, n) in ((0.35, 8), (0.72, 14)):
            for i in range(n):
                p = polar(360 * i / n, Rc * fr, y - 0.0006 * He)
                for s_ in (-1, 1):
                    q = p + polar(360 * i / n + 90, s_ * 0.009 * He)
                    tl.lathe(a, [(0.0045 * He, 0), (0.0, 0)], M('soot'), 6, q)
    else:
        for (fr, n) in ((0.34, 6), (0.7, 12)):
            for i in range(n):
                p = polar(360 * (i + 0.5 * (fr > 0.5)) / n, Rc * fr, y)
                if kind == 'coaxial':  # oxygen posts standing proud of the face, fuel annulus round each
                    tl.cyl(a, p, p + V(0, -0.012 * He, 0), 0.008 * He, M('steel'), 4, caps=True)
                else:  # swirl cups
                    tl.lathe(a, [(0.011 * He, 0), (0.011 * He, -0.008 * He), (0.005 * He, -0.008 * He)], M('steel'), 5, p)
    a.emit('slot_injector' if kind == 'coaxial' else f'slot_injector__{kind}', parent)


def igniter(g, parent, kind):
    He, Rc, a = g['He'], g['Rc'], Acc()
    az = 80
    if kind == 'spark':
        base = polar(az, Rc * 0.82, g['yH'] + 0.012 * He)
        tip = polar(az, Rc * 1.05, g['yH'] + 0.06 * He)
        tl.cyl(a, base, tip, 0.012 * He, M('stainless'), 10)
        tl.cyl(a, tip, tip + (tip - base).normalized() * 0.02 * He, 0.007 * He, M('rubber'), 8)
        route(a, [tip + (tip - base).normalized() * 0.02 * He, polar(az, 0.2 * He, He - 0.06 * He), polar(az - 8, 0.2 * He, He - 0.01 * He)], 0.0045 * He, M('cable'), 5)
        name = 'slot_igniter'
    elif kind == 'pyro':
        base = polar(az, Rc * 1.1, g['yI'] - 0.006 * He)
        tl.cyl(a, base, polar(az, Rc * 1.1 + 0.05 * He, g['yI'] + 0.012 * He), 0.016 * He, M('dark'), 10)
        tl.cyl(a, polar(az, Rc * 1.1 + 0.05 * He, g['yI'] + 0.012 * He), polar(az, Rc * 1.1 + 0.062 * He, g['yI'] + 0.016 * He), 0.011 * He, M('amber'), 10)
        route(a, [polar(az, Rc * 1.1 + 0.062 * He, g['yI'] + 0.016 * He), polar(az, 0.2 * He, He - 0.07 * He), polar(az - 8, 0.2 * He, He - 0.01 * He)], 0.0045 * He, M('cable'), 5)
        name = 'slot_igniter__pyro'
    elif kind == 'tea_teb':
        can = polar(az, Rc * 1.3, g['yD'] + 0.01 * He)
        tl.lathe(a, [(0.0, -0.025 * He), (0.018 * He, -0.022 * He), (0.02 * He, 0.0), (0.018 * He, 0.022 * He), (0.0, 0.025 * He)], M('stainless'), 12, can)
        route(a, [can + V(0, -0.025 * He, 0), can + V(0, -0.045 * He, 0), polar(az, Rc * 0.85, g['yH'] + 0.008 * He)], 0.006 * He, M('steel'), 6)
        tl.box(a, can + V(0, -0.045 * He, 0), (0.022 * He, 0.016 * He, 0.022 * He), M('dark'))
        name = 'slot_igniter__tea_teb'
    else:  # ampoule: start capsule housing in the fuel line, near the inlet
        ip = inlet_points(g)
        p = ip['fu'] + V(0, -0.04 * He, 0)
        tl.lathe(a, [(0.031 * He, -0.03 * He), (0.04 * He, -0.026 * He), (0.04 * He, 0.026 * He), (0.031 * He, 0.03 * He)], M('amber'), 14, p)
        tl.cyl(a, p + polar(-35, 0.04 * He), p + polar(-35, 0.065 * He), 0.012 * He, M('dark'), 8)
        name = 'slot_igniter__ampoule'
    a.emit(name, parent)


def stability(g, parent, kind):
    He, Rc, a = g['He'], g['Rc'], Acc()
    y = g['yI'] - 0.004 * He
    if kind == 'baffles':
        h = 0.035 * He
        for i in range(6):
            p0, p1 = polar(60 * i, Rc * 0.38, y), polar(60 * i, Rc * 0.93, y)
            tl.box(a, (p0 + p1) / 2 + V(0, -h / 2, 0), (Rc * 0.55, h, 0.004 * He), M('copper'), (polar(60 * i, 1.0), V(0, 1, 0), polar(60 * i + 90, 1.0)))
        tl.lathe(a, [(Rc * 0.38, y - h), (Rc * 0.38, y), (Rc * 0.40, y), (Rc * 0.40, y - h)], M('copper'), 20)
        name = 'slot_stability__baffles'
    elif kind == 'cavities':
        for i in range(10):
            p = polar(36 * i, Rc * 1.0, y - 0.012 * He)
            tl.box(a, p, (0.022 * He, 0.018 * He, 0.012 * He), M('soot'), (polar(36 * i, 1.0), V(0, 1, 0), polar(36 * i + 90, 1.0)))
        tl.lathe(a, [(Rc * 0.99, y - 0.024 * He), (Rc * 1.05, y - 0.024 * He), (Rc * 1.05, y), (Rc * 0.99, y)], M('copper'), 20)
        name = 'slot_stability__cavities'
    else:
        name = 'slot_stability'
    a.emit(name, parent)


# ------------------------------------------------------------------ slot_chamber
def chamber_prof(g, extra=0.0):
    """Throat to injector face, walking upward."""
    conv = g['conv']
    pts = [(r + extra, g['yT'] + x) for (r, x) in conv]
    pts.append((g['Rc'] + extra, g['yI']))
    return pts


def chamber(g, parent, kind):
    He, Rc, a = g['He'], g['Rc'], Acc()
    seg = 20
    prof = chamber_prof(g)
    rr = lambda y: next((r for (r, yy) in reversed(prof) if yy <= y), prof[0][0])  # noqa: E731
    if kind == 'ablative':
        thick = chamber_prof(g, 0.012 * He)
        tl.lathe(a, thick, M('ablative'), seg)
        for y in (g['yC'] + 0.012 * He, g['yI'] - 0.012 * He):
            tl.lathe(a, band_prof(lambda yy: Rc + 0.012 * He, y, 0.016 * He, 0.005 * He), M('steel'), seg)
        name = 'slot_chamber__ablative'
    else:
        mat = M('regen_tube') if kind == 'tubes' else M('copper')
        tl.lathe(a, prof, mat, seg, u_rep=8 if kind == 'tubes' else 1)
        # coolant manifolds: outlet at the top of the chamber, a band at the throat
        tl.torus(a, V(0, g['yI'] - 0.012 * He, 0), Rc + 0.008 * He, 0.011 * He, M('steel'), 16, 4)
        tl.torus(a, V(0, g['yT'] + 0.01 * He, 0), rr(g['yT'] + 0.01 * He) + 0.006 * He, 0.007 * He, M('steel'), 16, 3)
        if kind == 'tubes':
            for y in (g['yC'] + 0.01 * He, (g['yC'] + g['yI']) / 2):
                tl.lathe(a, band_prof(rr, y, 0.012 * He, 0.006 * He), M('steel'), seg)
        if kind == 'film':
            # film-cooling ring just below the injector, with its feed
            yf = g['yI'] - 0.035 * He
            tl.torus(a, V(0, yf, 0), Rc + 0.012 * He, 0.009 * He, M('stainless'), seg, 4)
            route(a, [polar(-60, Rc + 0.012 * He, yf), polar(-60, Rc + 0.05 * He, yf + 0.02 * He), polar(-60, Rc + 0.05 * He, g['yH'])], 0.007 * He, M('stainless'), 6)
        name = 'slot_chamber' if kind == 'channels' else f'slot_chamber__{kind}'
    a.emit(name, parent)


# ------------------------------------------------------------------ slot_contour
def bell_seg(g):
    return 28


def contour_bell(g, parent):
    """The regeneratively cooled bell from the throat to the skirt joint, with the sooty liner of the whole nozzle."""
    He, a = g['He'], Acc()
    seg = bell_seg(g)
    tl.lathe(a, bell_prof(g, 0.0, g['xs']), M('regen'), seg, u_rep=16)
    inner = [(r * 0.965, y) for (r, y) in bell_prof(g, 0.0, g['Lb'])]
    tl.lathe(a, inner[::2] + ([inner[-1]] if len(inner) % 2 == 0 else []), M('soot'), 16, flip=True)
    rb = lambda y: tl.bell_r_at(g['bell'], g['yT'] - y)  # noqa: E731
    for f in (0.3, 0.62):
        y = g['yT'] - g['xs'] * f
        tl.lathe(a, band_prof(rb, y, 0.012 * He, 0.006 * He), M('steel'), seg)
    # the skirt joint flange
    tl.lathe(a, [(g['rs'], g['ys'] - 0.004 * He), (g['rs'] + 0.012 * He, g['ys'] - 0.002 * He), (g['rs'] + 0.012 * He, g['ys'] + 0.012 * He), (rb(g['ys'] + 0.016 * He), g['ys'] + 0.016 * He)], M('steel'), seg)
    a.emit('slot_contour', parent)


def contour_conical(g, parent):
    """A straight conical nozzle (simple, a little less efficient than a bell) to the full exit: a whole nozzle."""
    He, a = g['He'], Acc()
    seg = bell_seg(g)
    Re, Rt, yT = g['Re'] * 0.97, g['Rt'], g['yT']
    x0 = 0.03 * He
    prof = [(Re, 0.0), (Rt * 1.18, yT - x0), (Rt * 1.03, yT - x0 * 0.4), (Rt, yT)]
    tl.lathe(a, prof, M('regen'), seg, u_rep=16)
    tl.lathe(a, [(r * 0.965, y) for (r, y) in prof], M('soot'), 18, flip=True)
    for f in (0.25, 0.55):
        y = (yT - x0) * f
        r = Re + (Rt * 1.18 - Re) * f
        tl.lathe(a, [(r + 0.0005, y - 0.006 * He), (r + 0.006 * He, y), (r + 0.0005, y + 0.006 * He)], M('steel'), seg)
    tl.torus(a, V(0, 0.008 * He, 0), Re + 0.006 * He, 0.01 * He, M('steel'), seg, 4)
    a.emit('slot_contour__conical', parent)['hides'] = 'nozzleExt'  # a whole nozzle: no bell skirt below it


def aerospike_parts(a, g, cells=10, seg=22, cell_seg=6, duct_seg=6, detail=True):
    """A toroidal aerospike under the injector head: four ducts from the head feed a ring manifold, a ring of small
    thrust cells fires down the outside of a truncated central plug, which hangs from a central post."""
    He = g['He']
    rr = 0.2 * He
    ym = g['yT'] - 0.02 * He
    yI = g['yI']
    tl.torus(a, V(0, ym, 0), rr, 0.022 * He, M('inconel'), 20 if detail else 14, 5 if detail else 4)
    for i in range(4):
        az = 45 + 90 * i
        route(a, [polar(az, g['Rc'] * 0.9, yI + 0.004 * He), polar(az, g['Rc'] * 1.25, yI - 0.04 * He), polar(az, rr * 0.95, ym + 0.05 * He), polar(az, rr, ym + 0.018 * He)], 0.016 * He, M('inconel'), duct_seg)
    tl.cyl(a, V(0, yI + 0.004 * He, 0), V(0, ym, 0), 0.05 * He, M('steel'), 12 if detail else 8, caps=False)  # the plug's post
    for i in range(cells):
        p = polar(360 * i / cells, rr + 0.006 * He, ym - 0.022 * He)
        tl.lathe(a, [(0.017 * He, -0.05 * He), (0.009 * He, -0.022 * He), (0.012 * He, 0.0)], M('copper'), cell_seg, p)
    prof = []
    for k in range(7 if detail else 5):
        t = k / (6 if detail else 4)
        y = lerp(ym - 0.03 * He, 0.03 * He, t)
        r = lerp(rr - 0.012 * He, 0.075 * He, 1 - (1 - t) ** 1.8)
        prof.append((r, y))
    prof = prof[::-1]
    tl.lathe(a, [(0.0, 0.0), (0.075 * He, 0.0)] + prof + [(rr * 0.6, ym), (0.0, ym)], M('regen'), seg, u_rep=11)
    if detail:
        y = lerp(0.03 * He, ym - 0.03 * He, 0.5)
        r = next(r for (r, yy) in prof if yy >= y)
        tl.torus(a, V(0, y, 0), r + 0.002 * He, 0.006 * He, M('steel'), 24, 3)


def contour_aerospike(g, parent):
    """A toroidal aerospike, fed straight from the injector head: it replaces the chamber and the whole bell."""
    a = Acc()
    aerospike_parts(a, g)
    a.emit('slot_contour__aerospike', parent)['hides'] = ['nozzleExt', 'chamber']


# ------------------------------------------------------------------ slot_nozzleExt
def ext(g, parent, kind):
    """The lower skirt from the joint to the exit (the sooty liner inside belongs to slot_contour)."""
    He, a = g['He'], Acc()
    seg = bell_seg(g)
    out = bell_prof(g, g['xs'], g['Lb'])
    rb = lambda y: tl.bell_r_at(g['bell'], g['yT'] - y)  # noqa: E731
    if kind == 'regen':
        tl.lathe(a, out, M('regen'), seg, u_rep=16)
        for f in (0.35, 0.7):
            y = g['ys'] * f
            tl.lathe(a, band_prof(rb, y, 0.012 * He, 0.006 * He), M('steel'), seg)
        tl.torus(a, V(0, 0.012 * He, 0), g['Re'] + 0.012 * He, 0.014 * He, M('steel'), seg, 4)  # coolant inlet manifold
        name = 'slot_nozzleExt'
    elif kind in ('radiative', 'carbon'):
        mat = M('niobium') if kind == 'radiative' else M('cc')
        tl.lathe(a, out, mat, seg)
        if kind == 'radiative':
            for f in (0.3, 0.62):
                tl.lathe(a, band_prof(rb, g['ys'] * f, 0.008 * He, 0.004 * He), M('niobium'), seg)
        tl.lathe(a, [(g['Re'] * 0.965, 0.0), (g['Re'] + 0.004 * He, 0.0), (g['Re'] + 0.004 * He, 0.008 * He), (rb(0.012 * He), 0.012 * He)], mat, seg)
        name = f'slot_nozzleExt__{kind}'
    elif kind == 'extendable':
        # a fixed upper skirt and a nested lower skirt, shown deployed (RL10B-2), on three screw jacks
        ysplit = g['ys'] * 0.45
        upper = [p for p in out if p[1] >= ysplit - 1e-6]
        if upper[0][1] > ysplit + 1e-6:
            upper.insert(0, (rb(ysplit), ysplit))
        tl.lathe(a, upper, M('cc'), seg)
        lower = [(r + 0.006 * He, y) for (r, y) in out if y <= ysplit + 0.02 * He]
        lower.append((rb(ysplit + 0.03 * He) + 0.006 * He, ysplit + 0.03 * He))
        tl.lathe(a, lower, M('cc'), seg)
        tl.torus(a, V(0, ysplit + 0.03 * He, 0), rb(ysplit + 0.03 * He) + 0.009 * He, 0.008 * He, M('titanium'), seg, 4)
        for i in range(3):
            top = polar(120 * i + 60, g['rs'] + 0.03 * He, g['ys'] - 0.01 * He)
            bot = polar(120 * i + 60, rb(ysplit + 0.03 * He) + 0.02 * He, ysplit + 0.03 * He)
            tl.cyl(a, top, bot, 0.006 * He, M('stainless'), 6, caps=False)
            tl.box(a, top, (0.022 * He, 0.03 * He, 0.022 * He), M('dark'))
        name = 'slot_nozzleExt__extendable'
    else:  # ablative: a thick charring skirt (RS-68)
        thick = [(r + 0.016 * He, y) for (r, y) in out]
        tl.lathe(a, thick, M('ablative'), seg)
        tl.lathe(a, [(g['Re'] * 0.965, 0.0), (g['Re'] + 0.016 * He, 0.0)], M('ablative'), seg)
        for f in (0.15, 0.5, 0.85):
            tl.lathe(a, band_prof(lambda yy: rb(yy) + 0.016 * He, g['ys'] * f, 0.014 * He, 0.004 * He), M('steel'), seg)
        name = 'slot_nozzleExt__ablative'
    a.emit(name, parent)


# ------------------------------------------------------------------ the whole engine
def build_engine(slug, size, vac=False):
    He = HEIGHT[size]
    g = geometry(He, vac)
    tl.reset()
    r = tl.root(slug)
    gimbal_block(g, r)
    actuators(g, r)
    ducts(g, r)
    cycle_gg(g, r)
    cycle_gg(g, r, name='slot_cycle__tapoff', tapoff=True)
    cycle_sc(g, r)
    cycle_two(g, r, 'slot_cycle__sc_fuel', rs25=True)
    cycle_two(g, r, 'slot_cycle__ffsc', rs25=False)
    cycle_expander(g, r)
    cycle_expander(g, r, bleed=True)
    cycle_electric(g, r)
    cycle_pressure(g, r)
    injector_head(g, r)
    for k in ('coaxial', 'swirl', 'pintle', 'impinging'):
        injector(g, r, k)
    for k in ('channels', 'tubes', 'film', 'ablative'):
        chamber(g, r, k)
    contour_bell(g, r)
    contour_conical(g, r)
    contour_aerospike(g, r)
    for k in ('regen', 'radiative', 'carbon', 'extendable', 'ablative'):
        ext(g, r, k)
    for k in ('spark', 'pyro', 'tea_teb', 'ampoule'):
        igniter(g, r, k)
    for k in ('none', 'baffles', 'cavities'):
        stability(g, r, k)
    return r, g


def build_lod(slug, size, kind='bell'):
    """Low-detail engine for clusters of more than nine (Super Heavy, N1): a closed-cycle look, no exhaust pipe, one
    mesh. kind: 'bell' (sea level), 'vac' (vacuum bell) or 'spike' (aerospike, no chamber)."""
    He = HEIGHT[size]
    g = geometry(He, kind == 'vac')
    tl.reset()
    r = tl.root(slug)
    a = Acc()
    if kind == 'spike':
        aerospike_parts(a, g, cells=8, seg=16, cell_seg=5, duct_seg=5, detail=False)
    else:
        out = bell_prof(g, 0.0, g['Lb'])[::2]
        if out[-1][1] < g['yT'] - 1e-6:
            out.append((g['Rt'], g['yT']))
        tl.lathe(a, out, M('regen'), 20, u_rep=8)
        tl.lathe(a, [(r_ * 0.95, y) for (r_, y) in out][::2] + [(g['Rt'] * 0.95, g['yT'])], M('soot'), 12, flip=True)
        tl.torus(a, V(0, 0.01 * He, 0), g['Re'] + 0.01 * He, 0.012 * He, M('steel'), 20, 4)
        tl.lathe(a, [(r_, y) for (r_, y) in chamber_prof(g)][::2] + [(g['Rc'], g['yI'])], M('copper'), 14)
    tl.lathe(a, [(g['Rc'] * 1.08, g['yI']), (g['Rc'] * 1.08, g['yH']), (g['Rc'] * 0.6, g['yD']), (0.05 * He, g['yG']), (0.07 * He, g['yG'] + 0.03 * He), (0.075 * He, He - 0.02 * He), (0.075 * He, He), (0.0, He)], M('inconel'), 14)
    for az, m in ((0, M('stainless')), (180, M('inconel'))):
        c = tp_pos(g, az, 0.95)
        tl.lathe(a, [(0.0, 0), (0.05 * He, 0.01 * He), (0.058 * He, 0.09 * He), (0.06 * He, 0.16 * He), (0.035 * He, 0.2 * He), (0.032 * He, 0.27 * He), (0.0, 0.28 * He)], m, 10, c)
        top = c + V(0, 0.27 * He, 0)
        tl.tube(a, tl.bend([top, top + V(0, 0.03 * He, 0), polar(az, g['Rc'] * 0.6, g['yD'] - 0.01 * He)], 0.04 * He, 2), 0.026 * He, M('inconel'), 6)
    for az in (135, 225):
        lo, hi = polar(az, g['Rc'] * 1.12, g['yH'] - 0.012 * He), polar(az, 0.25 * He, He - 0.045 * He)
        tl.cyl(a, hi, lo, 0.016 * He, M('steel'), 6)
    a.emit('engine_lod', r)
    return r, g


def preview(r, g, slug, shots):
    He = g['He']
    t = (0, He * 0.48, 0)
    d = He * 2.05
    combos = [
        ('default', {}),
        ('rs25', {'cycle': 'sc_fuel', 'chamber': 'tubes', 'injector': 'coaxial'}),
        ('raptor', {'cycle': 'ffsc', 'injector': 'swirl'}),
        ('rs68', {'cycle': 'gg', 'nozzleExt': 'ablative', 'chamber': 'ablative'}),
        ('rd180', {'cycle': 'sc', 'nozzleExt': 'radiative'}),
        ('rl10', {'cycle': 'expander', 'nozzleExt': 'extendable', 'igniter': 'spark'}),
        ('aerospike', {'contour': 'aerospike', 'nozzleExt': '__none__', 'chamber': '__none__', 'cycle': 'expander_bleed'}),
        ('electric', {'cycle': 'electric', 'contour': 'conical', 'nozzleExt': '__none__'}),
        ('pressure', {'cycle': 'pressure', 'nozzleExt': 'carbon', 'igniter': 'pyro'}),
    ]
    for name, keep in combos:
        tl.hide_except(r, keep)
        tl.look(os.path.join(shots, f'{slug}_{name}.png'), t, (d * 0.78, He * 0.62, d * 0.62))
    tl.hide_except(r, {})
    tl.look(os.path.join(shots, f'{slug}_side.png'), t, (0.0, He * 0.5, d * 1.05))
    tl.look(os.path.join(shots, f'{slug}_below.png'), (0, He * 0.3, 0), (d * 0.4, -He * 0.9, d * 0.5))
    tl.show_all(r)


def main():
    only = tl.C.arg('--only')
    shots = tl.shots_arg()
    jobs = []
    for size in ('s', 'm', 'l'):
        jobs += [(f'engine_{size}', size, 'full', False), (f'engine_{size}_vac', size, 'full', True)]
    # engine_s sits in clusters of 30 and 33 (N1, Super Heavy): low-detail copies for each nozzle look
    jobs += [('engine_s_lod', 's', 'lod', 'bell'), ('engine_s_lod_vac', 's', 'lod', 'vac'), ('engine_s_lod_spike', 's', 'lod', 'spike')]
    for slug, size, kind, vac in jobs:
        if only and slug not in only.split(','):
            continue
        if kind == 'lod':
            r, g = build_lod(slug, size, vac)
            tl.export(r, slug, height=HEIGHT[size], max_tris=2500)
        else:
            r, g = build_engine(slug, size, vac)
            tl.report_groups(r)
            tl.export(r, slug, height=HEIGHT[size])
        if shots:
            os.makedirs(shots, exist_ok=True)
            if kind == 'lod':
                tl.look(os.path.join(shots, f'{slug}.png'), (0, HEIGHT[size] * 0.48, 0), (HEIGHT[size] * 1.6, HEIGHT[size] * 0.6, HEIGHT[size] * 1.3))
            else:
                preview(r, g, slug, shots)


main()
