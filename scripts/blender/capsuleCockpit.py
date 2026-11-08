"""
SpaceB&E capsule cockpits: the crew cabin of every capsule the builder offers, seen from the commander's eye lying on his back.

  Blender -b --factory-startup -P scripts/blender/capsuleCockpit.py -- --type apollo --out public/assets/models/cockpit/apollo.glb [--shots DIR]
  (--type all builds the twelve capsules; --layout FILE overrides scripts/blender/capsule_layout.json, made by capsuleLayout.py from Role 1's exterior glb files)

Game coordinates (same as flightdeck.glb): the origin is the COMMANDER'S EYE, +Y toward the head (screen up), -Z up the capsule axis toward the apex,
+Z behind the back (the heat shield), +X right. The capsule shell, windows, hatch and docking port sit exactly where Role 1's exterior model has them
(the layout json holds the profile and every window/hatch island of the exterior), only moved so the eye is the origin.

Nodes of the glb (names that survive GLTFLoader are the plain ones):
  win_small / win_panoramic / win_cupola : one cabin shell WITH the openings of that style + its frames + glass (runtime shows one, so the shell is always closed)
  hatch_side / hatch_inward / hatch_top  : the door (child door_<style>, pivot at the hinge) + rim; ladderTop_<style> empty; the active one becomes aftHatch / ladderTop
  docking (tunnel at the apex, hidden with the cupola), dock_cap (plain end cap, hidden when the top hatch is chosen)
  displayLeft, centreDisplay, displayRight, btn:<id> (+ btnCap.<id>, btnLamp.<id>), alarmLamp, cutoffGuard/cutoffSwitch/cutoffLamp, assistButton/assistCap,
  retroButton/retroCap, tick.0-9, stick, throttle (+ gloves as children), arm bones, reachRig empties, eye/aft/ladder empties.
"""
import os, sys, json, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from cc_core import *
import cc_core as C
import cc_cockpit as K

IDS = ['vostok', 'mercury', 'gemini', 'apollo', 'soyuz', 'shenzhou', 'orion', 'dragon', 'starliner', 'gaganyaan', 'newshepard', 'mengzhou']
which = arg('--type', 'apollo')
OUT = arg('--out')
SHOTS = arg('--shots')
LAYOUT = json.load(open(arg('--layout', os.path.join(HERE, 'capsule_layout.json'))))

def build(cid):
    reset_scene()
    K.build_capsule(cid, LAYOUT[cid], OUT_FOR(cid))

def OUT_FOR(cid):
    if which == 'all':
        return os.path.join(OUT or 'public/assets/models/cockpit', cid + '.glb') if not (OUT or '').endswith('.glb') else OUT
    return OUT

if which == 'all':
    # each capsule needs a fresh Blender state: run them one after another through sub-processes
    import subprocess
    outdir = OUT or 'public/assets/models/cockpit'
    for cid in IDS:
        cmd = [sys.executable if False else bpy.app.binary_path, '-b', '--factory-startup', '-P', os.path.abspath(__file__), '--', '--type', cid, '--out', os.path.join(outdir, cid + '.glb')]
        if SHOTS:
            cmd += ['--shots', os.path.join(SHOTS, cid)]
        for extra in ('--no-render', '--scan', '--samples'):
            if extra in argv:
                cmd += [extra] + ([arg(extra)] if extra == '--samples' else [])
        print('=== ', cid, flush=True)
        subprocess.run(cmd, check=False)
else:
    build(which)
