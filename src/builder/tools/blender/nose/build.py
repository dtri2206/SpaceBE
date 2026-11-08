"""
Builds every Blender model of the nose card in one Blender session (Blender 5.2, nothing else needed). From the repo root:

  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/nose/build.py -- [--only capsule_apollo,las_soyuz] [--shots DIR]

Generators: capsules.py (G1 capsules), special.py (Starship nose, Dream Chaser), fairings.py (G3 fairings and shrouds),
towers.py (G4 escape systems), modules.py (G2 service, orbital and cargo modules), small.py (G5 caps, chute containers,
airlock, SuperDraco pod). Output: public/assets/models/builder/nose/<slug>.glb. Sizes and heights come from
sections/nose/parts.json when the part is there. Writes models.json here: each model's part, size, triangles, KB, nodes.
"""
import os, sys, json
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import nl  # noqa: E402
import capsules, special, fairings, towers, modules, small  # noqa: E402

PART = {}
PART.update({s: s for s in capsules.CAPS})
PART.update({s: s for s in special.BUILD})
PART.update({s: v['part'] for s, v in fairings.FAIRINGS.items()})
PART.update({s: v['part'] for s, v in towers.TOWERS.items()})
PART.update({s: v.get('part', s) for s, v in modules.MODS.items()})
PART.update({s: v['part'] for s, v in small.PARTS.items()})
JOBS = [(s, lambda s, sh: capsules.build(s, sh)) for s in capsules.CAPS]
JOBS += [(s, lambda s, sh: special.BUILD[s](s, sh)) for s in special.BUILD]
JOBS += [(s, fairings.build) for s in fairings.FAIRINGS]
JOBS += [(s, towers.build) for s in towers.TOWERS]
JOBS += [(s, modules.build) for s in modules.MODS]
JOBS += [(s, small.build) for s in small.PARTS]

if __name__ == '__main__':
    only = nl.C.arg('--only')
    shots = nl.C.arg('--shots')
    want = set(only.split(',')) if only else None
    man_path = os.path.join(HERE, 'models.json')
    manifest = json.load(open(man_path, encoding='utf8')) if os.path.exists(man_path) else {}
    for slug, fn in JOBS:
        if want and slug not in want:
            continue
        _, tris, size = fn(slug, shots)
        import bpy
        nodes = sorted(o.name for o in bpy.data.objects if o.name.startswith(('slot_', 'form_', 'motor_', 'esm_')))
        pd = nl.part_data(PART[slug]) or {}
        manifest[slug] = {'part': PART[slug], 'size': pd.get('size'), 'height': pd.get('height'), 'triangles': tris,
                          'kb': round(size / 1024), 'nodes': nodes}
    json.dump(dict(sorted(manifest.items())), open(man_path, 'w', encoding='utf8'), indent=1)
    total = sum(v['kb'] for v in manifest.values())
    print(f'[nose] {len(manifest)} models, {total} KB ({total / 1024:.2f} MB)')
