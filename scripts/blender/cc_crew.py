"""Couches, suited crew, the commander's stick / throttle with gloved hands and IK arm bones."""
import math
from mathutils import Vector, Matrix
from cc_core import *
import cc_core as C

SUITS = {
    'white':  ((0.80, 0.80, 0.76), (0.45, 0.45, 0.45)),
    'orange': ((0.62, 0.17, 0.02), (0.05, 0.05, 0.05)),
    'silver': ((0.45, 0.46, 0.48), (0.08, 0.08, 0.08)),
    'blue':   ((0.03, 0.07, 0.28), (0.20, 0.20, 0.21)),
}
GLOVE_L = {'stick': Vector((0.30, -0.50, 0.04)), 'throttle': Vector((-0.30, -0.50, 0.04))}
UPPER, FORE = 0.31, 0.29     # arm bone lengths at k = 1


def ik_elbow(sh, wr, l1, l2, pole):
    """Two-bone IK: elbow position for shoulder sh, wrist wr, elbow pushed toward `pole`."""
    d = wr - sh
    L = min(d.length, l1 + l2 - 1e-4)
    if L < 1e-5:
        return sh + Vector((0, 0, -l1))
    dn = d.normalized()
    a = (l1 * l1 - l2 * l2 + L * L) / (2 * L)
    hgt = math.sqrt(max(0.0, l1 * l1 - a * a))
    pv = pole - dn * pole.dot(dn)
    pv = pv.normalized() if pv.length > 1e-5 else Vector((0, 0, 1))
    return sh + dn * a + pv * hgt


def bone_rot(direction):
    """Rotation matrix taking the bone's local -Z (its build axis) onto `direction`."""
    q = Vector((0, 0, -1)).rotation_difference(Vector(direction).normalized())
    return q.to_matrix()


def build_glove(gl, sx):
    """Slim pressure-suit glove wrapped around the grip (controller frame: grip along z at y 0, forearm comes from +y).
    Finger 21 mm, palm 92 mm wide, silver wrist ring, Beta-cloth sleeve."""
    zc = -0.13
    gl.sphere('glove', 0.05, 0, 0.052, zc, n=14, m=7, sx=0.5, sy=0.9, sz=0.95)                    # palm
    gl.sphere('glove', 0.05, 0, 0.088, zc, n=14, m=7, sx=0.5, sy=0.7, sz=0.88)                    # back of the hand tapering to the wrist
    for i in range(4):
        z = zc + (i - 1.5) * 0.0225
        path = [(0.0, 0.035), (sx * 0.028, 0.036), (sx * 0.039, 0.012), (sx * 0.037, -0.022), (sx * 0.016, -0.045), (-sx * 0.012, -0.043)]
        gl.tube('glove', [(x, y, z) for x, y in path], 0.0105, 8, 4)
        gl.sphere('glove', 0.0105, -sx * 0.012, -0.043, z, n=8, m=4)
    thumb = [(-sx * 0.018, 0.075, zc + 0.036), (-sx * 0.038, 0.045, zc + 0.04), (-sx * 0.04, 0.012, zc + 0.043), (-sx * 0.028, -0.02, zc + 0.045)]
    gl.tube('glove', thumb, 0.0115, 8, 4)
    gl.sphere('glove', 0.0115, -sx * 0.028, -0.02, zc + 0.045, n=8, m=4)
    gl.cyl('chrome', 0.037, 0.016, 0, 0.122, zc + 0.0, axis='y', n=14)                          # silver anodised wrist ring
    gl.cyl('chrome', 0.034, 0.006, 0, 0.133, zc + 0.0, axis='y', n=14)
    gl.strut('suit', (0, 0.128, zc), (0, 0.2, zc), 0.036, 0.048, n=14)                       # white Beta-cloth sleeve


def make_mats(ctx):
    suit, trim = SUITS[ctx.p['suit']]
    material('suit', suit, 0.8)
    material('suit_trim', trim, 0.6)
    material('glove', tuple(min(1, c * 0.9 + 0.02) for c in suit), 0.75) if ctx.p['suit'] != 'orange' else material('glove', (0.55, 0.15, 0.02), 0.75)
    material('glove_dark', (0.03, 0.03, 0.035), 0.7)
    material('boot', (0.025, 0.025, 0.03), 0.6)
    material('visor', (0.01, 0.012, 0.016), 0.1, 0.4, spec=1.0)
    material('visor_gold', (0.62, 0.44, 0.1), 0.38, 0.85)
    material('couch', ctx.p['couch'], 0.9)
    material('couch_edge', tuple(min(1, c * 0.5) for c in ctx.p['couch']), 0.9)
    material('grip', (0.02, 0.02, 0.025), 0.6)
    material('yellow', (0.55, 0.38, 0.0), 0.5)


def seat_pose(ctx, i):
    """World pose (pos, rot) of seat i's local frame (local = the game frame of an eye sitting there)."""
    p = ctx.p
    n = p['crew']
    if ctx.ring:
        a = math.radians(ctx.seat_ang[i])
        hv = Vector((math.cos(a), math.sin(a), 0)); rv = Vector((-math.sin(a), math.cos(a), 0))
        e = Vector((ctx.hd * hv.x, ctx.hd * hv.y, p['ez']))
    else:
        lat = (i - (n - 1) / 2.0) * ctx.sp
        hv, rv = ctx.hv, ctx.rv
        e = hv * ctx.hd + rv * lat + Vector((0, 0, p['ez']))
    Ai = Matrix((tuple(rv), tuple(hv), (0, 0, -1)))
    return ctx.A @ (e - ctx.e), ctx.A @ Ai.inverted()


def build_seat(ctx, i, root, commander):
    k = ctx.k
    kl = ctx.kl
    pos, rot = seat_pose(ctx, i)
    s = Part('seat%d' % i if not commander else 'seat', pos=pos, rot=rot, parent=root)
    zb = 0.13                          # couch back plane (behind the eye)
    floor = ctx.p['ez'] - 0.04
    # couch pad pieces
    s.box('couch', 0.46 * k, 0.80 * k, 0.07, 0, -0.41 * k, zb + 0.035, bevel=0.03, segs=2)                      # back
    s.box('couch', 0.30, 0.24, 0.08, 0, 0.0, zb + 0.04, bevel=0.035, segs=2)                                      # headrest
    for sx in (-1, 1):
        s.box('couch_edge', 0.07 * k, 0.60 * k, 0.12, sx * 0.265 * k, -0.52 * k, zb - 0.0, bevel=0.025, segs=2)   # side bolsters
    th = Vector((0, -0.257 * kl, -0.31 * kl))                  # hip -> knee
    hip = Vector((0, -0.80 * k, 0.05 * k))
    knee = hip + th
    ank = knee + Vector((0, -0.28 * kl, 0.23 * kl))
    ang = math.atan2(th.z, -th.y)
    mid = (hip + knee) / 2 + Vector((0, 0, 0.11))
    s.box('couch', 0.40 * k, th.length + 0.10, 0.07, 0, mid.y, mid.z + 0.03, rx=ang * -1, bevel=0.025, segs=2)   # thigh pad
    mid2 = (knee + ank) / 2 + Vector((0, 0, 0.10))
    ang2 = math.atan2((ank - knee).z, -(ank - knee).y)
    s.box('couch', 0.36 * k, (ank - knee).length + 0.08, 0.06, 0, mid2.y - 0.02, mid2.z + 0.04, rx=ang2 * -1 + 0.0, bevel=0.025, segs=2)
    # support legs to the floor
    for sx in (-1, 1):
        for y, zz in ((-0.05, zb + 0.07), (-0.78 * k, zb + 0.07), (mid.y, mid.z + 0.1), (ank.y + 0.05, ank.z + 0.12)):
            if floor - zz > 0.03:
                s.strut('steel', (sx * 0.2 * k, y, zz), (sx * 0.2 * k, y, floor), 0.013, n=6)
    s.box('steel', 0.46 * k, 0.03, 0.03, 0, -0.05, zb + 0.12, bevel=0.008)
    s.box('steel', 0.46 * k, 0.03, 0.03, 0, -0.78 * k, zb + 0.12, bevel=0.008)
    for sx in (-1, 1):                  # rails along the seat connect the struts
        s.box('steel', 0.03, 0.80 * k + 0.1, 0.03, sx * 0.2 * k, -0.4 * k, floor - 0.02, bevel=0.008)
        s.strut('steel', (sx * 0.2 * k, -0.05, zb + 0.07), (sx * 0.2 * k, -0.78 * k, zb + 0.07), 0.013, n=6)
    # ---- the person
    d = 0.19 if commander else 0.22
    s.box('suit', 0.40 * k, 0.56 * k, d * k, 0, -0.50 * k, zb - d * k / 2 + 0.0, bevel=0.05, segs=2)                       # torso
    s.box('suit_trim', 0.10 * k, 0.10 * k, 0.02, 0.0, -0.40 * k, zb - d * k - 0.005 + 0.0, bevel=0.006)                   # chest unit
    s.box('suit', 0.36 * k, 0.16 * k, 0.17 * k, 0, -0.80 * k, zb - 0.085 * k, bevel=0.05, segs=2)                          # pelvis
    for sx in (-1, 1):
        sh = Vector((sx * 0.235 * k, -0.27 * k, zb - 0.08 * k))
        s.sphere('suit', 0.07 * k, sh.x, sh.y, sh.z, n=16, m=8)
        h_ = hip + Vector((sx * 0.115 * k, 0, 0))
        kn = h_ + th
        an = kn + Vector((0, -0.28 * kl, 0.23 * kl))
        s.strut('suit', h_, kn, 0.085 * k, 0.07 * k, n=10)
        s.sphere('suit', 0.07 * k, kn.x, kn.y, kn.z, n=10, m=5)
        s.strut('suit', kn, an, 0.065 * k, 0.05 * k, n=10)
        s.box('boot', 0.115 * k, 0.26 * kl, 0.09 * k, an.x, an.y - 0.08 * kl, an.z + 0.01, rx=0.15, bevel=0.02, segs=1)
        if not commander:
            el = Vector((sx * 0.31 * k, -0.50 * k, zb - 0.08 * k))
            hd = Vector((sx * 0.30 * k, -0.80 * k, zb - 0.08 * k))
            s.strut('suit', sh, el, 0.058 * k, 0.05 * k, n=8)
            s.strut('suit', el, hd, 0.05 * k, 0.045 * k, n=8)
            s.box('glove', 0.08 * k, 0.10 * k, 0.07 * k, hd.x, hd.y - 0.05 * k, hd.z, bevel=0.02)
    if not commander:
        s.strut('suit', (0, -0.22 * k, zb - 0.1 * k), (0, -0.12, zb - 0.1 * k), 0.06, n=8)
        # pressure-suit helmet: white shell, gold visor, neck ring and shoulder line (no face)
        s.sphere('suit', 0.135 * k, 0, 0.005, zb - 0.07, n=18, m=9, sx=0.95, sy=1.06, sz=1.0)
        s.sphere('visor_gold', 0.118 * k, 0, -0.012, zb - 0.135, n=18, m=8, sx=0.92, sy=0.98, sz=0.55)
        s.cyl('chrome', 0.082 * k, 0.026, 0, -0.145 * k, zb - 0.06, axis='y', n=18)                       # neck ring
        s.cyl('suit_trim', 0.088 * k, 0.012, 0, -0.165 * k, zb - 0.06, axis='y', n=18)
        s.box('suit', 0.46 * k, 0.07 * k, 0.1 * k, 0, -0.215 * k, zb - 0.06, bevel=0.03, segs=2)              # shoulder yoke line
    if ctx.p['suit'] and ctx.cid in ('vostok', 'gemini'):
        # ejection handle ring between the knees
        ring = [Vector((0.0 + 0.045 * math.cos(2 * math.pi * j / 12), -0.95 * k + 0.045 * math.sin(2 * math.pi * j / 12) * 0.2, zb - 0.28 * k + 0.045 * math.sin(2 * math.pi * j / 12))) for j in range(12)]
        s.add('yellow', sweep(ring, circle_profile(0.012, 5), closed=True))
    return s, (zb, hip)


def build(ctx, root, mats):
    make_mats(ctx)
    p = ctx.p
    k = ctx.k
    n = p['crew']
    seats = []
    for i in range(n):
        cmd = (i == p['cmd'])
        s, info = build_seat(ctx, i, root, cmd)
        seats.append(s)
        if cmd:
            zb, hip = info
            cmd_seat = s
    # commander's hand controllers (children of the commander seat frame, which is the game frame)
    zb = 0.13
    kk = k
    s = cmd_seat
    for nm, base in GLOVE_L.items():
        bx = base.x * kk if base.x > 0 else base.x * kk
        by = base.y * kk
        right = nm == 'stick'
        sx = 1 if right else -1
        # armrest block the controller stands on
        PZ = -0.03                                              # pivot height: armrest raised so the hands show when the commander looks down
        s.box('couch_edge', 0.10, 0.24, 0.05, sx * 0.30 * kk, by + 0.04, PZ + 0.04, bevel=0.02, segs=2)
        s.box('steel', 0.05, 0.05, zb - PZ + 0.1, sx * 0.30 * kk, by + 0.04, (PZ + 0.04 + zb + 0.1) / 2, bevel=0.01)       # post down to the couch
        piv = Vector((sx * 0.30 * kk, by, PZ))
        ctrl = Part(nm, pos=cmd_seat.pos + cmd_seat.rot @ piv, rot=cmd_seat.rot, parent=root)
        if right:
            ctrl.sphere('steel', 0.028, 0, 0, 0.0, n=10, m=5)
            ctrl.strut('grip', (0, 0, 0), (0, 0, -0.10), 0.016, 0.019, n=10)
            ctrl.box('grip', 0.045, 0.05, 0.07, 0, 0.0, -0.13, bevel=0.016, segs=2)       # grip body
            ctrl.box('steel', 0.012, 0.03, 0.02, 0, -0.03, -0.14, bevel=0.004)             # trigger
            ctrl.sphere('glove_dark', 0.015, 0.0, 0.0, -0.172, n=8, m=4)
            wrist = Vector((0.012, 0.075, -0.115))
        else:
            ctrl.strut('steel', (0, 0, 0), (0, 0, -0.04), 0.014, n=8)
            ctrl.strut('grip', (0, 0, -0.04), (0, 0, -0.12), 0.018, 0.016, n=10)
            ctrl.box('grip', 0.05, 0.05, 0.075, 0, 0.0, -0.13, bevel=0.016, segs=2)
            ctrl.box('rubber', 0.07, 0.016, 0.016, 0, -0.04, -0.17, bevel=0.004)
            wrist = Vector((-0.012, 0.075, -0.115))
        # glove (children of the controller => follow setControls)
        gl = Part('glove' + ('R' if right else 'L'), pos=ctrl.pos, rot=ctrl.rot, parent=ctrl.name)
        build_glove(gl, sx)
        # arm bones (static rest pose = IK solve here; the runtime repeats it every frame)
        wr_local = ctrl.rot @ (wrist) + ctrl.pos      # in the commander seat's parent frame (world game)
        wr_world = wr_local
        sh = cmd_seat.pos + cmd_seat.rot @ Vector((sx * 0.235 * kk, -0.27 * kk, zb - 0.08 * kk))
        el = ik_elbow(sh, wr_world, UPPER * kk, FORE * kk, cmd_seat.rot @ Vector((sx * 0.6, -0.2, 0.9)))
        up = Part('arm' + ('R' if right else 'L') + '_upper', pos=sh, rot=bone_rot(el - sh), parent=root)
        up.strut('suit', (0, 0, 0), (0, 0, -UPPER * kk), 0.047 * kk, 0.04 * kk, n=14)
        up.sphere('suit', 0.05 * kk, 0, 0, 0.0, n=14, m=7)
        fo = Part('arm' + ('R' if right else 'L') + '_fore', pos=el, rot=bone_rot(wr_world - el), parent=root)
        fo.strut('suit', (0, 0, 0), (0, 0, -FORE * kk - 0.03), 0.04 * kk, 0.032 * kk, n=14)
        fo.sphere('suit', 0.041 * kk, 0, 0, 0.0, n=14, m=7)
        Part('shoulder' + ('R' if right else 'L'), pos=sh, parent=root)
        Part('wrist' + ('R' if right else 'L'), pos=wr_world, rot=ctrl.rot, parent=gl.name)
    Part('eye', pos=(0, 0, 0), parent=root)
