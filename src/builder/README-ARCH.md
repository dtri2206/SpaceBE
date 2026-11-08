# Role 1: Rocket Builder — architecture

Everything Role 1 owns lives in `src/builder/`. The contract (`src/core/contract.js`) wins over this file for every name and shape.

## States and files

| State | Screen | File |
|---|---|---|
| `MENU` | main menu, content warning, settings | `menu.js`, `settings.js` |
| `HANGAR` | the engineering bay (first person) and the vehicle design page | `hangarScreen.js`, `hangarScene.js`, `designPage.js`, `bay/*` |
| `GONOGO` | animated Go/No-Go poll, confirm / override / back | `gonogoView.js` (+ wiring in `index.js`) |

`index.js` is the module core exports (`default { init, enter, update, exit }`). It keeps the current **Assembly**, recomputes the **ShipSpec** after every change, saves a draft through `save`, and is the only file that calls `economy`, `setShip`, `requestState` and emits events.

Pure logic (Node-testable, no browser or core imports; everything is passed in):

| File | What |
|---|---|
| `assembly.js` | the rocket as a tree of parts with attachment nodes; attach/remove/undo/redo/symmetry; layout (metres); serialize; share code |
| `stats.js` | `computeShipSpec(assembly, deps)` → `{ spec, breakdown }` per `SHIP_SPEC_SHAPE`; `engineStats(def, engines, g0)` |
| `gonogo.js` | `evaluate(spec, ctx)` → hard blocks, warnings and the console lines (text from `data/text.json`) |
| `tests/builder.test.mjs` | `node src/builder/tests/builder.test.mjs`: schema checks, text coverage, preset stats |

Data (JSON only, so balancing never conflicts with code): `data/parts.json` (parts with `role`, `pros`, `cons`, `materialFamily`), `data/materials.json` (material options per family with mass/cost factors and a reliability delta), `data/engines.json`, `data/launch.json`, `data/text.json`, `data/presets/*.json`, `data/handbook.json`, `data/bayAssets.json`.

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
- Only axial parts (`attach: "axial"` in the catalog) take `top`/`bottom` children; a `top`/`bottom` node holds at most one child. Radial parts take no children.
- `launch.slot` is an id from `data/launch.json` (`cold` = 2 °C, the Challenger setup).

## Layout (metres, from `assembly.layout(catalog)`)

Root base at y = 0; `top` children stack upward, `bottom` children downward, then everything shifts so the lowest base is 0. Each entry: `{ id, type, def, attach, parentId, node, angle, y (base), height, radius, centerY, x, z }`. Radial parts: `x = r·cos(angle)`, `z = −r·sin(angle)`, `r` = parent radius (1.25 m × size scale 0.75 / 1 / 1.35, the same as Role 3's art). These x, y, z, and `rotation = angle`, go straight into `ShipSpec.parts`.

## ShipSpec (what `computeShipSpec` returns as `spec`)

Exactly `SHIP_SPEC_SHAPE` in contract.js, plus three extras Role 2's `FlightController` reads when present: `stats.ascentCdA` (nose cone), `stats.cdA` (entry, with the shield) and `stats.heatShieldDamaged`. `stats.cost` is the ship alone; the launch-slot fee is charged separately at confirm and counted for `OVER_BUDGET`.

Derivations: dry mass = parts + engines (pump + chamber + nozzle); fuel mass = tanks whose fuel matches the engine fuel (other tanks are dead weight); `thrust` is vacuum thrust (sum of pumps); `ispSL`/`ispVac` thrust-weighted; `deltaV = ispVac · g0 · ln(wet/dry)`; `twrEarth` uses sea-level thrust `thrust · ispSL/ispVac`; `twrMars` uses vacuum thrust and wet mass; `comOffset`/`copOffset` are metres from the geometric centre of the stack (positive = towards the nose), CoP from side areas; `reliability` = product of parts; `coldRatedSeals` = no `cheapSeals` part; `heatShieldDamaged` = a `fragileShield` part (ceramic tiles).

`breakdown` (for the Formula Lens): `{ parts: [{ id, type, name, family, mass, fuel, y, height, sideArea }], fuelPartIds, enginePartIds, finPartIds, capsulePartIds, comY, copY, stackHeight, dvNeeded: { ascent, transfer, landing, return } }`.

Warnings (contract `WARNINGS`): `LOW_DV` Δv < ascent + transfer + landing; `LOW_TWR` TWR Earth < 1.2; `NO_HEAT_SHIELD`; `NO_LEGS`; `UNSTABLE` CoP ahead of CoM; `LOW_O2` no spare O₂ tank; `NO_ANTENNA`; `NO_SHELTER`; `COLD_SEALS` cheap seals and tempC < 5; `LOW_RELIABILITY` < 0.8. Hard blocks (`HARD_BLOCKS`): `NO_CAPSULE`, `NO_ENGINE`, `NO_FUEL` (no usable fuel), `NOT_CONNECTED`, `OVER_BUDGET` (cost + fee > money).

## Flow

HANGAR: build → **GO / NO-GO POLL** → GONOGO: lines reveal → no blocks: **CONFIRM & LAUNCH** (or **OVERRIDE** when there are warnings) → `economy.spend(cost + fee)`, `setShip(spec)`, `ship:built`, `requestState('PRELAUNCH')`. **BACK** → HANGAR. Money is spent only at confirm, never on entering a state (the boot check depends on that).

`?debug=1&state=GONOGO` works with no ship built: the draft or the Reliable preset is used.

## Events

Emits: `ship:built`, `guidebook:open`, `builder:highlightPart` (the Formula Lens and the Flight Report both make parts glow through this one event), `ending:show` + `requestState('ENDING')` with `bankrupt` when funds fall below `balance.insolvencyFloor` and the player declares it.
Listens: `builder:highlightPart`, `economy:changed`.

## Save keys (through core `save`)

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
| `bay/partArt.js` | 3D art for a part: real NASA hardware (`bay/nasa.js`, 22 parts, Draco-compressed GLBs in `public/assets/nasa/`) → detailed procedural tanks, nose cones, heat shields, fins and modules (`bay/partMeshes.js`) → Role 3's `rocketPart:` meshes (legs) |
| `designPage.js` | the vehicle design page: a top-to-bottom engineering drawing of the stack (side elevations from `partIcons.sideViewFor`, labels laid out per column without overlaps, leader lines, dashed `+ Add a part` slots, wheel zoom about the pointer); a picker row of cards (replacements, materials, HEAD/BODY/TAIL for an empty stand, checklist items via `autoplace.js`); header chips, build checklist, warnings, Formula Lens |
| `bay/nasa.js` | `NASA_PARTS` (which model each part uses, cut by node name, normalised to stand on y = 0 at the catalogue height) and `nasaProp(slug, cfg, height)` for the hardware standing in the hall |
| `bay/loader.js` | Poly Haven assets listed in `data/bayAssets.json` (HDRI, PBR sets, glTF props) with procedural fallbacks |
| `hangarScene.js` | puts it together: `createHangarScene({ renderer })` → scene, camera, player, stations, wall, test, `setLayout`, `worldAnchors`, `nearestStation`, `placeAtStation` |
| `hangarScreen.js` | the HUD (crosshair, prompt, chip, toasts) and the station panels: the design page for the five design desks (each preselects its family), test console, range terminal, handbook (`handbook.js`, notes saved as `builderNotes`), dialogs (rename, MORE: blueprints, share code, launch window, redo, clear) |
| `autoplace.js` | "ADD TO VEHICLE" from a card: puts the part where a technician would (`insertAbove` for tanks above the engine) |

Flow: walk up to a machine → `E` opens its panel (pointer unlocks, the player stands still) → `Esc` closes it. `H` opens the handbook anywhere. The readiness poll (GONOGO) is shown from the test conductor's console in the same hall. With `?debug=1`, `window.__game.builder.placeAt(id)` / `openStation(id)` / `startTest()` drive it from the console.

Assets: `public/assets/polyhaven/` (CC0, 53 MB), `public/assets/nasa/` (public domain, 45 MB), `public/assets/people/` (CC BY), see `CREDITS.md`; `data/bayAssets.json` is the manifest the loader trusts, and `nasaProp` resolves to null for a missing file, so neither produces a console error.

## Rules the checks enforce

`npm run check:static` rejects: unknown event/state names, imports into other roles' folders, `requestAnimationFrame` outside core, keyboard/mouse/pointer listeners outside `core/input.js`, `localStorage` outside `core/save.js`, the literals `9.81`, `3.71`, `9.80665` outside `core/planets.js`. `npm run check:boot` walks the loop in Chrome and needs a `[data-stub]` element in HANGAR and GONOGO (our roots carry `data-stub` and `data-screen`), no console errors, and the failure penalty computed from the Reliable mock (so never call `setShip` outside confirm).
