"""
Builds the body section's Blender models (README.md in the folder above is the contract). Run from the repo root:

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/body/build.py -- [--only slug,slug] [--shots DIR]

Writes public/assets/models/builder/body/<slug>.glb for every model (or the --only list) and, with --shots, preview
renders: <slug>.png (outside, as the real shape fits it), <slug>_inside.png (skin hidden: the inner pieces) and one
render per extra look listed in LOOKS. Generators: tanks.py (barrel tanks, clusters, profiled shells), structures.py
(skirts, centerbody, SLS forward skirt, hot-staging lattices and ring, the hung LOX tank), side.py (APS pod, ullage motor).

Node names in every model: `shell` (the outer skin), `frames` / `detail` (rings, fittings), `inner` (domes and supports),
`piece_<name>` (cluster tanks, spheres, side-part insides), and the kit's pieces: `slot_<key>` (the FIRST option's look)
and `slot_<key>__<optionId>` for every other option (bay/nasa.js applyChoices shows only the fitted one).
"""
import os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bodylib as L  # noqa: E402
import tanks, structures, side  # noqa: E402

MODELS = {}
MODELS.update(tanks.MODELS)
MODELS.update(structures.MODELS)
MODELS.update({'sivb_aps': ('aps_module', side.sivb_aps), 'ullage_motor': ('ullage_motors', side.ullage_motor)})

# The options the real shapes fit (sections/body/section.json), for the previews
SHAPE = {
    'titan2_tanks': {'feedline': 'pogo'},
    'soyuz_block_a': {'pressurisation': 'nitrogen'},
    'vulcan_tank': {'insulation': 'foam'},
    'ariane5_epc': {'insulation': 'foam_white'},
    'centerbody_l': {'construction': 'composite'},
}
LOOKS = {
    'forward_skirt_l': [('corrugated', {'construction': 'corrugated'}), ('isogrid', {'construction': 'isogrid'})],
    'centerbody_l': [('orthogrid', {'construction': 'orthogrid'})],
    'titan2_tanks': [('variants', {'wall': 'isogrid', 'pressurisation': 'helium', 'baffles': 'antivortex', 'feedline': 'tunnel'})],
}


def main():
    only = L.C.arg('--only')
    shots = L.C.arg('--shots')
    slugs = [s for s in only.split(',') if s] if only else list(MODELS)
    total = 0
    for slug in slugs:
        pid, fn = MODELS[slug]
        t0 = time.time()
        L.reset()
        root = L.C.root(slug)
        H, R = fn(root)
        p = L.part(pid)
        L.report_groups(root)
        axial = p.get('attach') == 'axial'
        own = (p.get('hullProfile') or {}).get('kind') == 'own'
        tris, size = L.export(root, slug, height=H if axial else None, radius=R if axial and not own else None)
        total += size
        if shots:
            L.shots(root, slug, H, R, shots, keep=SHAPE.get(slug, {}), extra=LOOKS.get(slug), side=not axial)
        print(f'[build] {slug}: {tris} triangles, {size / 1024:.0f} KB, {time.time() - t0:.1f} s')
    print(f'[build] {len(slugs)} models, {total / 1048576:.2f} MB')


main()
