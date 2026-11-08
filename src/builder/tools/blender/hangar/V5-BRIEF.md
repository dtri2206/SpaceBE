# Hangar v5: common brief for the part agents

Game: SpaceB&E (Vite, three.js r187, vanilla JS). This is Role 1's rocket hangar, modelled on NASA's VAB High Bay 3.
The human (Role 1, Vietnamese speaker) decided the v5 design below on 2026-11-08. Claude (the lead) orchestrates.
Four part agents (decks, access, stage, launcher) work **at the same time in the same folder**. Reviewers check afterwards.

Starting point: Codex's v4 (commit `87c79e4`, tag `hangar-v4-codex`). Read `README.md` in this folder (the v4 section first)
and `additions_v4.py` (Codex's v4 Blender modules, the worked example to copy). The human disliked four things in v4:
1. The open slot faced the front door, so the view from the consoles was frontal.
2. The inner edge of each deck was 36 radial plates per level and looked like fan spokes.
3. Only 10 stair flights, all in the back-right corner, invisible from the consoles. No walkways with railings leading to the ship. Railings were thin and few.
4. Two big grey blocks (the launcher's front cut-out) stood in front of the ship's base in the money shot.

## 1. The human's design (decided, do not change)

1. **Decks wrap 3/4 (270°) round the ship at every level. The open quarter is the FRONT-LEFT quadrant (x < 0, z < 0).**
   - The open quarter is an empty vertical shaft from floor to roof.
   - Two straight, perpendicular deck edges (the "slot faces") meet at the ship.
   - The view into it is **diagonal**, as in the reference `C:/Users/Thainguyen/Downloads/vab_work_platforms_with_sls.webp`: the viewer stands at a front corner, looks diagonally at the rocket, and the decks wrap the other three sides.
   - Also see `C:/Users/Thainguyen/Downloads/VAB-Platforms-side-section-photo-1500x1000.jpg` (NASA cutaway).
   - Reference photos are for looking only: never copy their pixels.
2. **The inner edge of each deck is one smooth continuous curve hugging the hull at that height:**
   - a yellow fascia ring and a toe board;
   - curved notches round boosters;
   - it follows the ship whenever the ship changes.
3. **Three sliding segments per level, each retracting its own way (same 1–2 s top-down wave as v4):**

   | Segment | Covers | Slides toward |
   |---|---|---|
   | `fr` (front-right) | x > 0, z < 0 | +X, the right tower |
   | `br` (back-right) | x > 0, z > 0 | +Z, the rear lattice |
   | `bl` (back-left) | x < 0, z > 0 | −X, the left tower |

   Sound and smoke come later in the game, not now.
4. **A curved bank of 4 consoles on the ground, on the diagonal inside the open quarter:**
   - Operators sit with their backs to the ship, facing the hall's front-left corner.
   - "Stand up and turn around" leaves the eye about 1.7 m above the ground, looking up diagonally into the open quarter: the whole ship from base to tip, framed by the stacked decks on both sides and behind it.
   - The human's words: far enough to see the whole ship, but close enough that it feels enormous next to tiny humans; grand, seen from below.
   - We test **15, 18 and 22 m** and the human picks from screenshots.
5. **The elevator moves** from the front-left corner to the front-right corner (mirror image).
6. **Details the human asked for (all of them):**
   - stairs between levels and walkways with railings leading to the ship, visible from the consoles;
   - the crew access arm and white room at the hatch level, running along the left slot face, visible from the consoles;
   - double handrails and toe boards on every edge;
   - deep yellow I-beams on the two slot faces;
   - under-deck beams, lamps and cable trays, because the player looks up at the undersides;
   - NASA equipment: white boxes, orange-red electrical panels, red standpipes, blue columns, concentric yellow rings round the ship;
   - a beautiful, solid mobile launcher seen from the diagonal, without front cut-out blocks.
7. **Seated at a desk, the player sees a real, dark hall wall in front:** nothing distracting.

## 2. Coordinates (contract, unchanged from v4)

**Hall and fixed structure**
- Metres, +Y up, origin on the floor at the rocket axis.
- Hall X/Z −22…22, Y 0…80. Door at −Z (front), rear wall at +Z.
- Ship base at **ML_TOP = 7**.
- Levels 01…11 at Y = 11, 17, 23, 29, 35, 41, 47, 53, 59, 65, 71; level index 0…10.
- Side tower blocks: x ±14…±20, z −9…+9, built from 6 m bays, up to 72 m.
- Rear lattice (Codex's `rear_tower_v4`) at z ≈ 17, x −12…12.
- Elevator now at (−17, 0, −11); it moves to (17, 0, −11).

**Angles and the open quarter.** Angles follow Codex's convention (`collarArc.mjs`, `layout.wrap`): **0° = +X, 90° = −Z, 180° = −X, 270° = +Z**.
- v5 arcs: `fr` [0, 90], open [90, 180] (centre 135°, direction (−0.7071, 0, −0.7071)), `bl` [180, 270], `br` [270, 360].

**Seams and slot faces**
- Seams:
  - `fr|br` along the +X axis (z = 0, x > r);
  - `br|bl` along the +Z axis (x = 0, z > r).
- The two **slot faces** (the showcase edges) are:
  - `fr`'s edge along the −Z axis (x = 0, z < 0);
  - `bl`'s edge along the −X axis (z = 0, x < 0).
- Deck outer boundary: the square |x|, |z| ≤ 14, as in v4. The inner part ends at a notch of radius 6 m, as in v4. The smooth collar band fills from the hull out to 6 m.

**Authoring a deck module.** Author it in the `fr` quadrant: x ∈ [0, 14], z ∈ [−14, 0].
- three.js Y rotation in degrees: `fr` = 0, `br` = 270 (that is −90), `bl` = 180.
- Local edge A runs along the local +X axis (z = 0); local edge B along the local −Z axis (x = 0).
- Edge roles:

  | Segment | Edge A | Edge B |
  |---|---|---|
  | `fr` | seam with `br` | slot face |
  | `br` | seam with `bl` | seam with `fr` |
  | `bl` | slot face | seam with `br` |

  A seam gets a cover plate on one side only, never two.

**Roll-out corridor and console positions**
- Roll-out corridor: the launcher (about ±8 m) leaves through the door along −Z. Keep |x| ≤ 9 for z < −8 free of fixed structure, at every height.
- Things on retracting segments may be there, because they slide away.
- The console bank should preferably keep out of it too (soft rule).
- Turnaround eye point for a bank distance d: (−d/√2, 1.7, −d/√2). For 18 m that is (−12.73, 1.7, −12.73).

## 3. The v5 scene and your plug-in

**URLs**
- The default sandbox `http://localhost:5280/sandbox/role1.hangar.html` is **v5** (`sandbox/role1.hangar.v5.js`, built from Codex's v4).
- `?v=4` (Codex), `?v=3` and `?v=2` must keep working. Never edit their files.

**`role1.hangar.v5.js` belongs to the lead: do not edit it.** If you really need a hook, describe it in your final report. Everything you need comes through `ctx`:
- `THREE`, `scene`, `assets` (Map of module id → loaded glTF scene), `layout` (layout.json), `fragments` (all four), `segments` (id → def), `fragment` (yours);
- `camera`, `controls`, `renderer`, `gui`, `cameraGui`, `params`, `actions` (camera and other actions; reassign or add keys, and add GUI buttons with `ctx.cameraGui.add(ctx.actions, key)`), `look(pos, target, fov)`, `slotTarget(pos)`;
- `rig` (the 4 spot lights), `hall` (Group);
- `collars`, `ship()` (current real-ship data: `top`, `entries`, `hull`), `getShipController()`, `builderFolder`;
- `platforms()` (the sliding deck holders), `roots()`, `rebuild()` (rebuild instancing), `setPlatformMode('retract' | 'close')`.

**Fragments** live in `public/assets/models/builder/hangar/v5/<part>.json`, one per part. Keys:
- `modules` — the same schema as `layout.json`: `file` relative to `/assets/models/builder/hangar/`, e.g. `"v5/deck_quad_v5.glb"`.
- `placements` — the same schema as `layout.placements`:
  - `id` (unique; prefix it with your part), `module`, `position`, `rotation` (degrees, XYZ), `scale`, optional `lod` (module id of the far copy);
  - sliding parts: `dynamic: "wrapSegment"`, `level` (0…10), `segment` (`fr` | `br` | `bl`), `axis` (world slide axis) and `retracted` (metres).
  - Anything that must slide with a segment uses the same `level`, `segment`, `axis` and `retracted` values.
- `hidePlacements` (placement ids) and `hideModules` (module ids): base placements to drop.
- `colliders`: `{kind, center, size, decorative?, dynamic?, level?, segment?}`.
- `hideColliders`: `[{kind?, region: {min, max}}]` hides base colliders whose centre lies in the region.
- `dropV4WrapColliders` (decks only), `segments` (decks only), `openSector` (decks only), `launcherModule` (launcher only).
- Anything else you need, for example `consoles` for stage.

**Instancing rules.** Each placement is grouped into InstancedMesh batches by module and mesh node.
- Mesh nodes named `opt_*` are drawn only if listed in `showNodes` on the placement or on its segment definition.
- `seam_cover_*` nodes are drawn only if listed in the segment's `seamCoverIds`.
- `slot_cut__*` nodes are never drawn.
- The scene keeps distance LOD: decks switch at 14 m, other placements at 22 m, with hysteresis.

**The real ship** comes from the builder code: presets Reliable, Apollo, Workhorse and others in the GUI. Its outline (`ctx.ship().hull`, `.entries`) drives the collars.

## 4. Blender

```
node src/builder/tools/blender/hangar/v5lock.mjs blender -- "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P src/builder/tools/blender/hangar/build.py -- --v5 <part> [--bake] --out public/assets/models/builder/hangar/v5
```

**What build.py gives your script.** It imports `v5_<part>.py` and calls `build(api)`, where `api` is `build.py`'s globals:
- `Geo()` with `solid`, `box`, `beam`, `ibeam`, `profile`, `angle`, `channel`, `pipe`, `gusset`, `grating`, `rail`, `mesh(name, root)`;
- `start(name)`, `marker(root, name, pos)`;
- `save(name, root, kit=False)`:
  - writes `<out>/<name>.glb` (or `<out>/kit/<name>.glb`);
  - bakes AO, colour and ORM with `detail_v4.finish` when `--bake` is passed;
  - asserts ≤ 60k triangles and ≤ 4 MB;
  - records `api['catalog'][name]`.
- colours `STEEL`, `WHITE`, `DARK`, `DECK`, `YELLOW`, `RED`;
- the v1 builders `tower()`, `wall()`, `truss()`, `stair()`, `catwalk()`, `platform()`.

Copy the style of `additions_v4.py`.

**Rules for your script**
- It writes **its own fragment JSON**: modules from `api['catalog']` with `v5/`-prefixed file paths, plus placements and the rest. Never write `layout.json`.
- Prefix every module name with your part (`deck_`, `access_`, `bank_`, `launcher_`) so baked texture names never collide.
- GLBs embed their textures. If the bake also leaves external atlas copies under `public/assets/models/builder/hangar/v5/textures/`, delete **your own** copies after export to save space. They are reproducible. Check that the GLB still loads with its textures.

## 5. Heavy jobs: always through the lock

- Run every Blender process and every headless Chrome through `node src/builder/tools/blender/hangar/v5lock.mjs <blender|browser> -- <command…>`. That allows one Blender and one browser across all agents: the machine has 14 GB of RAM and about 3.5 GB free. Release quickly. Run long bakes in the background.
- A Vite server is already serving on **5280**. Do not start or stop servers. Never touch port 5173: it is the human's. If 5280 is down, say so in your report.
- Playwright: `import {chromium} from 'playwright-core'` (resolved from the repo root), `chromium.launch({channel:'chrome', headless:true, args:['--enable-gpu','--ignore-gpu-blocklist']})`, viewport 1440 × 860.
  - Wait for `window.hangarInspect?.ready`.
  - Use `window.hangarInspect`: `actions`, `look`, `params`, `settle()`, `stats()`, `realShip.preset(name)`, `shipData`, `fragments`, `access`.
  - Examples: Codex's `inspect-v4.mjs` and `camera-check-v4.mjs`.
- Screenshots: JPEG quality about 85, at `src/builder/tools/blender/hangar/refs/shots/v5-<part>-<name>.jpg`. Look at them yourself with the Read tool and judge them honestly against the reference.

## 6. Safety rules (non-negotiable)

- **Git:** the folder is shared with the other agents and the human. Use only read-only git: `status`, `diff`, `log`, `show`. Never run `add`, `commit`, `checkout`, `switch`, `stash`, `reset`, `restore`, `clean`, `merge`, `pull`, `push`, `tag`, `branch` or `worktree`. The lead commits.
- **Files you may write:** only those listed in your prompt. Everything else is read-only, including:
  - the other agents' files, `role1.hangar.v5.js`, `layout.json`, `build.py`, `detail_v4.py`, `collarFit.mjs` and `collarArc.mjs`;
  - every v2, v3 and v4 file and GLB;
  - all game code;
  - `package.json` and `package-lock.json`.
- No `npm install` and no new dependencies. Never delete or overwrite a file you did not create in this task.
- **Budgets:**

  | What | Limit |
  |---|---|
  | Whole `public/assets/models/builder/hangar/` | ≤ 20 MB (now 15.3 MB) |
  | New files in `public` from your part | ≤ 1.2 MB |
  | Triangles in the worst view | ≤ 1,000,000 |
  | FPS, turnaround or slot view (1440 × 860, game look on, real ship, auto resolution floor 0.8) | ≥ 55 |
  | FPS, overview | ≥ 60 |

- **Keep the calm v3/v4 look:**
  - no glare and no clipped white;
  - far copies without shimmer: opaque averaged grating far away, no sub-pixel rails;
  - the fixed 4-spot light rig; no new real lights (use emissive lenses).
- **Licences:** your own geometry; CC0 textures already in `textures/` here. If you add a CC0 source, tell the lead in your report: `refs/LICENSES.md` is shared.

## 7. Final report (your last message)

Keep it short:
- files created or changed;
- what you built;
- numbers: triangles, bytes, FPS at the views you measured;
- screenshot paths;
- hooks you need from the lead;
- known gaps.

Be honest about anything that does not yet look right.
