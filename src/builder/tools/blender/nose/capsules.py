"""
G1, the capsule generator (SpaceB&E builder, Role 1, nose section). Builds every crew capsule of the nose card from
its real outline and hardware, scaled to the game's size class, with its inner pieces as slot_<key> nodes.

Run from the repo root (all capsules, or some):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/nose/capsules.py -- [--only capsule_apollo,capsule_soyuz] [--shots DIR]

Contract (../README.md): origin at the centre of the base on the axis, +Y up, metres; the part spans y = 0 to its
catalogue height; the base meets the heat shield at the profile's base radius; every capsule ends at the top in the
standard docking ring (radius NECK 0.45 m) so towers, covers and nose caps seat on it. The outline follows the part's
hullProfile (the skin system seams to it); the size and height come from sections/nose/parts.json when the part is
there (stage 2), else from the defaults below (the wave-4 spec).

Inner pieces (kit `capsule`): slot_couches, slot_suits, slot_hatch, slot_windows, slot_docking, slot_landing, each the
real craft's own hardware, plus slot_<key>__<optionId> for the other choices of that slot (an empty node where the
choice means "nothing", e.g. slot_docking__none). Computer, life support and cabin air keep the code-drawn pieces.
Scale factor f = game metres per real metre (the size class radius over the real radius).
"""
import os, sys, math
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nl  # noqa: E402
from nl import V, Acc, M, er, ea, polar, lathe, cyl, sphere, torus, tube, box, beam, patch, disc, band, ring_on, window, port, strip_along, Rev, fillet, resample, FRONT, NECK, DEG, RADIUS  # noqa: E402
import inner as I  # noqa: E402

OPTIONS = {
    'couches': ['fixed', 'shock', 'ejection'],
    'hatch': ['outward', 'inward', 'top'],
    'windows': ['small', 'panoramic', 'cupola'],
    'docking': ['none', 'probe_drogue', 'ssvp', 'apas', 'nds', 'cbm'],
    'landing': ['splash', 'rockets', 'hard_land', 'airbags'],
    'suits': ['none', 'pressure'],
}

# ------------------------------------------------------------------ the capsules (real hardware, scaled)
# prof: hullProfile fractions [rFrac, yFrac]; f: game metres per real metre; az angles are relative to FRONT.
# windows: (az, yFrac, w, h, shape, taper) real metres; hatch: (az, yFrac, w, h, corner); ports: (az, yFrac, radius).
# real: the option ids the real craft used (its default look); seats: crew layout; chutes: (mains, drogues, yFrac, rr, bag r, bag L).
CAPS = {
    'capsule_vostok': dict(
        size='m', H=2.4, f=1.043, kind='sphere', skin='abl_vostok',
        real=dict(couches='ejection', hatch='outward', windows='small', docking='none', landing='hard_land', suits='pressure'),
        windows=[(0, 0.62, 0.22, 0.22, 'round', 1), (12, 0.2, 0.26, 0.26, 'round', 1)],
        hatch=(0, 0.62, 1.0, 1.0, 0.5),
        seats=dict(n=1, kind='ejection', yf=0.36, az=0, spacing=0.6), suit='suit_orange',
        chutes=(1, 1, 0.8, 0.0, 0.28, 0.5),
    ),
    'capsule_mercury': dict(
        size='s', H=2.92, f=0.992, skin='shingle', skin_u=72, skin_v=2.5,
        prof=[[0.97, 0], [1, 0.012], [0.49, 0.5], [0.48, 0.52], [0.48, 1]],
        zones=[(0.5, 0.88, 'beryl', 40, 1.0), (0.88, 1.0, 'alu', 1, 1.0)],
        real=dict(couches='fixed', hatch='outward', windows='small', docking='none', landing='splash', suits='pressure'),
        windows=[(0, 0.37, 0.44, 0.48, 'trap', 0.6)],
        hatch=(62, 0.22, 0.6, 0.86, 0.12),
        ports=[(90, 0.6, 0.03), (180, 0.6, 0.03), (270, 0.6, 0.03), (0, 0.6, 0.03), (45, 0.05, 0.025), (225, 0.05, 0.025)],
        rings=[(0.5, 0.04, 0.012), (0.88, 0.03, 0.01)],
        seats=dict(n=1, kind='contour', yf=0.14, az=180, spacing=0.6), suit='suit_silver',
        chutes=(2, 1, 0.6, 0.45, 0.17, 0.55), rim='abl_char',
    ),
    'capsule_gemini': dict(
        size='s', H=1.84, f=0.819, skin='shingle', skin_u=72, skin_v=2.5,
        prof=[[0.975, 0], [1, 0.02], [0.62, 0.72], [0.58, 0.76], [0.5, 0.8], [0.48, 0.82], [0.48, 1]],
        zones=[(0.76, 1.0, 'beryl', 40, 1.0)],
        real=dict(couches='ejection', hatch='outward', windows='small', docking='none', landing='splash', suits='pressure'),
        windows=[(-24, 0.55, 0.3, 0.3, 'trap', 0.7), (24, 0.55, 0.3, 0.3, 'trap', 0.7)],
        hatch=[(-24, 0.4, 0.62, 1.05, 0.1), (24, 0.4, 0.62, 1.05, 0.1)],
        ports=[(a, 0.86, 0.022) for a in range(0, 360, 45)] + [(a + 22, 0.94, 0.022) for a in range(0, 360, 45)],
        rings=[(0.76, 0.03, 0.01), (0.9, 0.02, 0.008)],
        seats=dict(n=2, kind='ejection', yf=0.2, az=0, spacing=0.66), suit='suit_silver',
        chutes=(1, 0, 0.84, 0.0, 0.2, 0.26), rim='abl_char',
    ),
    'capsule_apollo': dict(
        size='l', H=2.8, f=0.863, skin='mylar', skin_u=16, skin_v=0.6,
        prof=[[0.975, 0], [1, 0.025], [0.4, 0.592], [0.33, 0.68], [0.29, 0.76], [0.267, 0.8], [0.267, 1]],
        zones=[(0.8, 1.0, 'alu', 1, 1.0)],
        real=dict(couches='shock', hatch='outward', windows='small', docking='probe_drogue', landing='splash', suits='pressure'),
        windows=[(-48, 0.34, 0.33, 0.33, 'rect', 1), (48, 0.34, 0.33, 0.33, 'rect', 1), (-21, 0.48, 0.3, 0.24, 'trap', 0.8), (21, 0.48, 0.3, 0.24, 'trap', 0.8), (0, 0.36, 0.22, 0.22, 'round', 1)],
        hatch=(0, 0.27, 0.74, 0.86, 0.1),
        ports=[(172, 0.55, 0.035), (188, 0.55, 0.035), (85, 0.1, 0.035), (95, 0.1, 0.035), (265, 0.1, 0.035), (275, 0.1, 0.035), (-8, 0.47, 0.03), (8, 0.47, 0.03)],
        rings=[(0.59, 0.03, 0.008), (0.8, 0.04, 0.012)],
        seats=dict(n=3, kind='strut', yf=0.15, az=180, spacing=0.66), suit='suit_white',
        chutes=(3, 2, 0.66, 0.5, 0.2, 0.42), rim='abl_avcoat', upright=3,
    ),
    'capsule_soyuz': dict(
        size='s', H=2.06, f=0.864, skin='mli_soyuz', skin_u=24, skin_v=2.0,
        prof=[[0.975, 0], [1, 0.03], [0.9, 0.55], [0.84, 0.66], [0.72, 0.78], [0.55, 0.9], [0.48, 0.96], [0.48, 1]],
        real=dict(couches='shock', hatch='top', windows='small', docking='none', landing='rockets', suits='pressure'),
        windows=[(70, 0.62, 0.21, 0.21, 'round', 1), (-110, 0.62, 0.21, 0.21, 'round', 1)],
        hatch=None, top_hatch=0.7,
        ports=[(a, 0.68, 0.02) for a in (20, 110, 200, 290)] + [(a, 0.45, 0.02) for a in (65, 155, 245, 335)],
        covers=[(160, 0.55, 0.62, 0.78, 0.25), (-150, 0.6, 0.46, 0.56, 0.2)],
        vzor=(-25, 0.32),
        seats=dict(n=3, kind='kazbek', yf=0.16, az=180, spacing=0.6, fan=12), suit='suit_white',
        chutes=(1, 1, 0.58, 0.62, 0.22, 0.42, 160), rim='abl_soyuz', rockets=6,
    ),
    'capsule_shenzhou': dict(
        size='m', H=2.2, f=0.992, skin='mli_white', skin_u=28, skin_v=2.0,
        prof=[[0.975, 0], [1, 0.03], [0.9, 0.55], [0.82, 0.68], [0.62, 0.85], [0.42, 0.95], [0.36, 0.97], [0.36, 1]],
        real=dict(couches='shock', hatch='top', windows='small', docking='none', landing='rockets', suits='pressure'),
        windows=[(55, 0.64, 0.3, 0.3, 'round', 1), (-125, 0.64, 0.3, 0.3, 'round', 1)],
        hatch=None, top_hatch=0.7,
        ports=[(a, 0.7, 0.025) for a in (20, 110, 200, 290)] + [(a, 0.45, 0.025) for a in (65, 155, 245, 335)],
        covers=[(165, 0.55, 0.8, 0.8, 0.4)],
        seats=dict(n=3, kind='kazbek', yf=0.15, az=180, spacing=0.62, fan=10), suit='suit_white',
        chutes=(1, 1, 0.58, 0.62, 0.26, 0.46, 165), rim='abl_soyuz', rockets=4,
    ),
    'capsule_orion': dict(
        size='l', H=2.25, f=0.671, skin='aetb', skin_u=14, skin_v=1.4,
        prof=[[0.975, 0], [1, 0.03], [0.36, 0.78], [0.31, 0.85], [0.267, 0.9], [0.267, 1]],
        zones=[(0.9, 1.0, 'alu', 1, 1.0)],
        real=dict(couches='shock', hatch='outward', windows='small', docking='nds', landing='splash', suits='pressure'),
        windows=[(-28, 0.5, 0.36, 0.3, 'rect', 1), (-44, 0.42, 0.36, 0.3, 'rect', 1), (28, 0.5, 0.36, 0.3, 'rect', 1), (44, 0.42, 0.36, 0.3, 'rect', 1), (0, 0.4, 0.24, 0.24, 'round', 1)],
        hatch=(0, 0.28, 1.0, 1.0, 0.25),
        ports=[(175, 0.7, 0.04), (185, 0.7, 0.04), (85, 0.12, 0.04), (95, 0.12, 0.04), (265, 0.12, 0.04), (275, 0.12, 0.04), (175, 0.12, 0.04), (185, 0.12, 0.04), (80, 0.6, 0.035), (100, 0.6, 0.035), (260, 0.6, 0.035), (280, 0.6, 0.035)],
        rings=[(0.78, 0.03, 0.01), (0.9, 0.04, 0.012)],
        seats=dict(n=4, kind='strut', yf=0.13, az=180, spacing=0.68, grid=True), suit='suit_orange',
        chutes=(3, 2, 0.72, 0.45, 0.26, 0.5), rim='abl_avcoat', upright=5, fbc=True,
    ),
    'capsule_dragon': dict(
        size='m', H=2.37, f=0.625, skin='white_panel', skin_u=8, skin_v=0.9,
        prof=[[0.975, 0], [1, 0.03], [0.62, 0.84], [0.5, 0.92], [0.36, 0.97], [0.36, 0.99], [0.36, 1]],
        real=dict(couches='fixed', hatch='outward', windows='small', docking='nds', landing='splash', suits='pressure'),
        windows=[(-42, 0.62, 0.42, 0.42, 'rect', 1), (42, 0.62, 0.42, 0.42, 'rect', 1), (180, 0.62, 0.42, 0.42, 'rect', 1), (0, 0.5, 0.28, 0.28, 'round', 1)],
        hatch=(0, 0.45, 1.05, 1.05, 0.32),
        dracos=[(45 + 90 * k, 0.8) for k in range(4)],
        seats=dict(n=4, kind='carbon', yf=0.17, az=180, spacing=0.62), suit='suit_white',
        chutes=(4, 2, 0.83, 0.5, 0.24, 0.5), rim='abl_pica', rim_h=0.035,
    ),
    'capsule_starliner': dict(
        size='l', H=2.3, f=0.734, skin='mli_white', skin_u=20, skin_v=1.6,
        prof=[[0.975, 0], [1, 0.03], [0.42, 0.74], [0.34, 0.84], [0.267, 0.92], [0.267, 1]],
        zones=[(0.74, 0.92, 'white', 1, 1.0), (0.92, 1.0, 'alu', 1, 1.0)],
        real=dict(couches='fixed', hatch='outward', windows='small', docking='nds', landing='airbags', suits='pressure'),
        windows=[(-17, 0.6, 0.34, 0.34, 'rect', 1), (0, 0.6, 0.34, 0.34, 'rect', 1), (17, 0.6, 0.34, 0.34, 'rect', 1)],
        hatch=(90, 0.32, 1.0, 1.0, 0.2), dark_band=(0.69, 0.74),
        ports=[(a, 0.64, 0.035) for a in (40, 140, 220, 320)] + [(a, 0.1, 0.035) for a in (0, 90, 180, 270)],
        rings=[(0.74, 0.035, 0.012), (0.92, 0.03, 0.01)],
        seats=dict(n=4, kind='carbon', yf=0.13, az=180, spacing=0.66), suit='suit_blue',
        chutes=(3, 2, 0.76, 0.5, 0.22, 0.42), rim='abl_bla', airbags=6,
    ),
    'capsule_gaganyaan': dict(
        size='m', H=2.22, f=0.714, skin='white_panel', skin_u=10, skin_v=1.0,
        prof=[[0.975, 0], [1, 0.03], [0.42, 0.78], [0.36, 0.88], [0.36, 0.94], [0.36, 1]],
        zones=[(0.78, 0.94, 'offwhite', 1, 1.0)],
        real=dict(couches='shock', hatch='outward', windows='small', docking='none', landing='splash', suits='pressure'),
        windows=[(-35, 0.5, 0.26, 0.26, 'round', 1), (35, 0.5, 0.26, 0.26, 'round', 1)],
        hatch=(0, 0.33, 0.8, 0.95, 0.15),
        ports=[(a, 0.66, 0.035) for a in (45, 135, 225, 315)] + [(a, 0.12, 0.035) for a in (0, 90, 180, 270)],
        rings=[(0.78, 0.035, 0.012)], seams=True,
        seats=dict(n=3, kind='strut', yf=0.14, az=180, spacing=0.66), suit='suit_orange',
        chutes=(3, 2, 0.74, 0.5, 0.24, 0.45), rim='abl_char',
    ),
    'capsule_newshepard': dict(
        size='m', H=2.04, f=0.683, skin='white', skin_u=1, skin_v=1.0,
        prof=[[1, 0], [1, 0.08], [0.86, 0.55], [0.64, 0.82], [0.4, 0.95], [0.36, 0.98], [0.36, 1]],
        real=dict(couches='fixed', hatch='outward', windows='panoramic', docking='none', landing='rockets', suits='none'),
        windows=[(30 + 60 * k, 0.4, 0.73, 1.1, 'rect', 1) for k in range(6)],
        hatch=None, ns=True,
        seats=dict(n=6, kind='recliner', yf=0.12, az=0, spacing=0.0, circle=0.5), suit='suit_blue',
        chutes=(3, 1, 0.84, 0.5, 0.26, 0.42), rockets=0,
    ),
    'capsule_mengzhou': dict(
        size='l', H=2.55, f=0.75, skin='white_panel', skin_u=14, skin_v=1.0,
        prof=[[0.975, 0], [1, 0.03], [0.4, 0.76], [0.33, 0.85], [0.267, 0.92], [0.267, 1]],
        zones=[(0.76, 0.92, 'offwhite', 1, 1.0), (0.92, 1.0, 'alu', 1, 1.0)],
        real=dict(couches='shock', hatch='outward', windows='small', docking='apas', landing='airbags', suits='pressure'),
        windows=[(-30, 0.52, 0.3, 0.3, 'rect', 1), (30, 0.52, 0.3, 0.3, 'rect', 1)],
        hatch=(0, 0.3, 0.85, 0.95, 0.15),
        ports=[(a, 0.66, 0.035) for a in (45, 135, 225, 315)] + [(a, 0.1, 0.035) for a in (0, 90, 180, 270)],
        rings=[(0.76, 0.035, 0.012), (0.92, 0.03, 0.01)], seams=True,
        seats=dict(n=3, kind='kazbek', yf=0.14, az=180, spacing=0.66), suit='suit_white',
        chutes=(3, 2, 0.78, 0.48, 0.24, 0.45), rim='abl_bla', airbags=6,
    ),
}


# ------------------------------------------------------------------ helpers
class Ctx:
    """Everything a capsule's builders need: size, height, outline, scale factor, the body accumulator."""

    def __init__(self, slug, spec):
        pd = nl.part_data(slug) or {}
        self.slug, self.spec = slug, spec
        self.size = pd.get('size', spec['size'])
        self.H = float(pd.get('height', spec['H']))
        self.R = RADIUS[self.size]
        self.f = spec['f'] * self.R / RADIUS[spec['size']]  # the scale factor follows a changed size class
        hp = (pd.get('hullProfile') or {}).get('profile')
        self.data_profile = hp
        self.body = Acc()

    def az(self, rel):
        return FRONT + rel

    def y(self, yf):
        return yf * self.H


def make_profile(ctx):
    """The capsule's outline in game metres: the hull profile (data or spec), corners filleted, the top at NECK."""
    sp = ctx.spec
    R, H = ctx.R, ctx.H
    if sp.get('kind') == 'sphere':
        dp = ctx.data_profile or [[0.34, 0], [0.9, 0.5], [0.36, 1]]
        rs = max(p[0] for p in dp) * R  # the sphere's equator
        rb = dp[0][0] * R  # meets the Vostok instrument module's top ring
        c = math.sqrt(rs * rs - rb * rb)
        ytop = c + math.sqrt(rs * rs - NECK * NECK)
        pts = []
        a0 = math.asin(rb / rs)
        a1 = math.pi - math.asin(NECK / rs)
        for k in range(41):
            a = a0 + (a1 - a0) * k / 40
            pts.append((rs * math.sin(a), c - rs * math.cos(a)))
        pts.append((NECK, H))
        return pts, ytop
    prof = ctx.data_profile or sp['prof']
    pts = [(rf * R, yf * H) for (rf, yf) in prof]
    # the docking ring is always NECK: snap the top points that are meant to be the neck
    pts = [(NECK if (y > 0.7 * H and abs(r - NECK) < 0.12) else r, y) for (r, y) in pts]
    pts = fillet(pts, 0.06 * R, 5)
    return resample(pts, 0.3), None


def split_profile(pts, y0, y1):
    """The part of an outline between two heights (inclusive, with interpolated ends)."""
    out = []
    for (a, b) in zip(pts, pts[1:]):
        (r0, ya), (r1, yb) = a, b
        if yb < y0 or ya > y1:
            continue
        def at(y):
            t = 0 if yb == ya else (y - ya) / (yb - ya)
            return (r0 + (r1 - r0) * t, y)
        p0 = a if ya >= y0 else at(y0)
        p1 = b if yb <= y1 else at(y1)
        if not out:
            out.append(p0)
        out.append(p1)
    return out


def body_shell(ctx, pts):
    """The outer shell with its material zones, the base bulkhead, the top tunnel and docking ring."""
    sp, H, R = ctx.spec, ctx.H, ctx.R
    zones = sp.get('zones', [])
    cuts = sorted({0.0, 1.0} | {z[0] for z in zones} | {z[1] for z in zones})
    for (a, b) in zip(cuts, cuts[1:]):
        z = next((z for z in zones if z[0] <= a + 1e-6 and z[1] >= b - 1e-6), None)
        key, u, v = (z[2], z[3], z[4]) if z else (sp['skin'], sp.get('skin_u', 1), sp.get('skin_v', 1.0))
        part = split_profile(pts, a * H, b * H)
        if len(part) >= 2:
            lathe(ctx.body, part, M(key), 60, u_rep=u, v_scale=v)
    # base bulkhead (hidden on the heat shield, seen when the capsule stands alone)
    r0 = pts[0][0]
    lathe(ctx.body, [(0.0, 0.004), (r0 * 0.995, 0.004)], M('dark'), 48)
    # the top: tunnel rim and docking ring, the forward hatch recessed inside
    lathe(ctx.body, [(NECK, H - 0.004), (NECK - 0.035, H - 0.004), (NECK - 0.035, H - 0.08), (0.0, H - 0.08)], M('dark'), 48)
    lathe(ctx.body, [(NECK + 0.004, H - 0.05), (NECK + 0.012, H - 0.05), (NECK + 0.012, H), (NECK - 0.02, H), (NECK - 0.02, H - 0.01)], M('alu'), 48)


def rim_band(ctx, rev):
    sp = ctx.spec
    if not sp.get('rim'):
        return
    s1 = rev.s_at_y(sp.get('rim_h', 0.025) * ctx.H)
    band(ctx.body, rev, 0.0, s1, M(sp['rim']), 0.002, 72)


def details(ctx, rev):
    sp, f, H = ctx.spec, ctx.f, ctx.H
    for (az, yf, w, h, shape, taper) in sp.get('windows', []):
        s = rev.s_at_y(yf * H)
        if shape == 'round':
            window(ctx.body, rev, ctx.az(az), s, w * f, w * f, 0.003, bw=0.035 * f, round_=True)
        else:
            window(ctx.body, rev, ctx.az(az), s, w * f, h * f, 0.003, bw=0.035 * f, taper=taper)
    hatches = sp.get('hatch')
    if hatches:
        for (az, yf, w, h, corner) in (hatches if isinstance(hatches, list) else [hatches]):
            s = rev.s_at_y(yf * H)
            # the hatch on the skin: a seam all round, the hinge fairing and the latch handle cover
            patch(ctx.body, rev, ctx.az(az), s, w * f + 0.025, h * f + 0.025, M('dark'), 0.002, 0.0, 8, 8, 1.0, corner * f + 0.012)
            patch(ctx.body, rev, ctx.az(az), s, w * f, h * f, M(sp['skin']) if sp['skin'] not in ('shingle',) else M('beryl'), 0.004, 0.004, 8, 8, 1.0, corner * f, M('dark'))
            r = max(0.2, rev.at_s(s)[0])
            for side in (-1,):
                patch(ctx.body, rev, ctx.az(az) + side * ((w * f / 2 + 0.03 * f) / r) / DEG, s, 0.05 * f, h * f * 0.8, M('dark'), 0.003, 0.02, 1, 3)
    for (az, yf, rad) in sp.get('ports', []):
        port(ctx.body, rev, ctx.az(az), rev.s_at_y(yf * H), rad * f / 0.9 if f < 1 else rad * f)
    for (yf, w, d) in sp.get('rings', []):
        ring_on(ctx.body, rev, rev.s_at_y(yf * H), w, d, M('dark'), 72)
    for (az, yf, w, h, corner) in sp.get('covers', []):  # parachute container covers, flush with a seam
        s = rev.s_at_y(yf * H)
        patch(ctx.body, rev, ctx.az(az), s, w * f + 0.03, h * f + 0.03, M('dark'), 0.002, 0.0, 8, 8, 1.0, corner * f + 0.015)
        patch(ctx.body, rev, ctx.az(az), s, w * f, h * f, M(sp['skin']), 0.004, 0.0, 8, 8, 1.0, corner * f)
    if sp.get('vzor'):
        az, yf = sp['vzor']
        s = rev.s_at_y(yf * H)
        disc(ctx.body, rev, ctx.az(az), s, 0.16 * f, M('dark'), 0.002, 0.03 * f, 16, 1)
        disc(ctx.body, rev, ctx.az(az), s, 0.09 * f, M('glass'), 0.035 * f, 0.03 * f, 16, 1)
    for (az, yf) in sp.get('dracos', []):  # Draco thruster clusters: 2 x 2 ports in a dark recess
        s = rev.s_at_y(yf * H)
        patch(ctx.body, rev, ctx.az(az), s, 0.36 * f, 0.3 * f, M('mid_grey'), 0.002, 0.004, 2, 2, 1.0, 0.04 * f)
        r = max(0.2, rev.at_s(s)[0])
        for (du, dv) in ((-0.08, -0.07), (0.08, -0.07), (-0.08, 0.07), (0.08, 0.07)):
            port(ctx.body, rev, ctx.az(az) + (du * f / r) / DEG, s + dv * f, 0.04 * f)
    if sp.get('seams'):  # panel seams of a tiled / blanketed thermal cover (Gaganyaan, Mengzhou)
        for k in range(8):
            strip_along(ctx.body, rev, ctx.az(22.5 + 45 * k), rev.s_at_y(0.04 * H), rev.s_at_y(0.74 * H), 0.012, 0.003, M('mid_grey'))
        for yf in (0.25, 0.5):
            ring_on(ctx.body, rev, rev.s_at_y(yf * H), 0.012, 0.003, M('mid_grey'), 72)


# ------------------------------------------------------------------ inner pieces
def seat_positions(ctx, rev):
    """[(hip point, az_long)] for the crew layout."""
    sp, f, H = ctx.spec['seats'], ctx.f, ctx.H
    yh = sp['yf'] * H + 0.06 * f
    az_long = ctx.az(sp['az'])
    out = []
    n = sp['n']
    if sp.get('circle'):
        for k in range(n):
            a = ctx.az(30 + 60 * k)
            # facing outward to its window: head toward the axis
            hip = polar(a, ctx.R * sp['circle'] * 1.0, yh)
            out.append((hip, a + 180))
        return out
    Ww = ea(az_long)
    Lx = er(az_long)
    if sp.get('grid'):
        rows = [(-0.5, 2), (0.5, 2)]
        for (row, m) in rows:
            for k in range(m):
                w = (k - (m - 1) / 2) * sp['spacing'] * f
                hip = V(0, yh + (0.18 * f if row > 0 else 0.0), 0) + Ww * w + Lx * (row * 0.9 * f - 0.05 * f)
                out.append((hip, az_long))
        return out
    for k in range(n):
        w = (k - (n - 1) / 2) * sp['spacing'] * f
        a = az_long + (sp.get('fan', 0) * (k - (n - 1) / 2))
        hip = V(0, yh, 0) + Ww * w - Lx * 0.05 * f
        out.append((hip, a))
    return out


def overflow(acc, rev, H, margin=0.04):
    """How far the piece's worst vertex sticks out of the shell (metres; <= 0 means it is inside)."""
    worst = -1.0
    for v in acc.V:
        x, y, z = v
        if y < 0.0 or y > H:
            worst = max(worst, 0.1)
            continue
        worst = max(worst, math.hypot(x, z) - (rev.r_at_y(y) - margin))
    return worst


def squeeze(acc, rev, H, margin=0.02):
    """Pulls a piece in toward the axis (x and z only) until it sits inside the shell."""
    k = 1.0
    base = list(acc.V)
    for _ in range(12):
        if overflow(acc, rev, H, margin) <= 0.0:
            break
        k *= 0.94
        acc.V = [(x * k, y, z * k) for (x, y, z) in base]
    return acc


def fitted(make, rev, H, margin=0.04):
    """Builds a piece with make(k) for a shrinking k until it fits inside the shell; returns (acc, k)."""
    k = 1.0
    for _ in range(9):
        acc = make(k)
        if overflow(acc, rev, H, margin) <= 0.0:
            return acc, k
        k *= 0.93
    return make(k), k


def emit_slot(root, key, build, options=None, hides=None):
    """The plain slot_<key> is the kit's FIRST option's look; every other option gets slot_<key>__<option>.
    (On the ship the game shows only the fitted option's node, else the plain one: README "Inner pieces".)
    hides: {option: other slot key} for a piece that replaces another slot (a cupola takes the docking port's place)."""
    opts = options or OPTIONS[key]
    for i, o in enumerate(opts):
        name = f'slot_{key}' if i == 0 else f'slot_{key}__{o}'
        obj = build(o).emit(name, root)
        if hides and o in hides:
            obj['hides'] = hides[o]


def add_couches(ctx, rev, root):
    sp, f = ctx.spec, ctx.f
    real = sp['real']['couches']
    seats = seat_positions(ctx, rev)
    floor = 0.03 * ctx.H
    generic = {'fixed': 'fixed', 'shock': 'strut', 'ejection': 'ejection'}

    def lay(lst, k):
        return [(V(h.x * k, h.y, h.z * k), a) for (h, a) in lst]

    centre = {}

    def make(kind, lst, tag):
        def m(k):
            acc = Acc()
            for (hip, a) in lay(lst, k):
                I.seat(acc, kind, hip, a, f * k, floor_y=floor)
            # centre the layout on the axis (a seat is longer toward its head than its feet)
            xs = [v[0] for v in acc.V]
            zs = [v[2] for v in acc.V]
            cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
            acc.V = [(x - cx, y, z - cz) for (x, y, z) in acc.V]
            centre[tag] = (cx, cz)
            return acc
        return m
    fits = {}

    def build(opt):
        kind = sp['seats']['kind'] if opt == real else generic[opt]
        lst = seats
        if ctx.slug == 'capsule_vostok' and opt == 'shock':  # Voskhod 1: three Elbrus couches in the same sphere
            lst = [(V(0, 0.3 * ctx.H, 0) + ea(ctx.az(180)) * (j - 1) * 0.6 * f, ctx.az(180)) for j in range(3)]
            kind = 'kazbek'
        acc, k = fitted(make(kind, lst, opt), rev, ctx.H)
        fits[opt] = k
        return acc
    emit_slot(root, 'couches', build)
    k0 = fits[real]
    ctx.seat_k = k0
    cx, cz = centre[real]
    return [(V(h.x - cx, h.y, h.z - cz), a) for (h, a) in lay(seats, k0)]


def add_suits(ctx, seats, root, rev):
    sp, f = ctx.spec, ctx.f

    def build(opt):
        pressure = opt == 'pressure'

        def make(k):
            acc = Acc()
            for (hip, a) in seats:
                I.crew_figure(acc, V(hip.x * k, hip.y + 0.03 * f, hip.z * k), a, f * 0.95 * ctx.seat_k * k, sp['suit'] if pressure else 'suit_grey', helmet=pressure)
            return acc
        return fitted(make, rev, ctx.H, 0.02)[0]
    emit_slot(root, 'suits', build)


def add_hatch(ctx, rev, root):
    sp, f, H = ctx.spec, ctx.f, ctx.H
    hs = sp.get('hatch')
    hs = hs if isinstance(hs, list) else ([hs] if hs else [])
    side = hs or [(0, 0.35, 0.8, 0.9, 0.15)]
    top_r = (sp.get('top_hatch', 0.7) / 2) * f
    top_r = min(top_r, NECK - 0.06)

    def build(kind):
        acc = Acc()
        if kind == 'top':
            I.hatch_top(acc, H - 0.2 * max(f, 0.7), top_r, f)
        else:
            for (az, yf, w, h, corner) in side:
                I.hatch_side(acc, rev, ctx.az(az), rev.s_at_y(yf * H), w * f, h * f, corner * f, inward=(kind == 'inward'), f=f)
        return acc
    emit_slot(root, 'hatch', build)


def add_windows(ctx, rev, root):
    sp, f, H = ctx.spec, ctx.f, ctx.H
    real = sp['real']['windows']

    def small():
        acc = Acc()
        for (az, yf, w, h, shape, taper) in sp.get('windows', []):
            if real == 'panoramic':
                w, h = min(w, 0.3), min(h, 0.3)
            I.window_block(acc, rev, ctx.az(az), rev.s_at_y(yf * H), w * f, h * f, f, taper, round_=(shape == 'round'))
        return acc

    def panoramic():
        acc = Acc()
        if real == 'panoramic':  # the craft's own big windows (New Shepard)
            for (az, yf, w, h, shape, taper) in sp.get('windows', []):
                I.window_block(acc, rev, ctx.az(az), rev.s_at_y(yf * H), w * f, h * f, f, taper, 0.08 * f)
            return acc
        for k in range(4 if ctx.R < 1.5 else 6):
            a = ctx.az(-40 + 80 * k / 3) if ctx.R < 1.5 else ctx.az(30 + 60 * k)
            I.window_block(acc, rev, a, rev.s_at_y(0.42 * H), 0.6 * f, 0.9 * f, f, 1.0, 0.08 * f)
        return acc

    def cup():
        acc = Acc()
        I.cupola(acc, H - 0.01, getattr(ctx, 'cupola_r', NECK - 0.06), f)
        return acc
    builders = {'small': small, 'panoramic': panoramic, 'cupola': cup}
    emit_slot(root, 'windows', lambda o: builders[o](), hides={'cupola': 'docking'})


def add_docking(ctx, root):
    H, f = ctx.H, ctx.f

    def build(opt):
        acc = Acc()
        if opt != 'none':
            I.docking(acc, opt, H - 0.012, NECK - 0.03, f)
        return acc
    emit_slot(root, 'docking', build)


def add_landing(ctx, rev, root, seats):
    sp, f, H, R = ctx.spec, ctx.f, ctx.H, ctx.R
    ch = sp['chutes']
    nm, nd, yf, rr, rb, L = ch[:6]
    side_az = ch[6] if len(ch) > 6 else None

    def chutes(acc):
        y = yf * H
        if side_az is not None:  # Soyuz / Shenzhou: one main in a side container, a reserve beside it
            r_in = rev.r_at_y(y) - 0.12 * f - rb * f
            I.chute_pack(acc, polar(ctx.az(side_az), r_in, y - L * f * 0.5), er(ctx.az(side_az)) * 0.4 + V(0, 1, 0), rb * f, L * f, f)
            I.chute_pack(acc, polar(ctx.az(side_az + 60), r_in * 0.95, y - L * f * 0.4), V(0, 1, 0), rb * f * 0.75, L * f * 0.8, f)
        elif rr == 0.0:  # one stack on the axis (Vostok's top container, Gemini's nose)
            y = min(y, H - 0.1 - L * f)
            I.chute_pack(acc, (0, y, 0), (0, 1, 0), min(rb * f, NECK - 0.08), L * f, f)
        else:
            # lower the ring until the bags fit between the tunnel and the wall
            Lb, rbb = L * f, rb * f
            while y > 0.3 * H and rev.r_at_y(y + Lb) - 0.06 - rbb < NECK + rbb * 0.7:
                y -= 0.04
            r_ring = rev.r_at_y(y + Lb) - 0.06 - rbb
            I.chutes_ring(acc, nm, nd, y, r_ring, rbb, Lb, f, ctx.az(30))
            if sp.get('upright'):
                I.uprighting_bags(acc, sp['upright'], r_ring * 0.9, y + Lb + 0.08 * f, f)

    def build(kind):
        acc = Acc()
        chutes(acc)
        r_base = rev.r_at_y(0.05 * H)
        if kind == 'rockets':
            n = sp.get('rockets') or 6
            I.landing_rockets(acc, n, r_base * 0.55, 0.02 * H, f)
        elif kind == 'airbags':
            I.airbags(acc, sp.get('airbags') or 6, r_base * 0.62, 0.012 * H, f)
        elif kind == 'hard_land':
            I.crush_pads(acc, [V(h.x, 0.03 * H + 0.06 * f, h.z) for (h, a) in seats], f)
        elif kind == 'splash' and ctx.slug == 'capsule_mercury':
            # Mercury's landing bag: the perforated skirt folded under the shield
            lathe(acc, [(r_base * 0.92, 0.01), (r_base * 0.96, 0.06), (r_base * 0.9, 0.1)], M('bag'), 32)
        return squeeze(acc, rev, H)
    emit_slot(root, 'landing', build)


def check_slots(root, rev, H):
    """Warns about any inner piece that sticks out of the shell (they must stay inside the part)."""
    import bpy
    for o in root.children:
        if not o.name.startswith('slot_') or o.type != 'MESH':
            continue
        worst = 0.0
        for v in o.data.vertices:
            x, y, z = v.co.x, v.co.z, -v.co.y
            if y < -0.005 or y > H + 0.005:
                worst = max(worst, 0.1)
            else:
                worst = max(worst, math.hypot(x, z) - rev.r_at_y(y))
        if worst > 0.01:
            print(f'[check] {root.name}/{o.name} sticks out by {worst:.3f} m')


# ------------------------------------------------------------------ capsule-specific details
def extra_vostok(ctx, rev, pts, ytop):
    f, H = ctx.f, ctx.H
    b = ctx.body
    # four steel straps over the sphere from the instrument-module ring to the top collar
    for k in range(4):
        strip_along(b, rev, ctx.az(45 + 90 * k), 0.04, rev.s_at_y(ytop) - 0.04, 0.07 * f, 0.012, M('steel_m'))
    # the top collar (parachute container hatch ring)
    lathe(b, [(NECK + 0.01, ytop - 0.02), (NECK + 0.03, ytop + 0.03), (NECK + 0.02, H - 0.05)], M('steel_m'), 48)
    # the entry / ejection hatch rim, the technological hatch, the Vzor ring round the foot window
    s = rev.s_at_y(0.62 * H)
    disc(b, rev, ctx.az(0), s, 0.5 * f + 0.04, M('dark'), 0.0, 0.02, 32, 1, inner=0.5 * f)
    disc(b, rev, ctx.az(150), rev.s_at_y(0.5 * H), 0.32 * f, M('dark'), 0.0, 0.015, 24, 1, inner=0.29 * f)
    disc(b, rev, ctx.az(12), rev.s_at_y(0.2 * H), 0.24 * f, M('steel_m'), 0.0, 0.05, 24, 1, inner=0.16 * f)
    # radio antennas folded under the shroud
    for a in (100, 260):
        P, N, Tm, Ta = rev.frame_y(ctx.az(a), 0.62 * H, 0.0)
        cyl(b, P, P + (N * 0.08 + Tm).normalized() * 0.4, 0.012, M('steel_m'), 6)
    # the cable fairing down to the instrument module
    strip_along(b, rev, ctx.az(200), 0.0, rev.s_at_y(0.45 * H), 0.1 * f, 0.03, M('dark'))


def extra_mercury(ctx, rev, pts, _):
    f, H = ctx.f, ctx.H
    b = ctx.body
    # the periscope fairing on the lower cone
    s = rev.s_at_y(0.1 * H)
    patch(b, rev, ctx.az(-24), s, 0.16, 0.3, M('beryl'), 0.0, 0.06, 2, 3, 0.6, 0.03)
    disc(b, rev, ctx.az(-24), s - 0.06, 0.04, M('glass'), 0.062, 0.0, 10, 1)
    # the antenna canister's horizon-scanner windows and the drogue cover on top
    for k in range(2):
        disc(b, rev, ctx.az(90 + 180 * k), rev.s_at_y(0.94 * H), 0.05, M('glass'), 0.003, 0.0, 12, 1)
    lathe(b, [(0.0, H - 0.02), (NECK * 0.7, H - 0.02), (NECK * 0.7, H - 0.005), (0.0, H - 0.005)], M('alu'), 32)
    # snorkel and the cone's top clamp ring for the tower
    for a in (150, 210):
        disc(b, rev, ctx.az(a), rev.s_at_y(0.44 * H), 0.05, M('dark'), 0.003, 0.012, 12, 1)


def extra_gemini(ctx, rev, pts, _):
    f, H = ctx.f, ctx.H
    b = ctx.body
    # the interface with the R&R section and the adapter tension straps at the base
    for k in range(6):
        box(b, polar(ctx.az(30 + 60 * k), pts[0][0] - 0.03, 0.03), (0.08, 0.05, 0.05), M('dark'))


def extra_apollo(ctx, rev, pts, _):
    f, H = ctx.f, ctx.H
    b = ctx.body
    # umbilical fairing, EVA handrails beside the hatch, SM tension-tie fittings at the base
    strip_along(b, rev, ctx.az(140), rev.s_at_y(0.03 * H), rev.s_at_y(0.2 * H), 0.16 * f, 0.04, M('mylar'))
    for side in (-1, 1):
        a = ctx.az(side * 32)
        P0 = rev.frame_y(a, 0.18 * H, 0.05)[0]
        P1 = rev.frame_y(a, 0.45 * H, 0.05)[0]
        tube(b, [rev.frame_y(a, 0.18 * H, 0.0)[0], P0, P1, rev.frame_y(a, 0.45 * H, 0.0)[0]], 0.012, M('amber'), 6)
    for k in range(6):
        box(b, polar(30 + 60 * k, pts[0][0] - 0.02, 0.025), (0.1, 0.05, 0.06), M('dark'))
    # the forward heat shield's seam and the docking tunnel
    lathe(b, [(NECK - 0.03, 0.8 * H), (NECK - 0.03, H - 0.06)], M('alu'), 32)


def extra_soyuz(ctx, rev, pts, _):
    f, H = ctx.f, ctx.H
    b = ctx.body
    # the darker ablator showing under the thermal cover's lower edge and the hatch flange at the top
    ring_on(b, rev, rev.s_at_y(0.035 * H), 0.03, 0.006, M('dark'), 72)
    for k in range(3):  # attach points of the orbital module's pyrobolts round the top
        box(b, polar(ctx.az(60 + 120 * k), NECK + 0.02, H - 0.08), (0.06, 0.06, 0.06), M('dark'))
    # the cable trunk to the service module
    strip_along(b, rev, ctx.az(100), rev.s_at_y(0.02 * H), rev.s_at_y(0.5 * H), 0.08, 0.025, M('dark'))


def extra_orion(ctx, rev, pts, _):
    f, H = ctx.f, ctx.H
    b = ctx.body
    # the forward bay cover's three mortar covers
    for k in range(3):
        a = ctx.az(60 + 120 * k)
        disc(b, rev, a, rev.s_at_y(0.84 * H), 0.07, M('mid_grey'), 0.003, 0.008, 12, 1)
    # umbilical and the crew-module / ESM separation ring at the base
    patch(b, rev, ctx.az(150), rev.s_at_y(0.08 * H), 0.3 * f, 0.22 * f, M('dark'), 0.002, 0.01, 2, 2)


def extra_dragon(ctx, rev, pts, _):
    f, H = ctx.f, ctx.H
    b = ctx.body
    # the nose cone hinge and its latch fittings on the top dome
    P, N, Tm, Ta = rev.frame_y(ctx.az(180), 0.95 * H, 0.0)
    box(b, P + N * 0.03, (0.22, 0.06, 0.12), M('mid_grey'), (Ta, Tm, N))
    for k in range(3):
        P, N, Tm, Ta = rev.frame_y(ctx.az(0 + 120 * k + 60), 0.94 * H, 0.0)
        box(b, P + N * 0.015, (0.06, 0.04, 0.03), M('dark'), (Ta, Tm, N))
    # the trunk umbilical
    patch(b, rev, ctx.az(180), rev.s_at_y(0.07 * H), 0.25, 0.14, M('dark'), 0.002, 0.012, 2, 2)


def extra_starliner(ctx, rev, pts, _):
    f, H = ctx.f, ctx.H
    b = ctx.body
    if ctx.spec.get('dark_band'):  # the dark band round the forward heat shield's base, studded with fittings
        y0, y1 = ctx.spec['dark_band']
        band(b, rev, rev.s_at_y(y0 * H), rev.s_at_y(y1 * H), M('black'), 0.003, 64)
        for k in range(36):
            disc(b, rev, ctx.az(k * 10), rev.s_at_y((y0 + y1) / 2 * H), 0.018, M('grey'), 0.004, 0.004, 6, 1)
    # the forward heat shield's cover over the chutes: a separate dome with its jettison fittings
    for k in range(4):
        P, N, Tm, Ta = rev.frame_y(ctx.az(45 + 90 * k), 0.75 * H, 0.0)
        box(b, P + N * 0.02, (0.08, 0.05, 0.04), M('dark'), (Ta, Tm, N))


def extra_newshepard(ctx, rev, pts, _):
    f, H, R = ctx.f, ctx.H, ctx.R
    b = ctx.body
    # the base: crushable ring, the retro-thrust ring and the solid escape motor's nozzle in the middle
    lathe(b, [(R * 0.98, 0.0), (R * 0.98, 0.03), (R * 0.84, 0.03), (R * 0.84, 0.0)], M('mid_grey'), 64)
    disc_y = 0.006
    lathe(b, [(0.0, disc_y), (R * 0.84, disc_y)], M('offwhite'), 64)
    for k in range(8):
        a = 22.5 + 45 * k
        lathe(b, [(0.03, 0.0), (0.06, 0.03), (0.06, 0.05)], M('nozzle'), 8, polar(a, R * 0.6, 0.0) + V(0, 0.05, 0), (0, -1, 0))
    # the parachute compartment cap with three main covers and the drogue mortar
    for k in range(3):
        disc(b, rev, ctx.az(60 + 120 * k), rev.s_at_y(0.9 * H), 0.12, M('offwhite'), 0.003, 0.008, 12, 1)
    # a window frame band and the feather panel (logo omitted)
    # the escape motor inside the base: a fixed child, not a slot (it is part of the capsule)
    m = Acc()
    cyl(m, (0, 0.05, 0), (0, 0.55 * H, 0), 0.22 * f, M('steel_m'), 16)
    lathe(m, [(0.08 * f, 0.05), (0.16 * f, 0.008), (0.17 * f, 0.004)], M('nozzle'), 16)
    return m


EXTRA = {'capsule_vostok': extra_vostok, 'capsule_mercury': extra_mercury, 'capsule_gemini': extra_gemini,
         'capsule_apollo': extra_apollo, 'capsule_soyuz': extra_soyuz, 'capsule_shenzhou': extra_soyuz,
         'capsule_orion': extra_orion, 'capsule_dragon': extra_dragon, 'capsule_starliner': extra_starliner,
         'capsule_newshepard': extra_newshepard, 'capsule_mengzhou': extra_starliner, 'capsule_gaganyaan': extra_starliner}


# ------------------------------------------------------------------ build
def build(slug, shots=None):
    spec = CAPS[slug]
    nl.reset()
    ctx = Ctx(slug, spec)
    root = nl.root(slug)
    pts, ytop = make_profile(ctx)
    rev = Rev(pts)
    body_shell(ctx, pts)
    rim_band(ctx, rev)
    details(ctx, rev)
    fixed = EXTRA[slug](ctx, rev, pts, ytop) if slug in EXTRA else None
    ctx.body.emit('body', root)
    if fixed is not None:
        fixed.emit('motor_escape', root)
    seats = add_couches(ctx, rev, root)
    add_suits(ctx, seats, root, rev)
    add_hatch(ctx, rev, root)
    add_windows(ctx, rev, root)
    add_docking(ctx, root)
    add_landing(ctx, rev, root, seats)
    check_slots(root, rev, ctx.H)
    tris, size = nl.export(root, slug, ctx.H, ctx.R)
    nl.write_profile(slug, pts, ctx.R, ctx.H)
    if shots:
        preview(root, slug, ctx, shots)
    return slug, tris, size


def preview(root, slug, ctx, shots):
    H, R = ctx.H, ctx.R
    os.makedirs(shots, exist_ok=True)
    nl.hide_except(root, ctx.spec.get('real', {}))
    nl.look(os.path.join(shots, f'{slug}_a.png'), (0, H * 0.48, 0), nl.cam_front(H, R))
    nl.look(os.path.join(shots, f'{slug}_b.png'), (0, H * 0.45, 0), nl.cam_front(H, R, az=FRONT + 150, pitch=25))
    # the inside: hide the body to see the inner pieces in place
    for o in root.children:
        if o.name in ('body',):
            o.hide_render = True
    nl.look(os.path.join(shots, f'{slug}_c.png'), (0, H * 0.45, 0), nl.cam_front(H, R, pitch=35))
    nl.show_all(root)


if __name__ == '__main__':
    only = nl.C.arg('--only')
    shots = nl.C.arg('--shots')
    todo = only.split(',') if only else list(CAPS)
    results = [build(s, shots) for s in todo]
    for (s, t, b) in results:
        print(f'[capsules] {s}: {t} triangles, {b / 1024:.0f} KB')
