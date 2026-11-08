"""
Thrust structures of real rockets (tail section): the engine bays the engines hang from.

Run from the repo root (writes public/assets/models/builder/tail/<id>.glb):
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/tail/thrust.py -- [--only thrust_n1_l,...] [--shots DIR]

Height, size and engine mounts are read from sections/tail/parts.json, so a model always matches its data.
Contract (../README.md): origin at the centre of the base (y = 0), the top joint ring at y = height with an outer radius
of exactly R (S 0.9375, M 1.25, L 1.6875 m); engine mounts at layout x R, where each engine's gimbal pad meets y = 0.
Inner pieces (thrust kit; the N1's ring kit adds steer):
  slot_baseShield (curtains) + __rigid + __none (empty: bare beams)
  slot_feed (lines) + __prevalves
  slot_pogo (none: empty) + __accumulator
  slot_steer (throttle) + __gimbals            (thrust_n1_l only)
Plain nodes: skin (outer wall, ring frames, fittings), structure (thrust beams, mount pads).
"""
import os, sys, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tl  # noqa: E402
from tl import V, M, Acc, polar, TAU  # noqa: E402

_parts = json.load(open(os.path.join(tl.REPO, 'src', 'builder', 'sections', 'tail', 'parts.json'), encoding='utf-8'))
PARTS = {p['id']: p for p in (_parts['parts'] if isinstance(_parts, dict) else _parts)}

Y_PLATE = 0.1  # the base heat shield sits this high; its boots reach down round each engine top to y = 0


def mounts(d, R):
    m = d.get('mounts') or {'count': 1, 'layout': [[0, 0]], 'scale': 1}
    pts = [(fx * R, fz * R) for (fx, fz) in m['layout'][:m.get('count', 1)]]
    return pts, m.get('scale', 1)


def min_gap(pts):
    d = 1e9
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            d = min(d, math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]))
    return d


def hole_radii(pts, R, r_plate, octagon=False):
    """One opening per mount, smaller near the rim (as tail/art.js mountHoles)."""
    hole = min(0.42 * min_gap(pts), 0.3 * R) if len(pts) > 1 else 0.3 * R
    inner = r_plate * math.cos(math.pi / 8) if octagon else r_plate
    out = []
    for (x, z) in pts:
        r = min(hole, inner - math.hypot(x, z) - 0.03)
        out.append(r if r >= 0.06 else 0.0)
    return out


# ------------------------------------------------------------------ shared pieces
HTOP = [1e9]  # the current part's height: walls stop under the top joint ring (no coplanar faces)


def wall(a, R, y0, y1, m, seg=64, u_rep=24, r1=None, a0=0.0, a1=TAU):
    y1 = min(y1, HTOP[0] - 0.04)
    tl.lathe(a, [(R, y0), (R if r1 is None else r1, y1)], m, seg, u_rep=u_rep, a0=a0, a1=a1)


def band(a, R, y, m, w=0.05, d=0.012, seg=64):
    tl.lathe(a, [(R - 0.002, y - w / 2), (R + d, y - w / 2 + d * 0.5), (R + d, y + w / 2 - d * 0.5), (R - 0.002, y + w / 2)], m, seg)


def top_ring(a, R, h):
    """The ring that bolts to the stage above: outer radius exactly R."""
    tl.lathe(a, [(R - 0.06, h - 0.04), (R, h - 0.04), (R, h), (R - 0.06, h)], M('dark'), 64)


def base_ring(a, R, y=0.0, m=None):
    tl.lathe(a, [(R - 0.05, y), (R + 0.006, y), (R + 0.006, y + 0.05), (R - 0.05, y + 0.05)], m or M('dark'), 64)


def pads(a, pts, s):
    """Gimbal attach pads, one per mount, at y = 0 (the engine's mounting pad meets them)."""
    k = max(0.5, min(1.4, s / 0.45))
    for (x, z) in pts:
        tl.lathe(a, [(0.0, 0.0), (0.09 * k, 0.0), (0.09 * k, 0.03), (0.06 * k, 0.07), (0.0, 0.07)], M('dark'), 12, (x, 0, z))


def struts(a, pts, R, h, y_top=0.7, spread=22, w=0.06, m=None):
    """Thrust struts from each mount pad up and out to the wall (where the thrust goes into the stage)."""
    m = m or M('alu')
    for (x, z) in pts:
        r = math.hypot(x, z)
        az = math.degrees(math.atan2(z, x)) if r > 1e-6 else None
        base = V(x, 0.07, z)
        if az is None:
            for k in range(4):
                tl.beam(a, base, polar(45 + 90 * k, R * 0.95, h * y_top), w, w, m)
        else:
            for s_ in (-spread, spread):
                tl.beam(a, base, polar(az + s_, R * 0.95, h * y_top), w, w, m)


def spoke(a, p0, p1, w, d, m):
    tl.beam(a, V(*p0), V(*p1), w, d, m)


def ring_beam(a, r, y, m, w=0.08, d=0.1, seg=48):
    tl.lathe(a, [(r - w / 2, y - d / 2), (r + w / 2, y - d / 2), (r + w / 2, y + d / 2), (r - w / 2, y + d / 2)], m, seg)


# ------------------------------------------------------------------ inner pieces (kit slots)
def plate_loop(R, octagon=False, n=56):
    if octagon:
        return [(R * math.cos(TAU * i / 8 + math.pi / 8), R * math.sin(TAU * i / 8 + math.pi / 8)) for i in range(8)]
    return tl.circle2d(0, 0, R, n)


def base_shield(parent, pts, R, kind, octagon=False, r_plate=None, y=Y_PLATE, outline=None):
    a = Acc()
    rp = r_plate or R * 0.975
    holes = hole_radii(pts, R, rp, octagon)
    if kind != 'none':
        big = len(pts) > 9
        nh = 10 if big else 18
        loops = [outline or plate_loop(rp, octagon)]
        for (x, z), hr in zip(pts, holes):
            if hr:
                loops.append(tl.circle2d(x, -z, hr, nh))
        t = 0.06 if kind == 'rigid' else 0.03
        tl.prism(a, loops, t, M('shield') if kind == 'rigid' else M('plate'), o=(0, y - t, 0))
        for (x, z), hr in zip(pts, holes):
            if not hr:
                continue
            if kind == 'curtains':  # flexible quilted boots that close round each engine but let it swivel
                tl.lathe(a, [(hr * 0.62, 0.005), (hr * 0.8, y * 0.45), (hr, y - 0.03)], M('fabric'), nh, (x, 0, z))
            else:  # rigid shield: a sealing ring round each opening
                tl.torus(a, V(x, y - 0.06, z), hr, 0.02, M('steel'), nh, 3)
    a.emit('slot_baseShield' if kind == 'curtains' else f'slot_baseShield__{kind}', parent)


def feed(parent, pts, R, h, kind):
    """Propellant feed: a pipe pair per engine (oxygen and fuel), or a ring manifold with a prevalve per engine."""
    a = Acc()
    n = len(pts)
    r_pipe = max(0.018, min(0.045, 0.32 * (min_gap(pts) if n > 1 else R) / 6))
    if kind == 'lines':
        for (x, z) in pts:
            rr = math.hypot(x, z)
            ux, uz = (x / rr, z / rr) if rr > 1e-6 else (1.0, 0.0)
            tx, tz = -uz, ux
            for s_, m in ((1, M('stainless')), (-1, M('alu'))):
                o = s_ * r_pipe * 1.6
                top = V(x * 0.55 + tx * o, h - 0.07, z * 0.55 + tz * o)
                mid = V(x * 0.9 + tx * o, h * 0.45, z * 0.9 + tz * o)
                bot = V(x + tx * o, Y_PLATE + 0.03, z + tz * o)
                tl.tube(a, [top, mid, bot], r_pipe, m, 6 if n <= 9 else 4)
        name = 'slot_feed'
    else:
        ym = h * 0.6
        rm = max(0.3 * R, min(0.62 * R, max(math.hypot(x, z) for (x, z) in pts) * 0.7 if n > 1 else 0.4 * R))
        tl.torus(a, V(0, ym, 0), rm, r_pipe * 1.6, M('stainless'), 40, 6)
        tl.cyl(a, V(0, h - 0.06, 0), V(0, ym, 0), r_pipe * 2.2, M('stainless'), 10, caps=False)
        for k in range(4):
            tl.tube(a, [V(0, ym + 0.12, 0), polar(45 + 90 * k, rm, ym)], r_pipe * 1.2, M('stainless'), 6)
        for (x, z) in pts:
            rr = math.hypot(x, z)
            az = math.degrees(math.atan2(z, x)) if rr > 1e-6 else 0
            p0 = polar(az, rm, ym)
            pv = V(x, h * 0.3, z)
            tl.tube(a, [p0, V(x, ym - 0.12, z), pv, V(x, Y_PLATE + 0.03, z)], r_pipe, M('steel'), 6 if n <= 9 else 4)
            tl.box(a, pv, (r_pipe * 4, r_pipe * 3, r_pipe * 4), M('amber'))
        name = 'slot_feed__prevalves'
    a.emit(name, parent)


def pogo(parent, pts, R, h, kind):
    a = Acc()
    if kind == 'accumulator':
        sel = pts if len(pts) <= 9 else pts[:: max(1, len(pts) // 8)]
        rs = max(0.05, min(0.12, (min_gap(pts) if len(pts) > 1 else R) * 0.16))
        for (x, z) in sel:
            rr = math.hypot(x, z)
            ux, uz = (x / rr, z / rr) if rr > 1e-6 else (1.0, 0.0)
            c = V(x * 0.8 - uz * rs * 1.2, h * 0.5, z * 0.8 + ux * rs * 1.2)
            tl.sphere(a, c, rs, M('stainless'), 10, 5)
            tl.box(a, c + V(0, -rs - 0.02, 0), (rs * 0.8, 0.04, rs * 0.8), M('amber'))
        name = 'slot_pogo__accumulator'
    else:
        name = 'slot_pogo'
    a.emit(name, parent)


def kit(parent, pts, R, h, octagon=False, r_plate=None, outline=None, y_plate=Y_PLATE):
    for k in ('curtains', 'rigid', 'none'):
        base_shield(parent, pts, R, k, octagon, r_plate, y_plate, outline)
    for k in ('lines', 'prevalves'):
        feed(parent, pts, R, h, k)
    for k in ('none', 'accumulator'):
        pogo(parent, pts, R, h, k)


# ------------------------------------------------------------------ the frames
def frame_skirt(d, R, h, pts, s, look):
    """A cylindrical engine section (most stages): wall, frames, bands, thrust struts, pads."""
    sk, st = Acc(), Acc()
    taper = look.get('taper', 1.0)
    mat = M(look.get('skin', 'white'))
    wall(sk, R * taper, 0.0, h, mat, r1=R, u_rep=look.get('ridges', 24))
    if look.get('band'):
        bh = h * look['bandFrac']
        wall(sk, R * taper + 0.004, 0.0, bh, M(look['band']), r1=R * (taper + (1 - taper) * look['bandFrac']) + 0.004, u_rep=look.get('ridges', 24))
    for f in look.get('frames', (0.35, 0.7)):
        band(sk, R * (taper + (1 - taper) * f), h * f, M('dark') if look.get('skin') in ('stainless', 'corr_steel') else M('grey'))
    top_ring(sk, R, h)
    base_ring(sk, R * taper)
    pads(st, pts, s)
    return sk, st


def build(slug):
    d = PARTS[slug]
    R, h = tl.RADIUS[d['size']], d['height']
    pts, s = mounts(d, R)
    tl.reset()
    HTOP[0] = h
    r = tl.root(slug)
    fn = FRAMES[slug]
    out = fn(d, R, h, pts, s, r)
    return r, R, h, pts, s, out


# --- one function per real pattern -----------------------------------------------------------------------------------
def f_boattail(d, R, h, pts, s, r):
    """Atlas V / Delta IV boattail: the stage wall tapers in round the top of its one big engine."""
    sk, st = Acc(), Acc()
    yc = h * 0.62
    rl = R * 0.72
    tl.lathe(sk, [(rl, 0.0), (R * 0.8, h * 0.18), (R * 0.93, h * 0.42), (R, yc), (R, h - 0.04)], M('corr_white'), 64, u_rep=20)
    tl.lathe(sk, [(rl + 0.004, 0.0), (R * 0.8 + 0.004, h * 0.18), (R * 0.8 + 0.004, h * 0.18 + 0.002)], M('black'), 64)
    band(sk, R, yc, M('grey'))
    band(sk, R * 0.86, h * 0.3, M('grey'))
    top_ring(sk, R, h)
    base_ring(sk, rl)
    for k in range(8):  # longerons down the cone
        tl.beam(st, polar(22.5 + 45 * k, R * 0.95, yc), V(0, 0.07, 0) + polar(22.5 + 45 * k, 0.12), 0.07, 0.07, M('alu'))
    tl.lathe(st, [(0.14, 0.06), (0.2, 0.12), (0.2, 0.18), (0.0, 0.2)], M('dark'), 16)
    pads(st, pts, s)
    sk.emit('skin', r)
    st.emit('structure', r)
    kit(r, pts, R, h, r_plate=rl * 0.97)


def f_octaweb(d, R, h, pts, s, r):
    """Falcon 9 Octaweb: an octagonal plate of beams holding eight engines round a ninth."""
    sk, st = frame_skirt(d, R, h, pts, s, {'skin': 'corr_white', 'band': 'black', 'bandFrac': 0.3, 'ridges': 20})
    ro = R * 0.93
    for k in range(8):
        c0, c1 = polar(22.5 + 45 * k, ro, 0.14), polar(67.5 + 45 * k, ro, 0.14)
        tl.beam(st, c0, c1, 0.08, 0.14, M('alu'))
        tl.beam(st, V(0, 0.14, 0), polar(45 * k, ro * math.cos(math.pi / 8), 0.14), 0.08, 0.14, M('alu'))
    struts(st, pts[1:], R, h, 0.75, 18, 0.05)
    for k in range(4):  # landing-leg hinge fittings at 45 degrees
        p = polar(45 + 90 * k, R, 0.12)
        tl.box(sk, p, (0.1, 0.22, 0.26), M('dark'), (polar(45 + 90 * k, 1), V(0, 1, 0), polar(135 + 90 * k, 1)))
    sk.emit('skin', r)
    st.emit('structure', r)
    kit(r, pts, R, h, octagon=True)


def f_five(d, R, h, pts, s, r):
    """Saturn V S-IC: two deep cross beams on the diagonals, the centre F-1 at the crossing, a corrugated skirt in the
    black-and-white roll pattern."""
    sk, st = Acc(), Acc()
    for i in range(8):
        wall(sk, R, 0.0, h, M('corr_white') if i % 2 == 0 else M('black'), seg=10, u_rep=4, a0=TAU * i / 8 - TAU / 16, a1=TAU * (i + 1) / 8 - TAU / 16)
    for f in (0.3, 0.68):
        band(sk, R, h * f, M('grey'))
    top_ring(sk, R, h)
    base_ring(sk, R)
    for k in (45, 135):  # the cross beams, deep I-beams through the centre
        tl.beam(st, polar(k, R * 0.96, 0.32), polar(k + 180, R * 0.96, 0.32), 0.14, 0.5, M('alu'))
    ring_beam(st, R * 0.93, 0.18, M('alu'), 0.1, 0.14)   # lower thrust ring
    for (x, z) in pts[1:]:  # thrust posts over the outer engines
        tl.beam(st, V(x, 0.07, z), V(x * 1.03, h * 0.85, z * 1.03), 0.16, 0.16, M('alu'))
    pads(st, pts, s)
    sk.emit('skin', r)
    st.emit('structure', r)
    kit(r, pts, R, h)


def f_twin(d, R, h, pts, s, r, look=None):
    """Two engines hanging from a heavy cross beam (Titan II/III, H3, Long March 5, LVM3, Vulcan)."""
    look = look or {'skin': 'white', 'band': 'dark', 'bandFrac': 0.2}
    sk, st = frame_skirt(d, R, h, pts, s, look)
    tl.beam(st, V(-R * 0.96, 0.24, 0), V(R * 0.96, 0.24, 0), 0.18, 0.34, M('alu'))
    for (x, z) in pts:
        tl.beam(st, V(x, 0.07, z), V(x, 0.24, z), 0.14, 0.14, M('alu'))
    struts(st, pts, R, h, 0.72, 35, 0.06)
    sk.emit('skin', r)
    st.emit('structure', r)
    kit(r, pts, R, h)


def f_triad(d, R, h, pts, s, r):
    """Space Shuttle aft fuselage: three engines in a triangle on a thrust structure of beams."""
    sk, st = frame_skirt(d, R, h, pts, s, {'skin': 'white', 'band': 'black', 'bandFrac': 0.4})
    for i in range(3):
        p0, p1 = pts[i], pts[(i + 1) % 3]
        tl.beam(st, V(p0[0], 0.2, p0[1]), V(p1[0], 0.2, p1[1]), 0.12, 0.2, M('alu'))
    struts(st, pts, R, h, 0.75, 30, 0.07)
    sk.emit('skin', r)
    st.emit('structure', r)
    kit(r, pts, R, h)


def f_quad(d, R, h, pts, s, r):
    """Soyuz core (Block A): four chambers in a square under a gently tapered grey skirt."""
    sk, st = frame_skirt(d, R, h, pts, s, {'skin': 'soyuz', 'taper': 0.94, 'frames': (0.4, 0.75)})
    for k in (0, 90):
        tl.beam(st, polar(k, R * 0.9, 0.2), polar(k + 180, R * 0.9, 0.2), 0.1, 0.18, M('alu'))
    struts(st, pts, R, h, 0.7, 25, 0.06)
    sk.emit('skin', r)
    st.emit('structure', r)
    kit(r, pts, R * 0.94, h)


def f_seven(d, R, h, pts, s, r):
    """New Glenn: a ring of six engines round a seventh, on a ring beam with spokes."""
    sk, st = frame_skirt(d, R, h, pts, s, {'skin': 'white', 'band': 'dark', 'bandFrac': 0.25})
    ro = math.hypot(*pts[1])
    ring_beam(st, ro, 0.16, M('alu'), 0.1, 0.16)
    for (x, z) in pts[1:]:
        tl.beam(st, V(0, 0.16, 0), V(x, 0.16, z), 0.08, 0.14, M('alu'))
    struts(st, pts[1:], R, h, 0.7, 20, 0.06)
    sk.emit('skin', r)
    st.emit('structure', r)
    kit(r, pts, R, h)


def squash(a, n0, kz):
    """Scale the z of the vertices added since n0 (an elliptical section, e.g. the Atlas booster fairings)."""
    for i in range(n0, len(a.V)):
        x, y, z = a.V[i]
        a.V[i] = (x, y, z * kz)


def f_atlas(d, R, h, pts, s, r):
    """Atlas LV-3B booster section: the sustainer in the middle and two booster engines under bulging fairings that
    reach 1.61 R each side (4.9 m across a 3.05 m stage); the section dropped off in flight at the skirt joint."""
    sk, st = Acc(), Acc()
    mat = M('corr_steel')
    wall(sk, R, 0.0, h, mat, u_rep=26)
    band(sk, R, h * 0.93, M('dark'))  # the separation joint
    top_ring(sk, R, h)
    base_ring(sk, R)
    # the two booster fairings, following the part's hull profile: 1.61 R up to 0.55 h, back to R at 0.95 h
    for sgn in (1, -1):
        cx = sgn * R * 0.86
        rpod = R * 0.75
        prof = [(rpod * 0.97, 0.0), (rpod, 0.05), (rpod, h * 0.55)]
        for k in range(1, 7):
            t = k / 6
            prof.append((rpod * math.cos(t * math.pi / 2) ** 0.8, h * 0.55 + (h * 0.38) * math.sin(t * math.pi / 2)))
        prof[-1] = (0.0, h * 0.93)
        n0 = len(sk.V)
        tl.lathe(sk, prof, mat, 40, (cx, 0, 0), u_rep=12)
        tl.lathe(sk, [(0.0, 0.004), (rpod * 0.97, 0.004)], M('dark'), 40, (cx, 0, 0))  # pod bottom
        for y in (h * 0.2, h * 0.42):
            tl.torus(sk, V(cx, y, 0), rpod + 0.004, 0.012, M('dark'), 40, 4)
        squash(sk, n0, 0.62)
    # thrust beams: one for the sustainer, a thrust barrel in each pod
    for (x, z) in pts:
        tl.cyl(st, V(x, 0.07, z), V(x, h * 0.6, z), 0.11, M('alu'), 12, caps=False)
    tl.beam(st, V(pts[0][0], h * 0.5, 0), V(pts[-1][0], h * 0.5, 0), 0.12, 0.18, M('alu'))
    pads(st, pts, s)
    sk.emit('skin', r)
    st.emit('structure', r)
    outline = []
    # the base plate follows the pods' outline: a union of the circle and the two pod circles
    for i in range(96):
        a = TAU * i / 96
        best = R * 0.975
        for sgn in (1, -1):
            cx, rp, kz = sgn * R * 0.86, R * 0.75 * 0.95, 0.62
            # distance along the ray to the far side of the pod's ellipse
            bx, bz = math.cos(a), math.sin(a) / kz
            A = bx * bx + bz * bz
            B = -2 * cx * bx
            Cc = cx * cx - rp * rp
            disc = B * B - 4 * A * Cc
            if disc > 0:
                best = max(best, (-B + math.sqrt(disc)) / (2 * A))
        outline.append((best * math.cos(a), -best * math.sin(a)))
    kit(r, pts, R, h, outline=outline)


def f_sib(d, R, h, pts, s, r):
    """Saturn IB S-IB: eight H-1s, an inner square on a central barrel and an outer four on a cruciform; eight fin
    root fittings on the corrugated skirt."""
    sk, st = frame_skirt(d, R, h, pts, s, {'skin': 'corr_white', 'band': 'black', 'bandFrac': 0.3, 'ridges': 28, 'frames': (0.45, 0.75)})
    for k in range(8):  # fin root fittings at 22.5 + k 45 degrees
        az = 22.5 + 45 * k
        tl.box(sk, polar(az, R + 0.02, h * 0.3), (0.06, h * 0.5, 0.16), M('grey'), (polar(az, 1), V(0, 1, 0), polar(az + 90, 1)))
    for k in (0, 90):
        tl.beam(st, polar(k, R * 0.95, 0.22), polar(k + 180, R * 0.95, 0.22), 0.12, 0.3, M('yellow'))
    tl.cyl(st, V(0, 0.08, 0), V(0, h * 0.8, 0), R * 0.36, M('alu'), 24, caps=False)
    for (x, z) in pts[4:]:
        tl.beam(st, V(x, 0.07, z), V(x * 1.06, h * 0.75, z * 1.06), 0.12, 0.12, M('yellow'))
    sk.emit('skin', r)
    st.emit('structure', r)
    kit(r, pts, R, h)


def f_sii(d, R, h, pts, s, r):
    """Saturn V S-II: five J-2s on an open cone of beams inside the aft skirt; the centre engine on a cross beam."""
    sk, st = frame_skirt(d, R, h, pts, s, {'skin': 'corr_white', 'ridges': 30, 'frames': (0.5,)})
    yt, yb, rt, rb = h - 0.08, 0.16, R * 0.9, R * 0.5
    tl.lathe(st, [(rb, yb), (rt, yt)], M('corr_steel'), 32, u_rep=8)  # the thrust cone
    for k in range(16):
        tl.beam(st, polar(11.25 + 22.5 * k, rb + 0.03, yb), polar(11.25 + 22.5 * k, rt + 0.03, yt), 0.05, 0.08, M('alu'))
    ring_beam(st, rb, yb, M('alu'), 0.1, 0.12, 32)
    ring_beam(st, (rb + rt) / 2, (yb + yt) / 2, M('alu'), 0.06, 0.08, 32)
    for k in (45, 135):
        tl.beam(st, polar(k, rb, yb), polar(k + 180, rb, yb), 0.1, 0.16, M('alu'))
    for (x, z) in pts:
        tl.beam(st, V(x, 0.07, z), V(x, yb, z), 0.1, 0.1, M('alu'))
    sk.emit('skin', r)
    st.emit('structure', r)
    kit(r, pts, R, h)


def f_sls(d, R, h, pts, s, r):
    """SLS core engine section and boattail: the orange foam engine section narrows to 0.84 R at the base round four
    RS-25s; booster aft attach fittings at +-X, umbilical plates on the side."""
    sk, st = Acc(), Acc()
    prof = [(R * 0.84, 0.0), (R * 0.88, h * 0.09), (R * 0.92, h * 0.18), (R * 0.97, h * 0.32), (R, h * 0.45), (R, h - 0.04)]
    tl.lathe(sk, prof, M('foam'), 64, u_rep=1)
    for f in (0.18, 0.45, 0.72):
        rr = next(rp for (rp, yy) in prof if yy >= h * f - 1e-6)
        band(sk, rr, h * f, M('foam_tan'), 0.04, 0.008)
    top_ring(sk, R, h)
    base_ring(sk, R * 0.84, m=M('grey'))
    for sgn in (1, -1):  # booster aft attach fittings
        tl.box(sk, V(sgn * (R + 0.06), h * 0.62, 0), (0.14, 0.26, 0.36), M('dark'))
        tl.beam(sk, V(sgn * (R + 0.02), h * 0.62, 0.14), V(sgn * (R + 0.02), h * 0.45, 0.24), 0.05, 0.05, M('steel'))
        tl.beam(sk, V(sgn * (R + 0.02), h * 0.62, -0.14), V(sgn * (R + 0.02), h * 0.45, -0.24), 0.05, 0.05, M('steel'))
    for az in (60, 120):  # tail service mast umbilical plates
        p = polar(az, R + 0.012, h * 0.7)
        tl.box(sk, p, (0.03, 0.3, 0.34), M('grey'), (polar(az, 1), V(0, 1, 0), polar(az + 90, 1)))
    for (x, z) in pts:
        tl.cyl(st, V(x, 0.07, z), V(x * 1.15, h * 0.55, z * 1.15), 0.08, M('alu'), 10, caps=False)
    for k in (0, 90):
        tl.beam(st, polar(k, R * 0.8, 0.3), polar(k + 180, R * 0.8, 0.3), 0.1, 0.2, M('alu'))
    pads(st, pts, s)
    sk.emit('skin', r)
    st.emit('structure', r)
    kit(r, pts, R, h, r_plate=R * 0.82)


def f_superheavy(d, R, h, pts, s, r):
    """Super Heavy: 33 Raptors in rings of 3 / 10 / 20 under a stainless skirt darkened by soot; the inner 13 on the
    thrust puck, the outer 20 each in its own shielded bay; two chines along the sides."""
    sk, st = Acc(), Acc()
    wall(sk, R, h * 0.3, h, M('stainless'), u_rep=1)
    wall(sk, R, 0.0, h * 0.3, M('soot_steel'), u_rep=1)
    for f in (0.3, 0.62):
        band(sk, R, h * f, M('soot_steel') if f < 0.4 else M('dark'), 0.03, 0.008)
    top_ring(sk, R, h)
    base_ring(sk, R, m=M('soot_steel'))
    for az in (90, 270):  # chines
        tl.prism(sk, [[(0.0, 0.25 * h), (0.0, h * 0.98), (0.07, h * 0.9), (0.07, 0.35 * h)]], 0.03, M('stainless'), o=polar(az, R - 0.01) + polar(az + 90, 0.015), U=polar(az, 1), Vv=V(0, 1, 0))
    # the outer engine bays: a short shield tube round each of the outer 20
    for (x, z) in pts[13:]:
        tl.cyl(sk, V(x, 0.0, z), V(x, Y_PLATE + 0.02, z), 0.14, M('soot_steel'), 12, caps=False)
    # thrust puck: a dome under the tank that carries the inner 13
    tl.lathe(st, [(R * 0.56, 0.12), (R * 0.5, h * 0.35), (R * 0.32, h * 0.6), (0.0, h * 0.68)], M('steel'), 40)
    ring_beam(st, R * 0.86, 0.14, M('steel'), 0.08, 0.12, 64)
    for k in range(20):
        tl.beam(st, polar(9 + 18 * k, R * 0.6, 0.14), polar(9 + 18 * k, R * 0.95, h * 0.55), 0.05, 0.05, M('steel'))
    pads(st, pts, s)
    sk.emit('skin', r)
    st.emit('structure', r)
    kit(r, pts, R, h)


def f_starship(d, R, h, pts, s, r):
    """Starship (ship) aft: three sea-level Raptors in the middle, three vacuum Raptors in their own bays; black
    hexagonal tiles on the windward half, bare steel on the other; hinge covers for the aft flaps at +-X."""
    sk, st = Acc(), Acc()
    wall(sk, R, 0.0, h, M('stainless'), seg=32, u_rep=1, a0=math.pi, a1=TAU)       # leeward half (-z side)
    wall(sk, R + 0.012, 0.0, h, M('hex'), seg=32, u_rep=12, a0=0.0, a1=math.pi)    # windward half, tiles (+z side)
    top_ring(sk, R, h)
    base_ring(sk, R, m=M('soot_steel'))
    band(sk, R + 0.012, h * 0.5, M('dark'), 0.02, 0.004)
    for sgn in (1, -1):  # aerocovers over the flap hinges
        c = V(sgn * (R - 0.04), 0, 0)
        prof = [(0.0, h * 0.12), (0.08, h * 0.28), (0.12, h * 0.5), (0.12, h - 0.04)]
        a0, a1 = (-math.pi / 2, math.pi / 2) if sgn > 0 else (math.pi / 2, 3 * math.pi / 2)
        tl.lathe(sk, prof, M('stainless'), 16, c, a0=a0, a1=a1)
    # thrust puck for the centre three, struts out to the vacuum engines
    tl.lathe(st, [(R * 0.32, 0.1), (R * 0.36, h * 0.3), (R * 0.2, h * 0.55), (0.0, h * 0.6)], M('steel'), 32)
    for (x, z) in pts[3:]:
        tl.cyl(st, V(x, 0.07, z), V(x, h * 0.5, z), 0.12, M('steel'), 12, caps=False)
        tl.beam(st, V(x, h * 0.45, z), V(0, h * 0.45, 0), 0.08, 0.12, M('steel'))
    pads(st, pts, s)
    sk.emit('skin', r)
    st.emit('structure', r)
    kit(r, pts, R, h)


def f_electron(d, R, h, pts, s, r):
    """Rocket Lab Electron: nine small engines (eight round one) under a short black carbon-composite skirt."""
    sk, st = frame_skirt(d, R, h, pts, s, {'skin': 'carbon', 'frames': (0.5,)})
    ring_beam(st, math.hypot(*pts[1]), 0.12, M('carbon'), 0.06, 0.1, 40)
    for (x, z) in pts[1:]:
        tl.beam(st, V(0, 0.12, 0), V(x, 0.12, z), 0.05, 0.08, M('carbon'))
    struts(st, pts[1:], R, h, 0.7, 15, 0.04, M('carbon'))
    sk.emit('skin', r)
    st.emit('structure', r)
    kit(r, pts, R, h)


def f_proton(d, R, h, pts, s, r):
    """Proton first stage: six outer fuel tanks (lobes) round the central oxidiser tank, one engine under each lobe
    in its own tail fairing; the centre is open."""
    sk, st = Acc(), Acc()
    rl = R * 0.216
    rc = R * 0.55
    wall(sk, rc, h * 0.3, h, M('white'), seg=40, u_rep=1)
    tl.lathe(sk, [(0.0, h * 0.18), (rc * 0.7, h * 0.22), (rc, h * 0.3)], M('grey'), 40)
    for (x, z) in pts:
        c = (x, 0, z)
        tl.lathe(sk, [(rl * 0.55, 0.02), (rl * 0.8, h * 0.18), (rl, h * 0.3), (rl, h)], M('white'), 24, c)
        tl.lathe(sk, [(rl + 0.006, h * 0.3), (rl + 0.006, h * 0.44)], M('black'), 24, c)
        tl.lathe(sk, [(rl * 0.55 - 0.01, 0.0), (rl * 0.55 + 0.01, 0.0), (rl * 0.55 + 0.01, 0.03)], M('dark'), 24, c)
    # the top: an annulus joining the six lobes and the centre tank under the stage above
    loops = [tl.circle2d(0, 0, R, 64)]
    tl.prism(sk, loops, 0.04, M('grey'), o=(0, h - 0.04, 0))
    top_ring(sk, R, h)
    for (x, z) in pts:
        tl.beam(st, V(x, 0.07, z), V(x * 0.6, h * 0.3, z * 0.6), 0.06, 0.06, M('alu'))
    pads(st, pts, s)
    sk.emit('skin', r)
    st.emit('structure', r)
    # inner pieces: no base plate across an open centre; the shields are rings round each engine
    a_c, a_r, a_n = Acc(), Acc(), Acc()
    for (x, z) in pts:
        tl.lathe(a_c, [(rl * 0.35, 0.005), (rl * 0.5, 0.04)], M('fabric'), 16, (x, 0, z))
        tl.lathe(a_r, [(0.0, 0.03), (rl * 0.52, 0.03), (rl * 0.52, 0.06), (0.0, 0.06)], M('shield'), 16, (x, 0, z))
    a_c.emit('slot_baseShield', r)
    a_r.emit('slot_baseShield__rigid', r)
    a_n.emit('slot_baseShield__none', r)
    for k in ('lines', 'prevalves'):
        feed(r, pts, R, h, k)
    for k in ('none', 'accumulator'):
        pogo(r, pts, R, h, k)


def f_n1(d, R, h, pts, s, r):
    """N1 Block A: thirty NK-15s, 24 round the rim and six inside, on two ring beams and spokes, under a stringered
    light-grey skirt; four lattice-fin roots at 45 degrees. Steered by throttling opposite engines (KORD)."""
    sk, st = frame_skirt(d, R, h, pts, s, {'skin': 'corr_white', 'ridges': 36, 'frames': (0.3, 0.55, 0.8)})
    for k in range(4):  # grid-fin root fittings
        az = 45 + 90 * k
        tl.box(sk, polar(az, R + 0.03, h * 0.45), (0.08, 0.5, 0.3), M('dark'), (polar(az, 1), V(0, 1, 0), polar(az + 90, 1)))
    ro, ri = math.hypot(*pts[6]), math.hypot(*pts[0])
    ring_beam(st, ro, 0.14, M('alu'), 0.08, 0.14, 64)
    ring_beam(st, ri, 0.14, M('alu'), 0.08, 0.14, 40)
    for k in range(12):
        tl.beam(st, polar(15 + 30 * k, ri, 0.14), polar(15 + 30 * k, ro, 0.14), 0.06, 0.12, M('alu'))
    for k in range(24):
        tl.beam(st, polar(7.5 + 15 * k, ro, 0.2), polar(7.5 + 15 * k, R * 0.96, h * 0.6), 0.04, 0.04, M('alu'))
    tl.cyl(st, V(0, 0.14, 0), V(0, h * 0.7, 0), ri * 0.5, M('alu'), 20, caps=False)
    sk.emit('skin', r)
    st.emit('structure', r)
    kit(r, pts, R, h)
    # steering: KORD throttle valves on the outer engines' feeds, or gimbal actuators
    a, b = Acc(), Acc()
    for (x, z) in pts[6:]:
        az = math.degrees(math.atan2(z, x))
        tl.box(a, V(x * 0.94, h * 0.25, z * 0.94), (0.07, 0.09, 0.07), M('amber'), (polar(az, 1), V(0, 1, 0), polar(az + 90, 1)))
        for da in (90, 0):
            p0 = V(x, 0.03, z) + polar(az + da, 0.08)
            tl.cyl(b, p0, p0 + V(0, 0.16, 0) + polar(az + da, 0.05), 0.015, M('steel'), 6, caps=False)
    tl.box(a, V(0, h * 0.5, 0), (0.25, 0.18, 0.2), M('dark'))  # the KORD control unit
    a.emit('slot_steer', r)
    b.emit('slot_steer__gimbals', r)


def f_energia(d, R, h, pts, s, r):
    """Energia core (Block Ts): four RD-0120s in a square on a cross frame; four booster attach fittings at 45 degrees."""
    sk, st = frame_skirt(d, R, h, pts, s, {'skin': 'offwhite', 'band': 'dark', 'bandFrac': 0.2, 'frames': (0.45, 0.75)})
    for k in range(4):
        az = 45 + 90 * k
        p = polar(az, R + 0.07, h * 0.55)
        tl.box(sk, p, (0.16, 0.34, 0.3), M('dark'), (polar(az, 1), V(0, 1, 0), polar(az + 90, 1)))
        tl.cyl(sk, polar(az, R + 0.15, h * 0.55), polar(az, R + 0.22, h * 0.55), 0.06, M('steel'), 10)
    for k in (0, 90):
        tl.beam(st, polar(k, R * 0.95, 0.22), polar(k + 180, R * 0.95, 0.22), 0.12, 0.26, M('alu'))
    struts(st, pts, R, h, 0.7, 25, 0.06)
    sk.emit('skin', r)
    st.emit('structure', r)
    kit(r, pts, R, h)


FRAMES = {
    'thrust_boattail_m': f_boattail,
    'thrust_octaweb_m': f_octaweb,
    'thrust_five_l': f_five,
    'thrust_twin_m': lambda *a: f_twin(*a, look={'skin': 'grey', 'band': 'dark', 'bandFrac': 0.22}),
    'thrust_twin_l': f_twin,
    'thrust_triad_m': f_triad,
    'thrust_triad_l': f_triad,
    'thrust_quad_m': f_quad,
    'thrust_seven_l': f_seven,
    'thrust_atlas_m': f_atlas,
    'thrust_sib_l': f_sib,
    'thrust_sii_l': f_sii,
    'thrust_sls_l': f_sls,
    'thrust_superheavy_l': f_superheavy,
    'thrust_starship_l': f_starship,
    'thrust_electron_s': f_electron,
    'thrust_proton_l': f_proton,
    'thrust_n1_l': f_n1,
    'thrust_energia_l': f_energia,
}


def stand_in_engines(r, pts, s, h):
    """Preview only: a simple bell at every mount, scaled like the game's cluster (engine_m proportions)."""
    a = Acc()
    He = 2.2 * s
    for (x, z) in pts:
        tl.lathe(a, [(0.275 * He, -He), (0.2 * He, -He * 0.75), (0.08 * He, -He * 0.46), (0.12 * He, -He * 0.3), (0.12 * He, -He * 0.15), (0.05 * He, 0.0)], M('regen'), 20, (x, 0, z), u_rep=6)
    return a.emit('preview_engines', r)


def preview(r, R, h, pts, s, slug, shots):
    eng = stand_in_engines(r, pts, s, h)
    tl.hide_except(r, {})
    D = R * 2
    tl.look(os.path.join(shots, f'{slug}_side.png'), (0, h * 0.2, 0), (D * 1.5, h * 0.9, D * 1.4))
    tl.look(os.path.join(shots, f'{slug}_below.png'), (0, h * 0.3, 0), (D * 0.6, -D * 1.5, D * 0.9))
    tl.hide_except(r, {'baseShield': '__none__', 'feed': 'prevalves', 'pogo': 'accumulator'})
    for o in r.children:
        if o.name == 'skin':
            o.hide_render = True
    tl.look(os.path.join(shots, f'{slug}_inside.png'), (0, h * 0.4, 0), (D * 1.4, h * 1.4, D * 1.2))
    tl.show_all(r)
    bpy_remove(eng)


def bpy_remove(o):
    import bpy
    bpy.data.objects.remove(o, do_unlink=True)


def main():
    only = tl.C.arg('--only')
    shots = tl.shots_arg()
    for slug in FRAMES:
        if only and slug not in only.split(','):
            continue
        if slug not in PARTS:
            print(f'[model] skip {slug}: not in parts.json')
            continue
        r, R, h, pts, s, _ = build(slug)
        tl.report_groups(r)
        own = (PARTS[slug].get('hullProfile') or {}).get('kind') == 'own'
        tl.export(r, slug, height=h, radius=None if own else R)
        if shots:
            os.makedirs(shots, exist_ok=True)
            preview(r, R, h, pts, s, slug, shots)


main()
