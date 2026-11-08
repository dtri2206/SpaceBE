# Blender models for builder parts: the contract

Every Blender model of a builder part follows these rules, so it snaps onto the stack and the outer skin exactly like
the code-drawn parts, in the design studio, on the hangar stand, in the explanation card and in the flight scenes.
`node src/builder/tests/models.test.mjs` checks them.

## Where things go
- Scripts: `src/builder/tools/blender/<section>/<script>.py` (one script may build many parts: parametric generators).
  Shared helpers: `common.py`; a worked example: `examples/tank_example.py`.
- Output: `public/assets/models/builder/<section>/<slug>.glb` (Draco-compressed GLB, written by `common.export`).
- A part uses its model through its data: `"model": { "builder": "<section>/<slug>" }` in `sections/<section>/parts.json`.
  The code-drawn art shows while the file downloads; the model replaces it once loaded (`bay/nasa.js`, `bay/partArt.js`).
- Run headless from the repo root:
  `"C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/<section>/<script>.py -- --out <glb> [--shots <dir>]`
  (Blender 5.2 LTS, the same as Role 3's `scripts/blender/`).

## Geometry
- Metres, +Y up (write game coordinates; `common.G()` converts to Blender), real proportions scaled to the game size.
- **Axial parts** (in the stack): origin at the centre of the part's base on the rocket axis; the part spans y = 0 to
  y = its catalogue `height` (±2 %). The joints are circles of the stack radius of its size: S 0.9375 m, M 1.25 m,
  L 1.6875 m (an adapter: its `adapter.top` radius at the top, `adapter.bottom` at the bottom). A tank or structure wall
  that is the vehicle's outer skin sits exactly at that radius; ring frames and fittings may stand proud by a few cm.
  Capsules, nose cones, towers and engines keep their own shape (the skin goes round them) and declare it with
  `hullProfile` in the part data (`data/hull.json` profiles show the format).
- A cover that really hangs down over the part below it (Orion's launch-abort fairing over the crew module) declares how
  far and over what: `"model": { "builder": "nose/las_orion", "below": 2.2, "encloses": "capsule_orion" }`; the
  studio then shows it see-through with that part's card open.
- A shell part with fittings that really stand out of its wall (the Dragon trunk's fins, a raceway) declares how far:
  `"model": { "builder": "nose/crew_trunk_m", "proud": 0.3 }` (metres beyond the stack radius).
- **Radial parts** (on the side): origin at the attachment point on the host's wall, +X pointing outward, height along
  +Y from the mount; a part that rides inside the skin is placed by the game, model it standing on y = 0 centred.
- **Engine clusters**: model one engine; the thrust structure's `mounts` places the copies. An engine that may sit in a
  cluster of more than 9 also ships a low-detail copy (at most 2,500 triangles, no inner pieces) named in its data:
  `"model": { "builder": "tail/<slug>", "lod": "tail/<slug>_lod" }`.
  The low-detail copy shows only when it has the fitted look: `lod` for the sea-level bell, `lodVac` for the vacuum
  bell, `lodSpike` for the aerospike (each at most 2,500 triangles); with no matching copy, or another contour, the
  cluster draws the full model.
- **Parts drawn as a set** (landing legs, fins in a symmetric group): the game places each copy; model one unit.
- **Which size**: by the real rocket's diameter: under 2.5 m S, 2.5–4.5 m M (Falcon 9, Atlas, Titan, Soyuz), over 4.5 m
  L (Saturn V, the Shuttle tank, SLS, Starship, Energia, N1, Vulcan, Ariane 5, Long March 5). Strap-on boosters keep the
  real booster ÷ core diameter ratio of their rocket, so a family stays recognisable.
- **Inner-piece budget**: every node counts towards the 20k triangles, choice variants (slot_<key>__<option>) included:
  keep each variant small (a few hundred triangles).
- A part may set `"defaultMaterial"` (an option id of its material family) when its real build differs from the family's
  first option (carbon cases, steel tanks).
- Nothing below y = 0 for axial parts except an engine's own bell when the part data says so.

## Inner pieces (the explanation card pulls them apart)
- Each kit slot of the part (`internals` kit in `sections/<section>/internals.json`) that is modelled is one empty or
  mesh named `slot_<key>` holding that piece, placed where it really sits inside the part.
- A choice with its own look: `slot_<key>__<optionId>` (two underscores); the game uses it when that option is fitted,
  else `slot_<key>`. Names: lowercase letters, digits and single underscores; no dots or spaces.
- Slots that are not modelled keep the code-drawn piece (`bay/internalsArt.js`).
- Name mesh DATA differently from its object (e.g. `m_<node>`): three.js names the per-material children of a node after
  its mesh data, and a child called `slot_…_1` would look like another variant (the game now ignores slot_ nodes inside a
  slot_ node, but keep names clean).
- On the ship the game shows, for each slot, only `slot_<key>__<option fitted>` when the model has it, else the plain
  `slot_<key>` (so the plain node must be the slot's FIRST option's look); every other variant is hidden. A piece that
  replaces another slot (an aerospike or conical nozzle replaces the bell extension) carries the custom property
  `hides = "nozzleExt"` (exported as glTF extras by `common.export`).
- An engine with a separate vacuum-bell file names it `"model": { "builder": "tail/engine_m", "vac": "tail/engine_m_vac" }`;
  the game uses it when the engine's nozzle is `vac`.

## Looks and budget
- glTF PBR materials (Principled BSDF): base colour, metallic, roughness; keep metalness moderate (0.3–0.6), the studio
  has no environment map. Real colours: white paint, bare Al-Li, foam orange, black carbon, copper chambers, ablator brown.
- Balanced budget (decided with the user): about 20,000 triangles and at most 400 KB per GLB; textures at most 1024 px;
  at most about 12 MB of models per section.
- Licences: your own geometry; NASA (public domain) and CC0 models may be cut and reused; CC BY only with a credit line in
  the section's `ASSETS.md`. Reference photos with other licences are for measuring only.

## Ground models (the Launch pad card)
Pad hardware is not a catalogue part: `sections/pad/art.js` builds the complex from pieces and fits it to the ship.
- Output: `public/assets/models/builder/pad/<slug>.glb`, built for a **reference ship 20 m tall and 2.5 m wide**
  (radius 1.25 m), the game's typical ship.
- Origin: on the ground (y = 0) at the piece's own anchor, stated in the piece's entry in `sections/pad/NOTES.md`
  (a tower: the centre of its base, its face toward the rocket on -X; a mount: centred on the rocket's axis).
- Scaling: `art.js` scales a piece along one axis family only, so details keep their shape: towers and masts in
  height with the ship's height (H / 20), mounts, rings, trenches and arms across with its width (D / 2.5); far-field
  structures (water towers, lightning towers, spheres) keep their real size.
- Named nodes: `attach_<name>` marks a point the art uses (an arm's pivot, the deck of a mobile platform);
  `pose_<name>` is a part that moves (an arm swung back or forward). Same name rules as `slot_` nodes.
- Ratio rules (measured on real photos; the user asked that a ship never looks tiny next to its pad):
  - umbilical or service tower: about 1.10 × the ship's height above the deck it stands on;
  - catch tower: mount top + 1.05 × the ship's height;
  - strongback: 1.02 × height;
  - service-tower footprint about 3 × the ship's width;
  - the mount ring 1.8–2 × the ship's width; a mobile platform deck about 3 × the width;
  - a flame trench 1.8–2.1 × the width.
- Budget: the same 20k triangles and 400 KB per file; about 12 MB for the pad section.
