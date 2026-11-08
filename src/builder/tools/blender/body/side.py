"""
Side hardware of the body section (radial parts: origin at the attachment point on the host's wall, +X outward, height
along +Y from the mount, README.md): the S-IVB Auxiliary Propulsion System module and a solid ullage motor in its
fairing. Neither part has an internals kit; their notable inside pieces are piece_* nodes.
"""
import math
from bodylib import Acc, V, M, TAU, lathe, cyl, sphere, capsule, tube, box, beam, dims, part


def _bell(acc, p, d, r_throat, r_exit, length, m_out='dark', m_in='soot', seg=14):
    """A small nozzle at p pointing along d (unit vector): throat, then a bell."""
    from mathutils import Vector
    d = Vector(d).normalized()
    prof = [(r_throat * 1.6, -0.04), (r_throat, 0.0)]
    for k in range(1, 6):
        t = k / 5
        prof.append((r_throat + (r_exit - r_throat) * (1 - (1 - t) ** 2), length * t))
    lathe(acc, prof, M(m_out), seg, c=p, axis=d)
    lathe(acc, [(r_exit * 0.96, length * 0.98), (r_throat * 0.9, length * 0.1)], M(m_in), seg, c=p, axis=d)


def _loft(acc, sections, m):
    """Skin through D-shaped sections [(y, depth, width)], flat side on the wall (x = -0.02), bulging to +x."""
    n = 12
    verts, faces = [], []
    for (y, dep, w) in sections:
        for j in range(n + 1):
            t = math.pi * j / n
            verts.append(V(-0.02 + dep * math.sin(t), y, -w / 2 * math.cos(t)))
    for k in range(len(sections) - 1):
        for j in range(n):
            i0 = k * (n + 1) + j
            faces.append([i0, i0 + 1, i0 + n + 2, i0 + n + 1][::-1])
    acc.add(verts, faces, m)
    # the bottom plate (faces down) and the top cap (faces up)
    for (y, dep, w), mk, up in ((sections[0], 'dark', False), (sections[-1], 'white', True)):
        pts = [V(-0.02 + dep * math.sin(math.pi * j / n), y, -w / 2 * math.cos(math.pi * j / n)) for j in range(n + 1)]
        acc.add(pts, [list(range(n + 1))[::-1] if up else list(range(n + 1))], M(mk))


def sivb_aps(root):
    """The S-IVB Auxiliary Propulsion System module (nasa_0100983): a streamlined pod on the aft skirt with three
    attitude-control thrusters (two firing sideways, one outward) and one ullage engine firing aft; inside, the fuel
    (MMH) and oxidizer (N2O4) tanks and a helium bottle."""
    H = float(part('aps_module')['height'])
    body = Acc()
    secs = []
    for k in range(10):
        y = 0.04 + (H - 0.04) * k / 9
        f = (y - 0.5 * H) / (0.5 * H)
        dep = 0.3 if f <= 0 else 0.3 * math.cos(f * math.pi / 2 * 0.92) + 0.02
        w = 0.46 if f <= 0.2 else 0.46 - 0.18 * ((f - 0.2) / 0.8) ** 1.5
        secs.append((y, dep, w))
    _loft(body, secs, M('white'))
    body.emit('shell', root)
    det = Acc()
    # the aft face: the ullage engine pointing aft, two attitude thrusters to the sides, one outward
    _bell(det, V(0.15, 0.06, 0.0), (0, -1, 0), 0.025, 0.06, 0.12)
    for s in (-1, 1):
        _bell(det, V(0.14, 0.16, 0.2 * s), (0, -0.15, s), 0.022, 0.05, 0.08)
    _bell(det, V(0.29, 0.16, 0.0), (1, -0.15, 0), 0.022, 0.05, 0.08)
    box(det, V(-0.005, H * 0.45, 0.0), (0.03, H * 0.8, 0.36), M('frame'))  # the mounting plate on the skirt
    det.emit('detail', root)
    ins = Acc()
    sphere(ins, V(0.14, 0.36, -0.1), 0.085, M('titanium'), seg=12)   # the oxidizer tank (N2O4)
    ins.emit('piece_ox_tank', root)
    ins = Acc()
    sphere(ins, V(0.14, 0.36, 0.1), 0.08, M('steel'), seg=12)        # the fuel tank (MMH)
    ins.emit('piece_fuel_tank', root)
    ins = Acc()
    sphere(ins, V(0.12, 0.6, 0.0), 0.07, M('copv'), seg=12)          # the helium bottle
    ins.emit('piece_helium_bottle', root)
    return H, 0.32


def ullage_motor(root):
    """A solid ullage motor (TX-280 class) in its fairing on a bracket, the nozzle canted 10 degrees outward: fired for
    a few seconds so the propellant settles over the tank outlets before the main engine starts."""
    H = float(part('ullage_motors')['height'])
    x0 = 0.14
    r = 0.085
    sh = Acc()
    # the fairing: a slim cylinder with a cone nose, open at the bottom round the nozzle
    prof = [(r, 0.12), (r, H * 0.72), (r * 0.82, H * 0.82), (r * 0.45, H * 0.93), (r * 0.1, H - 0.005), (0.0, H)]
    lathe(sh, prof, M('white'), 20, c=V(x0, 0, 0))
    lathe(sh, [(r + 0.006, 0.11), (r + 0.006, 0.16), (r - 0.002, 0.16)], M('frame'), 20, c=V(x0, 0, 0))
    sh.emit('shell', root)
    det = Acc()
    for y in (0.3, H * 0.62):  # the mounting bracket to the skirt
        beam(det, V(-0.02, y, 0), V(x0 - r + 0.01, y, 0), 0.08, 0.05, M('frame'))
        box(det, V(-0.01, y, 0), (0.03, 0.12, 0.12), M('frame'))
    a = math.radians(10)  # the nozzle, canted outward
    _bell(det, V(x0, 0.13, 0), (math.sin(a), -math.cos(a), 0), 0.03, 0.07, 0.12)
    det.emit('detail', root)
    g = Acc()
    cyl(g, V(x0, 0.16, 0), V(x0, H * 0.7, 0), r * 0.8, M('grain'), seg=14)  # the motor case and grain
    g.emit('piece_grain', root)
    ig = Acc()
    cyl(ig, V(x0, H * 0.7, 0), V(x0, H * 0.78, 0), r * 0.35, M('amber'), seg=10)
    ig.emit('piece_igniter', root)
    return H, x0 + r
