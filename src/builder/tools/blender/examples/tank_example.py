"""
Example and pipeline check: a methalox tank of the game's M size (radius 1.25 m, 4.0 m tall), the way every builder
model is made. Copy this file to start a new model. Run from the repo root:

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/examples/tank_example.py -- --out <path>.glb [--shots <dir>]

It shows the contract (README.md): origin at the base centre on the axis, +Y up, metres, the outer wall exactly at the
stack radius from y = 0 to the part height, and the inner pieces as groups named slot_<key> (the tank kit's slots:
bulkhead, pressurisation, baffles, insulation, feedline), optionally slot_<key>__<optionId> for a choice's own look.
"""
import os, sys, math
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import common as C

H, R = 4.0, C.RADIUS['m']
OUT = C.arg('--out', 'example_tank_m.glb')
SHOTS = C.arg('--shots')

C.reset()
root = C.root('tank_example')
skin = C.white_paint()

# outer wall: the cylinder is the stack's own skin, exactly R from y = 0 to H, with weld lands every barrel section
C.cylinder('wall', R, 0.0, H, skin, root, segments=72, caps=False)
for y in (0.06, 1.33, 2.66, H - 0.06):
    C.ring(f'weld_{y:.2f}', R, y, 0.05, 0.006, C.aluminium(), root)
# the forward and aft skirts' bolt rings, flush with the joint so the next part seats cleanly
C.ring('ring_top', R - 0.012, H - 0.015, 0.03, 0.012, C.dark_metal(), root)
C.ring('ring_bottom', R - 0.012, 0.015, 0.03, 0.012, C.dark_metal(), root)

# inner pieces, one group per kit slot (the explanation card pulls them out)
bulk = C.group('slot_bulkhead', root)
dome = [(R * 0.97 * math.cos(t), 2.0 + 0.55 * math.sin(t)) for t in [i * math.pi / 2 / 10 for i in range(11)]]
C.lathe('bulkhead_dome', [(r, y) for (r, y) in dome], C.aluminium(), bulk, segments=48)
press = C.group('slot_pressurisation', root)
for k in range(3):
    a = k * 2 * math.pi / 3
    C.lathe(f'copv_{k}', [(0.001, -0.18), (0.12, -0.15), (0.18, 0.0), (0.12, 0.15), (0.001, 0.18)], C.carbon(), press, segments=24, x=0.62 * math.cos(a), z=-0.62 * math.sin(a))
    press.children[-1].location.z += 3.3  # blender z is game y
baff = C.group('slot_baffles', root)
for y in (0.9, 1.5, 2.6, 3.2):
    C.lathe(f'baffle_{y}', [(R * 0.62, y), (R * 0.95, y), (R * 0.95, y + 0.03), (R * 0.62, y + 0.03)], C.aluminium(), baff, segments=48)
ins = C.group('slot_insulation', root)
C.cylinder('insulation_band', R * 0.985, 0.3, H - 0.3, C.foam_orange(), ins, segments=48, caps=False)
feed = C.group('slot_feedline', root)
C.cylinder('downcomer', 0.09, 0.0, 2.0, C.stainless(), feed, segments=20)

C.export(root, OUT, max_tris=20000, expect_height=H, expect_radius=R)
if SHOTS:
    C.render_preview(os.path.join(SHOTS, 'tank_example.png'), H, R)
