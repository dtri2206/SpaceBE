"""
G2, the module generator (SpaceB&E builder, Role 1, nose section): service modules, trunks, orbital and cargo modules
from their real layout (drums and cones, MLI blankets, radiator panels, folded solar wings, thruster quads, engine bells,
docking ports), each with the inner pieces of its kit.

Run from the repo root:
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/nose/modules.py -- [--only apollo_sm] [--shots DIR]

Outside shape (hullProfile): 'shell' modules are the outer skin (wall at the stack radius from y = 0 to the top);
'inner' modules are narrower hardware that the outer skin covers at launch (rMax x the size radius); 'own' modules keep
their outline (the Vostok instrument module's double cone, the Gemini adapter's cone).
Kits: service_module (slot_power: solar_wings | body_cells | fuel_cells | batteries; slot_engine: main | main_backup |
thrusters_only) and module (slot_docking: none | probe_drogue | ssvp | apas | nds | cbm; slot_stowage: bags | racks |
water_wall). The plain slot_<key> is the kit's first option; the others are slot_<key>__<option>.
"""
import os, sys, math
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nl  # noqa: E402
from nl import V, Acc, M, er, ea, polar, lathe, cyl, sphere, torus, tube, box, beam, patch, disc, band, ring_on, window, port, strip_along, bell, Rev, fillet, resample, FRONT, NECK, DEG, RADIUS, TAU  # noqa: E402
import inner as I  # noqa: E402

KITS = {
    'service_module': {'power': ['solar_wings', 'body_cells', 'fuel_cells', 'batteries'], 'engine': ['main', 'main_backup', 'thrusters_only']},
    'module': {'docking': ['none', 'probe_drogue', 'ssvp', 'apas', 'nds', 'cbm'], 'stowage': ['bags', 'racks', 'water_wall']},
}

MODS = {
    'vostok_instrument_module': dict(size='m', H=2.1, kit='service_module', real=dict(power='batteries', engine='main')),
    'gemini_adapter': dict(size='m', H=1.88, kit='service_module', real=dict(power='fuel_cells', engine='thrusters_only')),
    'apollo_sm': dict(size='l', H=4.2, kit='service_module', real=dict(power='fuel_cells', engine='main')),
    'soyuz_service_module': dict(size='m', H=2.08, kit='service_module', real=dict(power='solar_wings', engine='main_backup')),
    'orion_esm': dict(size='l', H=2.7, kit='service_module', real=dict(power='solar_wings', engine='main_backup')),
    'dragon_trunk': dict(part='crew_trunk_m', size='m', H=2.0, kit=None, real={}),
    'soyuz_orbital_module': dict(size='s', H=2.6, kit='module', real=dict(docking='ssvp', stowage='bags')),
    'shenzhou_orbital_module': dict(size='s', H=2.09, kit='module', real=dict(docking='apas', stowage='bags')),
    'shenzhou_service_module': dict(size='m', H=2.19, kit='service_module', real=dict(power='solar_wings', engine='main')),
    'starliner_sm': dict(size='l', H=1.9, kit='service_module', real=dict(power='body_cells', engine='main')),
    'cygnus_sm': dict(size='l', H=1.05, kit='service_module', real=dict(power='solar_wings', engine='main')),
    'atv_propulsion': dict(size='l', H=2.2, kit='service_module', real=dict(power='solar_wings', engine='main')),
    'cruise_stage_mars': dict(size='l', H=0.7, kit='service_module', real=dict(power='body_cells', engine='thrusters_only')),
    # the lighter ones (planned as code art; drawn here with few details so no module is a placeholder box)
    'progress_cargo_module': dict(size='s', H=2.75, kit='module', real=dict(docking='ssvp', stowage='bags')),
    'cygnus_pcm': dict(size='s', H=2.8, kit='module', real=dict(docking='cbm', stowage='bags')),
    'htv_logistics': dict(size='l', H=3.5, kit='module', real=dict(docking='cbm', stowage='racks')),
    'atv_icc': dict(size='l', H=3.1, kit='module', real=dict(docking='ssvp', stowage='bags')),
    'soyuz_7k_service_module': dict(size='m', H=2.1, kit='service_module', real=dict(power='solar_wings', engine='main_backup')),
    'gaganyaan_sm': dict(size='m', H=1.8, kit='service_module', real=dict(power='solar_wings', engine='main')),
    'mengzhou_sm': dict(size='l', H=2.0, kit='service_module', real=dict(power='solar_wings', engine='main')),
    'htv_propulsion': dict(size='l', H=2.0, kit='service_module', real=dict(power='body_cells', engine='main')),
    'shooting_star': dict(size='l', H=2.2, kit='service_module', real=dict(power='solar_wings', engine='thrusters_only')),
    'dragon1_trunk': dict(size='m', H=1.57, kit='service_module', real=dict(power='solar_wings', engine='thrusters_only')),
    'voskhod_backup_retro': dict(size='m', H=0.7, kit=None, real={}),
    'retropack_mercury': dict(size='s', H=0.45, kit=None, real={}),
}


class Ctx:
    def __init__(self, slug, spec):
        pid = spec.get('part', slug)
        pd = nl.part_data(pid) or {}
        self.slug, self.spec = slug, spec
        self.size = pd.get('size', spec['size'])
        self.H = float(pd.get('height', spec['H']))
        self.R = RADIUS[self.size]
        self.hp = pd.get('hullProfile') or {}
        self.kit = pd.get('internals', spec['kit']) if spec['kit'] else None
        self.rin = self.R * self.hp.get('rMax', 1.0) if self.hp.get('kind') == 'inner' else self.R
        self.body = Acc()


def emit_kit(root, ctx, builders):
    """Plain slot = the kit's first option; slot_<key>__<option> for the rest."""
    if not ctx.kit:
        return
    for key, opts in KITS[ctx.kit].items():
        for i, o in enumerate(opts):
            acc = builders[key](o)
            acc.emit(f'slot_{key}' if i == 0 else f'slot_{key}__{o}', root)


# ------------------------------------------------------------------ shared pieces
def wing_pack(acc, a, r, y0, y1, w, panels=4, t=0.025, m=None):
    """A solar wing folded against a module: `panels` stacked panels (cells out) on a yoke, at azimuth a."""
    m = m or M('solar')
    for k in range(panels):
        c = polar(a, r + k * (t + 0.008), (y0 + y1) / 2)
        box(acc, c, (t, y1 - y0, w), m if k == panels - 1 else M('frame'), (er(a), V(0, 1, 0), ea(a)))
    beam(acc, polar(a, r - 0.06, y0 + 0.1), polar(a, r, y0 + 0.1), 0.05, 0.05, M('dark'))


def thruster_quad(acc, a, r, y, s=1.0):
    """An RCS quad: a block on the wall with four small nozzles (up, down and both sides)."""
    e, t, u = er(a), ea(a), V(0, 1, 0)
    c = polar(a, r + 0.06 * s, y)
    box(acc, c, (0.12 * s, 0.2 * s, 0.2 * s), M('mid_grey'), (e, u, t))
    for d in (u, -u, t, -t):
        bell(acc, c + d * 0.1 * s, d, 0.012 * s, 0.03 * s, 0.06 * s, M('nozzle'), 6)


def engine_piece(acc, kind, ctx, y_top, rb=None, tanks=2, r_tank=None, backup=False):
    """The engine slot: main engine (chamber and bell exiting at the module's base), tanks; main_backup adds a second
    smaller engine; thrusters_only: four thruster quads and the tanks."""
    R, H = ctx.R, ctx.H
    rin = ctx.rin
    rb = rb or rin * 0.32
    rt = r_tank or rin * 0.28
    if kind in ('main', 'main_backup'):
        L = min(y_top * 0.55, rb * 2.6)
        ch = min(rb * 0.9, max(0.05, (y_top - 0.04 - L) / 1.1))
        bell(acc, (0, 0.02 + L, 0), (0, -1, 0), rb * 0.32, rb, L, M('nozzle'), 16, chamber=(rb * 0.45, ch))
        if kind == 'main_backup':
            for s_ in (-1, 1):
                bell(acc, polar(FRONT + 90 * s_, rin * 0.55, 0.02 + L * 0.5), (0, -1, 0), rb * 0.12, rb * 0.32, L * 0.5, M('nozzle'), 10, chamber=(rb * 0.16, rb * 0.3))
    else:
        for j in range(4):
            a = FRONT + 45 + 90 * j
            c = polar(a, rin * 0.82, 0.12)
            box(acc, c, (0.1, 0.12, 0.1), M('mid_grey'))
            bell(acc, c - V(0, 0.06, 0), (0, -1, 0), 0.015, 0.035, 0.07, M('nozzle'), 6)
    for j in range(tanks):
        a = FRONT + 360 * j / tanks
        c = polar(a, rin * 0.45, y_top * 0.55)
        lathe(acc, [(0.0, -rt), (rt * 0.7, -rt * 0.75), (rt, -rt * 0.2), (rt, rt * 0.2), (rt * 0.7, rt * 0.75), (0.0, rt)], M('alu') if j % 2 else M('steel_m'), 14, c)


def power_piece(acc, kind, ctx, y0, y1, r_wall, wings=2):
    """The power slot: solar wings folded (inside the skin), body cells (a band of cells), fuel cells, batteries."""
    if kind == 'solar_wings':
        for j in range(wings):
            wing_pack(acc, FRONT + 90 + 360 * j / wings, r_wall - 0.18, y0, y1, min(1.0, r_wall * 0.7))
    elif kind == 'body_cells':
        band(acc, Rev([(r_wall, y0), (r_wall, y1)]), 0.0, y1 - y0, M('solar'), -0.03, 32, az0=FRONT - 80, az1=FRONT + 100, u_rep=6)
    elif kind == 'fuel_cells':
        for j in range(3):
            c = polar(FRONT + 120 * j, r_wall * 0.55, (y0 + y1) / 2)
            cyl(acc, c - V(0, 0.25, 0), c + V(0, 0.25, 0), 0.13, M('alu'), 12)
            for k in range(4):
                lathe(acc, [(0.16, -0.012), (0.16, 0.012)], M('dark'), 12, c + V(0, -0.18 + 0.12 * k, 0))
    elif kind == 'batteries':
        for j in range(4):
            a = FRONT + 90 * j + 45
            box(acc, polar(a, r_wall * 0.6, (y0 + y1) / 2), (0.3, 0.22, 0.4), M('dark'), (er(a), V(0, 1, 0), ea(a)))
            box(acc, polar(a, r_wall * 0.6, (y0 + y1) / 2 + 0.12), (0.2, 0.03, 0.3), M('amber'), (er(a), V(0, 1, 0), ea(a)))


def mli_drum(b, prof, m, seg=48, u=6, v=1.5):
    lathe(b, prof, m, seg, u_rep=u, v_scale=v)


# ------------------------------------------------------------------ the modules
def vostok_im(ctx, root):
    R, H, b = ctx.R, ctx.H, ctx.body
    prof = [(rf * R, yf * H) for (rf, yf) in (ctx.hp.get('profile') or [[1, 0], [0.97, 0.12], [0.96, 0.42], [0.66, 0.88], [0.34, 1]])]
    prof = fillet(prof, 0.08, 4)
    rev = Rev(prof)
    lathe(b, prof, M('grey'), 64)
    lathe(b, [(0.0, 0.004), (prof[0][0], 0.004)], M('dark'), 48)
    lathe(b, [(prof[-1][0], H - 0.004), (0.0, H - 0.004)], M('dark'), 32)
    # the ring of spherical gas bottles round the upper cone (nitrogen for the attitude jets, oxygen for the cabin)
    s_b = rev.s_at_y(0.5 * H)
    for j in range(16):
        P, N, Tm, Ta = rev.frame_s(FRONT + 11.25 + 22.5 * j, s_b, 0.0)
        sphere(b, P + N * 0.13, 0.15, M('mid_grey'), 10, 6)
        cyl(b, P, P + N * 0.06, 0.03, M('dark'), 6)
    # louvred thermal-control shutters round the lower drum, and the cable fairings
    for j in range(8):
        patch(b, rev, FRONT + 22.5 + 45 * j, rev.s_at_y(0.25 * H), 0.42, 0.32, M('radiator'), 0.002, 0.015, 3, 3, 1.0, 0.02, M('dark'))
    for j in range(4):
        strip_along(b, rev, FRONT + 45 * (2 * j), rev.s_at_y(0.05 * H), rev.s_at_y(0.95 * H), 0.05, 0.02, M('dark'))
    ring_on(b, rev, rev.s_at_y(0.43 * H), 0.04, 0.012, M('dark'), 64)
    # whip antennas folded down the cone
    for a in (FRONT + 30, FRONT + 210):
        P, N, Tm, Ta = rev.frame_y(a, 0.7 * H, 0.03)
        cyl(b, P, P - Tm * 0.6, 0.01, M('steel_m'), 6)

    def power(o):
        acc = Acc()
        power_piece(acc, o, ctx, 0.15 * H, 0.38 * H, R * 0.94)
        return acc

    def engine(o):
        acc = Acc()
        engine_piece(acc, o, ctx, 0.42 * H, rb=0.28)  # the TDU-1 retro engine and its propellant
        return acc
    return {'power': power, 'engine': engine}


def gemini_adapter(ctx, root):
    R, H, b = ctx.R, ctx.H, ctx.body
    prof = [(rf * R, yf * H) for (rf, yf) in (ctx.hp.get('profile') or [[1, 0], [0.97, 0.15], [0.76, 1]])]
    prof = resample(fillet(prof, 0.06, 4), 0.3)
    rev = Rev(prof)
    lathe(b, prof, M('white'), 64)
    # white-painted magnesium skin on stringers, the retro / equipment section joint, OAMS thruster ports
    for j in range(36):
        strip_along(b, rev, FRONT + 10 * j, 0.03, rev.L - 0.03, 0.025, 0.012, M('offwhite'))
    ring_on(b, rev, rev.s_at_y(0.61 * H), 0.04, 0.012, M('mid_grey'), 64)
    ring_on(b, rev, 0.02, 0.04, 0.01, M('mid_grey'), 64)
    for j in range(4):
        a = FRONT + 45 + 90 * j
        for dy in (0.3, 0.75):
            port(b, rev, a, rev.s_at_y(dy * H), 0.035)
    lathe(b, [(prof[-1][0], H - 0.004), (0.0, H - 0.004)], M('dark'), 32)

    def power(o):
        acc = Acc()
        power_piece(acc, o, ctx, 0.12 * H, 0.5 * H, R * 0.9)
        return acc

    def engine(o):
        acc = Acc()
        engine_piece(acc, o, ctx, 0.55 * H, rb=0.3)
        if o == 'thrusters_only':  # the retro section's four TE-M-385 solid retros
            for j in range(4):
                c = polar(FRONT + 45 + 90 * j, 0.4, 0.8 * H)
                sphere(acc, c, 0.16, M('steel_m'), 10, 6)
                bell(acc, c - V(0, 0.14, 0), (0, -1, 0), 0.03, 0.06, 0.08, M('nozzle'), 8)
        return acc
    return {'power': power, 'engine': engine}


def apollo_sm(ctx, root):
    R, H, b = ctx.R, ctx.H, ctx.body
    y_sla, y_top = 0.55, H - 0.3
    # the white SLA-panel ring at the base round the SPS bell, the silver SM drum, the forward fairing
    lathe(b, [(R, 0.0), (R, y_sla)], M('white'), 64)
    lathe(b, [(R, y_sla), (R, y_top)], M('alu'), 64)
    lathe(b, [(R, y_top), (R * 0.985, H - 0.08), (R * 0.97, H)], M('alu'), 64)
    lathe(b, [(R * 0.97, H - 0.004), (0.0, H - 0.004)], M('dark'), 48)
    rev = Rev([(R, 0.0), (R, y_top), (R * 0.97, H)])
    ring_on(b, rev, y_sla, 0.03, 0.01, M('dark'), 64)
    # EPS radiator panels (white stripes) on the forward fairing, ECS radiators at the aft
    for j in range(8):
        patch(b, rev, FRONT + 22.5 + 45 * j, rev.s_at_y(H - 0.16), 0.6, 0.18, M('radiator'), 0.002, 0.004, 3, 1)
    for a in (FRONT + 60, FRONT + 240):
        patch(b, rev, a, rev.s_at_y(y_sla + 0.55), 1.1, 0.8, M('radiator'), 0.002, 0.004, 4, 3)
    # sector panel joints and the four RCS quads (on their housings)
    for j in range(6):
        strip_along(b, rev, FRONT + 60 * j + 10, rev.s_at_y(y_sla), rev.s_at_y(y_top), 0.02, 0.006, M('dark'))
    for j in range(4):
        a = FRONT + 90 * j
        patch(b, rev, a, rev.s_at_y(y_top - 0.5), 0.36, 0.56, M('alu'), 0.002, 0.012, 2, 2)
        thruster_quad(b, a, R, y_top - 0.5, 1.2)
    # the high-gain antenna stowed at the aft, and the SPS bell's top seen through the SLA ring
    P = polar(FRONT + 180, R, y_sla + 0.25)
    box(b, P + er(FRONT + 180) * 0.05, (0.1, 0.4, 0.5), M('mid_grey'), (er(FRONT + 180), V(0, 1, 0), ea(FRONT + 180)))
    lathe(b, [(0.0, 0.004), (R * 0.995, 0.004)], M('dark'), 48)

    def power(o):
        acc = Acc()
        power_piece(acc, o, ctx, y_sla + 0.4, y_sla + 1.4, R)
        return acc

    def engine(o):
        acc = Acc()
        engine_piece(acc, o, ctx, y_top, rb=0.75, tanks=4, r_tank=0.4)
        return acc
    return {'power': power, 'engine': engine}


def soyuz_sm(ctx, root):
    R, H, b = ctx.R, ctx.H, ctx.body
    r = ctx.rin * 0.9
    # propulsion compartment (widest, green MLI), the instrument compartment (narrower) and the transfer cone up to
    # the descent module's shield ring
    prof = fillet([(r, 0.0), (r, 0.48 * H), (r * 0.8, 0.6 * H), (r * 0.8, 0.88 * H), (r * 0.74, H)], 0.06, 4)
    rev = Rev(prof)
    lathe(b, prof, M('mli_green'), 64, u_rep=24, v_scale=2.0)
    lathe(b, [(0.0, 0.004), (r, 0.004)], M('dark'), 48)
    lathe(b, [(r * 0.74, H - 0.004), (0.0, H - 0.004)], M('dark'), 48)
    ring_on(b, rev, rev.s_at_y(0.48 * H), 0.04, 0.012, M('dark'), 64)
    # the two solar wings folded flat against the propulsion compartment (as at launch), radiator panel, antennas
    for s_ in (0, 180):
        a = FRONT + 90 + s_
        P = polar(a, r + 0.04, 0.28 * H)
        box(b, P, (0.06, 0.48 * H, 0.9), M('solar'), (er(a), V(0, 1, 0), ea(a)))
        box(b, polar(a, r + 0.012, 0.5 * H), (0.04, 0.06, 0.2), M('dark'), (er(a), V(0, 1, 0), ea(a)))
    patch(b, rev, FRONT, rev.s_at_y(0.25 * H), 0.8, 0.36 * H, M('radiator'), 0.002, 0.008, 3, 3)
    for j in range(4):
        thruster_quad(b, FRONT + 45 + 90 * j, r, 0.08 * H, 0.9)

    def power(o):
        acc = Acc()
        power_piece(acc, o, ctx, 0.1 * H, 0.45 * H, r)
        return acc

    def engine(o):
        acc = Acc()
        engine_piece(acc, o, ctx, 0.45 * H, rb=0.18, tanks=4, r_tank=0.26)
        return acc
    return {'power': power, 'engine': engine}


def orion_esm(ctx, root):
    R, H, b = ctx.R, ctx.H, ctx.body
    # at launch the ESM rides inside three white spacecraft-adapter jettisoned (SAJ) panels: the outer skin
    lathe(b, [(R, 0.0), (R, H)], M('white_panel'), 64, u_rep=6, v_scale=0.6)
    rev = Rev([(R, 0.0), (R, H)])
    for j in range(3):
        strip_along(b, rev, FRONT + 30 + 120 * j, 0.0, H, 0.04, 0.008, M('mid_grey'))
    ring_on(b, rev, 0.03, 0.05, 0.012, M('mid_grey'), 64)
    ring_on(b, rev, H - 0.03, 0.05, 0.012, M('mid_grey'), 64)
    for j in range(6):
        P, N, Tm, Ta = rev.frame_y(FRONT + 60 * j, 0.12, 0.0)
        box(b, P + N * 0.02, (0.14, 0.12, 0.04), M('dark'), (Ta, Tm, N))
    lathe(b, [(0.0, H - 0.004), (R, H - 0.004)], M('dark'), 48)
    # the ESM itself inside (seen through the panels when the card opens): gold-blanketed drum
    core = Acc()
    lathe(core, [(R * 0.86, 0.15), (R * 0.86, H - 0.15)], M('mli_gold'), 32, u_rep=8, v_scale=2.0)
    core.emit('esm_core', root)

    def power(o):
        acc = Acc()
        power_piece(acc, o, ctx, 0.3, H - 0.3, R * 0.98, wings=4)
        return acc

    def engine(o):
        acc = Acc()
        engine_piece(acc, o, ctx, H * 0.8, rb=0.42, tanks=4, r_tank=0.38)
        return acc
    return {'power': power, 'engine': engine}


def dragon_trunk(ctx, root):
    R, H, b = ctx.R, ctx.H, ctx.body
    # Crew Dragon's trunk: solar cells on one half, white radiator panels on the other, four small fins at the aft
    lathe(b, [(R, 0.0), (R, H)], M('solar'), 64, az0=FRONT - 90, az1=FRONT + 90, u_rep=10, v_scale=3.0)
    lathe(b, [(R, 0.0), (R, H)], M('radiator'), 64, az0=FRONT + 90, az1=FRONT + 270, u_rep=24)
    rev = Rev([(R, 0.0), (R, H)])
    for y in (0.03, H - 0.03):
        ring_on(b, rev, y, 0.05, 0.01, M('white'), 64)
    for a in (FRONT - 90, FRONT + 90):
        strip_along(b, rev, a, 0.0, H, 0.06, 0.008, M('white'))
    for j in range(4):
        a = FRONT + 45 + 90 * j
        p = [polar(a, R, 0.05), polar(a, R, 0.55), polar(a, R + 0.3, 0.12), polar(a, R + 0.3, 0.05)]
        n = ea(a)
        vs = [q - n * 0.025 for q in p] + [q + n * 0.025 for q in p]
        b.add(vs, [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]], M('white'))
    lathe(b, [(0.0, H - 0.004), (R, H - 0.004)], M('dark'), 48)
    return {}


def orbital_module(ctx, root, kind):
    """Soyuz (green MLI near-sphere) and Shenzhou (white cylinder with its own wings) orbital modules."""
    R, H, b = ctx.R, ctx.H, ctx.body
    r = ctx.rin * (0.92 if kind == 'soyuz' else 0.95)
    if kind == 'soyuz':
        pts = [(NECK, 0.0)]
        for j in range(1, 20):
            t = j / 20
            pts.append((NECK + (r - NECK) * math.sin(math.pi * t) ** 0.7, H * t))
        pts.append((NECK, H))
        prof = fillet(pts, 0.05, 3)
        skin = M('mli_green')
    else:
        prof = fillet([(NECK, 0.0), (r * 0.9, 0.06 * H), (r, 0.12 * H), (r, 0.86 * H), (r * 0.85, 0.94 * H), (NECK, H)], 0.08, 4)
        skin = M('mli_white')
    rev = Rev(prof)
    lathe(b, prof, skin, 64, u_rep=16, v_scale=2.0)
    lathe(b, [(NECK, H - 0.004), (0.0, H - 0.004)], M('dark'), 32)
    lathe(b, [(NECK + 0.012, H - 0.04), (NECK + 0.012, H), (NECK - 0.02, H)], M('alu'), 32)
    # the side hatch (crew entry on the pad, spacewalks), a window, antennas
    s_mid = rev.s_at_y(0.5 * H)
    disc(b, rev, FRONT + 20, s_mid, 0.34, M('dark'), 0.0, 0.03, 24, 1, inner=0.3)
    disc(b, rev, FRONT + 20, s_mid, 0.3, skin, 0.01, 0.0, 24, 2)
    window(b, rev, FRONT - 70, rev.s_at_y(0.7 * H), 0.2, 0.2, 0.003, round_=True)
    if kind == 'soyuz':
        for a in (FRONT + 120, FRONT + 240):  # Kurs rendezvous antennas
            P, N, Tm, Ta = rev.frame_y(a, 0.75 * H, 0.0)
            cyl(b, P, P + N * 0.1 + Tm * 0.25, 0.012, M('steel_m'), 6)
            sphere(b, P + N * 0.1 + Tm * 0.25, 0.05, M('alu'), 8, 4)
    else:
        for s_ in (0, 180):  # Shenzhou's orbital module has its own small wings, folded at launch
            a = FRONT + 90 + s_
            box(b, polar(a, r + 0.04, 0.5 * H), (0.06, 0.6 * H, 0.7), M('solar'), (er(a), V(0, 1, 0), ea(a)))

    def docking(o):
        acc = Acc()
        if o != 'none':
            I.docking(acc, o, H - 0.012, NECK - 0.03, 1.0)
        return acc

    def stowage(o):
        acc = Acc()
        I.stowage(acc, o, 0.25 * H, 0.75 * H, r * 0.92, 0.8)
        return acc
    return {'docking': docking, 'stowage': stowage}


def drum_sm(ctx, root, kind):
    """Shenzhou SM (white drum, skirt, big folded wings, four main engines), Starliner SM (white drum, doghouses,
    aeroskirt), Cygnus SM (gold squat bus, UltraFlex fans), ATV propulsion (white / gold, four X wings folded)."""
    R, H, b = ctx.R, ctx.H, ctx.body
    r = ctx.rin
    if kind == 'shenzhou':
        r = r * 0.93
        prof = [(r, 0.0), (r, H)]
        skin = M('white')
    elif kind == 'starliner':
        prof = [(R, 0.0), (R, H)]
        skin = M('white_panel')
    elif kind == 'cygnus':
        r = r * 0.8  # the bus about as wide as the pressurised module, the folded fans still under the skin
        prof = fillet([(r, 0.0), (r, H * 0.9), (r * 0.8, H)], 0.04, 3)
        skin = M('mli_gold')
    elif kind == 'atv':
        r = r * 0.92
        prof = [(r, 0.0), (r, H)]
        skin = M('mli_white')
    else:  # cruise stage
        r = r * 0.95
        prof = fillet([(r * 0.3, 0.0), (r, 0.12 * H), (r, 0.8 * H), (r * 0.55, H)], 0.04, 3)
        skin = M('mli_silver')
    rev = Rev(prof)
    lathe(b, prof, skin, 64, u_rep=12, v_scale=2.0)
    lathe(b, [(0.0, 0.004), (prof[0][0], 0.004)], M('dark'), 48)
    lathe(b, [(prof[-1][0], H - 0.004), (0.0, H - 0.004)], M('dark'), 48)
    wings_r = r
    if kind == 'shenzhou':
        for s_ in (0, 180):
            a = FRONT + 90 + s_
            box(b, polar(a, r + 0.05, 0.6 * H), (0.07, 0.7 * H, 1.0), M('solar'), (er(a), V(0, 1, 0), ea(a)))
        for j in range(4):
            thruster_quad(b, FRONT + 45 + 90 * j, r, 0.85 * H, 0.9)
    elif kind == 'starliner':
        ring_on(b, rev, 0.03, 0.06, 0.012, M('mid_grey'), 64)
        for j in range(5):  # OMAC doghouses round the rim
            a = FRONT + 72 * j
            patch(b, rev, a, rev.s_at_y(0.7 * H), 0.55, 0.5, M('white'), 0.0, 0.08, 2, 2, 0.8, 0.06, M('offwhite'))
            for k in range(3):
                port(b, rev, a + (k - 1) * 4, rev.s_at_y(0.62 * H), 0.03, 0.085)
    elif kind == 'cygnus':
        for s_ in (0, 180):  # UltraFlex fans folded: drums on the sides
            a = FRONT + 90 + s_
            c = polar(a, r + 0.06, 0.5 * H)
            cyl(b, c - er(a) * 0.05, c + er(a) * 0.05, 0.3, M('solar'), 20)
            cyl(b, c + er(a) * 0.05, c + er(a) * 0.07, 0.31, M('frame'), 20)
    elif kind == 'atv':
        for j in range(4):
            a = FRONT + 45 + 90 * j
            box(b, polar(a, r + 0.04, 0.5 * H), (0.06, 0.8 * H, 0.75), M('solar'), (er(a), V(0, 1, 0), ea(a)))
        for j in range(4):
            thruster_quad(b, FRONT + 90 * j, r, 0.2 * H, 0.9)
    else:  # Mars cruise stage: solar cells on the outer face, radiators round the rim, thrusters, star scanner
        lathe(b, [(r * 0.32, 0.006), (r * 0.98, 0.11 * H)], M('solar'), 64, u_rep=24)
        for j in range(16):
            patch(b, rev, FRONT + 22.5 * j, rev.s_at_y(0.45 * H), 0.4, 0.42 * H, M('radiator'), 0.002, 0.01, 2, 2)
        for j in range(8):
            a = FRONT + 45 * j
            bell(b, polar(a, r + 0.01, 0.6 * H), (er(a) + V(0, -0.4, 0)).normalized(), 0.015, 0.035, 0.06, M('nozzle'), 6)
        box(b, polar(FRONT, r * 0.6, H - 0.06), (0.15, 0.12, 0.15), M('dark'))

    def power(o):
        acc = Acc()
        power_piece(acc, o, ctx, 0.15 * H, 0.75 * H, wings_r)
        return acc

    def engine(o):
        acc = Acc()
        engine_piece(acc, o, ctx, 0.9 * H, rb=min(0.4, r * 0.3), tanks=4, r_tank=min(0.32, r * 0.24))
        return acc
    return {'power': power, 'engine': engine}


# ------------------------------------------------------------------ the lighter modules (simple drums, few details)
def cargo_module(ctx, root, kind):
    """Pressurised cargo modules (module kit): Progress (Soyuz-like near-sphere, no window), Cygnus PCM (silver
    cylinder in micrometeoroid blankets, berthing ring), HTV logistics carrier (solar cells round a gold drum, open
    bay), ATV integrated cargo carrier (white blanketed cylinder, probe nose)."""
    R, H, b = ctx.R, ctx.H, ctx.body
    r = ctx.rin * 0.95
    if kind == 'progress':
        pts = [(NECK, 0.0)] + [(NECK + (r - NECK) * math.sin(math.pi * j / 20) ** 0.7, H * j / 20) for j in range(1, 20)] + [(NECK, H)]
        prof = fillet(pts, 0.05, 3)
        skin = M('mli_green')
    else:
        prof = fillet([(NECK, 0.0), (r * 0.9, 0.05 * H), (r, 0.1 * H), (r, 0.88 * H), (r * 0.8, 0.95 * H), (NECK, H)], 0.08, 4)
        skin = {'cygnus': M('mli_silver'), 'htv': M('mli_gold'), 'atv': M('mli_white')}[kind]
    rev = Rev(prof)
    lathe(b, prof, skin, 64, u_rep=16, v_scale=2.0)
    lathe(b, [(NECK, H - 0.004), (0.0, H - 0.004)], M('dark'), 32)
    lathe(b, [(NECK + 0.012, H - 0.04), (NECK + 0.012, H), (NECK - 0.02, H)], M('alu'), 32)
    if kind == 'htv':  # the body-mounted solar cell panels round the drum
        for j in range(12):
            patch(b, rev, FRONT + 30 * j, rev.s_at_y(0.5 * H), 0.62, 0.62 * H, M('solar'), 0.003, 0.006, 2, 3)
    elif kind == 'cygnus':
        for y in (0.3, 0.6):
            ring_on(b, rev, rev.s_at_y(y * H), 0.03, 0.01, M('mid_grey'), 64)
        P, N, Tm, Ta = rev.frame_y(FRONT + 90, 0.75 * H, 0.0)
        box(b, P + N * 0.06, (0.3, 0.3, 0.1), M('dark'), (Ta, Tm, N))  # the grapple fixture
    elif kind == 'atv':
        for j in range(3):  # videometer targets
            disc(b, rev, FRONT + 120 * j, rev.s_at_y(0.92 * H), 0.05, M('dark'), 0.003, 0.01, 8, 1)
    else:
        for a in (FRONT + 120, FRONT + 240):
            P, N, Tm, Ta = rev.frame_y(a, 0.75 * H, 0.0)
            cyl(b, P, P + N * 0.25 + Tm * 0.15, 0.012, M('steel_m'), 6)

    def docking(o):
        acc = Acc()
        if o != 'none':
            I.docking(acc, o, H - 0.012, NECK - 0.03, 1.0)
        return acc

    def stowage(o):
        acc = Acc()
        I.stowage(acc, o, 0.2 * H, 0.8 * H, r * 0.92, 0.8)
        return acc
    return {'docking': docking, 'stowage': stowage}


def simple_sm(ctx, root, kind):
    """Service modules drawn plainly: Soyuz 7K-OK (toroidal tank, wings), Gaganyaan (white drum, folded panels, five
    engines), Mengzhou (white drum, folded wings), HTV propulsion (gold drum, body cells), Shooting Star (white drum,
    folded arrays), Dragon 1 trunk (white, two wing covers)."""
    R, H, b = ctx.R, ctx.H, ctx.body
    r = ctx.rin
    skin = {'soyuz7k': M('mli_green'), 'gaganyaan': M('white_panel'), 'mengzhou': M('white_panel'), 'htv': M('mli_gold'),
            'shooting': M('white_panel'), 'dragon1': M('white')}[kind]
    prof = [(r, 0.0), (r, H)]
    rev = Rev(prof)
    lathe(b, prof, skin, 64, u_rep=10, v_scale=1.5)
    lathe(b, [(0.0, 0.004), (r, 0.004)], M('dark'), 48)
    lathe(b, [(r, H - 0.004), (0.0, H - 0.004)], M('dark'), 48)
    ring_on(b, rev, 0.03, 0.05, 0.01, M('mid_grey'), 64)
    ring_on(b, rev, H - 0.03, 0.05, 0.01, M('mid_grey'), 64)
    if kind == 'soyuz7k':
        torus(b, (0, 0.18 * H, 0), r * 0.82, 0.12, M('mid_grey'), 40, 8)  # the external toroidal tank
        for s_ in (0, 180):
            a = FRONT + 90 + s_
            box(b, polar(a, r + 0.04, 0.55 * H), (0.06, 0.6 * H, 0.8), M('solar'), (er(a), V(0, 1, 0), ea(a)))
    elif kind in ('gaganyaan', 'mengzhou', 'shooting'):
        shell = ctx.hp.get('kind', 'shell') == 'shell'
        for s_ in ((0, 180) if kind != 'shooting' else (0, 120, 240)):
            a = FRONT + 90 + s_
            if shell:  # folded panels under the launch fairing, flush with the wall
                patch(b, rev, a, rev.s_at_y(0.5 * H), 0.75, 0.7 * H, M('solar'), 0.003, 0.012, 3, 4, 1.0, 0.03, M('frame'))
            else:
                box(b, polar(a, r + 0.04, 0.5 * H), (0.06, 0.7 * H, 0.7), M('solar'), (er(a), V(0, 1, 0), ea(a)))
        for j in range(4):
            if shell:
                port(b, rev, FRONT + 45 + 90 * j, rev.s_at_y(0.85 * H), 0.04)
            else:
                thruster_quad(b, FRONT + 45 + 90 * j, r, 0.85 * H, 0.9)
    elif kind == 'htv':
        for j in range(12):
            patch(b, rev, FRONT + 30 * j, rev.s_at_y(0.55 * H), 0.6, 0.6 * H, M('solar'), 0.003, 0.006, 2, 3)
        for j in range(4):
            thruster_quad(b, FRONT + 90 * j, r, 0.12 * H, 1.0)
    else:  # Dragon 1 trunk: the two solar wings under their jettisoned covers
        for s_ in (0, 180):
            a = FRONT + 90 + s_
            patch(b, rev, a, rev.s_at_y(0.5 * H), 0.7, 0.8 * H, M('offwhite'), 0.0, 0.12, 3, 4, 1.0, 0.1, M('mid_grey'))

    def power(o):
        acc = Acc()
        power_piece(acc, o, ctx, 0.15 * H, 0.75 * H, r)
        return acc

    def engine(o):
        acc = Acc()
        engine_piece(acc, o, ctx, 0.9 * H, rb=min(0.4, r * 0.3), tanks=4, r_tank=min(0.32, r * 0.24))
        if kind == 'gaganyaan' and o == 'main':  # five engines: the main and four around it
            for j in range(4):
                bell(acc, polar(FRONT + 45 + 90 * j, r * 0.6, 0.3), (0, -1, 0), 0.05, 0.12, 0.28, M('nozzle'), 10)
        return acc
    return {'power': power, 'engine': engine}


def voskhod_retro(ctx, root):
    """Voskhod's backup solid retro-rocket on the sphere's nose: a dark steel case on a truss, nozzle facing forward."""
    H, b = ctx.H, ctx.body
    r = ctx.rin
    for j in range(4):
        a = FRONT + 45 + 90 * j
        cyl(b, polar(a, NECK - 0.02, 0.02), polar(a, r * 0.75, 0.25 * H), 0.025, M('steel_m'), 6)
    lathe(b, [(NECK, 0.0), (NECK, 0.03), (r * 0.55, 0.05)], M('dark'), 32)
    lathe(b, fillet([(r * 0.78, 0.22 * H), (r * 0.82, 0.28 * H), (r * 0.82, 0.72 * H), (r * 0.6, 0.85 * H)], 0.03, 3), M('dark'), 32)
    lathe(b, [(0.0, 0.22 * H), (r * 0.78, 0.22 * H)], M('dark'), 32)
    bell(b, (0, 0.82 * H, 0), (0, 1, 0), r * 0.2, r * 0.45, 0.18 * H - 0.004, M('nozzle'), 16)
    return {}


def mercury_retropack(ctx, root):
    """Mercury's retropack: three TE-M-316 retros and three posigrades in a round package, strapped to the shield."""
    H, b = ctx.H, ctx.body
    r = ctx.rin
    lathe(b, fillet([(0.0, 0.02), (r * 0.9, 0.04), (r, 0.12), (r, H - 0.16), (r * 0.7, H - 0.06), (0.0, H - 0.05)], 0.03, 3), M('steel_m'), 32)
    for j in range(3):  # three straps up to the capsule's shield
        a = FRONT + 120 * j
        beam(b, polar(a, r * 0.95, 0.1), polar(a, ctx.R * 0.9, H), 0.06, 0.012, M('dark'))
    for j in range(6):  # three retros and three posigrades
        a = FRONT + 60 * j + 30
        bell(b, polar(a, r * (0.55 if j % 2 else 0.3), 0.16), (0, -1, 0), 0.02, 0.05, 0.12, M('nozzle'), 8)
    return {}


BUILD = {
    'vostok_instrument_module': vostok_im, 'gemini_adapter': gemini_adapter, 'apollo_sm': apollo_sm,
    'soyuz_service_module': soyuz_sm, 'orion_esm': orion_esm, 'dragon_trunk': dragon_trunk,
    'soyuz_orbital_module': lambda c, r: orbital_module(c, r, 'soyuz'),
    'shenzhou_orbital_module': lambda c, r: orbital_module(c, r, 'shenzhou'),
    'shenzhou_service_module': lambda c, r: drum_sm(c, r, 'shenzhou'), 'starliner_sm': lambda c, r: drum_sm(c, r, 'starliner'),
    'cygnus_sm': lambda c, r: drum_sm(c, r, 'cygnus'), 'atv_propulsion': lambda c, r: drum_sm(c, r, 'atv'),
    'cruise_stage_mars': lambda c, r: drum_sm(c, r, 'cruise'),
    'progress_cargo_module': lambda c, r: cargo_module(c, r, 'progress'), 'cygnus_pcm': lambda c, r: cargo_module(c, r, 'cygnus'),
    'htv_logistics': lambda c, r: cargo_module(c, r, 'htv'), 'atv_icc': lambda c, r: cargo_module(c, r, 'atv'),
    'soyuz_7k_service_module': lambda c, r: simple_sm(c, r, 'soyuz7k'), 'gaganyaan_sm': lambda c, r: simple_sm(c, r, 'gaganyaan'),
    'mengzhou_sm': lambda c, r: simple_sm(c, r, 'mengzhou'), 'htv_propulsion': lambda c, r: simple_sm(c, r, 'htv'),
    'shooting_star': lambda c, r: simple_sm(c, r, 'shooting'), 'dragon1_trunk': lambda c, r: simple_sm(c, r, 'dragon1'),
    'voskhod_backup_retro': voskhod_retro, 'retropack_mercury': mercury_retropack,
}


def build(slug, shots=None):
    spec = MODS[slug]
    nl.reset()
    ctx = Ctx(slug, spec)
    root = nl.root(slug)
    builders = BUILD[slug](ctx, root)
    ctx.body.emit('body', root)
    emit_kit(root, ctx, builders)
    nl.report_groups(root)
    tris, size = nl.export(root, slug, ctx.H, ctx.R)
    if shots:
        os.makedirs(shots, exist_ok=True)
        nl.hide_except(root, spec['real'])
        nl.look(os.path.join(shots, f'{slug}_a.png'), (0, ctx.H * 0.5, 0), nl.cam_front(ctx.H, ctx.R))
        for o in root.children:
            if o.name in ('body',):
                o.hide_render = True
        nl.look(os.path.join(shots, f'{slug}_c.png'), (0, ctx.H * 0.5, 0), nl.cam_front(ctx.H, ctx.R, pitch=30))
        nl.show_all(root)
    return slug, tris, size


if __name__ == '__main__':
    only = nl.C.arg('--only')
    shots = nl.C.arg('--shots')
    todo = only.split(',') if only else list(MODS)
    results = [build(s, shots) for s in todo]
    for (s, t, b) in results:
        print(f'[modules] {s}: {t} triangles, {b / 1024:.0f} KB')
