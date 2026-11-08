"""
Far-field pad gear (priority 3) at REAL size: the art keeps their real size and places them by the far-field rule
(drawn nearer than they really stand and shrunk by the same factor, so they look as big from the ship as they really
do). Origin: the centre of the base on the ground. Plus the small pieces near the ship that keep human size: the
slidewire escape basket and its bunker, the weather gear.
Real references: refs/watertower_39b_1/2 (Pad 39B water tower, 290 ft, 300,000 gal), lightning_39b_1/2 (39B
catenary towers, about 600 ft with fibreglass tops), lh2_sphere_1 (39B's new 1.25 M gal LH2 sphere, 2022),
slidewire_1/2 (Shuttle-era slidewire baskets; Artemis baskets carry up to five people).
"""
import math
from padlib import Piece, T, Ry, Rx, Rz, DEG


def polar(a, r):
    return (r * math.cos(a * DEG), -r * math.sin(a * DEG))


def water_tower():
    """
    Pad 39A/B's water tower: 290 ft (88 m) to the top, a 300,000-gallon (1,135 m3) tank on a central riser and four
    splayed legs with ring braces and X-bracing. It feeds the sound-suppression water: about 1.1 million litres pour
    onto the mobile launcher in under a minute.
    """
    p = Piece('water_tower', 'centre of its base on the ground; real size', {'none': 'real'},
              'deluge = tower (and iop). Real size: place by the far-field rule.')
    top, rt, tank_h = 88.0, 6.6, 9.8
    yb = top - tank_h
    base_r, top_r = 13.0, 5.2
    # four legs, splayed, with ring braces at five levels and X-bracing between them
    legs = []
    for k in range(4):
        a = 45 + 90 * k
        b0, b1 = polar(a, base_r), polar(a, top_r)
        legs.append(((b0[0], 0.0, b0[1]), (b1[0], yb + 0.5, b1[1])))
        p.beam('white', legs[-1][0], legs[-1][1], 0.9)
        p.box('concrete_old', 2.4, 0.8, 2.4, b0[0], 0.4, b0[1])
    levels = [0.0, yb * 0.2, yb * 0.4, yb * 0.6, yb * 0.8, yb + 0.5]

    def at(k, y):
        (x0, y0, z0), (x1, y1, z1) = legs[k]
        f = (y - y0) / (y1 - y0)
        return (x0 + (x1 - x0) * f, y, z0 + (z1 - z0) * f)
    for y in levels[1:-1]:
        for k in range(4):
            p.beam('white', at(k, y), at((k + 1) % 4, y), 0.45)
            p.beam('white', at(k, y), (0.0, y, 0.0), 0.3)
    for i in range(len(levels) - 2):
        y0, y1 = levels[i] + (0.6 if i == 0 else 0), levels[i + 1]
        for k in range(4):
            p.beam('white', at(k, y0), at((k + 1) % 4, y1), 0.25)
            p.beam('white', at((k + 1) % 4, y0), at(k, y1), 0.25)
    # the central riser and the tank: a short cylinder between an elliptical floor and roof, a walkway round its waist
    p.cyl('white', 1.6, 0.0, yb + 1.0, seg=20)
    p.lathe('white', [(0.0, yb - 1.4), (rt * 0.55, yb - 0.9), (rt * 0.85, yb - 0.2), (rt, yb + 0.9), (rt, yb + 4.4),
                       (rt * 0.86, yb + 6.6), (rt * 0.55, yb + 8.4), (rt * 0.2, yb + 9.4), (0.0, yb + 9.6)], seg=32)
    p.torus('grey', rt + 0.6, 0.06, 0, yb + 1.9, 0, seg=40, seg2=4)
    p.lathe('grey', [(rt + 0.05, yb + 0.85), (rt + 0.75, yb + 0.85), (rt + 0.75, yb + 0.95), (rt + 0.05, yb + 0.95)], seg=40)
    p.cyl('grey', 0.6, yb + 9.4, yb + 10.2, seg=12)
    p.lathe('grey', [(0.75, yb + 10.2), (0.0, yb + 10.6)], seg=12, caps=False)
    # the outlet main: a big pipe from the riser's foot toward the pad
    p.tube('steel', (0.0, 0.8, 0.0), (-30.0, 0.8, 0.0), 0.9, seg=14)
    p.box('steel_dark', 2.0, 2.2, 2.4, -3.5, 1.1, 0.0)
    return p, {'ship': (-30.0, 0.0, 0.0), 'frame': 40.0, 'views': ('34', 'side')}


def sphere_piece(slug, inner_d, label):
    """A cryogenic storage sphere on legs, 39B style: white double wall, ring of columns with X-bracing, a stair
    tower to the top platform, a vent stack, the transfer lines at its foot."""
    p = Piece(slug, 'centre of its base on the ground; real size', {'none': 'real'}, f'propellant = auto / loadgo: {label}. Real size.')
    r = inner_d / 2 + 1.2                # the outer (vacuum) shell round the perlite-filled gap
    yc = r + 3.5
    p.sphere('white', r, 0, yc, 0, seg=40, rings=22)
    n = 12
    rl = r * 0.97
    for k in range(n):
        a = 360 * k / n
        x, z = polar(a, rl)
        p.cyl('white', 0.75, 0.0, yc + 0.6, x, z, seg=12)
        p.cyl('concrete_old', 1.1, 0.0, 0.6, x, z, seg=12)
        x2, z2 = polar(360 * (k + 1) / n, rl)
        p.beam('white', (x, 1.0, z), (x2, yc - 1.0, z2), 0.22)
        p.beam('white', (x2, 1.0, z2), (x, yc - 1.0, z), 0.22)
        p.beam('white', (x, yc * 0.55, z), (x2, yc * 0.55, z2), 0.25)
    # the stair tower up the side, its bridge to the top platform with railing and the vent stack
    sx = r + 3.0
    p.lattice('white', x=sx, z=0, w=3.0, y0=0, y1=2 * r + 3.5, bay=3.0, t=0.25)
    for i in range(int((2 * r + 3.5) / 3.0)):
        a, b = i * 3.0, (i + 1) * 3.0
        d = 1 if i % 2 == 0 else -1
        p.stairs('grey', (sx - 1.0 * d, a + 0.1, 0.6), (sx + 1.0 * d, b + 0.1, 0.6), width=0.9, rise=0.25)
    top = yc + r
    p.beam('grey', (sx - 1.5, top + 0.1, 0.0), (r * 0.25, top + 0.1, 0.0), 1.2)
    p.disc('deck', r * 0.35, top - 0.1, seg=24)
    p.railing('yellow', [polar(a, r * 0.35) for a in range(0, 360, 30)], top - 0.1, closed=True, step=1.5)
    p.cyl('steel', 0.35, top - 0.5, top + 6.0, 0.8, 0.8, seg=10)
    # transfer lines and valves at the foot, the label band
    for z in (-1.2, 1.2):
        p.tube('steel', (0.0, 1.2, z), (-r - 12.0, 1.2, z), 0.35, seg=10)
    p.box('steel_dark', 2.4, 2.0, 4.0, -r * 0.5, 1.0, 0.0)
    return p, {'ship': (-r - 12.0, 0.0, 0.0), 'frame': 30.0, 'views': ('34', 'side')}


def sphere():
    """Pad 39B's liquid hydrogen sphere (2022): 1.25 million gallons, about 20.8 m inside."""
    return sphere_piece('sphere', 20.8, 'LH2, Pad 39B (1.25 M gal)')


def sphere_lox():
    """LC-39's liquid oxygen sphere: 900,000 gallons, about 18.7 m inside."""
    return sphere_piece('sphere_lox', 18.7, 'LOX, LC-39 (900,000 gal)')


def lightning_tower():
    """
    A catenary lightning tower like Pad 39B's three (2011): a tapering square steel lattice with a fibreglass mast on
    top, about 600 ft (183 m); the wires between the towers are drawn by art.js from attach_wire.
    """
    p = Piece('lightning_tower', 'centre of its base on the ground; real size', {'none': 'real'},
              'lightning = mast / catenary. Real size; wires from attach_wire.')
    lat, mast = 150.0, 33.0
    b0, b1 = 13.0, 2.6
    n = 22
    hw = lambda y: (b0 + (b1 - b0) * (y / lat)) / 2
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.beam('grey_light', (sx * hw(0), 0, sz * hw(0)), (sx * hw(lat), lat, sz * hw(lat)), 0.7)
    ys = [lat * (1 - (1 - i / n) ** 1.25) for i in range(n + 1)]
    for i, y in enumerate(ys):
        h = hw(y)
        for s in (-1, 1):
            p.box('grey_light', 2 * h, 0.35, 0.35, 0, y, s * h)
            p.box('grey_light', 0.35, 0.35, 2 * h, s * h, y, 0)
        if i < n:
            y1 = ys[i + 1]
            h1 = hw(y1)
            for s in (-1, 1):
                p.beam('grey_light', (-h, y, s * h), (h1, y1, s * h1), 0.28)
                p.beam('grey_light', (h, y, s * h), (-h1, y1, s * h1), 0.28)
                p.beam('grey_light', (s * h, y, -h), (s * h1, y1, h1), 0.28)
                p.beam('grey_light', (s * h, y, h), (s * h1, y1, -h1), 0.28)
    for s in (-1, 1):
        p.box('concrete_old', 3.5, 1.2, 3.5, s * hw(0), 0.6, s * hw(0))
        p.box('concrete_old', 3.5, 1.2, 3.5, s * hw(0), 0.6, -s * hw(0))
    p.box('grey', b1 + 1.2, 0.5, b1 + 1.2, 0, lat + 0.25, 0)
    p.lathe('white', [(0.9, lat + 0.5), (0.7, lat + mast * 0.5), (0.35, lat + mast), (0.0, lat + mast + 0.8)], seg=12)
    for k in range(1, 6):
        p.torus('grey', 0.9 - 0.11 * k, 0.08, 0, lat + 0.5 + k * mast * 0.16, 0, seg=12, seg2=4)
    p.mark('wire', (0.0, lat + mast * 0.85, 0.0))
    return p, {'ship': (-40.0, 0.0, 0.0), 'frame': 60.0, 'views': ('34', 'side')}


def egress():
    """
    The slidewire escape system (Apollo, Shuttle, Artemis at LC-39B): a basket hung under its trolley on a steel wire
    (node basket: origin at the wire, the basket hangs below), and the bunker at the landing zone (node bunker, origin
    at its base). Human size: art.js places them along its code-drawn wires.
    """
    p = Piece('egress', 'nodes placed by art.js (basket: its origin on the wire; bunker on the ground)', {'none': 'human'},
              'access = slidewire (basket, bunker); blastroom uses bunker.')
    W = 2.45  # the wire runs 2.45 m above the piece's origin; the basket hangs below it to y = 0
    with p.node('basket', (0, W, 0)), p.at(T(0, W, 0)):
        # trolley and brake on the wire, the frame of tubes, aluminised fabric walls, a floor; about 2 m tall, 1.4 m wide
        p.box('steel', 0.6, 0.18, 0.22, 0, -0.1, 0, chamfer=0.02)
        for dx in (-0.2, 0.2):
            with p.at(T(dx, 0.0, 0) @ Rx(90)):
                p.cyl('steel_dark', 0.08, -0.12, 0.12, seg=10)
        for s in (-1, 1):
            p.tube('yellow', (s * 0.25, -0.15, 0), (s * 0.75, -0.75, 0.0), 0.035, seg=6)
        p.box('silver', 1.5, 1.35, 1.1, 0, -1.65, 0, chamfer=0.04)
        p.box('steel_dark', 1.55, 0.06, 1.15, 0, -2.33, 0)
        for sx in (-1, 1):
            for sz in (-1, 1):
                p.tube('yellow', (sx * 0.77, -0.75, sz * 0.57), (sx * 0.77, -2.35, sz * 0.57), 0.03, seg=6)
        p.tube('yellow', (-0.77, -0.75, 0.57), (0.77, -0.75, 0.57), 0.03, seg=6)
        p.tube('yellow', (-0.77, -0.75, -0.57), (0.77, -0.75, -0.57), 0.03, seg=6)
        p.box('steel_dark', 0.8, 0.03, 0.02, 0, -1.5, 0.56)
    with p.node('bunker', (12.0, 0, 0)):
        with p.at(T(12.0, 0, 0)):
            p.box('concrete_old', 4.4, 0.8, 4.8, 0, 0.4, 0, chamfer=0.1)
            p.box('concrete_old', 3.2, 1.6, 3.6, 0, 1.6, 0, chamfer=0.08)
            p.front_prism('earth', [(-2.2, 0.0), (-2.2, 2.0), (-4.5, 0.0)], -2.4, 2.4)
            p.box('steel_dark', 0.06, 1.2, 1.0, -1.61, 1.3, 0)
            p.box('yellow', 0.1, 0.12, 1.2, -1.62, 2.0, 0)
            for s in (-1, 1):
                p.cyl('steel', 0.08, 0.0, 2.6, -4.0, s * 2.4, seg=6)
    return p, {'ship': (-3.0, -16.0, 0.0), 'frame': 10.0, 'views': ('detail',), 'ship_on': False}


def weather_gear():
    """The weather watch: a weather radar under its radome on a lattice tower (node radar), a field mill that measures
    the electric field before a storm (field_mill), and a wind tower with cup anemometers (wind_tower). Human size."""
    p = Piece('weather_gear', 'nodes placed by art.js, each on its own base', {'none': 'human'}, 'weather = radar (radar, field_mill, wind_tower).')
    with p.node('radar'):
        p.lattice('grey', w=1.8, y0=0, y1=6.0, bay=2.0, t=0.15)
        p.box('grey', 2.4, 0.2, 2.4, 0, 6.1, 0)
        p.railing('yellow', [(-1.2, -1.2), (1.2, -1.2), (1.2, 1.2), (-1.2, 1.2)], 6.2, closed=True, step=0.8, h=1.0, t=0.04)
        p.sphere('white', 1.8, 0, 7.75, 0, seg=24, rings=14)
        p.box('white', 1.6, 1.6, 1.4, 0.0, 0.8, 1.8)
    with p.node('field_mill', (5.0, 0, 0)):
        with p.at(T(5.0, 0, 0)):
            p.cyl('steel', 0.06, 0.0, 0.9, seg=8)
            p.cyl('steel_dark', 0.3, 0.9, 1.05, seg=16)
            p.box('grey', 0.4, 0.5, 0.3, 0.0, 0.25, 0.35)
    with p.node('wind_tower', (-5.0, 0, 0)):
        with p.at(T(-5.0, 0, 0)):
            p.cyl('steel', 0.08, 0.0, 10.0, seg=8)
            for k in (0.55, 1.0):
                p.box('steel', 1.0, 0.05, 0.05, 0, 10.0 * k, 0)
                for s in (-1, 1):
                    p.sphere('steel_dark', 0.09, s * 0.5, 10.0 * k + 0.08, 0, seg=8, rings=5)
            for s in (-1, 1):
                p.tube('wire', (0, 9.0, 0), (s * 3.0, 0.1, 0), 0.01, seg=3)
    return p, {'ship': (0.0, -16.0, 0.0), 'frame': 8.0, 'views': ('detail',), 'ship_on': False}


PIECES = {
    'water_tower': water_tower, 'sphere': sphere, 'sphere_lox': sphere_lox, 'lightning_tower': lightning_tower,
    'egress': egress, 'weather_gear': weather_gear,
}
