"""Apollo front closeouts: flat panels in the console colour that wall the whole front of the cabin so, from the commander's eye, the forward view is ONLY the main display console.
Pieces (game frame, eye = origin, -Z forward): a backdrop in the console's own plane (fills wall to wall beside the console), a hood plane that slopes from the console's top edge
up over the head side to the shell, and a lower plane under the console down to the equipment bay. Each is a flat polygon clipped against the inner skin and sunk a little into it."""
import math
import numpy as np
from mathutils import Vector, Matrix
from cc_core import *
import cc_core as C

SINK = 0.025          # polygon edges sink this far into the shell wall (no light leaks)
DEBUG = True
AX = 0.0
FLAT = (0.5, 0.5)


def _inside(ctx, q, sink):
    c = ctx.cap_of_game(q)
    return math.hypot(c.x, c.y) <= ctx.rin(c.z) + sink and 0.05 < c.z < ctx.H - 0.05


def _xext(ctx, m, sink):
    """(xl, xr): x range of the plane row through m that is inside the shell; the cone axis is off to the side (x = AX), so scan out from it"""
    c0 = m + Vector((AX, 0, 0))
    if not _inside(ctx, c0, sink):
        return None
    res = []
    for sg in (-1, 1):
        lo, hi = 0.0, 0.6
        while _inside(ctx, c0 + Vector((sg * hi, 0, 0)), sink) and hi < 3.0:
            lo, hi = hi, hi + 0.6
        for _ in range(18):
            mid = (lo + hi) / 2
            if _inside(ctx, c0 + Vector((sg * mid, 0, 0)), sink):
                lo = mid
            else:
                hi = mid
        res.append(AX + sg * lo)
    return tuple(res)


def clip_plane(ctx, origin, ey, s0, s1, ds=0.03, sink=SINK):
    """rows of (s, xl, xr) from s0 toward s1 while the axis point of the row stays inside the shell; the last row is where it leaves"""
    ey = Vector(ey).normalized()
    rows = []
    n = int(abs(s1 - s0) / ds) + 1
    sgn = 1 if s1 >= s0 else -1
    prev = None
    for i in range(n + 1):
        s = s0 + sgn * min(i * ds, abs(s1 - s0))
        x = _xext(ctx, origin + ey * s, sink)
        if x is None:
            a, b = prev[0], s
            for _ in range(16):
                mid = (a + b) / 2
                if _xext(ctx, origin + ey * mid, sink) is None:
                    b = mid
                else:
                    a = mid
            rows.append((a,) + _xext(ctx, origin + ey * a, sink))
            break
        rows.append((s,) + x)
        prev = (s,) + x
    return ey, rows


def plane_mesh(part, mat, origin, ey, rows, eye=Vector((0, 0, 0)), tile=0.5):
    """quad strip between consecutive rows, wound toward the eye, planar UVs (seams are continuous across a plane)"""
    ex = Vector((1, 0, 0))
    nrm = ex.cross(ey).normalized()
    if nrm.dot(eye - origin) < 0:
        nrm = -nrm
    verts, faces, uvs = [], [], []
    def P(s, x):
        return origin + ey * s + ex * x
    for (sa, la, ra), (sb, lb, rb) in zip(rows[:-1], rows[1:]):
        q = [P(sa, la), P(sa, ra), P(sb, rb), P(sb, lb)]
        o = len(verts)
        verts += [tuple(v) for v in q]
        f = [o, o + 1, o + 2, o + 3]
        # winding: face normal toward the eye
        fn = (q[1] - q[0]).cross(q[3] - q[0])
        if fn.dot(nrm) < 0:
            f = f[::-1]
        faces.append(tuple(f))
        uvs.append([FLAT] * 4)
    part.add(mat, (verts, faces), uvs)
    return nrm


def closeout_texture():
    """dark panel metal in the console's colour with fine panel seams (one 0.5 m tile, seam lines on its border and a mid seam)"""
    S = 512
    cv = Canvas(S, S, (0.045, 0.05, 0.045))
    rng = np.random.default_rng(5)
    cv.col[:] = np.clip(cv.col + (rng.random((S, S, 1)) - 0.5) * 0.006, 0, 1)
    cv.rect(0, 0, S, 3, (0.0, 0.0, 0.0)); cv.rect(0, 3, S, 2, (0.10, 0.105, 0.10))
    cv.rect(0, 0, 3, S, (0.0, 0.0, 0.0)); cv.rect(3, 0, 2, S, (0.10, 0.105, 0.10))
    return make_image('closeout_tex', cv.col)


def rivets(part, pts, n_dir, r=0.0065):
    for p in pts:
        part.add('steel', xform(lathe_geo([(0, 0), (r, 0), (r * 0.8, 0.0035), (0, 0.0045)], 8), basis_from_dir(n_dir) @ Matrix(((0, 0, 1), (0, 1, 0), (1, 0, 0))), p))


LIM = 86.0            # the closeouts cover everything the eye sees within this angle of straight ahead
LINER = 0.02         # the shell liner sits this far inside the inner skin


class Wall:
    """the front wall profile in (y, z): z of the wall surface as a function of y (every plane runs along x)"""
    def __init__(self, B, T, hey):
        self.B, self.T, self.k = B, T, hey.z / hey.y
        self.m = (T.z - B.z) / (T.y - B.y)
    def z(self, y):
        if y <= self.B.y:
            return self.B.z
        if y <= self.T.y:
            return self.B.z + self.m * (y - self.B.y)
        return self.T.z + self.k * (y - self.T.y)


def _ang(q):
    return math.degrees(math.acos(max(-1.0, min(1.0, -q.z / max(q.length, 1e-6)))))


def shell_pt(ctx, phi, gz, off=0.0):
    """game point on the inner skin at azimuth phi (capsule frame) and game depth gz; off > 0 moves it into the cabin"""
    z = ctx.e.z - gz
    r = ctx.rin(z) - off
    return ctx.g((r * math.cos(phi), r * math.sin(phi), z))


def bis(f, a, b, n=30):
    """root of the sign change of f between a and b"""
    fa = f(a)
    for _ in range(n):
        m = (a + b) / 2
        if (f(m) > 0) == (fa > 0):
            a = m
        else:
            b = m
    return (a + b) / 2


def liner(ctx, part, wall, ncol=96, rows=6):
    """conformal faceted skin on the shell between the LIM rim and the front wall, in the console colour"""
    cols = []
    for k in range(ncol):
        phi = 2 * math.pi * k / ncol
        # rim: first depth (from the eye plane forward) where the skin leaves the LIM cone of view
        zs = np.linspace(0.25, -0.9, 60)
        rim = None
        for a_, b_ in zip(zs[:-1], zs[1:]):
            if _ang(shell_pt(ctx, phi, a_)) >= LIM > _ang(shell_pt(ctx, phi, b_)):
                rim = bis(lambda g: _ang(shell_pt(ctx, phi, g)) - LIM, a_, b_)
                break
        if rim is None:
            C.log('liner col', k, 'no rim'); cols.append(None); continue
        c = lambda g: shell_pt(ctx, phi, g).z - wall.z(shell_pt(ctx, phi, g).y)
        if c(rim) <= 0.0:
            C.log('liner col', k, 'rim behind wall', round(rim, 3)); cols.append(None); continue          # the rim is already behind the wall here
        end = None
        for g in np.linspace(rim, rim - 1.6, 80):
            if c(g) <= -0.03:
                end = g; break
        if end is None:
            C.log('liner col', k, 'no end', round(rim, 3)); cols.append(None); continue
        col = []
        # chamfered rim: a lip from the wall (embedded) to the liner over 4 cm of depth
        col.append(shell_pt(ctx, phi, rim, -0.012))
        col.append(shell_pt(ctx, phi, rim - 0.035, LINER))
        for j in range(1, rows + 1):
            col.append(shell_pt(ctx, phi, (rim - 0.035) + (end - rim + 0.035) * j / rows, LINER))
        cols.append(col)
    axis = Vector((AX, ctx.g((0, 0, ctx.e.z)).y, 0))
    verts, faces, uvs = [], [], []
    def uv(p):
        return (math.atan2(p.y - axis.y, p.x - axis.x) * 0.9 / 0.5, p.z / 0.5)
    for k in range(ncol):
        A, Bc = cols[k], cols[(k + 1) % ncol]
        if A is None or Bc is None:
            continue
        for j in range(min(len(A), len(Bc)) - 1):
            q = [A[j], Bc[j], Bc[j + 1], A[j + 1]]
            cen = sum(q, Vector()) / 4
            fn = (q[1] - q[0]).cross(q[3] - q[0])
            to_eye = Vector((AX, cen.y * 0 + axis.y, cen.z)) - cen
            o = len(verts)
            idx = [0, 1, 2, 3]
            if fn.dot(to_eye) < 0:
                idx = idx[::-1]
            verts += [tuple(v) for v in q]
            faces.append(tuple(o + i for i in idx))
            uvs.append([FLAT] * 4)
    part.add('plate', (verts, faces), uvs)
    return len(faces)


def _islands(d):
    par = list(range(len(d['v'])))
    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]; a = par[a]
        return a
    for f in d['f']:
        for i in f[1:]:
            ra, rb = find(f[0]), find(i)
            if ra != rb:
                par[ra] = rb
    return [find(f[0]) for f in d['f']]


def cull(pp, zone, mats=None):
    """drop every connected island (one locker, one frame ...) of the part whose centre lies in the zone"""
    n = 0
    for mat, d in list(pp.m.items()):
        if mats is not None and mat not in mats:
            continue
        if not d['f']:
            continue
        roots = _islands(d)
        dead = set()
        for f, r in zip(d['f'], roots):
            if r in dead:
                continue
            for i in f:
                if zone(pp.pos + pp.rot @ Vector(d['v'][i])):
                    dead.add(r)
                    break
        if not dead:
            continue
        keep = [k for k, r in enumerate(roots) if r not in dead]
        n += len(set(roots)) - len(set(roots[k] for k in keep))
        used = sorted({i for k in keep for i in d['f'][k]})
        remap = {i: j for j, i in enumerate(used)}
        d['v'] = [d['v'][i] for i in used]
        d['uv'] = [d['uv'][k] for k in keep]
        d['f'] = [tuple(remap[i] for i in d['f'][k]) for k in keep]
    return n


def _ext(rows, s):
    """(xl, xr) of the clipped plane at plane coordinate s (rows may run toward decreasing s)"""
    for (sa, la, ra), (sb, lb, rb) in zip(rows[:-1], rows[1:]):
        lo, hi = min(sa, sb), max(sa, sb)
        if lo - 1e-9 <= s <= hi + 1e-9:
            t = 0.0 if hi == lo else (s - sa) / (sb - sa)
            return la + (lb - la) * t, ra + (rb - ra) * t
    return None


def _quad(part, mat, o, ex, ey, nrm, x0, x1, s0, s1, lift, uv=None):
    q = [o + ex * x0 + ey * s0 + nrm * lift, o + ex * x1 + ey * s0 + nrm * lift, o + ex * x1 + ey * s1 + nrm * lift, o + ex * x0 + ey * s1 + nrm * lift]
    fn = (q[1] - q[0]).cross(q[3] - q[0])
    idx = (0, 1, 2, 3) if fn.dot(nrm) > 0 else (3, 2, 1, 0)
    u = uv or [(0, 0), (1, 0), (1, 1), (0, 1)]
    part.add(mat, ([tuple(v) for v in q], [idx]), [[u[i] for i in idx]])


def seams(part, o, ey, rows, nrm, s_seams, x_seams, rivet=True, inset=0.05):
    """fine panel seams (2.5 mm light lines, 0.8 mm proud) with a screw head at every crossing"""
    ex = Vector((1, 0, 0))
    n = 0
    for s in s_seams:
        e = _ext(rows, s)
        if e is None:
            continue
        _quad(part, 'trimdark', o, ex, ey, nrm, e[0] + inset, e[1] - inset, s - 0.00125, s + 0.00125, 0.0008, [FLAT_T] * 4 if False else None)
    s_all = sorted(r[0] for r in rows)
    for x in x_seams:
        pts = [s for s in np.arange(s_all[0] + inset, s_all[-1] - inset, 0.02) if (_ext(rows, s) and _ext(rows, s)[0] + inset < x < _ext(rows, s)[1] - inset)]
        if len(pts) < 2:
            continue
        # one strip per contiguous run
        runs, cur = [], [pts[0]]
        for a, b in zip(pts[:-1], pts[1:]):
            if b - a > 0.03:
                runs.append(cur); cur = [b]
            else:
                cur.append(b)
        runs.append(cur)
        for r in runs:
            if len(r) > 1:
                _quad(part, 'trimdark', o, ex, ey, nrm, x - 0.00125, x + 0.00125, r[0], r[-1], 0.0008)
    if rivet:
        for s in s_seams:
            e = _ext(rows, s)
            if e is None:
                continue
            for x in x_seams:
                if e[0] + inset < x < e[1] - inset:
                    c = o + ex * x + ey * s + nrm * 0.0008
                    part.sphere('trimdark', 0.0055, c.x, c.y, c.z, n=6, m=3)
                    n += 1
    return n


def placard(part, text, o, ex, ey, nrm, x, s, w, h, seed):
    cv = Canvas(int(w * 2000), int(h * 2000), (0.34, 0.34, 0.32))
    cv.outline(2, 2, cv.w - 4, cv.h - 4, (0.12, 0.12, 0.12), 3)
    lines = text.split('|')
    for i, ln in enumerate(lines):
        cv.mtext(ln, cv.w / 2, cv.h * (0.5 + (i - (len(lines) - 1) / 2) * 0.36), cv.h * 0.2, (0.08, 0.08, 0.08))
    name = 'closeout_label%d' % seed
    material(name, (1, 1, 1), 0.7, image=make_image(name, cv.col))
    _quad(part, name, o, ex, ey, nrm, x - w / 2, x + w / 2, s - h / 2, s + h / 2, 0.0012)
    for sx in (-1, 1):
        for sy in (-1, 1):
            c = o + ex * (x + sx * (w / 2 - 0.008)) + ey * (s + sy * (h / 2 - 0.008)) + nrm * 0.0012
            part.sphere('trimdark', 0.0045, c.x, c.y, c.z, n=6, m=3)


def build(ctx, root, mats, panel_info=None):
    import cc_panel as PN
    P = PN.PCtx(ctx)
    global AX
    AX = ctx.g((0, 0, ctx.e.z)).x
    global FLAT
    FLAT = ctx.flat_uv
    part = Part('panelCloseout', parent=root)
    # 1) backdrop in the console plane (a hair behind the console face; the console boxes hide it where they stand)
    T0 = P.W(0, 0.27, -0.004)
    B0 = P.W(0, -0.34, -0.004)
    hdir = Vector((0, 0.70, 0.47)).normalized()
    wall = Wall(B0, T0, hdir)
    ey, rows = clip_plane(ctx, B0, P.v, 0.0, 0.61)
    plane_mesh(part, 'plate', B0, ey, rows)
    # 2) hood: starts at the console's top edge and slopes toward the eye over the head side
    hey, hrows = clip_plane(ctx, T0, hdir, 0.0, 3.0)
    plane_mesh(part, 'plate', T0, hey, hrows)
    # 3) lower wall: from the console's bottom edge straight down (a plane across the axis) to the feet-side shell, in front of the knees
    ley, lrows = clip_plane(ctx, B0, Vector((0, -1, 0)), 0.0, 3.0)
    plane_mesh(part, 'plate', B0, ley, lrows)
    nl = liner(ctx, part, wall)
    # fine seams and a few screws on the three flat walls, two small placards
    ex = Vector((1, 0, 0))
    def nrm_of(eyv):
        nn = ex.cross(eyv).normalized()
        return nn if nn.dot(-B0) >= 0 else -nn
    xs = [AX - 0.9 + 0.45 * k for k in range(0, 6)]
    nscrews = 0
    nscrews += seams(part, B0, ey, rows, nrm_of(ey), [0.21, 0.52], xs)
    nscrews += seams(part, T0, hey, hrows, nrm_of(hey), [0.17, 0.36, 0.55], xs)
    nscrews += seams(part, B0, ley, lrows, nrm_of(ley), [0.2, 0.42, 0.66], xs)
    placard(part, 'MDC UPPER CLOSEOUT|DO NOT STEP', T0, ex, hey, nrm_of(hey), AX - 0.23, 0.265, 0.17, 0.045, 1)
    placard(part, 'EQUIPMENT BAY ACCESS|NO LOOSE ITEMS', B0, ex, ley, nrm_of(ley), AX - 0.68, 0.31, 0.17, 0.045, 2)
    # 4) wall furniture and window frames in front of the wall and inside the view cone are replaced by the liner
    ncull = 0
    for nm, pp in list(PARTS.items()):
        if nm.startswith('apollo_walls'):
            ncull += cull(pp, lambda q: _ang(q) < LIM + 6 and q.z > wall.z(q.y) + 0.003)
        elif nm.startswith(('frame_', 'glass_')):
            ncull += cull(pp, lambda q: _ang(q) < LIM + 10 and q.z > wall.z(q.y) + 0.003)
            if not any(d['f'] for d in pp.m.values()):
                del PARTS[nm]
    C.log('closeout: backdrop rows', len(rows), 'hood rows', len(hrows), 'lower rows', len(lrows), 'liner faces', nl, 'screws', nscrews, 'culled islands', ncull, 'tris', part.tris())
    return part
