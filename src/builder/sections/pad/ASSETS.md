# Launch pad section: assets

## Blender models (wave 4)

25 ground models in `public/assets/models/builder/pad/` (about 1.5 MB in all; each under 20,000 triangles and 400 KB,
Draco-compressed GLB). `art.js` `PAD_MODELS` and `padModelIds` say which complex uses which; each file downloads only
when a complex that uses it is shown, and the code-drawn piece shows meanwhile (and if a file is missing).

- **Our own geometry** (built by `src/builder/tools/blender/pad/build.py` from real dimensions and the ratio rules; the
  textures are generated in the script with seeded noise): `slab`, `trench`, `mount_raised`, `mount_olm2`,
  `pedestal_lc34`, `pit`, `mlp_saturn`, `mlp_shuttle`, `table_ela3`, `holddown`, `tower_fixed`, `crew_arm`,
  `strongback`, `catch_tower`, `soyuz_gantry`, `soyuz_launcher`, `mst`, `rss`, `water_tower`, `sphere`, `sphere_lox`,
  `lightning_tower`, `egress`, `weather_gear`. Licence: ours, like the game's code.
- **`ml1`** (LC-39B's Mobile Launcher 1): NASA's model "Mobile Launcher" from NASA 3D Resources
  (github.com/nasa/NASA-3D-Resources), already in the repo as `public/assets/nasa/mobile_launcher.glb`; public domain
  (NASA media guidelines). Re-cut by `src/builder/tools/blender/pad/ml1.py`: cut at its deck into the platform and its tower,
  rescaled to the reference ship, its colour map lightened toward ML-1's grey. Credit: NASA.
- Reference photos used to measure and compare (not shipped, not traced): NASA images listed in the wave-4 research
  folder (`spaceb-wave4/pad/refs/index.json`); the two SpaceX photos there were looked at only.

## Code-drawn

- Every piece also exists as procedural three.js geometry in `art.js` (the fallback while a model loads, and the card
  pictures): launch mounts, towers, clamps and arms, the Soyuz support arms, water ring, water bags, rainbirds and water
  tower, lightning rod, mast and towers, crew arm, escape chute, slidewire baskets, blast-room entrance, storage spheres,
  chilling plant, tanker truck, weather station, radar, field mills and a windsock.
- The ground under each complex is a texture drawn at runtime on a canvas in `art.js` (no image file).
- The card pictures are the same code art rendered small by `partIcons.js` (`objectIcon`), nothing baked.
- Not used: `public/assets/nasa/mobile_launcher_pad.glb`, `gantry.glb`, `crawler.glb` (public domain).
- Nothing to add to CREDITS.md beyond the NASA credit it already gives for NASA 3D Resources.
