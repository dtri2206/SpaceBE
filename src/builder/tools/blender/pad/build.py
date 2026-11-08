"""
Builds the Launch pad card's ground pieces (Blender 5.2, nothing else needed). Run from the repo root:

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/pad/build.py -- \
      [--out public/assets/models/builder/pad] [--only slab,trench] [--shots DIR]

Each piece is one GLB (public/assets/models/builder/pad/<slug>.glb) built for the reference ship (20 m x 2.5 m); see
padlib.py for the conventions and pieces.json (written here) for each piece's anchor, scaling, nodes and budget.
--shots renders each piece beside a 20 m x 2.5 m reference cylinder, to compare with the reference photos.
"""
import os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import padlib as P  # noqa: E402
import mounts, towers, farfield, ml1  # noqa: E402

PIECES = {**mounts.PIECES, **towers.PIECES, **farfield.PIECES, **ml1.PIECES}
OUT = P.C.arg('--out', 'public/assets/models/builder/pad')
ONLY = P.C.arg('--only')
SHOTS = P.C.arg('--shots')

entries = {}
for slug, fn in PIECES.items():
    if ONLY and slug not in ONLY.split(','):
        continue
    piece, view = fn()
    entries[slug] = P.export(piece, OUT)
    if SHOTS:
        P.preview(piece, os.path.join(SHOTS, slug + '.png'), **view)
P.write_manifest(entries)
total = sum(e['kb'] for e in entries.values())
print(f'[pad] built {len(entries)} pieces, {total} KB')
