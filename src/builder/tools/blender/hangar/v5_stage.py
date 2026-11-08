"""Hangar v5 part "stage": the raised floor island under the diagonal console bank.

Run (through the lock, from the repo root):
  node src/builder/tools/blender/hangar/v5lock.mjs blender -- "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/hangar/build.py -- --v5 stage --bake --out public/assets/models/builder/hangar/v5

Authored in bank-local metres: origin = the arc centre of the four desks (the turnaround eye point on the floor),
forward (towards the hall's front-left corner, where the operators look) = -Z. The sandbox rotates it +45 degrees
about Y and slides it along the diagonal (stage.json banks[d].island). The outline matches islandOutline() in
v5-stage-check.mjs: an arc of radius 5.05 m over +-86 degrees in front, closed by two corners at (+-3.3, +1.1).
Writes only bank_island_v5.glb and the "modules" key of v5/stage.json; deletes its own baked atlas copies afterwards.
"""
import math, os, json, glob

R, ARC, BACK, BACK_HALF = 5.05, 86, 1.1, 3.3
TOP = .077


def outline(steps=36):
    pts = []
    for i in range(steps + 1):
        a = math.radians(-ARC + 2 * ARC * i / steps)
        pts.append((R * math.sin(a), -R * math.cos(a)))
    pts += [(BACK_HALF, BACK), (-BACK_HALF, BACK)]
    return pts


def offset(pts, d):
    """Offset a convex counter-clockwise-or-not polygon outward by d (per-vertex mitre, fine for gentle corners)."""
    n = len(pts); cx = sum(p[0] for p in pts) / n; cz = sum(p[1] for p in pts) / n; out = []
    for i, p in enumerate(pts):
        a, b = pts[i - 1], pts[(i + 1) % n]
        nx, nz = 0, 0
        for q0, q1 in ((a, p), (p, b)):
            ex, ez = q1[0] - q0[0], q1[1] - q0[1]; l = math.hypot(ex, ez) or 1
            mx, mz = ez / l, -ex / l
            if mx * ((q0[0] + q1[0]) / 2 - cx) + mz * ((q0[1] + q1[1]) / 2 - cz) < 0: mx, mz = -mx, -mz
            nx += mx; nz += mz
        l = math.hypot(nx, nz) or 1
        out.append((p[0] + nx / l * d, p[1] + nz / l * d))
    return out


def clip_line(pts, axis, value):
    """Segment of the line {axis = value} inside the convex polygon, or None."""
    hits = []
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        da, db = a[axis] - value, b[axis] - value
        if da == db: continue
        if (da <= 0 <= db) or (db <= 0 <= da):
            t = da / (da - db); hits.append(a[1 - axis] + t * (b[1 - axis] - a[1 - axis]))
    if len(hits) < 2: return None
    return min(hits), max(hits)


def build(api):
    Geo, start, save, catalog = api['Geo'], api['start'], api['save'], api['catalog']
    out = api['OUT']
    pts = outline()
    root = start('bank_island_v5'); g = Geo()
    # Raised access-floor slab with a sloped nosing (a gentle 12 cm ramp all round, so it reads as a real floor edge).
    n = len(pts); foot = offset(pts, .12)
    verts = [(x, TOP, z) for x, z in pts] + [(x, 0.0, z) for x, z in foot]
    faces = [tuple(range(n))]
    faces += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    g.solid(verts, faces, 0x323e44)
    # Quiet 0.6 m tile seams, aligned with the bank axis.
    inner = offset(pts, -.10)
    for k in range(-9, 10):
        v = k * .6
        for axis in (0, 1):
            seg = clip_line(inner, axis, v)
            if not seg: continue
            a, b = seg
            if b - a < .2: continue
            if axis == 0: g.box((.012, .002, b - a), (v, TOP + .001, (a + b) / 2), 0x3d4a50)
            else: g.box((b - a, .002, .012), ((a + b) / 2, TOP + .001, v), 0x3d4a50)
    # Dark steel nosing strip on the top edge and a muted yellow walk-on line along the back edge (ship side).
    ring = offset(pts, -.03)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        g.beam((a[0], TOP + .004, a[1]), (b[0], TOP + .004, b[1]), .06, 0x56646a, .008)
    a, b = offset(pts, -.16)[-2], offset(pts, -.16)[-1]
    g.beam((a[0], TOP + .005, a[1]), (b[0], TOP + .005, b[1]), .07, 0xa98a32, .008)
    # Cable trench cover in front of the desks' kick plates, following the arc, with lift-handle slots.
    steps = 24
    for i in range(steps):
        a0 = math.radians(-70 + 140 * i / steps); a1 = math.radians(-70 + 140 * (i + 1) / steps); r = 4.93
        p0 = (r * math.sin(a0), TOP + .006, -r * math.cos(a0)); p1 = (r * math.sin(a1), TOP + .006, -r * math.cos(a1))
        g.beam(p0, p1, .2, 0x263238, .01)
        if i % 2 == 0:
            m = math.radians(-70 + 140 * (i + .5) / steps)
            g.box((.05, .004, .05), (r * math.sin(m), TOP + .012, -r * math.cos(m)), 0x5d6d74)
    g.mesh('body', root)
    save('bank_island_v5', root)
    # Fragment: only the modules key is ours to write here; v5-stage-check.mjs --write owns the rest of stage.json.
    path = os.path.join(out, 'stage.json')
    data = json.load(open(path, encoding='utf8')) if os.path.exists(path) else {}
    entry = dict(catalog['bank_island_v5']); entry['file'] = 'v5/' + entry['file']
    data.setdefault('modules', {})['bank_island_v5'] = entry
    with open(path, 'w', encoding='utf8') as f: json.dump(data, f, indent=1); f.write('\n')
    # GLBs embed their textures; drop our own reproducible atlas copies.
    for file in glob.glob(os.path.join(out, 'textures', 'bank_*')): os.remove(file)
    print('[stage] bank_island_v5', entry)
