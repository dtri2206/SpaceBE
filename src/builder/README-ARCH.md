# Role 1: Rocket Builder — architecture

Everything Role 1 owns lives in `src/builder/`. The contract (`src/core/contract.js`) wins over this file for every name and shape.

## States and files

| State | Screen | File |
|---|---|---|
| `MENU` | main menu, content warning, settings | `menu.js`, `settings.js` |
| `HANGAR` | the engineering bay (first person) and the vehicle design page | `hangarScreen.js`, `hangarScene.js`, `designPage.js`, `designScene.js`, `bay/*` |
| `GONOGO` | animated Go/No-Go poll, confirm / override / back | `gonogoView.js` (+ wiring in `index.js`) |

`index.js` is the module core exports (`default { init, enter, update, exit }`). It keeps the current **Assembly**, recomputes the **ShipSpec** after every change, saves a draft through `save`, and is the only file that calls `economy`, `setShip`, `requestState` and emits events.

Pure logic (Node-testable, no browser or core imports; everything is passed in):

| File | What |
|---|---|
| `assembly.js` | the rocket as a tree of parts with attachment nodes; attach/remove/replace/undo/redo/symmetry; material and internal options per part (`setMaterial`, `setOption`, `options`); layout (metres); serialize; share code. `createCatalog(parts, internals)` adds `kit(def)`, `defaults(def)`, `optionsOf(def, options)` |
| `stats.js` | `computeShipSpec(assembly, deps)` → `{ spec, breakdown, blocks }` per `SHIP_SPEC_SHAPE`, with materials, internal options (`optionMods`) and solid motors folded in; `engineStats(def, engines, g0, mods)`; `partFigures(def, ctx)` for one part on a card |
| `gonogo.js` | `evaluate(spec, ctx)` → hard blocks, warnings and the console lines in flight-controller words (no numbers, no fixes; text from `data/text.json`), weather calls (lightning, ground wind), HOLD |
| `hull.js` | the seamless outer skin: `computeHull(layout, { hull })` → skirts, interstages, cones, payload fairings and an automatic equipment bay, with mass, cost, drag (`cdAFactor`), heat on the climb (1976 standard atmosphere, cork on hot flares), buckling margin at max-Q (crewed factor 1.4), wear per flight, `insideIds` (equipment carried inside), `risk`, `limits`; `hullChoices`, `hullMaterial`, `hullHasSkin`, `placeInside` (used by `assembly.layout()`). Data: `data/hull.json` |
| `weather.js` | launch-day weather at the chosen complex: `weatherFor(launch, { pad, launchData })` → forecast, actual (a cheap weather watch can be wrong), wind, lightning, HOLD fee; deterministic per complex, day and seed |
| `sections/pad/effects.js` | what the pad does: `padEffects(launch, { pad, weather, thrustSL, g, wetMass })` → fees, reliability, heat limit, held-back liftoff (Δv lost), debris damage chance, repairs, hold-down catch, lightning risk; `padSetup`, `heatLimitOf`, `kitFee`, `complexOf` |
| `asBuilt.js` | FIFA-style luck at confirm: `buildAsFlown(result, ctx)` → the flown ShipSpec (factory spread ±0.5–3 % by quality, rare defects from each part's reliability, pad debris, skin wrinkles or overheating, the real temperature), defects, notes, seed; refurbishment and wear for a reflown ship; `investigate` for the board |
| `traits/` | what each chosen part does in flight, on Mars and in the cruise (wave 5): `flightTraits(layout, ctx)` → `ShipSpec.stats.traits { propulsion, structure, life, landing }` from the real numbers in `traits/*.json` (each with sources and EN/VI `notes` templates); read by `src/flight/effects/` (FlightController hooks), the surface (oxygen, rovers), the cruise and the hangar's flight analysis. Every field optional: a missing trait means "as before" |
| `flightAnalysis.js` | the flight analysis the hangar opens after every flight: per section and part, what it did (the flight's record in `save.partEffects`, rendered through the groups' note templates), its wear and one comparison with a choice not made; EN/VI |
| `everyday.js` | numbers in everyday words, English and Vietnamese (mass as cars, thrust as weight lifted, failures as "1 in N flights") |
| `explain.js`, `i18n.js` | plain-language explanations (`explainFor(key)`, files `sections/<id>/explain.json`, `data/explain-*.json`) and the EN / VI switch (`tr`, `setLang`, saved as `builderLang`) |
| `sections.js` | the four vehicle sections (nose, body, tail, launch pad): `mergeSectionData(families, files)` folds each `sections/<id>/` folder into the catalogue; `createSections(files)`; `applyShape` (build one section as a real rocket's, keeping the rest, inserting adapters where diameters change and matching the engines' fuel to the tanks), `addThroughRow`, `clearSection`, `currentShape`, `rowCandidates`, `sectionParts`, `padState` |
| `catalogData.js` | imports `data/families.json` and the four section folders and exports the merged `partsJson`, `internalsJson`, `sections` |
| `tests/builder.test.mjs` | `node src/builder/tests/builder.test.mjs`: schema checks, text coverage, preset stats, every section (rows reachable, shapes alone and on top of a preset, any build order, clusters, clear, pad fees, save round-trip) |
| `tests/{hull,card,luck,pad,models}.test.mjs` | the skin (every nose × body, body × tail and nose × tail shape pair; `HULL_FULL=1` tries all combinations), the explanation card, luck and the board, the pad, and the Blender models (joint radius, height, triangles, file size, slot names, per-section budget) |

Data (JSON only, so balancing never conflicts with code): `data/families.json` (the 16 families and their text), the parts and internals kits in the section folders below (each part with `role`, `detail`, `pros`, `cons`, `real` (the real-world reference), `materialFamily`, optional `internals` kit id, optional `booster` for solid motors, optional `model` (a NASA model slug, or `{ builder, lod, vac, proud }` for Role 1's Blender models), optional `hullProfile` / `hullSide` (the shape the outer skin goes round), optional `defaultMaterial`, optional `mounts` for a thrust structure, `flags` such as `reliabilityBonus`, `bonusGroup`, `rigidity`, `chuteCdA`, `avionics`, `gimbal`, `steering`, `engineOut`; kit options change `massF`, `massD`, `costF`, `costD`, `rel`, `isp`, `thrustF`, `powerF`, `chuteF`), `data/materials.json` (five families: structure, engine chamber, equipment housing, pressure vessel, motor case), `data/engines.json` (fuels, nozzles, pumps and `references`: real engines as templates), `data/launch.json`, `data/text.json`, `data/presets/*.json` (Reliable, Workhorse, Cold Morning, Thin Skin), `data/handbook.json`, `data/bayAssets.json`, `data/icons.json` (which card pictures are baked).

Sections (`sections/<nose|body|tail|pad>/`, one folder per card of the design page, so one person or agent can work on each): `section.json` (the card's rows in order: shape first, then components, then the deep internals; each row names the families or part ids it offers; `shapes` are real rockets' versions of that section, a `stack` of part ids or `{ type, options, material }` plus `radial` parts; the pad folder has `sites` and `equipment` instead), `parts.json` (extra parts, merged into the catalogue with `section` set), `internals.json` (extra kits), `art.js` (optional `partArt(def, ctx)` and `internalsArt(def, options, ctx)`, asked before the NASA models and the shared procedural meshes; the pad's `padArt(state, { radius, height, layout })`), `NOTES.md` (sources) and `ASSETS.md` (where the art comes from).

Views with fixed interfaces (so three people can work at once): `formulaLens.js`, `gonogoView.js`, `workbench.js`, `settings.js`, `menu.js`, `builder.css`.

## Assembly JSON

```json
{
  "name": "Reliable",
  "symmetry": 1,
  "launch": { "slot": "mild" },
  "parts": [
    { "id": "p1", "type": "capsule_m", "parent": null, "node": null, "angle": 0, "yFrac": 0.5, "variant": null, "group": null },
    { "id": "p2", "type": "heat_shield_m", "parent": "p1", "node": "bottom", "angle": 0, "yFrac": 0.5, "variant": null, "group": null },
    { "id": "p3", "type": "tank_l_methalox", "parent": "p2", "node": "bottom", "angle": 0, "yFrac": 0.5, "variant": null, "group": null },
    { "id": "p4", "type": "engine_m", "parent": "p3", "node": "bottom", "angle": 0, "yFrac": 0.5, "variant": null, "group": null,
      "engine": { "fuel": "methalox", "nozzle": "vac", "pump": "M" } },
    { "id": "p5", "type": "legs_m", "parent": "p3", "node": "radial", "angle": 0, "yFrac": 0.1, "variant": null, "group": null },
    { "id": "p6", "type": "fin_m", "parent": "p3", "node": "radial", "angle": 0, "yFrac": 0.15, "variant": null, "group": "g1" },
    { "id": "p7", "type": "fin_m", "parent": "p3", "node": "radial", "angle": 180, "yFrac": 0.15, "variant": null, "group": "g1" }
  ]
}
```

- Exactly one part has `parent: null` (the root; normally the capsule). Every other part names its `parent` and the parent's `node` it hangs on: `top` (above the parent), `bottom` (below) or `radial` (clamped to the side).
- `angle` is degrees around the rocket axis for radial parts. `yFrac` (0..1) is where along the parent's height a radial part sits (0 = parent base). `group` ties symmetry copies together (remove one, all go).
- `engine` exists only on engine parts: `fuel` from `FUELS`, `nozzle` from `NOZZLES`, `pump` from `PUMPS` (contract.js). The part's size letter must equal the pump (`engine_m` ⇄ `M`).
- `material` (an option id of the part's `materialFamily` in `data/materials.json`) and `options` (`{ slotKey: optionId }` from the part's kit in `data/internals.json`) are optional; missing values mean the first option. `replace` clears both.
- Only axial parts (`attach: "axial"` in the catalog) take `top`/`bottom` children; a `top`/`bottom` node holds at most one child. Radial parts take no children.
- `launch` is `{ slot, site, pad: { equipmentKey: optionId } }`: `slot` from `data/launch.json` (`cold` = 2 °C, the Challenger setup), `site` and the pad equipment from `sections/pad/section.json`. Missing values mean the first (neutral) choice.
- `hull` is `{ nose?, body?, tail? }`: the skin material of each section (an id from `data/hull.json`); missing means the first.
- `launch` also carries `day` (HOLD), `seed` (the launch campaign) and `repairDue` (pad repairs owed); `site` is the launch complex.
- `origin` (optional) is the section a part came from when a shape put it there (`nose`, `body`, `tail`), so building that section again replaces only its own parts. Shapes and presets set it on radial parts such as fins.

## Layout (metres, from `assembly.layout(catalog)`)

Root base at y = 0; `top` children stack upward, `bottom` children downward, then everything shifts so the lowest base is 0. Each entry: `{ id, type, def, attach, parentId, node, angle, y (base), height, radius, centerY, x, z }`, plus `above` / `below` (the axial neighbours' types, so art can draw one joint instead of two) and `cluster` (`{ count, layout, scale }` for an engine hanging under a thrust structure with `mounts`). A strap-on booster's mass and side area sit 0.25 H above its base, the middle of the drawn booster. Radial parts: `x = r·cos(angle)`, `z = −r·sin(angle)`, `r` = parent radius (1.25 m × size scale 0.75 / 1 / 1.35, the same as Role 3's art). These x, y, z, and `rotation = angle`, go straight into `ShipSpec.parts`.

## ShipSpec (what `computeShipSpec` returns as `spec`)

Exactly `SHIP_SPEC_SHAPE` in contract.js, plus three extras Role 2's `FlightController` reads when present: `stats.ascentCdA` (nose cone), `stats.cdA` (entry, with the shield) and `stats.heatShieldDamaged`. Wave 5 adds `stats.traits` (see `traits/`), the flat `stats.minThrottle` / `stats.ignitions`, and `stats.cabin` (the crew cabin the player chose and how it is fitted, for Role 3's interior). `stats.cost` is the ship alone; the launch fees (slot + site + pad equipment, `breakdown.launchFee`) are charged separately at confirm and counted for `OVER_BUDGET`.

Derivations: dry mass = parts + engines (pump + chamber + nozzle); fuel mass = tanks whose fuel matches the engine fuel (other tanks are dead weight); `thrust` is vacuum thrust (sum of pumps); `ispSL`/`ispVac` thrust-weighted; `deltaV = ispVac · g0 · ln(wet/dry)`; `twrEarth` uses sea-level thrust `thrust · ispSL/ispVac`; `twrMars` uses vacuum thrust and wet mass; `comOffset`/`copOffset` are metres from the geometric centre of the stack (positive = towards the nose), CoP from side areas; `reliability` = product of parts (an engine cluster counts `r^n`, or `r^(1+0.2(n−1))` with an engine-out structure), times `1 + ` the "good engineering" bonus (at most 6 %; parts sharing `flags.bonusGroup` count once, the best), times `1 + ` the pad equipment's reliability; an engine cluster multiplies its engine's thrust, mass and cost and repeats it in `spec.engines`; `coldRatedSeals` = no `cheapSeals` part; `heatShieldDamaged` = a `fragileShield` part (ceramic tiles).

`breakdown` (for the Formula Lens): `{ parts: [{ id, type, name, family, mass, fuel, y, height, sideArea }], fuelPartIds, enginePartIds, finPartIds, capsulePartIds, comY, copY, stackHeight, steering, stabilityMargin, launchFee, padReliability, engineCount, boosterSpecs, site, dvNeeded: { ascent, transfer, landing, return } }`.

Warnings (contract `WARNINGS`): `LOW_DV` Δv < ascent + transfer + landing; `LOW_TWR` TWR Earth < 1.2; `NO_HEAT_SHIELD`; `NO_LEGS`; `UNSTABLE` CoP ahead of CoM (with active steering, a gimbal, verniers or jet vanes, the CoP may sit up to `STEERING_MARGIN` = 6 % of the stack height ahead, as on finless rockets); `LOW_O2` no spare O₂ tank; `NO_ANTENNA`; `NO_SHELTER`; `COLD_SEALS` cheap seals and tempC < 5; `LOW_RELIABILITY` < 0.8. Hard blocks (`HARD_BLOCKS`): `NO_CAPSULE`, `NO_ENGINE`, `NO_FUEL` (no usable fuel), `NOT_CONNECTED`, `OVER_BUDGET` (cost + fee > money).

## Flow

HANGAR: build → **GO / NO-GO POLL** → GONOGO: lines reveal → no blocks: **CONFIRM & LAUNCH** (or **OVERRIDE** when there are warnings) → `economy.spend(cost + fee)`, `setShip(spec)`, `ship:built`, `requestState('PRELAUNCH')`. **BACK** → HANGAR. Money is spent only at confirm, never on entering a state (the boot check depends on that).

`?debug=1&state=GONOGO` works with no ship built: the draft or the Reliable preset is used.

## Events

Emits: `ship:built`, `guidebook:open`, `builder:highlightPart` (the Formula Lens and the Flight Report both make parts glow through this one event), `ending:show` + `requestState('ENDING')` with `bankrupt` when funds fall below `balance.insolvencyFloor` and the player declares it.
Listens: `builder:highlightPart`, `economy:changed`, `flight:failed` and `ending:show` (the flight record, the investigation board, keeping a ship that came home).
Registers with Role 3's `assets`: `rocketPart:` art, `builder:rocketSkin`, `builder:launchPad` (`flightArt.js`).

## Save keys (through core `save`)

Also `builder.luck` (build serial, flight records, the kept ship and its wear) and `builderLang` ('en' | 'vi').

`builder: { draft: Assembly, blueprints: [Assembly], slot }`. Settings written by `settings.js`: `sensitivity`, `invertY`, `quality`, `volume`, `skipSensitive`, `warningSeen` (other roles may read `sensitivity` and `invertY`).

## The engineering bay (HANGAR)

The hangar is a round integration hall the engineer walks through in first person (`src/builder/bay/`):

| File | What |
|---|---|
| `bay/room.js` | the hall: floor, platform with railing and stairs, walls with ribs and the blue band, catwalk, trusses, lights, hangar door, pipes; the hold-down stand and service tower (`createStand`) |
| `bay/stations.js` | the machines, one per job (`STATIONS`): launch-control desks (three monitors, keyboard, lit nameplate, equipment cabinet) for integration, propulsion, structures, crew systems, warehouse, test stand, range, and the handbook desk; the centre monitor is a canvas screen (`setScreen`) |
| `bay/player.js` | first-person controller: WASD, Shift run, Space jump (gravity from `PLANETS.earth.g`), mouse look through core `input`, collisions with stations and `room.obstacles`, a human body (CesiumMan, walk animation, clipped at the neck by a clipping plane) with a tablet (`setTablet`) |
| `bay/screen.js` | the big curved wall screen: a render-to-texture camera feed of the stand (refreshed only when the vehicle changes) and a telemetry board |
| `bay/teststand.js` | static fire + hold-down liftoff test with Role 3's engine VFX and sounds |
| `bay/partArt.js` | 3D art for a part: Role 1's Blender model when it has one (`model.builder`, its vacuum-bell copy for a `vac` nozzle, only the chosen inner looks shown, then the section's `wrapModel` adds what the model cannot know, such as a fairing's see-through skirt) → the section's own art (`sections/<id>/art.js`) → real NASA hardware (`bay/nasa.js`, every part with a `model`, Draco-compressed GLBs in `public/assets/nasa/`, downloaded per part on demand with `requestPartArt`) → detailed procedural hardware (`bay/partMeshes.js`: tanks, nose cones, heat shields, fins, modules, interstage and centerbody sections, truss, guidance ring, payload adapter, spin table, kick motor, strap-on solid, spheres, wiring tunnel, solar wing, RTG, chutes, inflatable shield, airbags, instruments) , thrust structures, adapters) → Role 3's `rocketPart:` meshes (legs). An engine under a thrust structure is drawn once per mount (a cluster of more than 9 uses the engine's low-detail copy) |
| `partIcons.js` | card pictures: a baked PNG from `public/assets/icons/` when `data/icons.json` lists it (`node src/builder/tools/bake-icons.mjs` makes them), else rendered once in the browser (`iconFor(def)`, `objectIcon(key, build)`) |
| `tools/` | `bake-icons.mjs` (card pictures), `shrink-textures.mjs` (Poly Haven prop textures to 512 px), `blender/` (the Blender 5.2 scripts that build Role 1's models, one folder per section, shared `common.py`; the rules every model follows are in `tools/blender/README.md`) |
| `designPage.js` | the vehicle design page: a top bar (name, cost, funds, Δv, TWR, reliability; UNDO, CLEAR ALL, MORE ▾, TEST FIRE, READINESS POLL →), the 3D studio in the middle (`designScene.js`, shown through `graphics.setView` while the page is open, no labels) and a dock on the right with four cards: **Nose**, **Body**, **Tail**, **Launch pad**. Opening a card lists its rows top to bottom: 1 shape (real rockets' versions of that section), 2 components (installed parts with + Add), 3 the deep internals; a breadcrumb walks back. Items open in place with their story, numbers and one INSTALL / USE THIS / CHOOSE button. Views: home, shapes, add, part, slot, sites, slots, equipment. CLEAR ALL empties the stand so the player can start from any card. The Formula Lens is behind "Show the formulas". The vehicle turns by HTML5 drag, the slider, Q/E or on its own; the wheel zooms; clicking picks a part, a piece of its inside or the pad |
| `designScene.js` | the studio: lights, the pad art under the vehicle (`setPad`), the vehicle from `partArt`, orbit camera (`fit`, `frame`, `focusOn`, `focusSection`, `zoomBy`, `rotateBy`, `setViewCentre` so the vehicle stays centred beside the dock), the open section at full strength and the others faded (`setActiveSection`), selection glow (`highlightPiece`), exploded internals from `bay/internalsArt.js`, `pick(x, y)` by raycast (pad, part or internal piece); `update(dt)` clamps the step so a stalled tab cannot throw the camera away |
| `bay/internalsArt.js` | `internalsArt(def, options, { radius, height })` → the pieces inside a part for each slot of its kit, with the direction each slides out in |
| `bay/nasa.js` | `NASA_PARTS` (which model each part uses, cut by node name, normalised to stand on y = 0 at the catalogue height), Role 1's Blender models (`registerNasaModels`: `model.builder`, `#lod`, `#vac`; used as built, never rescaled; shared geometry marked so a disposed copy keeps it), `applyChoices(object, options)` (per slot, `slot_<key>__<option>` when fitted, else the plain `slot_<key>`; glTF extras `hides`), `modelSlotPiece` (a modelled inner piece for the card), `loadGroundModel(slug)` (pad hardware) and `nasaProp(slug, cfg, height)` for the hardware standing in the hall |
| `bay/loader.js` | Poly Haven assets listed in `data/bayAssets.json` (HDRI, PBR sets, glTF props) with procedural fallbacks |
| `hangarScene.js` | puts it together: `createHangarScene({ renderer })` → scene, camera, player, stations, wall, test, `setLayout`, `worldAnchors`, `nearestStation`, `placeAtStation` |
| `hangarScreen.js` | the HUD (crosshair, prompt, chip, toasts) and the station panels: the design page for the design desks (propulsion opens the Tail card, structures the Body, crew systems the Nose, the launch-window desk the Launch pad), test console, range terminal, handbook (`handbook.js`, notes saved as `builderNotes`), dialogs (rename, MORE: preset vehicles, blueprints, share code, redo; clear all) |
| `partCard.js` | the big explanation card in the middle of the screen: what it does and why, how it works inside (a turning 3D view pulled apart, read back asynchronously through a render target), the numbers in everyday words; EN / VI; opened by clicking a part, piece, shape, complex, equipment or skin |
| `designPad.js` | the Launch pad card: row 1 a real launch complex, row 2 its eight kinds of equipment, then plain launch-day facts |
| `investigation.js` | the investigation board after a failed flight (English / Vietnamese): what broke, as built against on paper, the real need, one question |
| `flightArt.js` | Role 1's art for the flight scenes (agreed by all four roles): `rocketPart:` models through `assets.setRocketPartArt`, `builder:rocketSkin` and `builder:launchPad` through `assets.register`; `flightArtGate.js` keeps the builder's own scenes on Role 3's built-in parts |
| `autoplace.js` | `autoAttach`: puts a part where a technician would (`insertAbove` for tanks above the engine); the tests use it, the design page adds through `sections.addThroughRow` |

Flow: walk up to a machine → `E` opens its panel (pointer unlocks, the player stands still) → `Esc` closes it (first one step back inside the open card, then the page). `H` opens the handbook anywhere. The readiness poll (GONOGO) is shown from the test conductor's console in the same hall. With `?debug=1`, `window.__game.builder.placeAt(id)` / `openStation(id)` / `startTest()` / `requestArt(ids)` drive it from the console; `window.__game.builder.scene3d` is the design studio; `/?debug=1&state=HANGAR&station=integration` opens a desk straight away.

Assets: `public/assets/models/builder/<nose|body|tail|pad>/` (Role 1's own Blender models, Draco GLB, about 12 MB at most per section), `public/assets/polyhaven/` (CC0, 53 MB), `public/assets/nasa/` (public domain, 45 MB), `public/assets/people/` (CC BY), see `CREDITS.md`; `data/bayAssets.json` is the manifest the loader trusts, and `nasaProp` resolves to null for a missing file, so neither produces a console error.

## Rules the checks enforce

`npm run check:static` rejects: unknown event/state names, imports into other roles' folders, `requestAnimationFrame` outside core, keyboard/mouse/pointer listeners outside `core/input.js`, `localStorage` outside `core/save.js`, the literals `9.81`, `3.71`, `9.80665` outside `core/planets.js`. `npm run check:boot` walks the loop in Chrome and needs a `[data-stub]` element in HANGAR and GONOGO (our roots carry `data-stub` and `data-screen`), no console errors, and the failure penalty computed from the Reliable mock (so never call `setShip` outside confirm).
