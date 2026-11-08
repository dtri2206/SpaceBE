"""Apollo aft access hatch, passage to the living cabin and the animated 5-point harnesses (only used for --type apollo).

All in GAME coordinates (eye of the commander = origin, +Y toward the head, -Z toward the apex, +Z behind the back = the aft bulkhead / floor).
The round pressure hatch sits in the aft bulkhead behind the head end of the centre couch, the passage runs on in +Z to the ceiling hatch shaft of the cabin.

Nodes written (names survive GLTFLoader):
  door_aft            the hinged door (pivot at the hinge on the wall side, local y = hinge axis, local z = out toward the crew); runtime renames it aftHatch
  ladderTop_aft       eye in front of the open hatch looking down the passage; runtime renames it ladderTop
  wp_couch wp_over wp_front wp_mouth wp_mid passageEnd   float-path waypoints (empties): the player's eye (commander, origin),
                                                          straight up over the own helmet, across above the centre crew's head, into the hatch
  hs<i>_* harness<i>  per couch: buckle + cap + 2 shoulder, 2 lap and 1 crotch strap as two-segment chains (animated by cockpit.userData.harness)
"""
import math
from mathutils import Vector, Matrix
from cc_core import *
import cc_core as C

R_HOLE = 0.375          # clear radius of the hatch (0.75 m)
R_PASS = 0.385          # passage radius (0.77 m clear)
LP = 1.25               # passage length from the floor plane to the cabin shaft
FLANGE = 0.045


def make_mats():
    material('pass_wall', (0.62, 0.63, 0.64), 0.92, spec=0.1)
    material('pass_rib', (0.42, 0.43, 0.45), 0.8, spec=0.2)
    material('pass_dark', (0.06, 0.06, 0.065), 0.7)
    material('pass_rail', (0.13, 0.22, 0.36), 0.45, 0.7)
    material('pass_steel', (0.62, 0.64, 0.66), 0.35, 1.0)
    material('pass_yellow', (0.80, 0.52, 0.04), 0.5, 0.2, spec=0.3)
    material('pass_door', (0.58, 0.57, 0.52), 0.7, spec=0.2)
    material('pass_label', (0.9, 0.9, 0.85), 0.6)
    material('pass_gauge', (0.9, 0.9, 0.85), 0.5)
    material('pass_valve', (0.62, 0.05, 0.03), 0.5, spec=0.4)
    material('led', (1, 1, 1), 0.5, emit=(1.0, 0.96, 0.86), emit_strength=3.0)
    material('strap', (0.80, 0.75, 0.60), 0.92, spec=0.05)
    material('strap_dark', (0.12, 0.12, 0.13), 0.7, 0.6)


def swap():
    return Matrix(((0, 0, 1), (0, 1, 0), (1, 0, 0)))


def lathe_z(part, mat, prof, center, seg=32):
    """Surface of revolution around the game Z axis through `center`; prof = [(radius, z_offset)]."""
    part.add(mat, xform(lathe_geo(prof, seg), swap(), center))


def ring_z(part, mat, r, tube, c, z, n=28, tn=5):
    pts = [Vector((c.x + r * math.cos(2 * math.pi * i / n), c.y + r * math.sin(2 * math.pi * i / n), z)) for i in range(n)]
    part.add(mat, sweep(pts, circle_profile(tube, tn), closed=True))


def stencil(part, mat, s, x, y, z, height, rot=None, align='c'):
    """Raised stencil letters (flat triangles, 1 mm off the surface) in the part's local x/y plane at depth z."""
    tris, wid, hgt = text_tris(s)
    k = height / max(hgt, 1e-6)
    ox = x - (wid * k / 2 if align == 'c' else 0.0)
    v, f = [], []
    for (a, b, c_, d, e, g) in tris:
        o = len(v)
        for px, py in ((a, b), (c_, d), (e, g)):
            v.append((ox + px * k, y + py * k, z))
        f.append((o, o + 1, o + 2))
        f.append((o + 2, o + 1, o))        # double sided so it shows from either side
    part.add(mat, (v, f))


def hatch_centre(ctx):
    ax = ctx.g((0, 0, 0))
    hx = ctx.sp * ((ctx.p['crew'] - 1) / 2.0 - ctx.p['cmd'])     # the centre couch
    return Vector((hx, ax.y + 1.0, ctx.p['ez'] - 0.04))


def cut_hole(ctx):
    """(capsule-frame centre, radius) of the opening the shell boolean cuts in the aft bulkhead."""
    c = hatch_centre(ctx)
    return ctx.cap_of_game(c), R_HOLE


def build(ctx, root, mats):
    make_mats()
    hc = hatch_centre(ctx)
    zf = hc.z
    c0 = Vector((hc.x, hc.y, 0))

    # ------------------------------------------------------------------------------ fixed rim + frame + flange
    rim = Part('aft_rim', parent=root)
    top = zf - FLANGE
    lathe_z(rim, 'pass_rib', [(R_HOLE - 0.02, zf + 0.02), (R_HOLE - 0.02, top), (0.47, top), (0.47, zf + 0.02)], c0, 40)   # flange plate
    ring_z(rim, 'pass_steel', 0.41, 0.022, hc, top - 0.012, 40)                       # raised seal retainer
    ring_z(rim, 'pass_dark', R_HOLE + 0.005, 0.016, hc, top + 0.0, 40)               # rubber seal
    for i in range(20):
        a = 2 * math.pi * (i + 0.5) / 20
        p = Vector((hc.x + 0.445 * math.cos(a), hc.y + 0.445 * math.sin(a), top))
        rim.strut('pass_steel', p, p + Vector((0, 0, -0.012)), 0.011, 0.009, 6)
    # stop pads and hinge brackets on the wall side (+Y)
    hinge = Vector((hc.x, hc.y + 0.41, zf - 0.05))
    for sx in (-1, 1):
        rim.box('pass_steel', 0.07, 0.06, 0.07, hc.x + sx * 0.17, hinge.y + 0.02, hinge.z - 0.005, bevel=0.01)
        rim.strut('pass_steel', hinge + Vector((sx * 0.135, 0, 0)), hinge + Vector((sx * 0.205, 0, 0)), 0.018, n=10)
    # hatch stencils on the flange (cabin side of the hatch)
    stencil(rim, 'pass_label', 'HATCH - CABIN', hc.x, hc.y - 0.445, top - 0.0035, 0.02)
    stencil(rim, 'pass_label', 'KEEP CLEAR', hc.x, hc.y - 0.495 + 0.0, top - 0.0035, 0.012)

    # ------------------------------------------------------------------------------ door (pivot at the hinge)
    rot = Matrix(((0, -1, 0), (-1, 0, 0), (0, 0, -1)))      # local x across the door (-Y), local y = hinge axis (-X), local z out toward the crew (-Z)
    door = Part('door_aft', pos=hinge, rot=rot, parent=root)
    R = 0.41
    cx = R
    prof = [(0, -0.02), (R * 0.2, -0.02), (R * 0.2, 0.012), (R * 0.55, 0.014), (R * 0.97, 0.005), (R, 0.0), (R, -0.03), (0, -0.03)]
    door.add('pass_door', xform(lathe_geo(prof, 40), swap(), (cx, 0, 0)))
    ring = [Vector((cx + (R - 0.01) * math.cos(2 * math.pi * i / 40), (R - 0.01) * math.sin(2 * math.pi * i / 40), 0.006)) for i in range(40)]
    door.add('pass_steel', sweep(ring, circle_profile(0.014, 6), closed=True))
    # central handle: gearbox boss, rotary handle, pump lever
    door.cyl('pass_steel', 0.07, 0.04, cx, 0, 0.032, 'z', 20)
    door.box('pass_steel', 0.13, 0.085, 0.045, cx, 0, 0.055, bevel=0.012)
    door.strut('pass_steel', Vector((cx, 0, 0.075)), Vector((cx, 0, 0.115)), 0.016, 0.022, 10)
    door.box('pass_steel', 0.34, 0.032, 0.028, cx, 0, 0.125, bevel=0.012)                  # T handle
    for sx_ in (-1, 1):
        door.box('pass_dark', 0.07, 0.036, 0.032, cx + sx_ * 0.135, 0, 0.125, bevel=0.01)      # rubber grips
    door.strut('pass_steel', Vector((cx + 0.07, 0.02, 0.055)), Vector((cx + 0.2, 0.06, 0.07)), 0.011, 0.011, 8)   # ratchet pump handle
    door.box('pass_dark', 0.04, 0.026, 0.02, cx + 0.2, 0.06, 0.07, bevel=0.005)
    # 12 latch dogs with their cam plates round the rim
    for i in range(12):
        a = 2 * math.pi * i / 12 + 0.26
        px, py = cx + 0.355 * math.cos(a), 0.355 * math.sin(a)
        door.box('pass_steel', 0.075, 0.032, 0.026, px, py, 0.02, rz=a, bevel=0.006)
        door.cyl('pass_dark', 0.012, 0.012, px, py, 0.034, 'z', 8)
    # pressure-equalisation valve (red) and a gauge
    a = math.radians(48)
    vx, vy = cx + 0.26 * math.cos(a), 0.26 * math.sin(a)
    door.cyl('pass_steel', 0.03, 0.05, vx, vy, 0.04, 'z', 14)
    door.cyl('pass_valve', 0.017, 0.03, vx, vy, 0.075, 'z', 10)
    door.box('pass_valve', 0.05, 0.012, 0.012, vx, vy, 0.095, bevel=0.004)
    a2 = math.radians(132)
    gx, gy = cx + 0.26 * math.cos(a2), 0.26 * math.sin(a2)
    door.cyl('pass_steel', 0.034, 0.03, gx, gy, 0.03, 'z', 18)
    door.cyl('pass_gauge', 0.027, 0.006, gx, gy, 0.047, 'z', 18)
    door.box('pass_dark', 0.004, 0.022, 0.003, gx, gy, 0.0515, rz=0.8, bevel=0.0)
    # pull grip on the far edge
    door.strut('pass_steel', Vector((2 * R - 0.075, -0.07, 0.01)), Vector((2 * R - 0.075, -0.07, 0.05)), 0.009, n=6)
    door.strut('pass_steel', Vector((2 * R - 0.075, 0.07, 0.01)), Vector((2 * R - 0.075, 0.07, 0.05)), 0.009, n=6)
    door.strut('pass_steel', Vector((2 * R - 0.075, -0.07, 0.05)), Vector((2 * R - 0.075, 0.07, 0.05)), 0.012, n=8)
    # stencils on the door (<= 25 mm letters)
    stencil(door, 'pass_label', 'HATCH - CABIN', cx, -0.19, 0.0075, 0.022)
    stencil(door, 'pass_label', 'EQUALIZE BEFORE OPENING', cx, 0.19, 0.0075, 0.012)
    stencil(door, 'pass_label', 'PEV', vx + 0.0, vy - 0.065, 0.0075, 0.014)

    # ------------------------------------------------------------------------------ rails on the bulkhead beside the hatch (stand-offs 70 mm)
    gr = Part('aft_grabs', parent=root)
    for sx in (-1, 1):
        x = hc.x + sx * 0.60
        a_ = Vector((x, hc.y - 0.28, zf - 0.075)); b_ = Vector((x, hc.y + 0.18, zf - 0.075))
        gr.strut('pass_rail', a_, b_, 0.0165, n=10)
        for y in (a_.y + 0.03, b_.y - 0.03):
            gr.strut('pass_steel', Vector((x, y, zf)), Vector((x, y, zf - 0.075)), 0.011, 0.011, 8)
            gr.box('pass_steel', 0.06, 0.05, 0.012, x, y, zf - 0.004, bevel=0.003)
    # a rail across the head end of the centre couch (pull-up bar) and Velcro pads
    x0, x1 = hc.x - 0.30, hc.x + 0.30
    y = hc.y - 0.62
    gr.strut('pass_rail', Vector((x0, y, zf - 0.075)), Vector((x1, y, zf - 0.075)), 0.0165, n=10)
    for x in (x0 + 0.03, x1 - 0.03):
        gr.strut('pass_steel', Vector((x, y, zf)), Vector((x, y, zf - 0.075)), 0.011, 0.011, 8)

    # ------------------------------------------------------------------------------ passage
    z0, z1 = zf + 0.02, zf + LP
    ps = Part('passage', parent=root)
    lathe_z(ps, 'pass_wall', [(R_PASS, z0), (R_PASS, z1 - 0.2), (0.335, z1)], c0, 40)
    for zz in (zf + 0.25, zf + 0.62, zf + 0.99):
        ring_z(ps, 'pass_rib', R_PASS - 0.004, 0.02, hc, zz, 40)
    # end flange against the cabin shaft: ring plate, bolts
    lathe_z(ps, 'pass_rib', [(0.34, z1 - 0.03), (0.34, z1 + 0.012), (0.5, z1 + 0.012), (0.5, z1 - 0.03)], c0, 40)
    ring_z(ps, 'pass_steel', 0.36, 0.014, hc, z1 - 0.034, 40)
    for i in range(16):
        a = 2 * math.pi * (i + 0.5) / 16
        p = Vector((hc.x + 0.44 * math.cos(a), hc.y + 0.44 * math.sin(a), z1 - 0.03))
        ps.strut('pass_steel', p, p + Vector((0, 0, -0.014)), 0.011, 0.009, 6)
    # ladder rails + rungs in the cabin ladder's plane (rails at x = hx +- 0.2, y = hy), stand-off braces to the wall
    for sx in (-1, 1):
        x = hc.x + sx * 0.20
        ps.strut('pass_yellow', Vector((x, hc.y, z0 + 0.05)), Vector((x, hc.y, z1 + 0.27)), 0.0225, n=10)
        for zz in (zf + 0.2, zf + 0.7, zf + 1.15):
            yw = hc.y + math.sqrt(R_PASS ** 2 - 0.2 ** 2)
            ps.strut('pass_steel', Vector((x, hc.y, zz)), Vector((x, yw, zz)), 0.011, 0.011, 8)
            ps.box('pass_steel', 0.05, 0.02, 0.05, x, yw - 0.006, zz, bevel=0.004)
    cab_floor = zf + LP + 0.72 + 2.6
    k = 0
    while True:
        zr = cab_floor - (0.3 + 0.28 * k)
        k += 1
        if zr > z1 - 0.03:
            continue
        if zr < z0 + 0.06:
            break
        ps.strut('pass_steel', Vector((hc.x - 0.2, hc.y, zr)), Vector((hc.x + 0.2, hc.y, zr)), 0.0165, n=10)
    # two handrails along the wall, stand-offs every 0.45 m
    for sx in (-1, 1):
        px, py = hc.x + sx * 0.238, hc.y - 0.238
        ps.strut('pass_rail', Vector((px, py, z0 + 0.12)), Vector((px, py, z1 - 0.12)), 0.0165, n=10)
        for zz in (z0 + 0.2, zf + 0.62, z1 - 0.2):
            wx, wy = hc.x + sx * R_PASS * 0.707, hc.y - R_PASS * 0.707
            ps.strut('pass_steel', Vector((px, py, zz)), Vector((wx, wy, zz)), 0.011, 0.011, 8)
    # one LED strip light on the +Y wall
    ps.box('pass_dark', 0.075, 0.012, 0.95, hc.x, hc.y + R_PASS - 0.012, zf + 0.62, bevel=0.0)
    ps.box('led', 0.05, 0.006, 0.9, hc.x, hc.y + R_PASS - 0.021, zf + 0.62, bevel=0.0)
    stencil(ps, 'pass_label', 'CABIN', hc.x + 0.12, hc.y - R_PASS + 0.01, zf + 0.12, 0.02)

    # ------------------------------------------------------------------------------ empties: ladderTop + float path
    lt = Part('ladderTop_aft', pos=Vector((hc.x, hc.y - 0.05, zf - 0.80)), rot=Matrix(((-1, 0, 0), (0, 1, 0), (0, 0, -1))), parent=root)   # faces +Z (looking down the passage), up = head (+Y)
    for nm, p in (('wp_couch', (0.0, 0.0, 0.0)), ('wp_over', (0.0, hc.y - 0.08, zf - 0.75)), ('wp_front', (hc.x, hc.y - 0.05, zf - 0.55)),
                  ('wp_mouth', (hc.x, hc.y, zf + 0.05)), ('wp_mid', (hc.x, hc.y, zf + LP * 0.55)), ('passageEnd', (hc.x, hc.y, zf + LP))):
        Part(nm, pos=Vector(p), parent=root)
    C.log(f'aft hatch centre game ({hc.x:.2f},{hc.y:.2f},{hc.z:.2f}) passage end z={zf + LP:.2f}')
    harness(ctx, root)


# ====================================================================================================== harnesses
def seat_frame(p):
    x = p.rot @ Vector((1, 0, 0)); y = p.rot @ Vector((0, 1, 0)); z = p.rot @ Vector((0, 0, 1))
    return p.pos, x, y, z


def harness(ctx, root):
    k = ctx.k
    for i, nm in enumerate(('seat', 'seat1', 'seat2')):
        p = PARTS.get(nm)
        if p is None:
            continue
        o, ex, ey, ez = seat_frame(p)
        W = lambda a, b, c: o + ex * a + ey * b + ez * c
        up = -ez
        d = (0.19 if nm == 'seat' else 0.22) * k
        zt = 0.13 - d - 0.010          # strap centre line on the torso
        B = W(0.0, -0.56 * k, zt - 0.012)
        buckle = Part(f'hs{i}_buckle', pos=B, rot=p.rot, parent=root)
        buckle.box('pass_steel', 0.085, 0.085, 0.016, 0, 0, 0, bevel=0.008)
        buckle.cyl('pass_dark', 0.032, 0.012, 0, 0, -0.012, 'z', 18)
        buckle.box('strap_dark', 0.03, 0.03, 0.008, 0, 0, 0.0, bevel=0.0)
        cap = Part(f'hs{i}_cap', pos=B + up * 0.01, rot=p.rot, parent=buckle)
        cap.cyl('pass_valve', 0.028, 0.012, 0, 0, 0, 'z', 18)
        cap.box('pass_steel', 0.05, 0.009, 0.01, 0, 0, -0.008, bevel=0.002)
        anchors = {
            'shL': (W(-0.17 * k, -0.22 * k, zt + 0.004), 'strap'), 'shR': (W(0.17 * k, -0.22 * k, zt + 0.004), 'strap'),
            'lpL': (W(-0.25 * k, -0.84 * k, 0.13 - 0.17 * k - 0.016), 'strap'), 'lpR': (W(0.25 * k, -0.84 * k, 0.13 - 0.17 * k - 0.016), 'strap'),
            'cr': (W(0.0, -0.98 * k, 0.13 - 0.17 * k - 0.016), 'strap'),
        }
        for key, (a, _) in anchors.items():
            d = (B - a)
            L = d.length
            xv = d.normalized()
            zv = (up - xv * up.dot(xv)).normalized()
            yv = zv.cross(xv)
            R = Matrix(((xv.x, yv.x, zv.x), (xv.y, yv.y, zv.y), (xv.z, yv.z, zv.z)))
            w = 0.05 if key != 'cr' else 0.045
            s1 = Part(f'hs{i}_{key}_a', pos=a, rot=R, parent=root)
            s1.box('strap', L * 0.5, w, 0.007, L * 0.25, 0, 0, bevel=0.0015)
            s1.box('strap_dark', 0.012, w * 1.02, 0.009, L * 0.1, 0, 0, bevel=0.0)      # stitch bar
            s1.box('pass_steel', 0.03, w * 1.05, 0.012, 0.0, 0, 0, bevel=0.004)           # anchor plate
            s2 = Part(f'hs{i}_{key}_b', pos=a + xv * (L * 0.5), rot=R, parent=s1)
            s2.box('strap', L * 0.5 - 0.02, w, 0.007, L * 0.25 - 0.01, 0, 0, bevel=0.0015)
            s2.box('pass_steel', 0.045, w * 0.95, 0.011, L * 0.5 - 0.02, 0, 0, bevel=0.004)  # tongue
        # keep the strap parent chain tidy: nothing else
