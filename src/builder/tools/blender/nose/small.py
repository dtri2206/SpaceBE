"""
G5, the small nose parts (SpaceB&E builder, Role 1, nose section): Apollo's boost protective cover collar, Crew Dragon's
hinged nose cone, Gemini's rendezvous and recovery (R&R) section, the side-mounted parachute containers (one Soyuz-style
main, four Crew Dragon mains), Voskhod 2's inflatable airlock (stowed) and the SuperDraco abort pod.

Run from the repo root:
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/nose/small.py -- [--only bpc_apollo] [--shots DIR]

Axial caps (bpc_apollo, nosecap_dragon, nose_gemini_rr) stand on the capsule's docking ring. Radial parts: the parts that
ride inside the skin (chute containers, the stowed airlock) stand on y = 0 centred; the abort pod lives outside, so its
origin is the attachment point on the wall, +X outward, height up +Y.
Kits: chute (slot_canopy: dgb | ringsail | ribbon | parafoil, the packed canopy; slot_reefing: none | staged) and
abort_pod (slot_chamber: printed | machined; slot_propellant: shared | dedicated). Plain node = the first option.
"""
import os, sys, math
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nl  # noqa: E402
from nl import V, Acc, M, er, ea, polar, lathe, cyl, sphere, torus, tube, box, beam, patch, disc, band, ring_on, window, port, strip_along, bell, Rev, fillet, resample, FRONT, NECK, DEG, RADIUS, TAU  # noqa: E402
import inner as I  # noqa: E402

PARTS = {
    'bpc_apollo': dict(part='bpc_apollo', size='l', H=0.55),
    'nosecap_dragon': dict(part='nosecap_dragon', size='s', H=0.55),
    'nose_gemini_rr': dict(part='nose_gemini_rr', size='s', H=1.1),
    'chute_single_main': dict(part='chute_single_main', size='s', H=0.6),
    'chute_cluster_4': dict(part='chute_cluster_4', size='s', H=0.75),
    'volga_airlock': dict(part='volga_airlock', size='s', H=0.8),
    'abort_pusher_pod': dict(part='abort_pusher_pod', size='s', H=0.8),
}
CANOPY = {'dgb': 'canopy_w', 'ringsail': 'canopy', 'ribbon': 'canopy_w', 'parafoil': 'orange'}


def chute_kit(root, packs):
    """slot_canopy (the packed canopies, their fabric showing at the bag mouth) and slot_reefing (line cutters)."""
    for i, o in enumerate(['dgb', 'ringsail', 'ribbon', 'parafoil']):
        acc = Acc()
        for (c, r, L) in packs:
            c = V(*c)
            if o == 'parafoil':  # a parafoil packs flat and wide
                box(acc, c + V(0, L * 0.5, 0), (r * 1.7, L * 0.9, r * 1.2), M('bag'))
                box(acc, c + V(0, L * 0.92, 0), (r * 1.5, 0.03, r * 1.0), M(CANOPY[o]))
            else:
                I.chute_pack(acc, c, (0, 1, 0), r, L)
                lathe(acc, [(r * 0.75, L), (r * 0.6, L + 0.02), (0.0, L + 0.025)], M(CANOPY[o]), 10, c)
                if o == 'ringsail':  # the ringsail's coloured gores
                    lathe(acc, [(r * 1.01, L * 0.3), (r * 1.01, L * 0.42)], M('canopy'), 10, c)
                if o == 'ribbon':
                    for k in range(3):
                        lathe(acc, [(r * 1.01, L * (0.25 + 0.2 * k)), (r * 1.01, L * (0.27 + 0.2 * k))], M('dark'), 10, c)
        acc.emit('slot_canopy' if i == 0 else f'slot_canopy__{o}', root)
    nl.node('slot_reefing', root)
    acc = Acc()
    for (c, r, L) in packs:
        c = V(*c)
        for k in range(3):
            a = 120 * k
            cyl(acc, c + polar(a, r * 1.05, L * 0.55), c + polar(a, r * 1.05, L * 0.7), 0.015, M('amber'), 6)
    acc.emit('slot_reefing__staged', root)


def bpc_apollo(H, R, root, b):
    # the boost protective cover's top over the docking tunnel: fibreglass and cork, white, with the tower-leg sockets
    prof = fillet([(0.53, 0.0), (0.54, 0.03), (0.5, H * 0.75), (0.47, H - 0.02), (0.44, H)], 0.02, 3)
    rev = Rev(prof)
    lathe(b, prof, M('cork') if False else M('offwhite'), 48)
    lathe(b, [(0.44, H - 0.004), (0.0, H - 0.004)], M('offwhite'), 32)
    ring_on(b, rev, 0.015, 0.025, 0.01, M('dark'), 48)
    strip_along(b, rev, FRONT + 90, 0.03, rev.L - 0.02, 0.03, 0.006, M('mid_grey'))
    for k in range(4):  # the four tower-leg sockets on the top
        box(b, polar(45 + 90 * k, 0.32 * math.sqrt(2) * 0.95, H - 0.02), (0.1, 0.05, 0.1), M('dark'))
    patch(b, rev, FRONT, rev.s_at_y(H * 0.45), 0.14, 0.12, M('glass'), 0.003, 0.0, 2, 2)  # the window over the hatch
    for k in range(3):
        disc(b, rev, FRONT + 120 + 40 * k, rev.s_at_y(H * 0.35), 0.03, M('dark'), 0.003, 0.0, 10, 1)  # vents


def nosecap_dragon(H, R, root, b):
    # Crew Dragon's nose cone: a dome over the docking port, hinged at the back, latched at the front
    pts = [(0.5, 0.0), (0.5, 0.07), (0.48, 0.2), (0.42, 0.32), (0.32, 0.43), (0.18, H - 0.04), (0.0, H)]
    prof = fillet(pts, 0.04, 4)
    lathe(b, prof, M('white'), 48)
    rev = Rev(prof)
    ring_on(b, rev, 0.04, 0.03, 0.01, M('dark'), 48)
    P, N, Tm, Ta = rev.frame_y(FRONT + 180, 0.08, 0.0)
    box(b, P + N * 0.05, (0.3, 0.1, 0.1), M('mid_grey'), (Ta, Tm, N))  # the hinge
    P, N, Tm, Ta = rev.frame_y(FRONT, 0.06, 0.0)
    box(b, P + N * 0.02, (0.12, 0.05, 0.04), M('dark'), (Ta, Tm, N))  # the latch
    for k in range(2):  # Draco ports under the cone's skirt
        port(b, rev, FRONT + 90 + 180 * k, rev.s_at_y(0.15), 0.025)


def nose_gemini_rr(H, R, root, b):
    # Gemini's rendezvous and recovery section: shingled cylinder and cone, re-entry control thrusters, radar radome
    prof = fillet([(NECK, 0.0), (NECK, 0.62 * H / 1.1), (0.31, 0.82 * H / 1.1), (0.22, 0.84 * H / 1.1)], 0.03, 3)
    lathe(b, prof, M('shingle'), 48, u_rep=40, v_scale=2.5)
    rev = Rev(prof)
    ring_on(b, rev, 0.02, 0.03, 0.01, M('alu'), 48)
    ring_on(b, rev, rev.s_at_y(0.62 * H / 1.1), 0.02, 0.008, M('mid_grey'), 48)
    for (y, off) in ((0.22, 0), (0.46, 45)):
        for k in range(4):
            port(b, rev, FRONT + off + 90 * k, rev.s_at_y(y * H / 1.1), 0.025)
    y0 = 0.84 * H / 1.1
    lathe(b, fillet([(0.22, y0), (0.22, 0.95 * H / 1.1), (0.17, 1.03 * H / 1.1), (0.08, H - 0.01), (0.0, H)], 0.03, 3), M('offwhite'), 32)
    # the docking index bar's mount and the drogue cover
    P, N, Tm, Ta = rev.frame_y(FRONT, 0.4 * H, 0.0)
    box(b, P + N * 0.03, (0.06, 0.25, 0.05), M('dark'), (Ta, Tm, N))
    chute_kit(root, [((0, 0.08, 0), 0.22, 0.45 * H), ((0.0, 0.6 * H, 0.0), 0.1, 0.12)])


def chute_single_main(H, R, root, b):
    # the main parachute container set into the capsule wall (Soyuz): a can with its hatch cover and a drogue mortar
    lathe(b, [(0.26, 0.0), (0.27, 0.02), (0.27, H - 0.06), (0.24, H - 0.02), (0.0, H - 0.02)], M('alu'), 24)
    box(b, (0.24, H * 0.5, 0), (0.03, H * 0.8, 0.42), M('mli_grey'))  # the hatch cover on the outside face
    for k in range(4):
        box(b, (0.26, 0.1 + k * (H - 0.2) / 3, 0.0), (0.04, 0.04, 0.46), M('dark'))
    cyl(b, (-0.16, 0.0, 0.2), (-0.16, H * 0.7, 0.2), 0.06, M('frame'), 10)
    chute_kit(root, [((0, 0.03, 0), 0.22, H - 0.12)])


def chute_cluster_4(H, R, root, b):
    # Crew Dragon's four mains side by side on a mounting plate, with the riser bundle
    box(b, (-0.24, H * 0.45, 0), (0.06, H * 0.9, 1.0), M('mid_grey'))
    zs = (-0.36, -0.12, 0.12, 0.36)
    for z in zs:
        lathe(b, [(0.12, 0.0), (0.12, 0.03)], M('dark'), 12, (0.0, 0.0, z))
    box(b, (0.02, H * 0.55, 0), (0.04, 0.04, 0.8), M('amber'))
    chute_kit(root, [((0.0, 0.03, z), 0.11, H * 0.93) for z in zs])


def volga_airlock(H, R, root, b):
    # Voskhod 2's inflatable airlock folded for launch: a ring, the folded fabric tube under its cover, the top hatch
    lathe(b, [(0.0, 0.0), (0.38, 0.0), (0.38, 0.06), (0.36, 0.08), (0.0, 0.08)], M('alu'), 32)
    folds = []
    for k in range(9):
        y = 0.08 + (H - 0.18) * k / 8
        folds.append((0.36 if k % 2 else 0.385, y))
    lathe(b, folds, M('mli_white'), 32, u_rep=8)
    lathe(b, [(0.385, H - 0.1), (0.385, H - 0.04), (0.3, H), (0.0, H)], M('alu'), 32)
    torus(b, (0, H - 0.05, 0), 0.2, 0.015, M('dark'), 16, 4)
    for k in range(4):  # the inflation bottles
        sphere(b, polar(45 + 90 * k, 0.32, 0.12), 0.06, M('steel_m'), 8, 4)


def abort_pusher_pod(H, R, root, b):
    # a SuperDraco pod: a faired blister on the wall housing two engines, their bells canted out through the bottom
    prof = [(0.0, 0.0), (0.12, 0.02), (0.16, 0.12), (0.17, 0.3), (0.17, H - 0.2), (0.11, H - 0.06), (0.0, H)]
    acc = Acc()
    lathe(acc, prof, M('white'), 20, az0=-90, az1=90)
    # flatten into a blister on the wall: x out (depth), z across (width)
    acc.V = [(x * 0.8, y, z * 1.3) for (x, y, z) in acc.V]
    b.add(acc.V, [list(f) for f in acc.F], M('white'))
    box(b, (0.135, H * 0.55, 0.0), (0.02, H * 0.45, 0.26), M('carbon'))  # the intake door
    for z in (-0.1, 0.1):  # the nozzle exits in the pod's lower face
        lathe(b, [(0.0, 0.035), (0.075, 0.035)], M('soot'), 12, (0.07, 0.0, z))
    # pieces: the two engines (printed Inconel chambers, plain) and the propellant
    for i, o in enumerate(['printed', 'machined']):
        p = Acc()
        m = M('dark') if o == 'printed' else M('steel_m')
        for z in (-0.1, 0.1):
            d = (V(0.31, -1, -0.12 * z / 0.1)).normalized()
            bell(p, V(0.07, 0.24, z), d, 0.035, 0.075, 0.19, m, 12, chamber=(0.05, 0.12))
        p.emit('slot_chamber' if i == 0 else f'slot_chamber__{o}', root)
    nl.node('slot_propellant', root)  # shared: fed from the capsule's tanks
    p = Acc()
    for z in (-0.07, 0.07):
        sphere(p, (0.08, H * 0.62, z), 0.065, M('alu') if z < 0 else M('steel_m'), 10, 5)
    p.emit('slot_propellant__dedicated', root)


BUILD = {'bpc_apollo': bpc_apollo, 'nosecap_dragon': nosecap_dragon, 'nose_gemini_rr': nose_gemini_rr,
         'chute_single_main': chute_single_main, 'chute_cluster_4': chute_cluster_4, 'volga_airlock': volga_airlock,
         'abort_pusher_pod': abort_pusher_pod}


def build(slug, shots=None):
    sp = PARTS[slug]
    nl.reset()
    pd = nl.part_data(sp['part']) or {}
    H = float(pd.get('height', sp['H']))
    R = RADIUS[pd.get('size', sp['size'])]
    root = nl.root(slug)
    b = Acc()
    BUILD[slug](H, R, root, b)
    b.emit('body', root)
    nl.report_groups(root)
    tris, size = nl.export(root, slug, H, None)
    if shots:
        os.makedirs(shots, exist_ok=True)
        nl.hide_except(root, {})
        nl.look(os.path.join(shots, f'{slug}_a.png'), (0, H * 0.5, 0), nl.cam_front(H, 0.6, dist=max(2.2, H * 2.6)))
        nl.show_all(root)
    return slug, tris, size


if __name__ == '__main__':
    only = nl.C.arg('--only')
    shots = nl.C.arg('--shots')
    todo = only.split(',') if only else list(PARTS)
    results = [build(s, shots) for s in todo]
    for (s, t, b) in results:
        print(f'[small] {s}: {t} triangles, {b / 1024:.0f} KB')
