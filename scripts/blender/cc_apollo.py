"""Apollo Command Module interior dressing for capsuleCockpit.py (only used for --type apollo).

Everything is authored in GAME coordinates (eye = origin, -Z toward the apex) on the identity-posed Part 'apollo_*', so Part-local == world.
Wall furniture is placed on the cone with wall_frame(): local x = the viewer's right, y = up the slanted wall, z = out of the wall into the cabin.

  textures  : wall paint (cylindrical UVs on the shell), MDC panels 2 and 3, bay panels (optics, IMU, DSKYs, valves, breakers), locker doors, Beta cloth
  geometry  : MDC sections 2 + 3 (toggle banks with guards, DSKY, caution and warning matrix), lower equipment bay (eyepieces, optics, IMU, DSKY),
              locker walls, side bays (valves, hoses, breaker panels), Velcro strips, cable bundles with clamps, tunnel probe, couch tube frames, straps
"""
import math, random
import numpy as np
from mathutils import Vector, Matrix
from cc_core import *
import cc_core as C

# ----------------------------------------------------------------------------------------------- frames
class F:
    """Local frame in game coordinates: columns x, y, z."""
    def __init__(self, o, x, y, z):
        self.o = Vector(o)
        self.x, self.y, self.z = Vector(x).normalized(), Vector(y).normalized(), Vector(z).normalized()
        self.M = Matrix(((self.x.x, self.y.x, self.z.x), (self.x.y, self.y.y, self.z.y), (self.x.z, self.y.z, self.z.z)))
    def p(self, x=0.0, y=0.0, z=0.0):
        return self.o + self.M @ Vector((x, y, z))


class Dress:
    """Geometry accumulator that places primitives in a frame F."""
    def __init__(self, name, parent, ctx):
        self.part = Part(name, parent=parent)
        self.ctx = ctx
        self.tris0 = 0

    def box(self, mat, fr, w, h, d, x=0, y=0, z=0, bevel=0.0, segs=1, rz=0.0, rx=0.0):
        geo = box_geo(w, h, d)
        if bevel:
            geo = finish(*geo, min(bevel, min(w, h, d) * 0.45), segs)
        M = fr.M @ Rx(rx) @ Rz(rz)
        self.part.add(mat, xform(geo, M, fr.p(x, y, z)))

    def quad(self, mat, fr, w, h, x=0, y=0, z=0, uvr=(0, 0, 1, 1)):
        v = [(-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0)]
        u0, v0, u1, v1 = uvr
        self.part.add(mat, xform((v, [(0, 1, 2, 3)]), fr.M, fr.p(x, y, z)), [[(u0, v0), (u1, v0), (u1, v1), (u0, v1)]])

    def strut(self, mat, a, b, r, r1=None, n=8):
        self.part.strut(mat, Vector(a), Vector(b), r, r1, n)

    def sstrut(self, mat, fr, a, b, r, r1=None, n=8):
        self.part.strut(mat, fr.p(*a), fr.p(*b), r, r1, n)

    def cyl(self, mat, fr, r, h, x, y, z, axis='z', n=8, r1=None):
        c = Vector((x, y, z))
        d = {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}[axis]
        self.part.strut(mat, fr.p(*(c - d * h / 2)), fr.p(*(c + d * h / 2)), r, r1, n)

    def ring(self, mat, fr, r, tube, x, y, z, n=18, tn=5, axis='z'):
        pts = []
        for i in range(n):
            a = 2 * math.pi * i / n
            if axis == 'z':
                pts.append(fr.p(x + r * math.cos(a), y + r * math.sin(a), z))
            elif axis == 'y':
                pts.append(fr.p(x + r * math.cos(a), y, z + r * math.sin(a)))
            else:
                pts.append(fr.p(x, y + r * math.cos(a), z + r * math.sin(a)))
        self.part.add(mat, sweep(pts, circle_profile(tube, tn), closed=True))

    def tube(self, mat, pts, r, n=5, per=3):
        self.part.add(mat, sweep(catmull([Vector(p) for p in pts], per), circle_profile(r, n), closed=False, caps=True))


def wall_frame(ctx, th_deg, z, lift=0.0):
    """Frame on the inner skin of the cone at azimuth th_deg (capsule frame), height z (capsule frame)."""
    th = math.radians(th_deg)
    r = ctx.rin(z)
    dr = (ctx.rin(z + 0.04) - ctx.rin(z - 0.04)) / 0.08
    rad = Vector((math.cos(th), math.sin(th), 0)); tt = Vector((-math.sin(th), math.cos(th), 0))
    tz = Vector((dr * rad.x, dr * rad.y, 1)).normalized()
    nc = tt.cross(tz)
    if nc.dot(rad) > 0:
        nc = -nc
    pc = Vector((r * rad.x, r * rad.y, z)) + nc * lift
    Y = ctx.gv(tz); N = ctx.gv(nc); X = Y.cross(N)
    return F(ctx.g(pc), X, Y, N)


def dth(ctx, z, s):
    """Azimuth step (deg) for an arc length s on the wall at height z."""
    return math.degrees(s / ctx.rin(z))


def dz_of(ctx, z, ds):
    dr = (ctx.rin(z + 0.04) - ctx.rin(z - 0.04)) / 0.08
    return ds / math.sqrt(1 + dr * dr)


# ----------------------------------------------------------------------------------------------- textures
BEIGE = (0.66, 0.61, 0.50)
GREY = (0.46, 0.47, 0.46)
WHITE = (0.93, 0.93, 0.89)
INK = (0.08, 0.08, 0.08)


def noise(rng, h, w, amp, cell=8):
    a = rng.normal(0, 1, (h // cell + 2, w // cell + 2))
    a = np.kron(a, np.ones((cell, cell)))[:h, :w]
    return a * amp


def wall_tex(seed=1):
    rng = np.random.default_rng(seed)
    W, H = 2048, 1024
    a = np.ones((H, W, 3)) * np.array(BEIGE)
    a += noise(rng, H, W, 0.012, 4)[..., None] + noise(rng, H, W, 0.015, 48)[..., None]
    a += rng.normal(0, 0.006, (H, W, 1))
    seam = (0.52, 0.48, 0.38)
    for i in range(48):                               # panel seams every 7.5 deg
        x = int(i * W / 48)
        a[:, x:x + 2] = seam
        for y in range(6, H, 22):
            a[y:y + 3, x - 1:x + 3] = (0.35, 0.33, 0.28)    # rivets
    for zc in np.arange(0.3, 2.8, 0.3):                 # horizontal stiffener bands
        y = int((1 - zc / 2.8) * H)
        a[y:y + 3, :] = seam
        a[y + 3:y + 4, :] = (0.92, 0.88, 0.76)
    # Velcro patches (25 x 75 mm): rows of dark strips
    for zc in (0.2, 0.62, 1.0, 1.4, 1.75, 2.05):
        y0 = int((1 - zc / 2.8) * H)
        for k in range(0, 48, 3):
            x0 = int((k + 1.2) * W / 48)
            for dx in (0, 14):
                a[y0 - 10:y0 + 10, x0 + dx:x0 + dx + 5] = (0.30, 0.30, 0.31)
    # scuffs
    for _ in range(140):
        x, y = rng.integers(0, W - 80), rng.integers(0, H - 8)
        ln = rng.integers(20, 80)
        a[y:y + 2, x:x + ln] *= 0.9
    return np.clip(a, 0, 1)


def tex_cloth(seed=2):
    rng = np.random.default_rng(seed)
    S = 512
    a = np.ones((S, S, 3)) * np.array((0.74, 0.73, 0.68))
    a[::4, :] *= 0.965
    a[:, ::4] *= 0.965
    a += noise(rng, S, S, 0.012, 16)[..., None]
    a[::128, :] = (0.7, 0.68, 0.62)      # stitch lines
    a[:, ::128] = (0.7, 0.68, 0.62)
    return np.clip(a, 0, 1)


LOCKER_NAMES = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'FOOD', 'U2', 'WASTE', 'LiOH', 'CAMERA', 'SUIT']
LOCKER_LINES = {'FOOD': ['RATION PKT', 'MEAL 3 / DAY 2'], 'WASTE': ['FECAL BAGS', 'DO NOT OPEN'], 'LiOH': ['CO2 CANISTER', 'REPLACE 24 HR'], 'CAMERA': ['16MM MAGAZINE', 'LENS 18MM'],
                'SUIT': ['SUIT DONNING', 'KIT'], 'U2': ['URINE', 'XFER HOSE']}
TILE_M = 0.30      # one 512 px locker tile covers 0.30 x 0.30 m (a door shows the centre of it at true scale)


def tex_lockers(seed=3):
    ppm = 512 / TILE_M
    cv = Canvas(2048, 2048, BEIGE)
    rng = random.Random(seed)
    for i, nm in enumerate(LOCKER_NAMES):
        x0, y0 = (i % 4) * 512, (i // 4) * 512
        bagc = i in (10, 12, 13, 15)
        base = (0.80, 0.79, 0.74) if bagc else [(0.66, 0.61, 0.50), (0.62, 0.58, 0.49), (0.52, 0.52, 0.50)][i % 3]
        cv.rect(x0, y0, 512, 512, base)
        cx, cy = x0 + 256, y0 + 256
        if bagc:
            for k in (-1, 1):
                cv.rect(cx + k * 0.075 * ppm - 0.0125 * ppm, cy + 0.04 * ppm, 0.025 * ppm, 0.075 * ppm, (0.28, 0.28, 0.3))     # Velcro 25 x 75 mm
        else:
            cv.rect(cx + 0.04 * ppm, cy + 0.045 * ppm, 0.06 * ppm, 0.02 * ppm, (0.45, 0.45, 0.47), r=3)                          # latch recess
        # one small placard in the upper left: id 25 mm, two lines 12 mm
        px0, py0 = cx - 0.12 * ppm, cy - 0.085 * ppm
        cv.rect(px0, py0, 0.11 * ppm, 0.045 * ppm, (0.92, 0.92, 0.88))
        cv.mtext(nm, px0 + 0.015 * ppm + (0.0125 * ppm if len(nm) < 3 else 0.03 * ppm), py0 + 0.0125 * ppm, 0.0095 * ppm if len(nm) > 3 else 0.019 * ppm, INK, align='c')
        for ln, t in enumerate(LOCKER_LINES.get(nm, ['STOW', 'CHECK ' + nm])):
            cv.mtext(t, px0 + 0.055 * ppm, py0 + (0.026 + ln * 0.0075) * ppm, 0.0045 * ppm, INK)
        cv.rect(cx - 0.12 * ppm, cy - 0.025 * ppm, 0.24 * ppm, 2, tuple(c * 0.6 for c in base))
    return cv.col


def draw_gauge_px(cv, cx, cy, r, rng):
    cv.disc(cx, cy, r, (0.03, 0.03, 0.03))
    cv.disc(cx, cy, r * 0.9, (0.07, 0.07, 0.07))
    n = rng.choice([8, 10, 12])
    a0, a1 = math.radians(-135), math.radians(135)
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        r0, r1 = r * 0.62, r * (0.82 if i % 2 == 0 else 0.74)
        cv.line(cx + math.sin(a) * r0, cy - math.cos(a) * r0, cx + math.sin(a) * r1, cy - math.cos(a) * r1, WHITE, max(1, r // 14))
    a = a0 + (a1 - a0) * rng.uniform(0.2, 0.8)
    cv.line(cx, cy, cx + math.sin(a) * r * 0.7, cy - math.cos(a) * r * 0.7, (0.95, 0.9, 0.8), max(2, r // 10))
    cv.disc(cx, cy, max(2, r // 7), (0.3, 0.3, 0.3))


def draw_talk(cv, cx, cy, r, rng):
    cv.disc(cx, cy, r, (0.03, 0.03, 0.03))
    if rng.random() < 0.5:     # barber pole
        cv.disc(cx, cy, r * 0.8, (0.88, 0.88, 0.85))
        for k in range(-3, 4):
            cv.line(cx + k * r * 0.5 - r * 0.7, cy - r * 0.7, cx + k * r * 0.5 + r * 0.7, cy + r * 0.7, (0.1, 0.1, 0.1), max(2, r // 3))
        cv.ring(cx, cy, r * 0.97, (0.03, 0.03, 0.03), max(2, r // 4))
    else:
        cv.disc(cx, cy, r * 0.8, (0.13, 0.13, 0.14))
        cv.mtext(rng.choice(['0', 'X', 'GO']), cx, cy, r * 0.8, (0.7, 0.7, 0.68))


LEGENDS = ['SPS HE', 'SPS PRESS', 'RCS CMD', 'CM RCS', 'SEQ EVENT', 'TLM', 'CMC MODE', 'SCS TVC', 'EMS MODE', 'LV SPS', 'SCS ELEC', 'GDC', 'ECA', 'UP TLM',
           'SIG COND', 'BMAG', 'FDAI', 'ISOL', 'LOGIC 1', 'LOGIC 2', 'PYRO ARM', 'MAIN DEP', 'DROGUE', 'CSM LV', 'CANARD', 'LES', 'APEX CVR', 'DUMP', 'PRPLNT',
           'H2 HTR', 'O2 FAN', 'BAT CHGR', 'INV 1', 'INV 2', 'AC BUS', 'FC 1', 'FC 2', 'FC 3', 'PUMPS', 'GLY EVAP', 'SUIT', 'CAB FAN', 'WASTE', 'VHF AM',
           'S-BD', 'PWR AMP', 'PCM', 'TV', 'PRE MOD', 'HGA', 'TAPE', 'O2 SURGE', 'RAD', 'SECS', 'ELS', 'ASC', 'PRIM', 'AUTO', 'MAN', 'NORM']
CW_NAMES = ['CMC', 'ISS', 'SPS', 'RCS', 'GMBL', 'PRE AMP', 'FC BUS', 'CO2', 'O2 FLOW', 'H2O', 'SUIT', 'CABIN', 'AC 1', 'AC 2', 'UP TLM', 'CREW', 'BMAG', 'LV', 'TEMP', 'PGNS',
            'MAIN', 'DROGUE', 'GLYCOL', 'OXID', 'INV', 'BUS A', 'BUS B', 'FUEL', 'LAMP', 'STBY']


class Layout:
    """Collects toggles and knobs while a panel texture is drawn. u, v in metres from the panel centre."""
    def __init__(self, W_m, H_m, ppm, base, seed):
        self.W_m, self.H_m, self.ppm = W_m, H_m, ppm
        self.cv = Canvas(int(W_m * ppm), int(H_m * ppm), base)
        rng = np.random.default_rng(seed)
        self.cv.col += noise(rng, self.cv.h, self.cv.w, 0.008, 6)[..., None]
        self.r = random.Random(seed)
        self.items = []          # (kind, u, v)
        self.top = H_m / 2

    def px(self, u): return (u + self.W_m / 2) * self.ppm
    def py(self, v): return (self.H_m / 2 - v) * self.ppm
    def label(self, s, u, v, size=0.0046, color=WHITE):
        self.cv.mtext(s, self.px(u), self.py(v), size * self.ppm, color)
    def frame(self, u0, u1, v0, v1, title=None):
        t = 2
        self.cv.outline(self.px(u0), self.py(v1), (u1 - u0) * self.ppm, (v1 - v0) * self.ppm, WHITE, t)
        if title:
            self.label(title, (u0 + u1) / 2, v1 - 0.007, 0.0052)
    def toggles(self, u0, v_top, cols, rows, dx=0.036, dy=0.05, title=None, names=None, kind='tog', guard=0.6):
        r = self.r
        if title:
            self.frame(u0 - 0.014, u0 + (cols - 1) * dx + 0.014, v_top - 0.014 - (rows - 1) * dy - 0.034, v_top + 0.014 + 0.012, title)
        for j in range(rows):
            for i in range(cols):
                u, v = u0 + i * dx, v_top - j * dy
                nm = (names[(j * cols + i) % len(names)] if names else r.choice(LEGENDS))
                self.label(nm, u, v - 0.0245, 0.0039)
                if r.random() < 0.18 and kind == 'tog':
                    self.items.append(('knob', u, v)); self.cv.ring(self.px(u), self.py(v), 0.0105 * self.ppm, WHITE, 2)
                else:
                    self.items.append((kind, u, v if kind != 'tog' else v))
                    self.cv.rect(self.px(u) - 0.012 * self.ppm, self.py(v) - 0.012 * self.ppm, 0.024 * self.ppm, 0.024 * self.ppm, (0.38, 0.39, 0.38), r=3)
    def talkbacks(self, u0, v, n, dx=0.03, title=None):
        for i in range(n):
            draw_talk(self.cv, self.px(u0 + i * dx), self.py(v), 0.0105 * self.ppm, self.r)
            self.label(self.r.choice(LEGENDS), u0 + i * dx, v - 0.019, 0.0036)
    def gauges(self, cells, r_m=0.026):
        for (u, v) in cells:
            draw_gauge_px(self.cv, self.px(u), self.py(v), r_m * self.ppm, self.r)
            self.items.append(('bezel', u, v, r_m))
            self.label(self.r.choice(['PSI', 'VOLT', 'AMP', 'TEMP', 'x10', '%', 'FLOW', 'QTY']), u, v - r_m - 0.011, 0.004)
    def cw_matrix(self, u0, v_top, cols, rows, dx=0.031, dy=0.021):
        for j in range(rows):
            for i in range(cols):
                u, v = u0 + i * dx, v_top - j * dy
                x, y = self.px(u) - 0.0135 * self.ppm, self.py(v) - 0.0085 * self.ppm
                lit = self.r.random() < 0.06
                self.cv.rect(x, y, 0.027 * self.ppm, 0.017 * self.ppm, (0.9, 0.62, 0.2) if lit else (0.64, 0.63, 0.58), r=2)
                self.cv.outline(x, y, 0.027 * self.ppm, 0.017 * self.ppm, (0.05, 0.05, 0.05), 2, r=2)
                self.label(self.r.choice(CW_NAMES), u, v, 0.0036, INK)
    def tape_meters(self, cells):
        for (u, v) in cells:
            x, y, w, h = self.px(u) - 0.008 * self.ppm, self.py(v) - 0.04 * self.ppm, 0.016 * self.ppm, 0.08 * self.ppm
            self.cv.rect(x, y, w, h, (0.04, 0.04, 0.04))
            for k in range(11):
                self.cv.rect(x + w * 0.5, y + 4 + k * (h - 8) / 10, w * 0.4, 2, WHITE)
            self.cv.rect(x + 1, y + h * self.r.uniform(0.2, 0.8), w - 2, 4, (0.9, 0.2, 0.15))
    def hline(self, u0, u1, v):
        self.cv.rect(self.px(u0), self.py(v), (u1 - u0) * self.ppm, 2, WHITE)


def build_mdc_tex(which):
    """MDC panel 2 (centre: propulsion, RCS, sequence, DSKY) or 3 (right: electrical, environmental, comms). 0.5 x 0.61 m."""
    ly = Layout(0.50, 0.61, 2048, GREY, 20 + which)
    H = ly.H_m / 2
    ly.cv.rect(0, 0, ly.cv.w, 3, (0.22, 0.22, 0.22))
    if which == 2:
        ly.frame(-0.235, 0.0, 0.215, 0.283, 'CAUTION AND WARNING')
        ly.cw_matrix(-0.2175, 0.263, 7, 3)
        ly.frame(0.015, 0.235, 0.215, 0.283, 'EVENT')
        ly.talkbacks(0.04, 0.256, 8, dx=0.0255)
        ly.toggles(-0.215, 0.185, 5, 2, dx=0.037, dy=0.054, title='SEQUENCE')
        ly.frame(0.03, 0.235, 0.0, 0.206)               # DSKY seat outline
        ly.label('DSKY', 0.1325, 0.198, 0.0055)
        ly.toggles(-0.215, 0.055, 6, 2, dx=0.036, dy=0.054, title='PROPULSION')
        ly.toggles(-0.215, -0.07, 6, 3, dx=0.036, dy=0.052, title='RCS')
        ly.gauges([(0.07, -0.06), (0.14, -0.06), (0.21, -0.06)])
        ly.toggles(0.04, -0.13, 5, 2, dx=0.039, dy=0.052, title='TVC')
        ly.toggles(-0.215, -0.235, 6, 2, dx=0.036, dy=0.05, title='SCS')
        ly.toggles(0.015, -0.235, 6, 2, dx=0.036, dy=0.05, title='LOGIC')
    else:
        ly.gauges([(-0.19 + 0.075 * i, 0.245) for i in range(6)], 0.024)
        ly.tape_meters([(-0.2 + 0.05 * i, 0.15) for i in range(9)])
        ly.frame(-0.235, 0.235, 0.098, 0.197, 'ELECTRICAL POWER')
        ly.talkbacks(-0.2, 0.162, 10, dx=0.0446)
        ly.hline(-0.235, 0.235, 0.13)
        ly.toggles(-0.215, 0.075, 6, 2, dx=0.036, dy=0.052, title='DC / AC')
        ly.toggles(0.015, 0.075, 6, 2, dx=0.036, dy=0.052, title='FUEL CELL')
        ly.toggles(-0.215, -0.07, 6, 3, dx=0.036, dy=0.052, title='ENVIRONMENTAL')
        ly.gauges([(0.07, -0.04), (0.14, -0.04), (0.21, -0.04)])
        ly.toggles(0.015, -0.1, 6, 2, dx=0.036, dy=0.052, title='COMMUNICATIONS')
        ly.toggles(-0.215, -0.235, 6, 2, dx=0.036, dy=0.05, title='SUIT')
        ly.toggles(0.015, -0.235, 6, 2, dx=0.036, dy=0.05, title='LIGHTS')
    return ly


BAY_H = 1536


def build_bay_tex():
    """Atlas of the bay panels. Returns (canvas, {name: (x, y, w, h) px}, ppm)."""
    ppm = 1300
    tiles = {
        'optics': (0.34, 0.24), 'imu': (0.34, 0.26), 'dsky_disp': (0.13, 0.065), 'dsky_keys': (0.13, 0.14), 'env': (0.46, 0.50), 'breaker': (0.42, 0.52),
        'power': (0.44, 0.40), 'waste': (0.40, 0.34), 'optctl': (0.30, 0.26),
    }
    atlas = Canvas(2048, BAY_H, GREY)
    pos = {}
    x, y, rowh = 0, 0, 0
    for nm, (w, h) in tiles.items():
        pw, ph = int(w * ppm), int(h * ppm)
        if x + pw > 2048:
            x, y, rowh = 0, y + rowh + 4, 0
        pos[nm] = (x, y, pw, ph)
        x += pw + 4; rowh = max(rowh, ph)
    items = {}
    def lay(nm, seed):
        x0, y0, pw, ph = pos[nm]
        ly = Layout(tiles[nm][0], tiles[nm][1], ppm, GREY, seed)
        return ly
    def put(nm, ly):
        x0, y0, pw, ph = pos[nm]
        atlas.col[y0:y0 + ph, x0:x0 + pw] = ly.cv.col[:ph, :pw]
        items[nm] = ly.items
    # optics station (sextant + scanning telescope panel)
    ly = lay('optics', 31); ly.label('SEXTANT', -0.085, 0.10, 0.0075); ly.label('SCANNING TELESCOPE', 0.07, 0.10, 0.0055)
    ly.frame(-0.16, 0.16, -0.115, 0.115)
    ly.toggles(-0.12, -0.04, 4, 1, dx=0.08, names=['SHAFT', 'TRUNNION', 'SPEED', 'MARK'])
    ly.toggles(-0.12, -0.095, 8, 1, dx=0.034, names=['COUPL', 'ZERO', 'OPT'])
    put('optics', ly)
    ly = lay('imu', 32); ly.frame(-0.165, 0.165, -0.125, 0.125, 'IMU CONTROL')
    ly.toggles(-0.13, 0.085, 5, 3, dx=0.0655, dy=0.065, names=['CAGE', 'ALIGN', 'GIMBAL', 'TEMP', 'COARSE', 'FINE', 'ISS', 'GYRO', 'ACCEL', 'PIPA'])
    ly.gauges([(0.1, -0.1)], 0.02)
    put('imu', ly)
    ly = lay('dsky_disp', 33)
    ly.cv.rect(0, 0, ly.cv.w, ly.cv.h, (0.02, 0.05, 0.03))
    ly.label('PROG', -0.045, 0.024, 0.006, (0.4, 0.8, 0.5)); ly.label('VERB', 0.0, 0.024, 0.006, (0.4, 0.8, 0.5)); ly.label('NOUN', 0.045, 0.024, 0.006, (0.4, 0.8, 0.5))
    ly.label('11', -0.045, 0.005, 0.012, (0.35, 1.0, 0.5)); ly.label('16', 0.0, 0.005, 0.012, (0.35, 1.0, 0.5)); ly.label('62', 0.045, 0.005, 0.012, (0.35, 1.0, 0.5))
    ly.label('+00123', 0.0, -0.016, 0.011, (0.35, 1.0, 0.5)); ly.label('-00045', 0.0, -0.034, 0.011, (0.35, 1.0, 0.5))
    put('dsky_disp', ly)
    ly = lay('dsky_keys', 34)
    ly.cv.rect(0, 0, ly.cv.w, ly.cv.h, (0.05, 0.05, 0.05))
    keys = ['VERB', 'NOUN', '+', '7', '8', '9', '-', '4', '5', '6', '0', '1', '2', '3', 'CLR', 'PRO', 'ENTR', 'RSET', 'KEY', 'REL']
    for k, nm in enumerate(keys):
        i, j = k % 4, k // 4
        u, v = -0.045 + i * 0.03, 0.055 - j * 0.027
        ly.cv.rect(ly.px(u) - 0.012 * ppm, ly.py(v) - 0.011 * ppm, 0.024 * ppm, 0.022 * ppm, (0.62, 0.62, 0.6), r=4)
        ly.label(nm, u, v, 0.0045 if len(nm) > 1 else 0.0075, INK)
    put('dsky_keys', ly)
    ly = lay('env', 35); ly.frame(-0.215, 0.215, -0.24, 0.24, 'ENVIRONMENTAL CONTROL')
    for k, (nm, u, v) in enumerate([('O2 SURGE TANK', -0.12, 0.17), ('WATER', 0.0, 0.17), ('GLYCOL', 0.12, 0.17), ('SUIT FLOW', -0.12, 0.02), ('CABIN PRESS', 0.0, 0.02), ('SUIT HOSE', 0.12, 0.02)]):
        ly.label(nm, u, v - 0.052, 0.0048)
    ly.gauges([(-0.12, 0.215), (0.0, 0.215), (0.12, 0.215)], 0.022)
    ly.toggles(-0.15, -0.12, 5, 2, dx=0.075, dy=0.06, names=['PRESS RLF', 'DIRECT O2', 'REPRESS', 'EMER', 'SHUT OFF'])
    put('env', ly)
    ly = lay('breaker', 36); ly.frame(-0.19, 0.19, -0.245, 0.245, 'CIRCUIT BREAKERS')
    for j in range(15):
        for i in range(9):
            u, v = -0.16 + i * 0.04, 0.205 - j * 0.0282
            ly.label(ly.r.choice(['MN A', 'MN B', 'BAT A', 'BAT B', 'FC 1', 'FC 2', 'INV', 'TLM', 'SPS', 'RCS', 'ECS', 'LGT', 'PYRO', 'LOGIC', 'COMM']), u, v - 0.0112, 0.0027)
            ly.items.append(('breaker', u, v))
    put('breaker', ly)
    ly = lay('power', 37); ly.frame(-0.205, 0.205, -0.18, 0.18, 'POWER DISTRIBUTION')
    ly.toggles(-0.17, 0.12, 6, 4, dx=0.068, dy=0.075, names=['MAIN BUS', 'BAT BUS', 'AC 1', 'AC 2', 'PUMPS', 'HTRS', 'FANS', 'LAMPS'])
    put('power', ly)
    ly = lay('waste', 38); ly.frame(-0.185, 0.185, -0.155, 0.155, 'WASTE MANAGEMENT')
    for k, nm in enumerate(['URINE', 'FECAL', 'WATER', 'VENT']):
        ly.label(nm, -0.12 + k * 0.08, 0.12, 0.0055)
    ly.toggles(-0.12, 0.05, 4, 2, dx=0.08, dy=0.07, names=['DUMP', 'HEAT', 'PURGE', 'VENT'])
    put('waste', ly)
    ly = lay('optctl', 39); ly.frame(-0.135, 0.135, -0.115, 0.115, 'OPTICS CONTROL')
    ly.toggles(-0.1, 0.05, 4, 2, dx=0.066, dy=0.07, names=['MARK', 'REJECT', 'SPEED', 'MODE', 'ZERO', 'CMC', 'MAN'])
    put('optctl', ly)
    return atlas, pos, items, ppm


# ----------------------------------------------------------------------------------------------- hardware primitives
def toggle(D, fr, u, v, rng, guard=True, mat='bat'):
    """Toggle switch on a panel frame (z out of the panel) with flanking guard bars."""
    D.part.strut(mat, fr.p(u, v, 0.0), fr.p(u, v, 0.006), 0.0075, 0.0075, 6)
    tilt = rng.choice([-0.55, 0.55, 0.0])
    tip = (u, v + 0.014 * math.sin(tilt), 0.006 + 0.018 * math.cos(tilt))
    D.part.strut(mat, fr.p(u, v, 0.005), fr.p(*tip), 0.0028, 0.0034, 4)
    if guard:
        for sx in (-1, 1):
            D.box('bat', fr, 0.0025, 0.016, 0.014, u + sx * 0.0105, v, 0.007)


def knob(D, fr, u, v, rng):
    D.cyl('capdark', fr, 0.0105, 0.012, u, v, 0.006, 'z', 8)
    a = rng.uniform(0, 6.28)
    D.box('bat', fr, 0.003, 0.014, 0.004, u + 0.003 * math.sin(a), v + 0.003 * math.cos(a), 0.013, rz=-a)


def breaker(D, fr, u, v, rng):
    D.part.strut('breaker', fr.p(u, v, 0.0), fr.p(u, v, rng.choice([0.007, 0.012])), 0.0062, 0.0062, 5)


def place_items(D, fr, items, rng, off=(0.0, 0.0)):
    for it in items:
        kind, u, v = it[0], it[1] + off[0], it[2] + off[1]
        if kind == 'tog':
            toggle(D, fr, u, v, rng, guard=rng.random() < 0.65)
        elif kind == 'knob':
            knob(D, fr, u, v, rng)
        elif kind == 'breaker':
            breaker(D, fr, u, v, rng)
        elif kind == 'bezel':
            D.ring('bat', fr, it[3] + 0.002, 0.0022, u, v, 0.002, n=18, tn=4)


def velcro(D, fr, x, y, z=0.0, w=0.025, h=0.075, rz=0.0):
    D.box('velcro', fr, w, h, 0.004, x, y, z + 0.002, rz=rz)


TILES = {'optics': (0.34, 0.24), 'imu': (0.34, 0.26), 'dsky_disp': (0.13, 0.065), 'dsky_keys': (0.13, 0.14), 'env': (0.46, 0.50), 'breaker': (0.42, 0.52),
         'power': (0.44, 0.40), 'waste': (0.40, 0.34), 'optctl': (0.30, 0.26)}


# ----------------------------------------------------------------------------------------------- materials
class Tex:
    pass


def make_materials():
    T = Tex()
    T.wall = make_image('apollo_wall', wall_tex())
    material('wallpaint', (1, 1, 1), 0.85, image=T.wall, spec=0.15)
    lk = make_image('apollo_lockers', tex_lockers())
    material('locker', (1, 1, 1), 0.8, image=lk, spec=0.2)
    cl = make_image('apollo_cloth', tex_cloth())
    material('cloth', (1, 1, 1), 0.95, image=cl, spec=0.05)
    m2, m3 = build_mdc_tex(2), build_mdc_tex(3)
    T.mdc_items = {2: m2.items, 3: m3.items}
    arr = np.concatenate([m2.cv.col, m3.cv.col], axis=1)
    T.mdc_size = (m2.cv.w, m2.cv.h)
    material('mdc', (1, 1, 1), 0.7, image=make_image('apollo_mdc', arr), spec=0.2)
    atlas, pos, items, ppm = build_bay_tex()
    T.bay_pos, T.bay_items, T.bay_ppm = pos, items, ppm
    img = make_image('apollo_bay', atlas.col)
    material('bay', (1, 1, 1), 0.7, image=img, spec=0.2)
    material('dsky_disp', (1, 1, 1), 0.4, image=img, emit_image=img, emit_strength=0.5, spec=0.3)
    material('paint', (0.62, 0.57, 0.46), 0.8, spec=0.15)
    material('greypan', (0.50, 0.51, 0.50), 0.6, spec=0.2)
    material('trimdark', (0.10, 0.10, 0.11), 0.5, spec=0.3)
    material('velcro', (0.12, 0.12, 0.125), 0.95, spec=0.05)
    material('breaker', (0.02, 0.02, 0.022), 0.6)
    material('cable', (0.035, 0.035, 0.04), 0.6)
    material('webbing', (0.82, 0.76, 0.60), 0.9, spec=0.05)
    material('hose', (0.78, 0.72, 0.58), 0.75, spec=0.1)
    material('flood', (0.95, 0.9, 0.8), 0.5, emit=(1.0, 0.86, 0.62), emit_strength=0.55)
    material('redknob', (0.55, 0.03, 0.02), 0.45, spec=0.5)
    material('yellowgd', (0.65, 0.45, 0.02), 0.5, spec=0.5)
    material('anod', (0.55, 0.55, 0.58), 0.5, 0.9)
    material('bat', (0.62, 0.62, 0.64), 0.6, spec=0.15)
    material('rubbercup', (0.01, 0.01, 0.012), 0.8)
    return T


def tile_uv(T, name):
    x, y, w, h = T.bay_pos[name]
    return (x / 2048, 1 - (y + h) / BAY_H, (x + w) / 2048, 1 - y / BAY_H)


# ----------------------------------------------------------------------------------------------- the main display console, sections 2 and 3
def dsky(D, fr, T, u, v, z=0.0):
    D.box('trimdark', fr, 0.17, 0.215, 0.026, u, v, z + 0.011, bevel=0.004)
    D.quad('dsky_disp', fr, 0.13, 0.065, u, v + 0.062, z + 0.0245, uvr=tile_uv(T, 'dsky_disp'))
    D.quad('bay', fr, 0.13, 0.14, u, v - 0.047, z + 0.0245, uvr=tile_uv(T, 'dsky_keys'))
    for sx in (-1, 1):
        D.box('trimdark', fr, 0.006, 0.07, 0.01, u + sx * 0.068, v + 0.062, z + 0.027)
    D.box('trimdark', fr, 0.14, 0.006, 0.01, u, v + 0.097, z + 0.027)
    D.box('trimdark', fr, 0.14, 0.006, 0.01, u, v + 0.03, z + 0.027)
    # key relief: raised rim strips between the rows
    for j in range(6):
        D.box('trimdark', fr, 0.125, 0.0025, 0.004, u, v - 0.047 + 0.07 - j * 0.027 + 0.0135, z + 0.027)


def build_mdc(ctx, root, T):
    import cc_panel as PN
    P = PN.PCtx(ctx)
    f1 = F(P.c, P.x, P.v, P.n)
    rng = random.Random(7)
    D = Dress('apollo_mdc', root, ctx)
    vc, Hh, Ww = -0.035, 0.61, 0.50
    alpha = math.radians(11)
    hinge = f1.p(0.46, 0, 0)
    cx, cn = f1.x, f1.z
    frames = []
    w_tex, h_tex = T.mdc_size
    for k, which in enumerate((2, 3)):
        xk = cx * math.cos(alpha) + cn * math.sin(alpha)
        nk = cn * math.cos(alpha) - cx * math.sin(alpha)
        fr = F(hinge + xk * (Ww / 2) + f1.y * vc, xk, f1.y, nk)
        frames.append(fr)
        hinge = hinge + xk * Ww
        cx, cn = xk, nk
        u0 = k * 0.5
        D.box('bezel', fr, Ww, Hh, 0.14, 0, 0, -0.07, bevel=0.006)
        D.quad('mdc', fr, Ww, Hh, 0, 0, 0.0008, uvr=(u0 * 1.0 * 0.5 * 2 / 2 if False else k * 0.5, 0.0, (k + 1) * 0.5, 1.0))
        D.box('trimdark', fr, Ww + 0.01, 0.014, 0.03, 0, Hh / 2 + 0.006, 0.01, bevel=0.003)       # glare edge
        D.box('trimdark', fr, Ww + 0.01, 0.008, 0.012, 0, -Hh / 2 - 0.002, 0.004)
        place_items(D, fr, T.mdc_items[which], rng)
        # brackets to the wall
        for sx in (-1, 1):
            for vq in (-0.25, 0.2):
                a = fr.p(sx * 0.2, vq + vc, -0.1)
                b = PN._wall_hit(ctx, a, -fr.z)
                D.strut('steel', a, b, 0.016, n=6)
    # DSKY on section 2 (right half of the printed seat outline) and its keypad
    dsky(D, frames[0], T, 0.1325, 0.103, 0.0)
    # section 3 gets two rotary selectors and a tape-meter bezel row via the printed layout; side cheek closing the arc against the wall
    ctx.mdc_frames = frames
    return D


# ----------------------------------------------------------------------------------------------- wall furniture
class Walls:
    def __init__(self, ctx, grp, T, style='small', name='apollo_walls'):
        self.ctx, self.T, self.style = ctx, T, style
        self.D = Dress(name, grp, ctx)
        self.rng = random.Random(11)
        self.occ = []           # wall-space rectangles (th_c, z_c, half theta deg, half z)
        self.count = dict(lockers=0, bags=0, panels=0, velcro=0, straps=0)
        for w in ctx.windows(style):
            c = Vector(w['c']); rho = max(w['w'], w['h']) / 2 + 0.05
            th = math.degrees(math.atan2(c.y, c.x))
            self.occ.append((th, c.z, dth(ctx, c.z, rho), rho))
        # wall contact of the console plate and its two sections: no lockers where brackets land
        import cc_panel as PN
        P = PN.PCtx(ctx)
        for u in (-0.46, 1.4):
            for v in (-0.3, 0.0, 0.25):
                q = ctx.cap_of_game(P.W(u, v, 0.0) )
                if math.hypot(q.x, q.y) > ctx.rin(q.z) - 0.15:
                    th = math.degrees(math.atan2(q.y, q.x))
                    self.occ.append((th, q.z, dth(ctx, q.z, 0.22), 0.2))
        h = ctx.hatch('side'); c = Vector(h['c'])
        th = math.degrees(math.atan2(c.y, c.x))
        self.occ.append((th, c.z, dth(ctx, c.z, 0.40), 0.46))

    def free(self, th, z, hth, hz, m=0.0):
        for t0, z0, h0, hz0 in self.occ:
            d = (th - t0 + 180) % 360 - 180
            if abs(d) < hth + h0 - m and abs(z - z0) < hz + hz0 - m * 0.01:
                return False
        return True

    def claim(self, th, z, hth, hz):
        self.occ.append((th, z, hth, hz))

    def rect_free(self, th, z, w, h, claim=True, tol=0.004):
        hth, hz = dth(self.ctx, z, w / 2), dz_of(self.ctx, z, h / 2)
        # shrink a hair so neighbours in a row do not reject each other
        if not self.free(th, z, hth - 0.2, hz - tol):
            return False
        if claim:
            self.claim(th, z, hth, hz)
        return True

    # ---- items
    def locker(self, th, z, w=0.28, h=0.20, tile=None, bag=False):
        if not self.rect_free(th, z, w, h):
            return False
        D, rng = self.D, self.rng
        fr = wall_frame(self.ctx, th, z)
        if bag:
            D.box('cloth', fr, w, h, 0.12, 0, 0, 0.012, bevel=0.025, segs=2)
            for sx in (-1, 1):
                velcro(D, fr, sx * w * 0.3, -h * 0.28, 0.065, 0.025, 0.05)
            D.box('webbing', fr, w * 0.96, 0.03, 0.006, 0, h * 0.12, 0.074)
            D.box('bat', fr, 0.03, 0.022, 0.008, w * 0.3, h * 0.12, 0.078)
            self.count['bags'] += 1
        else:
            t = rng.randrange(16) if tile is None else tile
            D.box('paint', fr, w, h, 0.09, 0, 0, 0.02, bevel=0.006)
            cu, cvv = (t % 4 + 0.5) / 4, 1 - (t // 4 + 0.5) / 4
            hu, hv = (w - 0.012) / TILE_M / 8, (h - 0.012) / TILE_M / 8
            D.quad('locker', fr, w - 0.012, h - 0.012, 0, 0, 0.0655, uvr=(cu - hu, cvv - hv, cu + hu, cvv + hv))
            D.box('bat', fr, 0.045, 0.012, 0.012, w * 0.30, -h * 0.05, 0.072)
            for sy in (-1, 1):
                D.box('trimdark', fr, 0.008, 0.03, 0.01, -w / 2 + 0.006, sy * h * 0.3, 0.068)
            self.count['lockers'] += 1
        if rng.random() < 0.5:
            velcro(D, fr, w / 2 + 0.03, 0.0, 0.0, 0.025, 0.075)
            self.count['velcro'] += 1
        return True

    def bank(self, th_c, z_c, cols, rows, w, h, gap=0.012, bag_ratio=0.0, skip=()):
        for j in range(rows):
            z = z_c
            for _ in range(j):
                z += dz_of(self.ctx, z, h + gap)
            for i in range(cols):
                th = th_c + (i - (cols - 1) / 2) * dth(self.ctx, z, w + gap)
                if (i, j) in skip:
                    continue
                self.locker(th, z, w, h, bag=self.rng.random() < bag_ratio)

    def ring(self, z_c, th_lo, th_hi, w, h, rows=1, gap=0.012, bag_ratio=0.0):
        for j in range(rows):
            z = z_c
            for _ in range(j):
                z += dz_of(self.ctx, z, h + gap)
            th = th_lo
            while th < th_hi:
                wi = min(self.rng.choice([w * 0.85, w, w * 1.15]), TILE_M - 0.01, 0.2 * self.ctx.rin(z))
                th += dth(self.ctx, z, wi / 2)
                self.locker(th, z, wi, h, bag=self.rng.random() < bag_ratio)
                th += dth(self.ctx, z, wi / 2 + gap)

    def panel(self, th, z, tile, extra=None):
        w, h = TILES[tile]
        fr = wall_frame(self.ctx, th, z)
        D, T = self.D, self.T
        if not self.rect_free(th, z, w + 0.03, h + 0.03):
            return None
        D.box('greypan', fr, w + 0.02, h + 0.02, 0.07, 0, 0, 0.01, bevel=0.004)
        D.box('trimdark', fr, w + 0.03, h + 0.03, 0.012, 0, 0, 0.0395)
        D.quad('bay', fr, w, h, 0, 0, 0.0461, uvr=tile_uv(T, tile))
        place_items(D, F(fr.p(0, 0, 0.0461), fr.x, fr.y, fr.z), T.bay_items[tile], self.rng, off=(0, 0))
        # items are placed in the texture frame with z = 0 at the panel face: lift them
        self.count['panels'] += 1
        return fr

    def panel_near(self, th, z, tile):
        for dz in (0, 0.12, -0.12, 0.24, -0.24, 0.36):
            for dt in (0, 14, -14, 28, -28, 42, -42):
                fr = self.panel(th + dt, z + dz, tile)
                if fr is not None:
                    return fr
        return None

    def row(self, th_c, z, specs, gap=0.03):
        """specs: list of (width, fn(th, z) -> None); placed side by side centred on th_c."""
        total = sum(s[0] for s in specs) + gap * (len(specs) - 1)
        s = -total / 2
        for wd, fn in specs:
            th = th_c + dth(self.ctx, z, s + wd / 2)
            fn(th, z)
            s += wd + gap

    def strap(self, th, z0, z1, w=0.035):
        D = self.D
        z = z0
        while z < z1 - 0.01:
            fr = wall_frame(self.ctx, th, z + 0.1)
            if self.free(th, z + 0.1, dth(self.ctx, z, w / 2), 0.1):
                D.box('webbing', fr, w, 0.205, 0.006, 0, 0, 0.004)
            z += dz_of(self.ctx, z, 0.2)
        fr = wall_frame(self.ctx, th, (z0 + z1) / 2)
        D.box('bat', fr, 0.05, 0.03, 0.01, 0, 0, 0.01)
        self.count['straps'] += 1

    def cable(self, th, z0, z1, n=3):
        """Black cable bundle up the wall with clamps."""
        D = self.D
        zm = (z0 + z1) / 2
        if not self.free(th, zm, dth(self.ctx, zm, 0.03), (z1 - z0) / 2):
            return
        self.claim(th, zm, dth(self.ctx, zm, 0.03), (z1 - z0) / 2)
        zs = np.linspace(z0, z1, 7)
        pts = []
        for zz in zs:
            fr = wall_frame(self.ctx, th, zz)
            pts.append(fr.p(0, 0, 0.012))
        for k in range(n):
            off = (k - (n - 1) / 2) * 0.012
            q = []
            for zz, p0 in zip(zs, pts):
                fr = wall_frame(self.ctx, th, zz)
                q.append(p0 + fr.x * off)
            D.tube('cable', q, 0.0055, 5, 2)
        for zz in zs[::2]:
            fr = wall_frame(self.ctx, th, zz)
            D.box('bat', fr, 0.04, 0.012, 0.016, 0, 0, 0.012)


def leb(Wl, ctx, T):
    """Lower equipment bay on the feet-side wall: optics, DSKY, IMU, optics control, locker wall."""
    D, rng = Wl.D, Wl.rng
    thf = ctx.p['head'] + 180
    zc = 1.12
    def optics(th, z):
        fr = Wl.panel(th, z, 'optics')
        if fr is None:
            return
        # two eyepieces with rubber eye cups
        for sx, nm in ((-0.085, 'sx'), (0.07, 'sc')):
            base = fr.p(sx, -0.02, 0.05)
            tip = fr.p(sx, -0.05, 0.16)
            D.strut('anod', base, tip, 0.021, 0.017, 10)
            D.strut('rubbercup', tip, fr.p(sx, -0.058, 0.19), 0.026, 0.034, 10)
            D.strut('anod', fr.p(sx, -0.01, 0.05), fr.p(sx + 0.05, 0.0, 0.05), 0.008, 0.008, 6)
            D.cyl('bat', fr, 0.016, 0.02, sx + 0.06, 0.0, 0.05, 'x', 8)
        D.box('trimdark', fr, 0.30, 0.05, 0.04, 0, 0.068, 0.07, bevel=0.005)
    def imu(th, z):
        Wl.panel(th, z, 'imu')
    def dsky2(th, z):
        fr = wall_frame(ctx, th, z)
        if not Wl.rect_free(th, z, 0.21, 0.26):
            return
        D.box('greypan', fr, 0.21, 0.26, 0.07, 0, 0, 0.01, bevel=0.004)
        dsky(D, fr, T, 0, 0, 0.045)
    def optctl(th, z):
        Wl.panel(th, z, 'optctl')
    Wl.row(thf, zc, [(0.30, optctl), (0.34, optics), (0.21, dsky2)])
    Wl.row(thf, zc - 0.36, [(0.34, imu), (0.34, lambda th, z: Wl.locker(th, z, 0.32, 0.22)), (0.28, lambda th, z: Wl.locker(th, z, 0.26, 0.22))], 0.02)
    # locker wall around
    Wl.bank(thf, zc + dz_of(ctx, zc, 0.30), 6, 3, 0.26, 0.19)
    Wl.bank(thf, zc - 0.36 - dz_of(ctx, zc, 0.50), 7, 2, 0.26, 0.19, bag_ratio=0.3)
    for k in range(-3, 4):
        Wl.strap(thf + k * 12 + 6, zc - 0.7, zc + 0.5)


def side_bays(Wl, ctx, T):
    D, rng = Wl.D, Wl.rng
    thl = ctx.p['head'] + 180 + 90 - 0      # commander's left: head + 270 = head - 90
    thl = (ctx.p['head'] - 90) % 360
    thr = (ctx.p['head'] + 90) % 360
    def valves(fr, items):
        for (u, v) in items:
            D.part.strut('anod', fr.p(u, v, 0.045), fr.p(u, v, 0.075), 0.007, 0.007, 6)
            D.ring('redknob', fr, 0.032, 0.006, u, v, 0.078, n=14, tn=5)
            for a in (0, 2.1, 4.2):
                D.sstrut('redknob', fr, (u, v, 0.078), (u + 0.032 * math.cos(a), v + 0.032 * math.sin(a), 0.078), 0.004, 0.004, 4)
    # left: environmental control + hoses
    z = 0.75
    fr = Wl.panel_near(thl, z, 'env')
    if fr is not None:
        valves(fr, [(-0.12, 0.10), (0.0, 0.10), (0.12, 0.10)])
        for k, u in enumerate((-0.12, 0.0, 0.12)):
            c0 = fr.p(u, -0.06, 0.05)
            D.strut('bat', c0, fr.p(u, -0.06, 0.09), 0.026, 0.026, 8)
            D.tube('hose', [fr.p(u, -0.06, 0.09), fr.p(u + 0.04, -0.14, 0.17), fr.p(u - 0.03, -0.26, 0.15), fr.p(u + 0.02, -0.34, 0.07), fr.p(u + 0.0, -0.38, 0.03)], 0.019, 6, 3)
            D.box('bat', fr, 0.045, 0.016, 0.03, u, -0.34, 0.06)
    Wl.row(thl, 1.42, [(0.42, lambda th, z: Wl.panel_near(th, z, 'breaker')), (0.42, lambda th, z: Wl.panel_near(th, z, 'breaker'))], 0.03)
    Wl.bank(thl, 0.34, 4, 1, 0.27, 0.2, bag_ratio=0.8)
    # right: waste, power, food
    fr = Wl.panel_near(thr + 4, 0.85, 'power')
    fr2 = Wl.panel_near(thr - 5, 0.50, 'waste')
    if fr2 is not None:
        for sx in (-0.08, 0.08):
            D.strut('bat', fr2.p(sx, -0.1, 0.06), fr2.p(sx, 0.05, 0.14), 0.045, 0.045, 12)
            D.ring('webbing', fr2, 0.0, 0.0, 0, 0, 0)  if False else None
    Wl.row(thr, 1.42, [(0.42, lambda th, z: Wl.panel_near(th, z, 'breaker')), (0.42, lambda th, z: Wl.panel_near(th, z, 'breaker'))], 0.03)
    Wl.bank(thr, 0.34, 4, 1, 0.27, 0.2, bag_ratio=0.9)
    Wl.bank(thr, 1.0, 3, 2, 0.27, 0.2, bag_ratio=0.6)


def fill_walls(Wl, ctx, T, light=False):
    """Every remaining bit of wall: rows of lockers and Beta-cloth bags from the aft bulkhead up to the tunnel throat."""
    for th in range(0, 360, 45):
        Wl.cable(th + 22, 0.25, 2.0, n=2)
    z = 0.18
    row = 0
    while z < 2.2:
        h = 0.19 if z < 1.2 else 0.17
        bag = 0.55 if z < 0.7 else 0.15
        c0 = dict(Wl.count)
        Wl.ring(z, 0, 360, 0.26, h, bag_ratio=bag)
        C.log('ring', round(z, 2), {k: Wl.count[k] - c0[k] for k in ('lockers', 'bags')})
        z += dz_of(ctx, z, h + 0.012)
        row += 1
    if light:
        return
    z = 0.2
    while z < 2.2:           # second pass: small lockers in the gaps the big rows left
        Wl.ring(z, 0, 360, 0.17, 0.12, bag_ratio=0.25)
        z += dz_of(ctx, z, 0.12 + 0.01)
    for off in (0.04, 0.08, 0.12, 0.02, 0.06, 0.10):
        z = 0.2 + off
        while z < 2.2:
            Wl.ring(z, 0, 360, 0.17, 0.12, bag_ratio=0.2)
            z += dz_of(ctx, z, 0.12 + 0.01)
    z = 0.2
    while z < 2.2:
        Wl.ring(z, 0, 360, 0.10, 0.09, bag_ratio=0.0, gap=0.008)
        z += dz_of(ctx, z, 0.09 + 0.008)
    for zt in (1.2, 1.4, 1.6, 1.8, 1.95):
        gaps = [th for th in range(0, 360, 5) if Wl.free(th, zt, 0.1, 0.01)]
        C.log('gaps z', zt, gaps)
    D = Wl.D
    for th in (-56 + 50, -56 - 50, -56 + 180):
        fr = wall_frame(ctx, th, 2.02)
        D.cyl('trimdark', fr, 0.07, 0.04, 0, 0, 0.02, 'z', 14)
        D.cyl('flood', fr, 0.052, 0.01, 0, 0, 0.042, 'z', 14)


def tunnel_probe(ctx, T, z_end, r_top):
    """Docking probe assembly on the dock cap + stowage ring and ratchet latches on the tunnel collar."""
    ax = ctx.gv((0, 0, 1))
    D = Dress('apollo_probe', 'dock_cap', ctx)
    fr = F(ctx.g((0, 0, z_end)), ctx.gv((1, 0, 0)), ctx.gv((0, 1, 0)), -ax)    # z = down the tunnel toward the crew
    D.part.strut('anod', fr.p(0, 0, 0.0), fr.p(0, 0, 0.26), 0.05, 0.036, 14)                                  # probe body
    D.part.strut('bat', fr.p(0, 0, 0.26), fr.p(0, 0, 0.34), 0.03, 0.03, 12)
    D.ring('anod', fr, 0.055, 0.016, 0, 0, 0.30, n=20)
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.4
        D.sstrut('steel', fr, (0.05 * math.cos(a), 0.05 * math.sin(a), 0.30), (r_top * 0.9 * math.cos(a), r_top * 0.9 * math.sin(a), 0.09), 0.012, 0.012, 6)
    D.ring('steel', fr, r_top * 0.9, 0.018, 0, 0, 0.09, n=28, tn=5)
    for k in range(12):
        a = 2 * math.pi * k / 12
        D.box('bat', fr, 0.04, 0.02, 0.04, r_top * 0.9 * math.cos(a), r_top * 0.9 * math.sin(a), 0.07, rz=a)
    for k in range(6):
        a = 2 * math.pi * k / 6 + 0.2
        D.box('webbing', fr, 0.03, 0.12, 0.004, 0.6 * r_top * math.cos(a), 0.6 * r_top * math.sin(a), 0.02, rz=a)
    return D


# ----------------------------------------------------------------------------------------------- couches
def dress_seats(ctx):
    import cc_crew as CR
    for nm, p in list(PARTS.items()):
        if not (nm == 'seat' or (nm.startswith('seat') and nm[4:].isdigit())):
            continue
        fr = F(p.pos, p.rot @ Vector((1, 0, 0)), p.rot @ Vector((0, 1, 0)), p.rot @ Vector((0, 0, 1)))
        S = Dress('apollo_' + nm, p.parent, ctx)
        k, kl = ctx.k, ctx.kl
        zb = 0.13
        floor = ctx.p['ez'] - 0.04
        rng = random.Random(hash(nm) & 0xffff)
        cmd = (nm == 'seat')
        # tube frame: side rails, cross bars, headrest U
        for sx in (-1, 1):
            S.sstrut('anod', fr, (sx * 0.255 * k, 0.13, zb + 0.065), (sx * 0.255 * k, -0.95 * k, zb + 0.065), 0.012, 0.012, 8)
            S.sstrut('anod', fr, (sx * 0.16, 0.13, zb + 0.05), (sx * 0.16, -0.09, zb + 0.05), 0.011, 0.011, 8)
        for y in (0.13, -0.35 * k, -0.82 * k):
            S.sstrut('anod', fr, (-0.255 * k, y, zb + 0.065), (0.255 * k, y, zb + 0.065), 0.012, 0.012, 8)
        S.sstrut('anod', fr, (-0.16, -0.09, zb + 0.05), (0.16, -0.09, zb + 0.05), 0.011, 0.011, 8)
        # fabric seams
        for x in (-0.1, 0.1):
            S.box('couch_edge', fr, 0.004, 0.8 * k, 0.004, x, -0.41 * k, zb - 0.002)
        for y in (-0.2, -0.4, -0.6):
            S.box('couch_edge', fr, 0.42 * k, 0.004, 0.004, 0, y * k, zb - 0.002)
        # struts with shock attenuator cylinders to the aft bulkhead
        for sx in (-1, 1):
            for y in (0.08, -0.45 * k, -0.9 * k):
                x0 = sx * 0.255 * k
                x1 = sx * 0.30 * k
                S.sstrut('steel', fr, (x0, y, zb + 0.075), (x1, y, floor - 0.012), 0.016, 0.02, 8)
                S.sstrut('anod', fr, (x0 * 1.05, y, zb + 0.16), (x1 * 0.99, y, zb + 0.30), 0.028, 0.028, 10)       # shock attenuator cylinder
                S.sstrut('steel', fr, (x1 * 0.99, y, zb + 0.3), (x1, y, floor - 0.004), 0.016, 0.018, 8)
                S.box('steel', fr, 0.1, 0.1, 0.012, x1, y, floor - 0.006, bevel=0.003)
        # (the 5-point harness is animated geometry: cc_aft.harness)
        # foot restraints: plate and strap at the boots
        hip = Vector((0, -0.80 * k, 0.05 * k)); th_ = Vector((0, -0.257 * kl, -0.31 * kl))
        knee = hip + th_; ank = knee + Vector((0, -0.28 * kl, 0.23 * kl))
        for sx in (-1, 1):
            c = (sx * 0.115 * k, ank.y - 0.10 * kl, ank.z + 0.07)
            S.box('steel', fr, 0.14, 0.26 * kl, 0.01, c[0], c[1], c[2] + 0.05, rx=0.15, bevel=0.004)
            S.box('webbing', fr, 0.13, 0.035, 0.012, c[0], c[1] - 0.02, c[2] - 0.045, rx=0.15)
        # headrest: strap + Velcro
        velcro(S, fr, 0.0, -0.05, zb - 0.002, 0.075, 0.025)
    return


# ----------------------------------------------------------------------------------------------- shell paint (UVs on the shell)
def paint_shell(ctx):
    for nm in ('shell_small', 'shell_panoramic', 'shell_cupola'):
        p = PARTS.get(nm)
        if p is None or 'hull' not in p.m:
            continue
        d = p.m.pop('hull')
        verts, faces = d['v'], d['f']
        cap = [ctx.cap_of_game(Vector(v)) for v in verts]
        uvs = []
        for f in faces:
            if all(cap[i].z < 0.07 for i in f):
                uvs.append([(0.1 + cap[i].x * 0.05, 0.02 + cap[i].y * 0.05) for i in f])      # aft bulkhead: a patch of the paint texture
                continue
            th = [math.atan2(cap[i].y, cap[i].x) for i in f]
            b = th[0]
            fix = []
            for t in th:
                while t - b > math.pi: t -= 2 * math.pi
                while t - b < -math.pi: t += 2 * math.pi
                fix.append(t)
            uvs.append([(t / (2 * math.pi), cap[i].z / 2.8) for t, i in zip(fix, f)])
        p.m['wallpaint'] = dict(v=verts, f=faces, uv=uvs)


# ----------------------------------------------------------------------------------------------- entry
def build(ctx, root, mats, groups, tops, z_end):
    T = make_materials()
    paint_shell(ctx)
    build_mdc(ctx, root, T)
    dress_seats(ctx)
    for style, grp in groups.items():
        Wl = Walls(ctx, grp, T, style, name='apollo_walls_' + style)
        leb(Wl, ctx, T)
        side_bays(Wl, ctx, T)
        fill_walls(Wl, ctx, T, light=(style != 'small'))
        C.log(f'apollo walls {style}:', Wl.count)
    top, r_top = tops['small']
    tunnel_probe(ctx, T, z_end, r_top)
