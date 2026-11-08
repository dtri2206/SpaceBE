"""The instrument panel above the commander's knees: displays, checklist buttons, FLIGHT MODE group, MASTER ALARM, wings of decorative switchgear."""
import math, random
import numpy as np
from mathutils import Vector, Matrix
from cc_core import *
import cc_core as C

PX = 1600                       # texture pixels per metre on the plate
PANEL_X = 0.15                  # the console is centred this far to the commander's right: in the Apollo hull the left wall closes in on the console's upper left corner, so a centred console sank into it
PANEL_C = Vector((PANEL_X, -0.20, -0.52))
BTN_A = [('hatch', '1 HATCH'), ('cabin', '2 CABIN'), ('o2', '3 O2'), ('arm', '4 ARM|ENGINE')]
BTN_B = [('fire', 'FIRE'), ('dump', 'DUMP'), ('rcs-a', 'RCS-A'), ('rcs-b', 'RCS-B'), ('main', 'MAIN'), ('apu', 'APU'),
         ('pwr', 'PWR'), ('comms', 'COMMS'), ('dock', 'DOCK'), ('para', 'PARA'), ('entry', 'ENTRY')]
WHITE = (0.82, 0.82, 0.8)
DIM = (0.55, 0.55, 0.53)


class PCtx:
    def __init__(self, ctx):
        self.ctx = ctx
        n = (-Vector((0.0, PANEL_C.y, PANEL_C.z))).normalized()       # the plane keeps its tilt about X only (no yaw), so the shift does not turn it
        v = Vector((0, n.z, -n.y)).normalized()
        self.n, self.v, self.x = n, v, Vector((1, 0, 0))
        self.R = Matrix(((1, v.x, n.x), (0, v.y, n.y), (0, v.z, n.z)))
        self.c = PANEL_C

    def W(self, u, v, z=0.0):
        return self.c + self.x * u + self.v * v + self.n * z


def part_at(P, name, u, v, z=0.0, parent='panel'):
    return Part(name, pos=P.W(u, v, z), rot=P.R, parent=parent)


# ------------------------------------------------------------------ textures
def draw_plate(style, rows):
    """Main plate canvas (u -0.46..0.46, v v_lo..0.27) with every printed label."""
    v_lo = rows['v_lo']
    W = int(0.92 * PX); H = int((0.27 - v_lo) * PX)
    base = {'analog': (0.045, 0.05, 0.045), 'glass': (0.028, 0.03, 0.036), 'minimal': (0.035, 0.037, 0.04)}[style]
    cv = Canvas(W, H, base)
    px = lambda u: (u + 0.46) * PX
    py = lambda v: (0.27 - v) * PX
    # panel seam lines
    cv.rect(0, 0, W, 3, (0.12, 0.12, 0.12)); cv.rect(0, H - 3, W, 3, (0.0, 0.0, 0.0))
    t = 0.0075 * PX
    def label(s, u, v, color=WHITE, size=t):
        lines = s.split('|')
        for i, ln in enumerate(lines):
            cv.mtext(ln, px(u), py(v) + i * size * 1.45, size, color)
    for (id_, txt), u in zip(BTN_A, rows['uA']):
        label(txt, u, rows['vA'] - 0.034)
    for (id_, txt), u in zip(BTN_B, rows['uB']):
        label(txt, u, rows['vB'] - 0.027)
    label('MASTER ALARM', rows['uAlarm'], rows['vA'] - 0.034, (1.0, 0.45, 0.4))
    # FLIGHT MODE group frame
    u0, u1 = rows['fm0'], rows['fm1']
    cv.outline(px(u0), py(rows['vA'] + 0.045), (u1 - u0) * PX, 0.125 * PX, (0.85, 0.6, 0.12), 2, r=6)
    label('FLIGHT MODE', (u0 + u1) / 2, rows['vA'] + 0.034, (0.95, 0.7, 0.2), t * 1.05)
    label('X ENGINE|CUT-OFF', rows['uCut'], rows['vA'] - 0.040, (1.0, 0.45, 0.4), t * 0.9)
    label('F MANUAL', rows['uAssist'], rows['vA'] - 0.040, (0.45, 0.9, 1.0))
    label('SPACE LOCK', rows['uRetro'], rows['vA'] - 0.040, (1.0, 0.78, 0.3))
    label('THROTTLE', rows['uTick'], rows['vTick'] + 0.014, DIM, t * 0.9)
    # display bezel recess outlines + titles
    for key, (u, v, w, h, title) in rows['displays'].items():
        cv.rect(px(u - w / 2 - 0.012), py(v + h / 2 + 0.012), (w + 0.024) * PX, (h + 0.024) * PX, (0.012, 0.012, 0.014), r=5)
        cv.outline(px(u - w / 2 - 0.012), py(v + h / 2 + 0.012), (w + 0.024) * PX, (h + 0.024) * PX, (0.2, 0.2, 0.2), 2, r=5)
        label(title, u, v + h / 2 + 0.024, DIM, t * 0.85)
    # divider lines
    cv.rect(px(-0.45), py(rows['vA'] - 0.058), 0.9 * PX, 2, (0.2, 0.2, 0.2))
    if style == 'analog':
        for u, txt in zip(rows['uT'], rows['tNames']):
            label(txt, u, rows['vT'] - 0.032, DIM, t * 0.85)
        for (u, v, k) in rows['gauges']:
            label(rows['gnames'][k % len(rows['gnames'])], u, v - 0.045, DIM, t * 0.7)
    return cv


def draw_gauge(seed):
    rng = random.Random(seed)
    S = 192
    cv = Canvas(S, S, (0.012, 0.012, 0.014))
    cx = cy = S / 2
    cv.disc(cx, cy, S * 0.46, (0.02, 0.02, 0.022))
    n = rng.choice([8, 10, 12])
    a0, a1 = math.radians(-140), math.radians(140)
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        r0 = S * 0.36; r1 = S * (0.43 if i % 2 == 0 else 0.40)
        cv.line(cx + math.sin(a) * r0, cy - math.cos(a) * r0, cx + math.sin(a) * r1, cy - math.cos(a) * r1, (0.85, 0.85, 0.8), 3 if i % 2 == 0 else 2)
    zone = rng.choice([(0.2, 0.85, 0.3), (0.95, 0.75, 0.15), (0.95, 0.3, 0.2)])
    for i in range(int(n * 0.75), n + 1):
        a = a0 + (a1 - a0) * i / n
        cv.disc(cx + math.sin(a) * S * 0.31, cy - math.cos(a) * S * 0.31, 4, zone)
    a = a0 + (a1 - a0) * rng.uniform(0.2, 0.75)
    cv.line(cx, cy, cx + math.sin(a) * S * 0.34, cy - math.cos(a) * S * 0.34, (0.95, 0.9, 0.8), 4)
    cv.disc(cx, cy, 8, (0.2, 0.2, 0.2))
    cv.mtext(rng.choice(['PSI', 'VOLT', 'AMP', 'TEMP', '%', 'x10']), cx, cy + S * 0.22, 15, (0.7, 0.7, 0.65))
    return cv


def draw_wing(style, seed, w_m, h_m):
    rng = random.Random(seed)
    W, H = int(w_m * PX), int(h_m * PX)
    base = {'analog': (0.045, 0.05, 0.045), 'glass': (0.028, 0.03, 0.036), 'minimal': (0.035, 0.037, 0.04)}[style]
    cv = Canvas(W, H, base)
    t = 0.0072 * PX
    names = ['SM RCS', 'CM RCS', 'PYRO', 'FUEL', 'O2 FAN', 'COOL', 'GLY', 'HTR', 'INV', 'BUS A', 'BUS B', 'LAMPS', 'ECS', 'SUIT', 'PUMP', 'VENT', 'TLM', 'RECORD', 'IMU', 'GDC', 'SCS', 'EMS', 'LOGIC', 'ARM']
    cols = 5
    rows_ = int(h_m / 0.095)
    for r in range(rows_):
        for c in range(cols):
            x = (0.07 + c * (w_m - 0.10) / (cols - 1)) * PX
            y = (0.05 + r * 0.095) * PX
            cv.mtext(rng.choice(names), x, y + 0.035 * PX, t, DIM)
    cv.rect(0, 0, W, 3, (0.12, 0.12, 0.12)); cv.rect(0, H - 3, W, 3, (0, 0, 0))
    return cv


# ------------------------------------------------------------------ geometry helpers on the panel
def toggle(pt, mat_base, mat_lever, u, v, lever_tilt=0.0):
    pt.cyl(mat_base, 0.0085, 0.008, u, v, 0.004, axis='z', n=8)
    pt.strut(mat_lever, (u, v, 0.006), (u + 0.0, v + 0.011 * math.sin(lever_tilt), 0.006 + 0.016 * math.cos(lever_tilt)), 0.0035, 0.0045, n=6)
    pt.sphere(mat_lever, 0.006, u, v + 0.012 * math.sin(lever_tilt), 0.006 + 0.016 * math.cos(lever_tilt), n=6, m=3)


def build(ctx, root, mats):
    p = ctx.p
    style = p['panel']
    P = PCtx(ctx)
    k = 1.0
    analog = style == 'analog'
    v_lo = -0.34 if analog else -0.26
    # --- rows (u, v positions in the panel frame)
    rows = dict(v_lo=v_lo)
    rows['vA'] = -0.095; rows['vB'] = -0.175
    rows['uA'] = [-0.405, -0.325, -0.245, -0.165]
    rows['uB'] = [-0.40 + i * 0.08 for i in range(11)]
    rows['uAlarm'] = -0.035
    rows['fm0'], rows['fm1'] = 0.075, 0.455
    rows['uCut'], rows['uAssist'], rows['uRetro'] = 0.145, 0.275, 0.385
    rows['uTick'], rows['vTick'] = -0.31, -0.012
    if analog:
        # the three displays and their bezels stand clear of each other (8 mm between bezels) and of the gauge columns
        disp = {'displayLeft': (-0.230, 0.150, 0.120, 0.120, 'LEFT'), 'centreDisplay': (0.0, 0.115, 0.260, 0.2097, 'TRAJECTORY'), 'displayRight': (0.230, 0.150, 0.120, 0.120, 'RIGHT')}
        rows['uT'] = [-0.405 + i * 0.0725 for i in range(12)]; rows['vT'] = -0.255
        rows['tNames'] = ['SM RCS', 'CM RCS', 'PYRO', 'FUEL', 'O2 FAN', 'COOL', 'HTR', 'INV', 'BUS A', 'BUS B', 'LAMPS', 'ECS']
        rows['gauges'] = [(u, v, i) for i, (u, v) in enumerate([(-0.343, 0.205), (-0.413, 0.205), (-0.343, 0.125), (-0.413, 0.125), (-0.343, 0.045), (-0.413, 0.045),
                                                              (0.343, 0.205), (0.413, 0.205), (0.343, 0.125), (0.413, 0.125), (0.343, 0.045), (0.413, 0.045)])]
        rows['gnames'] = ['CABIN P', 'O2 FLOW', 'BUS V', 'FUEL', 'BATT', 'TEMP']
    else:
        sz = 0.2
        disp = {'displayLeft': (-0.31, 0.145, sz, sz, 'PROPULSION'), 'centreDisplay': (0.0, 0.115, 0.36, 0.29, 'TRAJECTORY'), 'displayRight': (0.31, 0.145, sz, sz, 'ATTITUDE')}
        rows['gauges'] = []
    rows['displays'] = disp
    sg = (p['panel'] == 'minimal')
    # --- materials
    plate_cv = draw_plate(style, rows)
    wing_w, wing_h = 0.5, (0.27 - v_lo)
    wing_cv = draw_wing(style, 7, wing_w, wing_h)
    gauge_cv = [draw_gauge(s) for s in range(6)]
    SZ = 2048
    atlas = Canvas(SZ, SZ, (0, 0, 0))
    def blit(cv, x, y):
        atlas.col[y:y + cv.h, x:x + cv.w] = cv.col
    blit(plate_cv, 0, 0)
    wy = plate_cv.h + 8
    blit(wing_cv, 0, wy)
    gx = wing_cv.w + 16
    for i, g in enumerate(gauge_cv):
        blit(g, gx + (i % 3) * 200, wy + (i // 3) * 200)
    def uvr(x, y, w, h):
        return (x / SZ, 1 - (y + h) / SZ, (x + w) / SZ, 1 - y / SZ)
    uv_plate = uvr(0, 0, plate_cv.w, plate_cv.h)
    uv_wing = uvr(0, wy, wing_cv.w, wing_cv.h)
    uv_gauge = [uvr(gx + (i % 3) * 200, wy + (i // 3) * 200, 192, 192) for i in range(6)]
    # a flat swatch of the plate colour in the spare corner of the atlas: the Apollo closeouts reuse material 'plate' (same lighting as the console) with all UVs on it
    FX, FY, FS = 1500, 8, 32
    atlas.col[FY:FY + FS, FX:FX + FS] = plate_cv.col[plate_cv.h // 2, 10]
    ctx.flat_uv = ((FX + FS / 2) / SZ, 1 - (FY + FS / 2) / SZ)
    img = make_image('panel_atlas', atlas.col)
    material('plate', (1, 1, 1), 0.7, image=img)
    # emissive-looking lamps and displays
    material('disp', (0.0, 0.0, 0.0), 0.35, spec=0.04, emit=(0, 0, 0))
    material('capdark', (0.045, 0.045, 0.05), 0.45)
    material('capred', (0.5, 0.03, 0.02), 0.45)
    material('lampbase', (0.02, 0.02, 0.02), 0.5)
    lens_material('lens_off', (0.1, 0.13, 0.16), 0.0)
    material('guard', (0.45, 0.02, 0.02), 0.35, spec=0.6)
    material('guard_glass', (0.5, 0.02, 0.02), 0.2)
    material('cyancap', (0.02, 0.12, 0.14), 0.4)
    material('ambercap', (0.14, 0.09, 0.01), 0.4)
    material('alarm', (0.12, 0.012, 0.01), 0.3, emit=(1.0, 0.1, 0.08), emit_strength=0.0)
    material('tickoff', (0.015, 0.02, 0.022), 0.5)
    material('bezel', (0.02, 0.02, 0.022), 0.5, 0.4)
    material('chrome', (0.5, 0.5, 0.52), 0.25, 0.9)
    material('bat', (0.62, 0.62, 0.64), 0.6, spec=0.15)
    # --- node: panel
    panel = Part('panel', pos=P.c, rot=P.R, parent=root)
    top_v = 0.27
    pu = lambda u0, u1, v0, v1: ((u0 + u1) / 2, (v0 + v1) / 2, u1 - u0, v1 - v0)
    def slab(name, u0, u1, v0, v1, uv):
        uc, vc, w, h = pu(u0, u1, v0, v1)
        panel.box('bezel', w, h, 0.05, uc, vc, -0.025, bevel=0.006)
        panel.quad('plate', w, h, uc, vc, 0.0008, uvr=uv)
    slab('main', -0.46, 0.46, v_lo, top_v, uv_plate)
    # wings
    lat_ok = lambda u: _wing_ok(ctx, P, u)
    wings = []
    for sgn in (-1, 1):
        w_av = 0.0
        step = 0.04
        u = 0.46
        while w_av < 0.5 and lat_ok(sgn * (u + step)):
            u += step; w_av += step
        if w_av >= 0.12 and not sg:
            u0, u1 = (0.46, 0.46 + w_av) if sgn > 0 else (-0.46 - w_av, -0.46)
            frac = w_av / wing_w
            uvw = list(uv_wing)
            if sgn > 0:
                uvw[2] = uvw[0] + (uv_wing[2] - uv_wing[0]) * frac
            else:
                uvw[0] = uv_wing[2] - (uv_wing[2] - uv_wing[0]) * frac
            slab('wing%d' % sgn, u0, u1, v_lo, top_v, tuple(uvw))
            wings.append((sgn, u0, u1))
            # wing hardware: toggles on the printed rows, small gauges up top for analog craft
            rng = random.Random(3 + sgn)
            rws = int((0.27 - v_lo) / 0.095)
            for r in range(rws):
                for c in range(5):
                    uu = (0.07 + c * (wing_w - 0.10) / 4)
                    if uu > w_av - 0.03:
                        continue
                    ua = (0.46 + uu) if sgn > 0 else (-0.46 - uu)
                    vv = top_v - (0.05 + r * 0.095) - 0.012
                    if analog or r % 2 == 0:
                        toggle(panel, 'bat', 'bat', ua, vv, rng.choice([-0.5, 0.5]))
                    else:
                        panel.box('capdark', 0.03, 0.02, 0.01, ua, vv, 0.005, bevel=0.003)
                        panel.box('lens_off', 0.02, 0.004, 0.003, ua, vv + 0.013, 0.008, bevel=0)
    # --- displays (quad with 0..1 UVs, black placeholder; the runtime draws the pages)
    for key, (u, v, w, h, title) in disp.items():
        pd = part_at(P, key, u, v, 0.0065)                # the glass sits 3 mm behind the front of its bezel, 5.7 mm proud of the plate: never sunk into the wall
        pd.quad('disp', w, h, 0, 0, 0)
        panel.box('bezel', w + 0.022, h + 0.022, 0.005, u, v, 0.0015, bevel=0.001)               # backing: no plate showing around the glass
        panel.box('bezel', w + 0.022, 0.011, 0.010, u, v + h / 2 + 0.0055, 0.0045, bevel=0.002)
        panel.box('bezel', w + 0.022, 0.011, 0.010, u, v - h / 2 - 0.0055, 0.0045, bevel=0.002)
        panel.box('bezel', 0.011, h, 0.010, u - w / 2 - 0.0055, v, 0.0045, bevel=0.002)
        panel.box('bezel', 0.011, h, 0.010, u + w / 2 + 0.0055, v, 0.0045, bevel=0.002)
    # --- gauges (analog)
    for (u, v, kq) in rows['gauges']:
        pg = part_at(P, 'gauge%d_%d' % (int((u + 1) * 100), int((v + 1) * 100)), u, v, 0.002)
        pg.quad('plate', 0.058, 0.058, 0, 0, 0.0, uvr=uv_gauge[kq % 6])
        ring = [Vector((0.031 * math.cos(2 * math.pi * j / 20), 0.031 * math.sin(2 * math.pi * j / 20), 0.002)) for j in range(20)]
        pg.add('chrome', sweep(ring, circle_profile(0.003, 5), closed=True))
    # --- buttons
    btn_ids = []
    def make_button(id_, u, v, cw, ch, capmat='capdark'):
        b = part_at(P, 'btn:' + id_, u, v, 0.0)
        cap = Part('btnCap.' + id_, pos=b.pos, rot=b.rot, parent=b.name)
        lamp = Part('btnLamp.' + id_, pos=b.pos, rot=b.rot, parent=b.name)
        cap.box(capmat, cw, ch, 0.010, 0, 0, 0.011, bevel=0.003)
        lamp.box('lens_off', cw * 0.8, 0.0055, 0.003, 0, ch / 2 + 0.0075, 0.005, bevel=0)
        b.box('bezel', cw + 0.008, ch + 0.018, 0.007, 0, 0.003, 0.0035, bevel=0.002)
        btn_ids.append(id_)
    for (id_, t), u in zip(BTN_A, rows['uA']):
        make_button(id_, u, rows['vA'], 0.052, 0.030)
    for (id_, t), u in zip(BTN_B, rows['uB']):
        make_button(id_, u, rows['vB'], 0.040, 0.026)
    # MASTER ALARM lens
    al = part_at(P, 'alarmLamp', rows['uAlarm'], rows['vA'], 0.0)
    al.box('alarm', 0.115, 0.036, 0.011, 0, 0, 0.0075, bevel=0.005, segs=2)
    panel.box('bezel', 0.13, 0.05, 0.008, rows['uAlarm'], rows['vA'], 0.004, bevel=0.003)
    # throttle LED ticks
    for i in range(10):
        tk = part_at(P, 'tick.%d' % i, rows['uTick'] - 0.1 + i * 0.022, rows['vTick'], 0.0)
        tk.box('tickoff', 0.016, 0.014, 0.004, 0, 0, 0.003, bevel=0.0)
    # FLIGHT MODE: guarded cut-off, F MANUAL (cyan), SPACE LOCK (amber)
    vA = rows['vA']
    sw_u = rows['uCut']
    panel.box('bezel', 0.075, 0.062, 0.012, sw_u, vA, 0.004, bevel=0.004)
    sw = part_at(P, 'cutoffSwitch', sw_u, vA - 0.005, 0.010)
    sw.cyl('chrome', 0.011, 0.01, 0, 0, 0.0, axis='z', n=10)
    sw.strut('chrome', (0, 0, 0), (0, 0, 0.032), 0.0045, 0.0055, n=8)
    sw.sphere('capred', 0.0085, 0, 0, 0.034, n=8, m=4)
    gd = part_at(P, 'cutoffGuard', sw_u, vA + 0.027, 0.020)         # hinged along its top edge, hangs over the switch
    gd.box('guard', 0.062, 0.050, 0.004, 0, -0.025, 0.0, bevel=0.004)
    gd.box('guard', 0.062, 0.004, 0.026, 0, -0.050, -0.011, bevel=0.002)
    for sx in (-1, 1):
        gd.box('guard', 0.004, 0.050, 0.026, sx * 0.031, -0.025, -0.011, bevel=0.002)
    gd.cyl('steel', 0.003, 0.074, 0, 0.0, 0.0, axis='x', n=6)
    cl = part_at(P, 'cutoffLamp', sw_u, vA + 0.040, 0.004)
    cl.box('lens_off', 0.040, 0.008, 0.004, 0, 0, 0, bevel=0.0)
    ab = part_at(P, 'assistButton', rows['uAssist'], vA, 0.0)
    ac = Part('assistCap', pos=ab.pos, rot=ab.rot, parent=ab.name)
    ac.box('cyancap', 0.056, 0.036, 0.012, 0, 0, 0.011, bevel=0.004)
    ab.box('bezel', 0.066, 0.046, 0.008, 0, 0, 0.004, bevel=0.003)
    rb = part_at(P, 'retroButton', rows['uRetro'], vA, 0.0)
    rc = Part('retroCap', pos=rb.pos, rot=rb.rot, parent=rb.name)
    rc.box('ambercap', 0.056, 0.036, 0.012, 0, 0, 0.011, bevel=0.004)
    rb.box('bezel', 0.066, 0.046, 0.008, 0, 0, 0.004, bevel=0.003)
    # analog toggle bank
    if analog:
        rng = random.Random(11)
        for u in rows['uT']:
            toggle(panel, 'bat', 'bat', u, rows['vT'] + 0.004, rng.choice([-0.5, 0.5]))
    # glare shield on top and cheek plates so the console reads as a hood
    panel.box('bezel', 0.94, 0.03, 0.05, 0, top_v + 0.012, 0.016, bevel=0.006)
    # --- housing + brackets to the shell
    panel.box('bezel', 0.90, v_lo * -1 + top_v - 0.04, 0.14, 0, (top_v + v_lo) / 2, -0.12, bevel=0.01)
    ends = [-0.4, 0.4] + [w[1] if w[0] < 0 else w[2] for w in wings]
    for ue in ends:
        for vq in (v_lo + 0.05, top_v - 0.05):
            a = P.W(ue if abs(ue) < 0.5 else ue - (0.02 if ue > 0 else -0.02), vq, -0.1)
            b = _wall_hit(ctx, a, -P.n)
            panel.strut('steel', P.R.inverted() @ (a - P.c), P.R.inverted() @ (b - P.c), 0.016, n=6)
    ctx.panel_info = dict(btns=btn_ids, normal=P.n)


def _wing_ok(ctx, P, u):
    pw = ctx.cap_of_game(P.W(u, 0.0, 0.0))
    for vq in (-0.2, 0.0, 0.25):
        q = ctx.cap_of_game(P.W(u, vq, -0.08))
        if math.hypot(q.x, q.y) > ctx.rin(q.z) - 0.08 or q.z > ctx.H - 0.1:
            return False
    return True


def _wall_hit(ctx, a, d):
    """Walk from a (game) along d until the cabin wall (inner skin) is reached; returns a point a few mm inside the wall."""
    d = Vector(d).normalized()
    for i in range(1, 160):
        q = a + d * (0.01 * i)
        c = ctx.cap_of_game(q)
        if math.hypot(c.x, c.y) >= ctx.rin(c.z) - 0.005 or c.z > ctx.H - 0.02 or c.z < 0.04:
            return a + d * (0.01 * i + 0.03)
    return a + d * 1.0
