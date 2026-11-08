# VAB-inspired high bay — hand-over to Claude

This is a new standalone asset kit and inspection template for Role 1. Existing game scenes, shared Blender helpers, other assets, dependency manifests and Git state were not edited by this task. Leave these files uncommitted for Claude to review. The human's port 5173 server was not restarted.

## V4: 270-degree wrap, viewing slot and console inspection

V4 is now the default at **http://localhost:5280/sandbox/role1.hangar.html** (also `?v=4`). **`?v=3`** loads the saved calm-lighting/two-half implementation; **`?v=2`** loads its historical predecessor. Claude's non-sandbox-canvas hiding fix is retained immediately before console creation in v4. The saved runtime files and every original GLB/texture are unchanged: `refs/protected-v3.json` records 121 SHA-256 hashes, asserted by the asset test. `refs/contract-v3.json` is the full pre-v4 manifest; every original key/value/module definition remains unchanged. Backups are Claude's `b90cab3` / `hangar-v3` and `2db32c9` / `hangar-v2-backup`; no restore or modifying Git command was used.

Only the authorized hangar assets/tools/tests and `sandbox/role1.hangar.*` changed. No game code, dependencies, saves, other assets or port 5173 were changed. All game-module imports remain read-only. The older sections below describe historical implementations; this section takes precedence for the default v4 viewer.

### V4 commands

```powershell
# Additive v4 bake/export only; uses the existing checked-in v2/v3 manifest and assets:
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b --factory-startup -P src/builder/tools/blender/hangar/build.py -- --v4 --bake --out public/assets/models/builder/hangar
# Reuse an existing 5280 server; start this only if 5280 is not already serving:
npx.cmd vite --port 5280 --strictPort --config src/builder/tools/blender/hangar/vite.config.mjs --configLoader native
node src/builder/tests/hangar-models.test.mjs
node src/builder/tests/models.test.mjs
node src/builder/tests/builder.test.mjs
npm.cmd run check:static
node src/builder/tools/blender/hangar/inspect.mjs --v4
node src/builder/tools/blender/hangar/camera-check-v4.mjs
node src/builder/tools/blender/hangar/report.mjs --v4
node src/builder/tools/blender/hangar/audit-v4.mjs
```

`--v4` selects `additions_v4.py` and `detail_v4.py`; no original GLB is regenerated. Omitting `--bake` is safe only if the geometry/UV/material inputs have not changed. All new atlases are 512 px, with four-thread CPU Cycles AO/colour and ORM bakes and separate mipmapped CC0 normals. New normal derivatives, averaged-grating tile and bake names have v4 suffixes; existing textures are never overwritten. The previous unflagged/`--v3` build commands below are historical regeneration commands, not a rollback procedure. One Blender job and one inspection browser run sequentially.

The inspection dispatcher selects the new v4 script with `--v4`; without that flag it explicitly opens `?v=3` for historical measurements. V4 uses one Chrome/page sequentially for all three sandbox versions and the real game on 5280, tests actual mouse drags, fly inputs, double-click focus, segment slides, three collar presets, the builder editor and reveal, and repeats twenty shape changes twice to check resident memory. It writes only under this tools directory.

### Wrap geometry and data

New `layout.wrap` is additive; original `placements`, `levels[].halves`, `colliders`, `collar`, `consoles`, bounds and motion contracts remain intact. In Assembly angles **0=+X, 90=-Z, 180=-X, 270=+Z**. `openSector` is `{center:90,width:90,direction:[0,0,-1]}`. The open interval is 45..135 degrees at every level, with no collar panels. Each of the eleven original heights has three new placements:

| Segment | Arc, degrees | World slide axis | Closed / retracted, m | Rotation Y |
|---|---|---|---|---:|
| right | -45..45 | +X | 0 / 4 | 0 |
| left | 135..225 | -X | 0 / 4 | 180 |
| back | 225..315 | +Z | 0 / 4 | 270 |

Each segment uses `wrap_deck_v4` / `wrap_deck_v4_far`; `attach_slide` local +X points outward. `segment_deck` is its main mesh. The seams at 225 and 315 degrees have narrow cover plates: left owns `seam_cover_end`, right owns `seam_cover_start`, back owns neither, avoiding doubled faces. Seam ownership and marker IDs are in `wrap.seams` / `segments[].seamCoverIds`. Fixed decks extend from the **6 m notch** to a square outer boundary at 14 m on their support side. Visible yellow I-beam fascias, radial under-beams, modeled near grating, rails, kick plates, white equipment boxes, orange-red panels, red pipe stubs and under-deck cable trays are baked into the new quarter module. Far copies use opaque averaged grating and broad rails, without thin mid-rails or fine bearing bars.

`wrap.placements` contains 136 placements: 33 sliding decks, 33 fixed rail/support modules, ten six-metre stair flights and sixty rear lattice bays (five columns across X=-12..12 at Z=17, twelve six-metre bays high). Rear tower members use a blue painted finish. Existing side lattice, red standpipes and under-deck lamps remain. The front slot has no new spanning structure. Stairs and tracks belong to the fixed support; production needs interlocks before deck motion. The new inspection launcher `launcher_slot_v4` retains `attach_deck=[0,7,0]`, side/rear supports and an open front sightline to the real ship base. The original mobile launcher remains intact for older versions.

`wrap.colliders` adds four closed-state boxes per segment/level plus five conservative rear-tower envelopes. Sliding boxes carry `dynamic:'wrapSegment'`, `level`, `segment`; apply `center += slideAxis * currentOffset`. Fixed rear envelopes use `level:-1, segment:'back'`. V4 uses the original collider list minus original platform boxes, plus these additions. Original launcher/tower collision envelopes remain conservative. Adjustable inner panels, stairs and console furniture still need production walk surfaces; these boxes are not a multi-floor navigation mesh.

### Pure arc fitting and ship synchronization

Import **`fitCollarArc` and `plateIndices` from `collarArc.mjs`**. This separate module preserves the original `collarFit.mjs` bytes/API. `fitCollarArc(level, segment, layoutEntries, hullSegments, collarCfg)` returns `{plateIndices, plateRadii, retract}`; `segment.arc` is an increasing degree range. Radii correspond to the returned original 48-panel indices, not a newly renumbered arc. Entries/hull use height above ML_TOP; level is absolute world Y. The helper selects twelve 7.5-degree plates per quarter, **36 per level / 396 total**. The open front has none. Notch, 0.25 m clearance and 0.35..6 m radial limits are unchanged.

The full existing hull/measured-radial outline algorithm evaluates each wedge; only selected directions can trigger that segment's oversize retraction. Thus an oversized booster wholly within the empty slot does not retract the back/side segments. An oversized core retracts all three; an oversized rear booster retracts the back. Above the ship's top each segment retracts. The sandbox logs oversize level/segment IDs once per affected fit. Tests include cylinders, waist transitions, twin boosters at 90/270 degrees, excluded-slot oversize, active-arc oversize and above-top handling.

Panel and yellow toe-board meshes remain two instanced draws. Their matrices inherit the segment's signed X/Z offset. Radius damping reaches 99% in about 0.6 seconds; slide motion retains the 1–2 second top-down wave. The custom raycast accounts for shader-deformed panel radii, so orbit focus picks the actual fitted surface. Old `slot_cut__s/m/l` nodes remain in the untouched original assets and are never drawn by v4.

The real ship reuses the unchanged `role1.hangar.ship.js` pipeline documented under v3: catalogue/Assembly, NASA registration and bounded preload, layout, partArt/mountRadial, skinFor and computeShipSpec. It stands at ML_TOP and its measured outline sections drive every arc. All five builder presets and three shape-card selectors remain; console edits update that same Assembly and both ship and collars. Shared geometry ownership/disposal remains the game's implementation. This is local sandbox synchronization, not a write into the human's running game/session.

### Console bank and cameras

`engineering_consoles_v4` replaces only the v4 display template. The four named station roots and twenty `screen_*` nodes/UVs retain their original names. Desk shells have beveled edges, sloped upper panels, metal trim/kick plates and cable ports; separate hardware includes three monitor arms/bezels, keyboard/button banks, phone, mouse, headset, guarded switches, gooseneck lamp, low-emission status tower, chair/casters and overhead truss/display. Three repeated chassis/material meshes are instanced four times; four canvas atlases supply all live mock-up screens/nameplates. Soft blue desk-spill strips are baked colours, with no added lights. The raised tiled island/cable trench is a separate original module in the same console area. Nameplates read WINDOW & WEATHER, SPACECRAFT DESIGN, ENGINE TEST & SIM, LAUNCH DIRECTOR. All plots are illustrative, with real current-ship metrics and the game's weather fields; no launch event or poll is dispatched.

Console transforms, interact points and orientations are unchanged: operators sit on the rocketward side facing away toward the door. Sit/stand controls remain. The 1.5 second reveal now ends at an angular-midpoint target between the real base and tip, looking up through the open slot **with the decks closed**. No automatic hardware motion is triggered by standing up.

- **F**, or Camera → Free fly / orbit: toggle collision-free inspection. **WASD** moves; **Q/E** descends/ascends; hold **right mouse** to look; **Shift** is 4× speed, **Ctrl** is 0.15×; wheel adjusts speed (0.1..80 m/s). Near clip is 0.05 m; logarithmic depth remains on.
- Orbit: left drag, wheel zoom; **double-click a visible surface** to set the pivot, including instanced/deformed collars. Minimum orbit distance is 0.3 m. Ground first-person walking remains separate.
- New presets: Slot view, Wrap overview, Console bank (3 m eye height), four desk close-ups. Original ground/overview/access/collar/ceiling presets remain. Engineering console bank contains each Sit action and Stand up and turn around.

### Calm lighting and performance

The fixed light count, HDRI/environment 0.35, hemisphere 0.32, FogExp2 0.009 and the game's composer chain remain: finite guard, bloom, ACES tone mapping, SMAA HIGH, restrained chromatic aberration, vignette and grain 0.06. V4 exposure is **0.85**; ceiling spots remain 4000 each, rocket spots are **450 / 750** instead of 650 / 1200. Positions, decay, angles and ship-following targets otherwise match v3. Nearby lens rows use strength 1.8, far lenses 0.35. No added console lights, no runtime shadow passes. Clean captures quantify clipped-white area rather than claiming subjective glare is impossible.

Resolution starts at **1.0**. V4's isolated `role1.hangar.render-v4.js` preserves the game's sustained half-second windows, four slow windows, twelve fast windows, step size, backoff and recovery, but uses **1000/55 ms** as the slow threshold (held recovery below 17 ms) to honor this pass's 55 FPS target. It can descend only to **0.8**. V2/v3 controllers are unchanged. Full near detail is kept; far cards are opaque, mipmapped, anisotropy up to 8, with simplified rails and high uniform roughness/no far normal sampling. Quarter decks switch initially at 14 m with 12/16 m hysteresis, removing sub-pixel grating sooner; other structure retains 22 m initial / 19/25 m hysteresis. Preset/distance LOD preserves animated poses and excludes cutaway walls from rebuild decisions. Pure rotation does not change distance selections. All-pass renderer counts include real ship art and post-processing; kit batch counts exclude ship art. Console portfolio captures explicitly use native resolution; measured performance captures use automatic resolution.

<!-- V4_METRICS -->

| New module | Unique triangles | GLB KiB | Colour / ORM / normal px |
|---|---:|---:|---|
| wrap_deck_v4 | 3,172 | 256.3 | 512 / 512 / 512 |
| wrap_deck_v4_far | 360 | 230.5 | 512 / 512 / 512 |
| wrap_track_v4 | 276 | 110.2 | 512 / 512 / 512 |
| rear_tower_v4 | 2,552 | 205.6 | 512 / 512 / 512 |
| rear_tower_v4_far | 432 | 112.2 | 512 / 512 / 512 |
| wrap_stair_v4 | 1,760 | 218.5 | 512 / 512 / 512 |
| launcher_slot_v4 | 864 | 136.0 | 512 / 512 / 512 |
| console_island_v4 | 444 | 103.3 | 512 / 512 / 512 |
| engineering_consoles_v4 | 5,792 | 379.1 | 512 / 512 / 512 |

Whole folder, including every v2/v3 file and external atlases: **15,250,767 bytes (15.25 MB) / 20 MB**. 40 GLBs. New bank: **23,048 drawn triangles / 120,000**, **388,204 GLB bytes / 3 MB**, seven batches (three instanced chassis materials + four canvas atlases). No hero triangle exemptions.

| Reliable, Game look ON, 1440 × 860 | Triangles, all passes | Total calls | Structure / complete kit batches | Scale | 5 s mean FPS | Instantaneous min FPS | p95 ms |
|---|---:|---:|---|---:|---:|---:|---:|
| slot | 251,899 | 184 | 38 / 47 | 0.9 | 58.2 | 23.5 | 24.1 |
| overview | 246,049 | 188 | 31 / 40 | 1.0 | 93.7 | 33.0 | 18.1 |

Measured 2026-11-08T14:16:14.022Z, Chrome 156.0.8078.80, GPU ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11). Device scale 1; renderer starts at 1.0, automatic resolution ON with floor 0.8. Scale is the actual final scale, not a claim that scaled results are native. Minimum means the slowest single RAF interval; background machine work can affect it. Full-detail, complete envelope with real ship/post: **869,197 triangles**, 32 structure batches. Conservative complete-kit (no culling) bound is separately asserted in hangar-models.test.mjs.

Slow 60 m orbit: mean **81.4 FPS**, minimum **23.6 FPS**, p95 **18.1 ms**, **0 re-batches**. Near geometry is modeled grating; far decks use opaque averaged tiles, no fine grating/mid-rails, high roughness and no normal-map sampling.

The requested sustained-average targets pass. Single-frame dips still occur during warmed steady views/orbit, as the minimum column shows; the stronger request that dips occur only during rebuilds is **not fully met**. There were no LOD re-batches in the slow orbit. Initial loading and model/shape rebuilding can also stall. Do not present this run as a guarantee of zero stutter.

| Clean screenshot | White pixels (RGB ≥250) | Largest connected region, px |
|---|---:|---:|
| slot | 0 | 0 |
| overview | 0 | 0 |

Compatibility: actual pointer drags moved the camera in v2, v3 and v4 by v2: 82.51 m; v3: 80.93 m; v4: 81.10 m. Free fly movement/RMB/wheel, double-click focus, three-axis retraction, three real-ship collar presets, console editor sync and the 1.5 s reveal were asserted. Sandbox/page/console errors: **0**; HTTP failures: **0**. Game on 5280: **HANGAR**, 7 advancing frames, 0 errors.

Memory after each identical twenty-shape sequence, returning to Reliable: 449 geometries / 167 textures → 449 geometries / 167 textures. Counts are equal after cache warm-up.

Additional real-input camera trial: normal/Shift/Ctrl travel over 0.5 seconds = 2.01 m / 8.14 m / 0.31 m; Q descends. Pure ground-view rotation: 60.1 FPS mean / 23.6 minimum at scale 0.9, 0 re-batches. See camera-check-v4.json.

Requested checks:
- `hangar-v4-test.log`: PASS.
- `models-v4-test.log`: PASS.
- `builder-v4-test.log`: PASS.
- `static-v4-check.log`: PASS.

Asset tests assert 121 unchanged original-file hashes, complete original manifest values, arc/booster/oversize cases, texture sizes, module nodes, budgets and adaptive-resolution recovery. `refs/changed-v4.json` records the final scoped file inventory and read-only Git/whitespace audit.

Regenerate: `node src/builder/tools/blender/hangar/report.mjs --v4` (or `report-v4.mjs`). Detailed evidence: `refs/inspection-v4.json`, `refs/inspection-v4.log`, `refs/build-v4.log`. Screenshots: `refs/shots/v4-*.png`.

<!-- /V4_METRICS -->

### For Claude — v4 integration

- Review the additive v4 paths; leave saved v2/v3 files intact. No game/core/package/Git changes or server operations on 5173 were performed.
- Adopt `wrap.placements` instead of the old platform-half placements; keep old placement data for compatibility. Render one selected seam owner at each rear corner. Add the fixed rear lattice/tracks and interlock access stairs before retraction.
- Fit each segment with `fitCollarArc`, feed current hull and measured radial sections, and attach its panels to the correct world slide axis. Preserve top-down timing and above-top/oversize retraction. Do not add plates inside the front slot.
- Move `wrap.colliders` with segment offsets; replace conservative ML/tower envelopes with navigable support/walk surfaces before upstairs play. Add explicit panel-edge/stair/console collision handling rather than treating the supplied ground envelopes as exact.
- Use `layout.consoles` unchanged with the v4 template and live canvas textures. Preserve operators facing away from the ship. Use the new slot-facing, base-to-tip angular-midpoint framing as the post-console camera pose; do not auto-retract on standing.
- The launcher front cutaway is inspection art; review its front-open support design before game use. Original launcher GLB/colliders remain intact.
- Reuse the calm rig and fixed light count, 55 FPS resolution budget/floor and distance LOD. Review measured scale and single-frame minima on the human's active machine; rebuilding art and initial shader/model loads can briefly stall.
- Keep the non-sandbox canvas hiding fix only in standalone viewers. Integrate into the game's existing renderer/loop rather than hiding the game canvas there.
- Consolidate existing CC0 attribution into team credits later. Nothing needs deletion to meet the 20 MB limit; old versions remain available.

## Run and rebuild (historical v2/v3)

From the repository root, in PowerShell (Node 26.13.0, Blender 5.2.3 LTS):

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b --factory-startup -P src/builder/tools/blender/hangar/build.py -- --out public/assets/models/builder/hangar
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b --factory-startup -P src/builder/tools/blender/hangar/build.py -- --v3 --bake --out public/assets/models/builder/hangar
npx vite --port 5280 --strictPort --config src/builder/tools/blender/hangar/vite.config.mjs --configLoader native
```

The first Blender command rebuilds the original **26 GLBs**; the second appends the five v3 modules and manifest keys (**31 GLBs total**). For v3-only iteration, run only the second command. No installation required. The generator disables Python bytecode writes before importing the existing `common.py`; it uses `common.G`, materials and Draco export. Export in a batch, with nobody inspecting a half-written GLB. The Vite config isolates its dependency cache from port 5173.

Open **http://localhost:5280/sandbox/role1.hangar.html**. Add `?blockout=1` for grey-box massing. The page has a placeholder rocket, three collar sizes, top-down retraction, elevator stops, crew-arm extension, crane trolley/hook and door controls; ground, overview and access-level cameras; first-person ground walking; LOD, wireframe and collider overlays. The cutaway switch hides front cladding and door for inspection. Turn it off to see the complete envelope.

```powershell
node src/builder/tests/hangar-models.test.mjs
node src/builder/tests/models.test.mjs
node src/builder/tests/builder.test.mjs
npm run check:static
node src/builder/tools/blender/hangar/inspect.mjs
```

The last command uses **one** Chrome process and one page, sequentially. It captures original geometry, tests S/M/L against 8/36/60 m ships, checks moving nodes and ground collision, measures complete-hall budgets, then opens the actual game's HANGAR on 5280. It writes `refs/inspection.json`, sequential JPEG captures under `refs/shots`, and original-render comparison sheets. It does not start/stop any server. `refs/models-test.log`, `builder-test.log`, and `static-check.log` hold the requested existing-check results.

## Coordinate and motion contract

- Metres, game +Y up, origin on the floor at the rocket axis. Inside bounds X/Z −22…22, Y 0…80. Front door faces −Z; rear wall +Z. Ship base at **ML_TOP = 7 m**; its height excludes this deck offset.
- Eleven numeric levels **01…11**, ascending from Y **11,17,23,29,35,41,47,53,59,65,71**. They are gameplay levels, not NASA's lettered levels. Real HB3 uses A,B,C,D,E,F,G,H,J,K; see [research](refs/NOTES.md).
- Tower bays are 6 × 6 × 6 m; blocks centred X ±17, assembled along Z −6,0,+6 up to 72 m. Platform root is at [0,levelY,0]. The +X half uses Y rotation 0, the −X half uses Y rotation 180 degrees, never a negative scale. `attach_slide` local +X points outward for each half.
- Closed local X offset is **0 for all sizes**. Pick **exactly one** of `slot_cut__s`, `slot_cut__m`, `slot_cut__l`: nominal radii 0.9375,1.25,1.6875 m plus 0.25 m inner-edge clearance. Circular arcs use 32 segments; tiny chord approximation is expected. Retraction is **+4 m local X**, i.e. ±4 m in world X; at least 3 m additional clearance. Keep levels above the ship and beside side boosters retracted. The sandbox automatically handles height; production booster checks belong to Claude.
- The half-deck tapers from 12 m wide at the tower to 5 m near the collar, exposing more of the ship from the entrance while retaining the close-fitting collar. Fixed catwalks remain in the towers. Retraction may overlap the racks as intended.
- Elevator root [-17,0,-11], `pose_cab` translated in Y. Stops: ground 0, then every platform elevation. Cab footprint 2.4 × 2.4 m, height 2.6 m. Door faces +Z; short landing bridges connect to fixed tower decks. Decorative zigzag stairs and return landings rise from the ground through level 01 and continue beside the shaft.
- Crew arm root at platform elevation, normally X −8, Z 0, facing +X. `attach_root` is local [0,0,0]; `attach_tip` is [2,0,0] under `extend`, whose rest X is 4. Rest reach 6 m. Move `extend.position.x` from 4 to 6 for 0…2 m extra reach; the 4 m sleeve retains overlap, so no floor gap opens. To reach the left face of a radius-r rocket from X −8, extension is **2 − r**. The white room travels intact, without scaling handrails. Pick nearest level to the **absolute world Y** hatch height. The difference between hatch height and the discrete level must be handled by production integration; do not move the player's camera into solid cabin art.
- Crane root Y 75, bridge along X. `pose_trolley.position.x` −17…17; `pose_hook.position.y` negative downward. The viewer draws two simple ropes and changes their length to the hook. No load rating or physics is asserted.
- `pose_door` moves +Y in the viewer as a staging demonstration. The seven panels form a separate node. A production telescoping door should keep its panels inside the roof envelope rather than lifting the full 70 m door intact above it.
- `attach_deck` on the mobile launcher is [0,7,0]. No launcher tower. Reserved ground console area X −10…10, Z −20…−12 hosts the v3 bank; floor guide strips can cross it. Entry [0,1.7,−20]. Optional `console_desk.glb` is supplied but **not placed**.

## Layout schema and instancing

`layout.json` is versioned data:

```json
{
  "version": 1,
  "units": "metres",
  "up": "+Y",
  "ML_TOP": 7,
  "modules": {
    "tower_bay": {"file":"kit/tower_bay.glb", "triangles":1200, "bytes":5700, "bounds":{"min":[-3.3,0,-3.3],"max":[3.3,6,3.3]}}
  },
  "placements": [{"id":"tower_bay_0","module":"tower_bay","position":[-17,0,-6],"rotation":[0,0,0],"scale":[1,1,1],"lod":"tower_bay_lod"}]
}
```

The numeric `bytes` and bounds in this example are illustrative; read each actual manifest entry. Rotations are **degrees**, XYZ Euler order. Additional top-level data: `radii`, `hallBounds`, `consoleArea`, `playerEntry`, `levels`, `elevator`, `crewArm`, `colliders`. A placement may have `dynamic`, `level` and `side`. Every placement has a unique ID. `levels[].halves` contains the relevant placement IDs.

`sandbox/role1.hangar.js` loads with GLTFLoader + DRACOLoader, decoder path `/assets/draco/`, and one decode worker. It caches materials by name and groups all placements by **module + mesh node** into InstancedMesh batches. Thus ordinary kit modules are one draw call per mesh/material each; independently moving or optional hero nodes use their own batches. Geometry is shared, never cloned per placement. Closed meshes use back-face culling, avoiding the substantial cost of two-sided steel. World transforms must include the GLTF scene root transform. Do not merge away `pose_`, `attach_` or `slot_` hierarchy.

For height-based LOD, use a placement's `lod` file when its base Y > 30. Tower, wall and roof LODs are respectively 20%, approximately 13%, and approximately 14% of the full triangle count. Platform variants are filtered before batching. Do not draw all collar variants on top of each other. The viewer freezes static instance matrices after assembly; only independently moving modules update each frame. Disable helper overlays when measuring rendering cost.

All GLB geometry has baked transforms, triangulated faces, consistent outward normals, `m_<node>` mesh names, module-specific baked PBR materials (see v2 notes below), and Draco compression. Lamp geometry uses an emissive material, **no glTF lights**. External bake atlases and original CC0 texture sources accompany the portable embedded-texture GLBs; no reference photographs are included. No dependency additions.

## Colliders and integration limits

`colliders[]` entries have `kind`, `center:[x,y,z]`, `size:[x,y,z]`. Dynamic platform boxes also have `level` and `side`; add the current signed slide offset to center X. Door boxes add the animated Y offset. Collider helper render colours distinguish decorative stair envelopes.

Floor, wall, ML, tower, landing and platform boxes are supplied. Platform tapers are approximated by four AABBs per half. These boxes deliberately omit the tiny curved collar infill; use deck geometry or radial tests if walking around that edge. Tower volumes and stairs are **conservative envelopes**, suitable for the ground demo; they are not a navigable multi-storey collision mesh. The sandbox walk is a ground-plane, axis-separated 0.30 m-radius collision check (eye Y 1.7), not a replacement for the game's controller. Do not use the solid tower envelopes to block players riding upstairs: replace with structural post colliders, walk surfaces and stair ramps when integrating.

## Calm steel, adaptive collars and four consoles — v3

This pass is additive. The original 26 GLBs, placement IDs, transforms, levels, colliders and motion nodes are unchanged. Commit `2db32c9` / tag `hangar-v2-backup` is Claude's backup; Codex did not restore, tag, commit or run any modifying Git command. **Append `?v=2` to the sandbox URL for the exact previous sandbox implementation**, fixed 0.60 scale, old lighting, fixed S/M/L collars and cylinder. The entry point now selects `role1.hangar.v2.js` or `role1.hangar.v3.js`.

### Build and inspect v3

```powershell
# Additions only; does NOT rebuild or overwrite any original GLB:
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b --factory-startup -P src/builder/tools/blender/hangar/build.py -- --v3 --bake --out public/assets/models/builder/hangar
npx.cmd vite --port 5280 --strictPort --config src/builder/tools/blender/hangar/vite.config.mjs --configLoader native
node src/builder/tests/hangar-models.test.mjs
node src/builder/tools/blender/hangar/memory-v3.mjs
node src/builder/tools/blender/hangar/inspect.mjs
node src/builder/tools/blender/hangar/report.mjs
```

The unflagged generator retains its v2 behavior; if rebuilding the original kit from scratch, run the v3 command afterward to append its manifest keys/modules. `--v3` reads the existing manifest and adds five modules plus `collar` and `consoles` keys. New atlases use the existing four-thread Cycles pipeline. The console chassis is baked once and shared by the four named roots. Console screens intentionally have plain UV 0–1 and no baked colour texture, allowing live canvas replacement.

### Glare, clarity and automatic resolution

Render scale starts at **1.0**, exposure **0.90**. The controller in `role1.hangar.render.js` copies the game's 0.5 s timing windows: four windows over 20 ms step down by 0.1; twelve windows below 13 ms step up; held frames below 18 ms can retry after 30 s. An unsuccessful upward retry within 15 s doubles the delay, capped at eight minutes. This sandbox limits descent to two steps (**0.8 minimum**). It does not start at a reduced scale. The scale and automatic controller can be inspected/controlled in the GUI; every view's actual scale is recorded with its FPS.

Far selection starts at 22 m, with 19/25 m hysteresis thereafter. It re-evaluates after camera presets and during travel/orbit (at most every 750 ms after 4 m movement), rebuilding only when a visible placement crosses a threshold. Moving slide offsets and elevator cab height survive re-batching. New `platform_v3_far` and `catwalk_far` use an **opaque averaged grating atlas**, broad rail/toe bars, and no fine bearing bars or mid-rails. Near copies keep modeled open grating, so no alpha test or alpha-to-coverage is needed. At 40–80 m the repeated hole patterns are absent. Far materials use high uniform roughness, reduced metalness/environment response, and remove normal/ORM sampling. All image maps use mipmaps and anisotropy min(8, renderer maximum); near normals are mipmapped rather than sharpening at distance. The same bloom, ACES tone mapping, SMAA, finite guard, grain 0.06, vignette and chromatic aberration chain remains.

Only lamp rows within 20 m have emissive strength 1.8; other lenses use 0.35, below the bloom threshold. Lamps remain instanced and add no real lights. Four actual SpotLights remain fixed in count. Ceiling light intensity is 4000 each; rocket light intensities are 650 and 1200. Rocket spot targets/heights follow the current ship's top, rather than lighting empty space above a short ship. Hemisphere/fog/HDRI settings remain as v2. This avoids broad clipped-white regions while retaining a few visible lamp highlights. `inspect.mjs` measures both total clipped-white pixels and the largest connected region, with GUI/header overlays hidden. Slow-orbit poses and a continuous orbit timing capture are included.

### Collar data and pure API

`layout.collar`: notch radius **6 m**, **48 plates**, **7.5 degrees** per plate, clearance **0.25 m**, radial slide limits **0.35–6 m**, ML_TOP **7**; module IDs `collar_plate`, `platform_v3`, `platform_v3_far`. The notch gives ample space around the catalogue's maximum nominal core radius (1.6875 m) and the tested booster/fins envelopes. Oversized external art is still explicitly rejected per level rather than silently clipped; future catalogue additions need no unsafe assumption that they always fit.

`fitCollar(level, layoutEntries, hullSegments, collarCfg)` is pure JS with no DOM/three.js. `level` is world Y (number or `{y}`); entries/segments are metres above ML_TOP. It returns `{plateRadii, retract}`; radius indices start at -90 degrees plus half a pitch, increasing in Assembly's convention (0=+X, 90=-Z). The core uses linear hull segment radii supplemented by measured exposed-art sections; this accounts for model skirts/fairings extending beyond their nominal attachment height. For radials, the sandbox provides triangle/plane segments through the actual mounted art, sampled over the deck/toe-board thickness. The helper clips each segment against the full wedge, checking both angular boundaries and in-wedge endpoints. Without measured sections, it falls back to the supplied dimensions' oriented box. Inside equipment is excluded. Above-ship/over-wide levels retract and return fully-out radii. One informational message per retracted level is logged.

The panel shader deforms a shared unit wedge into a telescoping plate between its fitted inner radius and the fixed notch rim. Its separate yellow edge/toe board moves with it. Both meshes are instanced (two draws for all 528 panels); the panel matrices inherit each half's existing signed slide offset. Damping reaches 99% of a new target in about 0.6 s. The two halves still retract +4 m in local X. Original `slot_cut__s/m/l` meshes remain untouched in the v2 GLBs and are hidden in v3. Existing platform collider boxes remain unchanged and do **not** describe the enlarged visual notch/panels; game integration must supply proper walk surfaces/interlocks.

### Same real ship as the design studio

`role1.hangar.ship.js` reads, without editing: `catalogData.js` → `createCatalog` / `Assembly` → `registerNasaModels` → bounded sequential `preloadNasaParts` → `assembly.layout()` → `partArt`, axial Y placement / `mountRadial` → `skinFor(layout)` and its `insideIds`/`coveredIds`. This matches the studio's closed-vehicle view. The vehicle stands at ML_TOP. `computeShipSpec` supplies the actual displayed mass, cost, TWR and delta-v; no guessed numbers replace them.

All five existing presets and the actual nose/body/tail card shapes are available. The builder console's HTML editor forwards to the very same GUI/controllers and Assembly; its canvas wireframe/statistics and the big ship refit together. Unmatched preset/card combinations show "Current custom layout" instead of falsely claiming a shape is selected. Shapes are local to this sandbox: no game save is written, no external 5173 session is modified or synchronized across origins. The cylinder remains available via the fallback toggle, including when imports fail.

Replacement art uses the game's `disposeObject`; loaded geometry keeps its `sharedGeometry` ownership flag. Memory verification switches twenty shapes, returns to the same preset, then repeats the identical twenty-shape sequence. This separates first-use cached model residency from unbounded growth; see `refs/memory-v3.json`. No new dependencies or game-file edits are needed.

### Four consoles and the reveal

`engineering_consoles.glb` contains `station_window`, `station_builder`, `station_testfire`, `station_launch`, each with three desk screen nodes, one overhead screen and one nameplate screen. Every screen has plain UVs. One chassis geometry/material is instanced four times; each station combines its five screens into one geometry with its own 1024px canvas atlas. **Five calls total for the bank** (one chassis plus four screen atlases), two calls attributable to each workstation. The GLB triangle count is unique stored geometry; `instancedTriangles` records all four visible stations, also checked against 80k.

The four GLB roots are neutral-origin station templates, not a pre-positioned duplicate bank; the loader applies the manifest transforms below. Positions are on a 4 m radius semicircular bank centered at [0,0,-13.6], angles -67.5/-22.5/+22.5/+67.5 degrees. Each desk's local +Z faces its operator; operators are on the rocketward side, facing outward/doorward. Chassis, chairs, supports and interact points fit inside the reserved X/Z region. `layout.consoles` supplies rotations, named screens, interactPoint, lookTarget and turnaroundView. Entry and original colliders are preserved; new console meshes are a visual/demo bank, not game collision/navigation code.

Buttons in the Engineering console bank folder sit at each station. The builder workstation opens shape controls. Stand up and turn around interpolates the eye-height position and quaternion over 1.5 s, stepping back toward the rocket then tilting up. Orbit controls yield during this animation. Its target height follows half the current ship height above ML_TOP, so short ships are framed as well as tall ones. The reveal screenshots use Apollo and explicitly retract the platforms first via the existing sandbox control; standing up alone does not trigger hardware motion. The screen plots/radar/test traces are **illustrative**, not live telemetry, real weather radar or an ephemeris. Weather values use the game's existing weather fields; transfer timing labels are approximately 26 months / 259 days. Test mock-ups follow the stand's hold/ignition/release concepts; launch HOLD/GO controls do not trigger a game event.

### For Claude — v3 integration

- Review only the authorized paths; no game scene, core file, package file or Git state was changed. Port 5173 was untouched.
- Import the pure collar helper; provide the current layout/hull and, for exact radial fitting, the measured outline sections generated by the art bridge. Reuse existing slide/crew/elevator handling.
- Integrate the four console transforms/screens and same Assembly/art pipeline into the single game loop. Keep canvas textures/material ownership separate from cached model geometry.
- Add navigation, walk surfaces and mechanical interlocks for the new notch/panels and desks. Original conservative collider records were preserved by instruction.
- Reuse the sandbox distance/hysteresis policy, or integrate it with the game LOD manager. Keep moving-node poses across re-batching; invisible front cladding must not trigger rebuilds.
- Keep the 0.8 auto-resolution floor and per-view measured scale visible during performance review. Do not describe scaled results as native-resolution results.
- Consolidate attribution into the team's CREDITS.md when committing; exact provenance stays in `refs/LICENSES.md`. All new screen art and hardware geometry are original.

## Steel detail pass v2 (historical baseline, 2026-11-08)

The human explicitly authorized staying on the shared `role1-builder` branch without fetch/switch/pull. Git remains Claude's responsibility. Only this kit, its source tools/tests and the standalone sandbox were edited. Original renders and the complete v1 layout contract are retained in `refs/before/` and `refs/contract-v1.json`.

### Rebuild and bake

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' -b --factory-startup -P src/builder/tools/blender/hangar/build.py -- --bake --out public/assets/models/builder/hangar
npx.cmd vite --port 5280 --strictPort --config src/builder/tools/blender/hangar/vite.config.mjs --configLoader native
node src/builder/tests/hangar-models.test.mjs
node src/builder/tools/blender/hangar/inspect.mjs
node src/builder/tools/blender/hangar/report.mjs
```

Use `--bake` after **any geometry, UV, colour or material change**. Omitting it reuses existing atlas JPGs for quick re-export; it is safe only when geometry/UVs/materials are identical. Missing atlases always bake. For a deliberate partial bake use `--only platform_half_lod,roof_truss_lod`; untouched manifest entries are retained. Full rebuilds remain the reproducibility reference. The source JPEGs and their Poly Haven download metadata are included under `textures/`, so rebuilding needs no network or package installation. One Blender process uses Cycles CPU, four threads, eight samples, sixteen AO samples, 0.75 m AO distance. Two emission bakes per mesh produce colour with real ray-traced AO and grime, and linear R=AO/G=roughness/B=metalness. No photographic reference is sampled. UV `Atlas` packs faces; UV `Detail` keeps metre-based tiling for normal maps. JPEG normal maps are reduced to 512 square. AO darkens base colour and also feeds glTF occlusion; the duplicate contact contribution is intentional for this dark rig.

### Geometry, materials and LOD

W-section beams have continuous webs/flanges and chamfered flange tips. Tower bays use paired L-angle braces, gusset/bolt groups, stiffeners and column base plates. Platforms and catwalks have real open grating, toe boards and regularly spaced rails. Deep fan ribs and curved ring girders under the platforms create the vault; the collar and its small closing plates remain inside the approved clearance. Stairs have channel stringers and open treads. A separate original caged ladder is placed at the far tower edge. Standpipes are octagonal tubes. The crew arm gains channels and diagonal braces without changing sleeve travel or tip placement.

The sandbox selects tower/wall/roof/platform LOD above 30 m. Access camera presets rebuild batches with full detail within 9 vertical metres of the camera when it is inside the hall (Z > -23); the distant overview keeps the height scheme. Free orbit keeps that selection until another preset or the LOD toggle is used. Each LOD is checked against the full module at 10-25% of its visible triangles. Full geometry remains available via the LOD toggle. A far-side/distance LOD selector is left to Claude's player-camera integration; this viewer uses height plus the access-camera band. Existing placement IDs, transforms, level records and colliders are checked against v1; new ladder placements are appended.

Materials are named `hangar_v2_<module>_<node>`; their atlases are unique to that geometry and must **not** be collapsed into one material by name. Repeated placements share the same material and geometry. Baked metallic values: painted white/yellow/red 0.28, structural/bare steel and grating 0.60, concrete 0. Roughness varies 0.48-0.80. Shared CC0 Blue Metal Plate supplies scratches and normal detail, tinted by our grey/white/yellow/red vertex palette before baking; Hangar Concrete Floor supplies the floor wear. Actual bolts and plate edges supply the silhouette, while the normal map supplies surface detail (there is no high-poly bolt-normal transfer). This is restrained wear, not a severe rust treatment. Lamp lenses alone use `hangar_lamp` with emission strength 8 and cold-white colour; housings remain opaque painted steel. The rocket is a sandbox-only white/orange witness with longitudinal lines and thin stage seams.

### Lighting rig for Claude

The sandbox copies the current `src/graphics/index.js` pipeline: half-float composer, finite-value guard, identical bloom (threshold 1.35, smoothing 0.30, intensity 0.70, mipmap blur, radius 0.72), ACES_FILMIC ToneMappingEffect, SMAA HIGH, chromatic aberration (0.00055,0.00045), vignette (0.36,0.50), overlay grain 0.06. Renderer: NoToneMapping, sRGB output, logarithmic depth, no native MSAA, pixel ratio capped at 1, then multiplied by the adjustable render scale (default 0.60, matching the game approach of reducing resolution to preserve frame rate). At a 1440 x 860 viewport, this renders 864 x 516 internally. Game look is enabled by default; flat comparison bypasses the composer. Exposure starts at 1.15 and can be adjusted. HDRI is the existing Small Hangar 01, converted via PMREM, environment intensity **0.35**, matching designScene. Background/fog colour #111719, FogExp2 density 0.009. Fog is distance based, not a true height-volume simulation.

Hemisphere: sky #cbd9dc, ground #484335, intensity 0.32. Four fixed SpotLights, colour #e7f0ff, distance 110 m, penumbra 0.65, decay 2; positions/targets are world metres, intensity in three.js candela:

| Position | Target | Intensity | Angle (rad) |
|---|---|---:|---:|
| -12,73,-8 | -10,0,0 | 12500 | 0.48 |
| 12,73,8 | 10,0,0 | 12500 | 0.48 |
| -6,18,-12 | 0,26,0 | 3600 | 0.50 |
| 6,54,-8 | 0,42,0 | 6500 | 0.50 |

The last two isolate the rocket. No lights cast runtime shadows: baked module AO provides contact depth while keeping structure rendering to one scene pass. There is one extra DirectionalLight held at zero intensity in Game look, used at 2.3 in flat mode; the hemisphere rises to 1.5 there and spots become zero. Toggle intensities rather than adding/removing lights to keep the shader light count fixed. There are no glTF light objects. Each lamp instance is an emissive fixture, not another actual light.

The performance button records five seconds of actual RAF intervals: average FPS, minimum instantaneous FPS and p95 frame time. Diagnostic overlays are not counted as structure; renderer totals include all post-processing passes. Headless browser/GPU identity is recorded in `refs/inspection.json`, and must be checked before treating results as hardware performance guarantees.

### Remaining integration work for Claude

- Copy the material-aware instancing and rig into the game's own scene and render loop. Do not import this standalone renderer/loop.
- Keep module-specific atlas material names; cache normal maps by source if desired. Embedded normal maps repeat across GLBs to keep each GLB portable; external bake atlases remain for reproducibility and count toward the total budget.
- Add far-side/player-distance LOD when integrating. Keep the existing walking/collision caveats below. New ladder geometry is decorative and adds no collider or locomotion.
- Consolidate attribution into the team's CREDITS.md when committing; it is outside this task's allowed paths. Exact sources and licences are in `refs/LICENSES.md`.
- Atlas colour contains AO and surface wear; the normal is a shared surface tile, not a baked high-poly bolt atlas. Rail sections remain square HSS, intentionally without individual bevels or bolt heads.

## For Claude

1. Review and commit only the new allowed paths. Only read-only Git inspection was used; no Git mutation was performed. The game hangar remains its existing implementation.
2. Integrate loading/instancing and light setup into the existing renderer and single game loop. Do not import the sandbox's standalone renderer or animation loop into `src/`.
3. Move the rocket base to ML_TOP and extend the hangar camera/clipping/fog and walking boundary for the 44 × 44 × 80 m envelope. Map the four new console node templates to the existing game interaction APIs, inside the reserved rectangle with operators facing doorward (-Z). Node IDs are not new contract station/event IDs. Use only existing game event/state/station names.
4. Synchronize platform closure with the actual ship radius, local shape and boosters; prevent closing on a person. Add appropriate access gates/interlocks and safe walking surfaces. Preserve collision and camera continuity during elevator movement; replace decorative stair envelopes with walkable ramps if the stairs should be usable.
5. Map the chosen capsule hatch to the closest level, handle the remaining vertical gap, align the crew arm and add the walk-in transition and sound. The kit does not introduce a new ShipSpec field or claim that `stats.cabin` is available.
6. Implement production crane/door mechanics, collision updates, environmental audio and disposal lifecycle. The door's simple whole-node lift is intentionally only a preview.
7. Reference photos stay outside the repo. `refs/LICENSES.md` documents provenance. Comparison PNGs contain only our own blockout/detail renders.

## Evidence and budgets

The model test parses GLB JSON rather than trusting a triangle count printed by Blender. It checks Draco, required nodes, names, size, material limits, the ML datum, all placement references, levels, and worst-visible whole-hall counts (largest collar choice per half, complete hall, no frustum-culling deduction). See the generated table below and `refs/inspection.json` for measured runtime values and browser/viewport. Headless FPS on this machine is a local benchmark, not a prediction for the final game with its other systems.

<!-- GENERATED_METRICS -->

| File | GLB triangles, all variants | KiB | Atlas / normal px |
|---|---:|---:|---|
| kit/tower_bay.glb | 2,552 | 720.6 | 1024 / 512 |
| kit/tower_bay_lod.glb | 432 | 115.5 | 512 |
| kit/wall_bay.glb | 372 | 139.5 | 512 |
| kit/wall_bay_lod.glb | 48 | 59.5 | 512 |
| kit/roof_truss.glb | 792 | 182.2 | 512 |
| kit/roof_truss_lod.glb | 84 | 77.9 | 512 |
| kit/stair_run.glb | 1,112 | 214.5 | 512 |
| kit/catwalk.glb | 1,104 | 169.7 | 512 |
| kit/caged_ladder.glb | 1,252 | 189.0 | 512 |
| kit/standpipe.glb | 104 | 43.0 | 512 |
| kit/cable_tray.glb | 300 | 101.2 | 512 |
| kit/lamp.glb | 144 | 3.7 | none |
| kit/floor_tile.glb | 36 | 76.6 | 512 |
| kit/girder.glb | 60 | 59.0 | 512 |
| kit/crate.glb | 36 | 71.4 | 512 |
| kit/cart.glb | 144 | 111.4 | 512 |
| kit/scissor_lift.glb | 264 | 128.6 | 512 |
| kit/safety_stripe.glb | 72 | 55.0 | 512 |
| platform_half.glb | 10,408 | 1125.8 | 1024 / 512 |
| platform_half_lod.glb | 2,364 | 437.7 | 512 |
| mobile_launcher.glb | 1,488 | 166.5 | 512 |
| elevator.glb | 2,160 | 253.6 | 512 |
| crew_arm.glb | 636 | 246.3 | 512 |
| crane_bridge.glb | 1,008 | 263.4 | 512 |
| high_bay_door.glb | 924 | 157.5 | 512 |
| console_desk.glb | 96 | 75.1 | 512 |
| platform_v3.glb | 3,408 | 232.0 | 512 |
| platform_v3_far.glb | 720 | 221.3 | 512 |
| kit/catwalk_far.glb | 96 | 81.7 | 512 |
| kit/collar_plate.glb | 24 | 107.8 | 512 |
| engineering_consoles.glb | 3,268 | 249.6 | 512 |
 
31 GLBs, 864 placements. GLBs: **6,283,788 bytes**. Entire directory with external bake atlases and layout: **11,939,272 bytes (11.94 MB)** / 20 MB. Every GLB below 60,000 triangles; no hero exemption.

| Game look ON, real Reliable ship, distance LOD | Triangles (all passes) | Total calls | Kit batches incl. collar/bank | Scale | 5 s avg FPS | Instantaneous min FPS | p95 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| ground-look-up | 216,093 | 174 | 41 | 1 | 55.2 | 20.7 | 24.2 |
| overview | 196,153 | 180 | 32 | 1 | 95.8 | 27.5 | 12.3 |
 
| Complete envelope | Triangles (all passes) | Total calls | Structure batches | FPS sample |
|---|---:|---:|---:|---:|
| Full detail | 679,902 | 265 | 27 | 38.0 |
| Height LOD | 262,434 | 274 | 36 | 71.0 |
 
Measured 2026-11-08T12:32:40.292Z, Chrome 156.0.8078.80, viewport 1440 × 860, device scale 1, initial pixel ratio **1**, with automatic resolution enabled (floor 0.8). GPU: ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11). Renderer totals include fullscreen post-processing and the actual ship. Kit batches exclude ship art and include both collar meshes and the console bank. Minimum is the slowest individual RAF interval, not a rolling one-second average.

| Same-cylinder lighting comparison | Scale | Average FPS | Minimum FPS | Clipped white pixels | Largest clipped region, px |
|---|---:|---:|---:|---:|---:|
| Before ground | 0.6 | 76.6 | 27.4 | 587 | 77 |
| After ground | 1 | 56.0 | 18.3 | 0 | 0 |
| Before overview | 0.6 | 128.1 | 23.6 | 17 | 16 |
| After overview | 1 | 95.3 | 27.5 | 0 | 0 |
 
Clipping threshold: all RGB channels >=250/255 in clean native viewport screenshots. This measures bright areas, not a subjective glare score. Comparison PNGs use only our own renders. Brief frame-time dips remain visible in minimum/p95 metrics; sustained average performance is the requested target.

Memory after two identical 20-shape sequences, returning to Reliable: 384 geometries / 112 textures → 384 geometries / 112 textures. Browser errors during memory trial: 0.
Console bank: 12,952 drawn triangles / 80,000, 255,584 GLB bytes / 2,000,000. Five bank draws total. Stored mesh triangles are lower because all four chassis nodes share one geometry.

- hangar-test.log: PASS.
- models-test.log: PASS.
- builder-test.log: PASS.
- static-check.log: PASS.
- Sandbox console/page errors: 0. HTTP failures: 0.
- Game HANGAR smoke test on 5280: HANGAR, 7 advancing frames, 0 browser errors.
- Nine height/radius combinations, independent moving nodes and ground ML collision are asserted in inspect.mjs. Static tests compare original layout data, placement IDs/transforms, colliders, dimensions, Draco, budgets and LOD ratios.

Screenshots (PNG): refs/shots/{before-glare-ground,after-glare-ground,before-glare-overview,after-glare-overview,after-ground-real,after-overview-real,collar-reliable,collar-apollo,collar-workhorse,console-bank,station_window,station_builder,station_testfire,station_launch,turnaround-mid,turnaround-reveal,far-orbit-40,far-orbit-60,far-orbit-80}. Comparison sheets: refs/compare-glare-ground.png and refs/compare-glare-overview.png. Historical v2 evidence remains under refs/v2 and refs/before.

Regenerate: node src/builder/tools/blender/hangar/report.mjs
