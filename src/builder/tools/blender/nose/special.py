"""
The two crew noses that are not simple capsules (SpaceB&E builder, Role 1, nose section):
  starship_nose - Starship's stainless-steel nose: weld rings, black hexagonal tiles on the windward half, the two
                  forward flaps, HLS-style landing thrusters and windows, the crew deck inside.
  dream_chaser  - Sierra Space's Dream Chaser standing nose-up as it rides in the fairing: a lifting body with a black
                  tiled belly and white top, wings folded up along its sides with their tip fins, the berthing port at
                  the aft end toward the Shooting Star module.
Run from the repo root:
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/nose/special.py -- [--only starship_nose] [--shots DIR]
Same contract and slot names as capsules.py (kit `capsule`).
"""
import os, sys, math
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nl  # noqa: E402
from nl import V, Acc, M, er, ea, polar, lathe, cyl, sphere, torus, tube, box, beam, patch, disc, band, ring_on, window, port, strip_along, Rev, fillet, resample, FRONT, NECK, DEG, RADIUS, TAU  # noqa: E402
import inner as I  # noqa: E402
import capsules as CP  # noqa: E402

SPECS = {
    'starship_nose': dict(size='l', H=4.9, f=0.375, prof=[[1, 0], [1, 0.35], [0.93, 0.55], [0.74, 0.75], [0.45, 0.9], [0.14, 1]],
                          real=dict(couches='fixed', hatch='outward', windows='small', docking='nds', landing='rockets', suits='pressure'),
                          seats=dict(n=4, kind='recliner', yf=0.36, az=0, spacing=0.0, circle=0.42), suit='suit_white',
                          chutes=(3, 2, 0.6, 0.45, 0.26, 0.45), skin='steel'),
    'dream_chaser': dict(size='l', H=5.6, f=0.62, prof=[[0.86, 0], [0.86, 0.45], [0.8, 0.65], [0.6, 0.85], [0.35, 0.96], [0.267, 1]],
                         real=dict(couches='fixed', hatch='outward', windows='small', docking='cbm', landing='hard_land', suits='pressure'),
                         seats=dict(n=4, kind='fixed', yf=0.42, az=180, spacing=0.62, grid=True), suit='suit_white',
                         chutes=(1, 1, 0.12, 0.0, 0.2, 0.35), skin='white'),
}
WINDWARD = FRONT - 60.0  # the centre of Starship's tiled half


def flip_y(acc, y0, y1):
    """Mirrors a piece top to bottom between y0 and y1 (for hardware facing down)."""
    acc.V = [(x, y0 + y1 - y, -z) for (x, y, z) in acc.V]


# ------------------------------------------------------------------ Starship
def build_starship(slug, shots):
    sp = SPECS[slug]
    nl.reset()
    ctx = CP.Ctx(slug, sp)
    H, R, f = ctx.H, ctx.R, ctx.f
    root = nl.root(slug)
    prof = [(rf * R, yf * H) for (rf, yf) in (ctx.data_profile or sp['prof'])]
    rt = prof[-1][0]
    prof[-1] = (rt, H - 0.08)
    prof = fillet(prof, 0.12, 5) + [(rt * 0.75, H - 0.03), (rt * 0.4, H - 0.005), (0.0, H)]
    ctx.cupola_r = rt * 0.7
    prof = resample(prof, 0.25)
    rev = Rev(prof)
    b = ctx.body
    steel, hexm = M('steel'), M('hex')
    s_tip = rev.s_at_y(0.86 * H)
    lo = [p for p in prof if p[1] <= 0.86 * H + 1e-6]
    hi = [p for p in prof if p[1] >= 0.86 * H - 1e-6]
    # the windward half is tiled from the base to the nose tip, the leeward half bare steel
    lathe(b, lo, hexm, 40, az0=WINDWARD - 90, az1=WINDWARD + 90, u_rep=9, v_scale=0.75)
    lathe(b, lo, steel, 40, az0=WINDWARD + 90, az1=WINDWARD + 270, u_rep=1)
    lathe(b, hi, hexm, 40, u_rep=6, v_scale=0.75)
    # weld rings every 1.83 m (real), on the steel half
    y = 0.0
    while y < 0.84 * H:
        y += 1.83 * f
        if y < 0.84 * H:
            s = rev.s_at_y(y)
            pts = []
            for dv in (-0.01, 0.01):
                r_, yy, dr, dy = rev.at_s(s + dv)
                pts.append((r_ + dy * 0.004, yy - dr * 0.004))
            lathe(b, pts, M('steel_m'), 32, az0=WINDWARD + 90, az1=WINDWARD + 270)
    # base ring (the joint with the ship below)
    lathe(b, [(R + 0.006, 0.0), (R + 0.006, 0.04), (R - 0.03, 0.04)], M('steel_m'), 64)
    lathe(b, [(0.0, 0.004), (R, 0.004)], M('dark'), 48)
    # the two forward flaps on the edges of the tiled half: hinged to the body, windward face tiled
    for side in (-1, 1):
        a = WINDWARD + side * 88
        y0, y1 = 0.36 * H, 0.76 * H
        r0, r1 = rev.r_at_y(y0), rev.r_at_y(y1)
        span0, span1 = 0.72 * R / 1.6875, 0.3 * R / 1.6875
        p = [polar(a, r0, y0), polar(a, r1, y1), polar(a, r1 + span1, y1 - 0.25), polar(a, r0 + span0, y0 + 0.22)]
        nrm = ea(a) * (-side)
        t = 0.08
        vs = [q + nrm * t / 2 for q in p] + [q - nrm * t / 2 for q in p]
        b.add(vs[:4], [[0, 1, 2, 3]] if side > 0 else [[3, 2, 1, 0]], hexm)
        b.add(vs[4:], [[3, 2, 1, 0]] if side > 0 else [[0, 1, 2, 3]], steel)
        sides = [[0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]
        b.add(vs, sides if side < 0 else [q[::-1] for q in sides], M('dark'))
        # hinge fairing along the body
        strip_along(b, rev, a, rev.s_at_y(y0 - 0.05), rev.s_at_y(y1 + 0.05), 0.12, 0.05, M('steel_m'))
    # leeward details: windows band, RCS ports, the cargo / crew door outline
    lee = WINDWARD + 180
    for j in range(4):
        window(b, rev, lee - 30 + 20 * j, rev.s_at_y(0.8 * H), 0.3 * f * 2, 0.36 * f * 2, 0.003, bw=0.03)
    for a in (lee - 70, lee + 70, WINDWARD - 70, WINDWARD + 70):
        port(b, rev, a, rev.s_at_y(0.9 * H), 0.03)
    patch(b, rev, lee, rev.s_at_y(0.56 * H), 0.85, 1.1, M('dark'), 0.002, 0.0, 6, 6, 1.0, 0.08)
    patch(b, rev, lee, rev.s_at_y(0.56 * H), 0.8, 1.05, steel, 0.004, 0.0, 6, 6, 1.0, 0.07)
    b.emit('body', root)
    sp2 = dict(sp)
    sp2['hatch'] = (WINDWARD + 180 - FRONT, 0.56, 0.8 / f, 1.05 / f, 0.07 / f)
    sp2['windows'] = [(WINDWARD + 180 - FRONT - 30 + 20 * j, 0.8, 0.6, 0.72, 'rect', 1) for j in range(4)]
    ctx.spec = sp2
    seats = CP.add_couches(ctx, rev, root)
    CP.add_suits(ctx, seats, root, rev)
    CP.add_hatch(ctx, rev, root)
    CP.add_windows(ctx, rev, root)
    # docking (HLS-style port on the nose tip) and the landing thrusters (HLS: high on the body, outside)
    def dock(kind):
        acc = Acc()
        if kind != 'none':
            I.docking(acc, kind, H - 0.03, rt * 0.7, f)
        return acc
    CP.emit_slot(root, 'docking', dock)

    def land(kind):
        acc = Acc()
        if kind == 'rockets':
            for j in range(8):
                a = WINDWARD + 180 + 22.5 + 45 * j
                P, N, Tm, Ta = rev.frame_y(a, 0.62 * H, 0.0)
                box(acc, P + N * 0.08, (0.24, 0.5, 0.16), M('steel_m'), (Ta, Tm, N))
                nl.bell(acc, P + N * 0.12 - Tm * 0.25, (-Tm + N * 0.3).normalized(), 0.03, 0.07, 0.14, M('nozzle'), 8)
        else:
            I.chutes_ring(acc, 3, 2, 0.55 * H, rev.r_at_y(0.75 * H) * 0.6, 0.2 * f * 2, 0.35, f)
            if kind == 'airbags':
                I.airbags(acc, 6, R * 0.6, 0.02, f * 2)
            elif kind == 'hard_land':
                I.crush_pads(acc, [V(h.x, h.y - 0.25, h.z) for (h, a) in seats], f * 2)
        return acc
    CP.emit_slot(root, 'landing', land)
    CP.check_slots(root, rev, H)
    nl.report_groups(root)
    tris, size = nl.export(root, slug, H, R)
    if shots:
        CP.preview(root, slug, ctx, shots)
    return slug, tris, size


# ------------------------------------------------------------------ Dream Chaser
def dc_section(t, W, D):
    """Half-width and the top / belly depths of the lifting body at t (0 aft .. 1 nose tip)."""
    taper = max(0.0, 1 - t ** 2.4) ** 0.5
    hw = W * (0.92 + 0.08 * (1 - t)) * taper
    top = D * 0.62 * max(0.0, 1 - t ** 2.0) ** 0.55
    bel = D * 0.38 * max(0.0, 1 - t ** 3.0) ** 0.5
    return hw, top, bel


def build_dream_chaser(slug, shots):
    sp = SPECS[slug]
    nl.reset()
    ctx = CP.Ctx(slug, sp)
    H, R, f = ctx.H, ctx.R, ctx.f
    root = nl.root(slug)
    env = 0.86 * R  # the envelope radius (hull profile)
    W, D = 1.02 * R / 1.6875, 1.25 * R / 1.6875  # real ~3.3 m wide and ~2 m deep, scaled
    belly_dir = er(FRONT + 135)   # the belly faces this way (the tiled side seen at an angle)
    side_dir = ea(FRONT + 135)
    n_ring, n_pts = 34, 40
    rings_top, rings_bel = [], []
    b = Acc()
    verts, faces_w, faces_k = [], [], []
    grid = []
    for i in range(n_ring + 1):
        t = i / n_ring
        y = H * (1 - (1 - t) ** 1.0) if i < n_ring else H
        hw, top, bel = dc_section(t, W, D)
        row = []
        for j in range(n_pts):
            th = TAU * j / n_pts
            c, s = math.cos(th), math.sin(th)
            # a superellipse with a flat belly: s > 0 is the top (white), s < 0 the belly (black)
            dep = top if s >= 0 else bel
            x = hw * math.copysign(abs(c) ** 0.7, c)
            z = dep * math.copysign(abs(s) ** (0.9 if s >= 0 else 0.45), s)
            p = side_dir * x - belly_dir * z + V(0, y, 0)
            row.append(len(verts))
            verts.append(p if i < n_ring else V(0, H, 0) - belly_dir * (top - bel) * 0.0)
        grid.append(row)
    for i in range(n_ring):
        for j in range(n_pts):
            a, b2, c2, d = grid[i][j], grid[i][(j + 1) % n_pts], grid[i + 1][(j + 1) % n_pts], grid[i + 1][j]
            th = TAU * (j + 0.5) / n_pts
            face = [a, b2, c2, d] if i < n_ring - 1 else [a, b2, c2]
            (faces_w if math.sin(th) >= -0.05 and i < n_ring - 3 else faces_k).append(face)
    # orient: outward normals (the loop above runs clockwise or anticlockwise depending on the frame)
    va, vb, vc = verts[faces_w[0][0]], verts[faces_w[0][1]], verts[faces_w[0][2]]
    cen = V(0, va.y, 0)
    if (vb - va).cross(vc - va).dot(va - cen) < 0:
        faces_w = [q[::-1] for q in faces_w]
        faces_k = [q[::-1] for q in faces_k]
    b.add(verts, faces_w, M('white'))
    b.add(verts, faces_k, M('hex') if False else M('abl_pica'))
    # the aft face: a flat bulkhead with the berthing ring opening
    aft = [verts[k] for k in grid[0]]
    b.add(aft + [V(0, 0.002, 0)], [[j, (j + 1) % n_pts, n_pts] for j in range(n_pts)], M('dark'))
    # the nose cap (TUFROC, dark grey) and the black leading edges are in the belly material; the white top's tiles
    # wings folded up along the sides from the belly chines, with their tip fins canted out
    for side in (-1, 1):
        root_y0, root_y1 = 0.02 * H, 0.42 * H
        hw0, _, bel0 = dc_section(0.05, W, D)
        base = side_dir * side * hw0 * 0.92 + belly_dir * bel0 * 0.2
        span = env - hw0 * 0.92 - 0.06
        out = side_dir * side
        up = belly_dir * -1
        p = [base + V(0, root_y0, 0), base + V(0, root_y1, 0), base + out * 0.05 + up * 0.0 + V(0, root_y1 * 0.7, 0) + out * span * 0.4,
             base + out * span * 0.55 + V(0, root_y0 + 0.1, 0)]
        t = 0.08
        nrm = belly_dir
        vs = [q - nrm * t / 2 for q in p] + [q + nrm * t / 2 for q in p]
        b.add(vs, [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]], M('white'))
        # the tip fin (winglet), black leading edge
        tip = base + out * span * 0.5 + V(0, root_y0 + 0.05, 0)
        fin = [tip, tip + V(0, 0.9 * H * 0.18, 0), tip + V(0, 0.9 * H * 0.18, 0) + up * 0.55 - out * 0.08, tip + up * 0.7 - out * 0.1]
        nv = out
        vs = [q - nv * 0.03 for q in fin] + [q + nv * 0.03 for q in fin]
        b.add(vs, [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]], M('white'))
        # the folding hinge line
        cyl(b, base + V(0, root_y0, 0), base + V(0, root_y1, 0), 0.04, M('dark'), 8)
    # body flaps at the aft end of the belly, and the docking ring opening
    for side in (-1, 1):
        c = side_dir * side * W * 0.35 + belly_dir * D * 0.36 + V(0, 0.15, 0)
        box(b, c, (0.5, 0.3, 0.06), M('abl_pica'), (side_dir, V(0, 1, 0), belly_dir))
    torus(b, (0, 0.02, 0), 0.38, 0.03, M('alu'), 24, 4)
    b.emit('body', root)
    # inner pieces: use an inscribed surface of revolution (the smaller of the half-width and the depths) for fitting
    ins = []
    for i in range(n_ring + 1):
        t = i / n_ring
        hw, top, bel = dc_section(t, W, D)
        ins.append((max(0.02, min(hw, top, bel * 1.6) * 0.95), H * t))
    rev = Rev(ins)
    sp2 = dict(sp)
    sp2['hatch'] = (180 - (FRONT - (FRONT + 90 - 180)) * 0, 0.5, 0.8, 1.0, 0.12)
    sp2['hatch'] = (-90, 0.5, 0.8, 1.0, 0.12)  # on the top (dorsal) side, opposite the belly
    sp2['windows'] = [(-90 - 12, 0.86, 0.3, 0.22, 'rect', 1), (-90 + 12, 0.86, 0.3, 0.22, 'rect', 1)]
    ctx.spec = sp2
    seats = CP.add_couches(ctx, rev, root)
    CP.add_suits(ctx, seats, root, rev)
    CP.add_hatch(ctx, rev, root)
    CP.add_windows(ctx, rev, root)
    def dock(kind):
        acc = Acc()
        if kind != 'none':  # the berthing / docking port at the aft end, facing the Shooting Star
            I.docking(acc, kind, 0.45, 0.4, f)
            flip_y(acc, 0.0, 0.47)
        return acc
    CP.emit_slot(root, 'docking', dock)

    def land(kind):
        acc = Acc()
        if kind == 'hard_land':  # Dream Chaser lands on a runway: tricycle gear stowed in the belly
            for (yy, w) in ((0.78 * H, 0.0), (0.3 * H, -0.45), (0.3 * H, 0.45)):
                c = side_dir * w + belly_dir * D * 0.2 + V(0, yy, 0)
                cyl(acc, c, c + V(0, 0.55, 0), 0.04, M('frame'), 8)
                cyl(acc, c - side_dir * 0.08, c + side_dir * 0.08, 0.13, M('rubber'), 12)
        else:
            I.chute_pack(acc, (0, 0.6 * H, 0), (0, 1, 0), 0.18, 0.35, f)
            if kind == 'airbags':
                I.airbags(acc, 4, 0.4, 0.5 * H, f)
            elif kind == 'rockets':
                I.landing_rockets(acc, 4, 0.4, 0.05, f)
        return acc
    CP.emit_slot(root, 'landing', land)
    nl.report_groups(root)
    tris, size = nl.export(root, slug, H, R)
    if shots:
        CP.preview(root, slug, ctx, shots)
    return slug, tris, size


BUILD = {'starship_nose': build_starship, 'dream_chaser': build_dream_chaser}

if __name__ == '__main__':
    only = nl.C.arg('--only')
    shots = nl.C.arg('--shots')
    todo = only.split(',') if only else list(BUILD)
    results = [BUILD[s](s, shots) for s in todo]
    for (s, t, b) in results:
        print(f'[special] {s}: {t} triangles, {b / 1024:.0f} KB')
