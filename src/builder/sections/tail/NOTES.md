# Tail section: notes

Owned by the tail section agent. Data in `parts.json`, `section.json`, `internals.json`, `explain.json`; art in
`art.js` (the tail modeller's). Research, sources and reference photos of wave 4: the tail researcher's folder
(`spaceb-wave4/tail/`: `spec.json`, `models.md`, `sources.md`, `refs/`); the main sources are listed at the end.

## What is here (wave 4, 2026-11-07)

- **31 shapes.** The 11 earlier ids are kept, with their text rewritten and the real engine options set. The 20 new
  ones are listed by first flight: mercury_atlas, saturn_ib, saturn_sii, n1, titan_iiie, energia, delta_ii_7925,
  proton, delta_iv_heavy, angara_a5, new_shepard, long_march_5, lvm3, electron, falcon_heavy, sls, h3_22,
  super_heavy, starship, ariane_64.
- **Size rule** (lead's decision): by the real stage diameter, under 2.5 m is S, 2.5–4.5 m is M, over 4.5 m is L.
  - vulcan and space_shuttle moved to L (new `thrust_triad_l`).
  - mercury_atlas, titan_iiie, lvm3, new_shepard and falcon_heavy are on M.
  - **Exception to the rule:** Delta II is 2.44 m, a hair under the 2.5 m line, but both Delta II shapes
    (single_solids, delta_ii_7925) stay on M, so the Delta II family keeps one size. The Redstone-style single_engine
    (1.78 m) also stays on M, because it is the default shape players start from.
- **56 parts** (30 earlier + 26 new):
  - 12 thrust structures: `thrust_atlas_m`, `thrust_twin_l`, `thrust_triad_l`, `thrust_sib_l` (8), `thrust_sii_l` (5),
    `thrust_sls_l` (4, boattail), `thrust_superheavy_l` (33), `thrust_starship_l` (6), `thrust_electron_s` (9),
    `thrust_proton_l` (6), `thrust_n1_l` (30), `thrust_energia_l` (4).
  - 5 solid boosters: `srb_5seg_l`, `srb_ua1205_l`, `srb_p120c_l`, `srb_3_m`, `srb_s200_l`.
  - 5 liquid boosters: `booster_cbc_l`, `booster_f9_m`, `booster_blok_a_m`, `booster_urm1_m`, `booster_cz5_m`.
  - 2 fins: `fin_flap_l` (Starship aft flap), `fin_aft_m` (New Shepard aft fin).
  - 2 legs: `legs_glenn_l` (six legs), `legs_shepard_m`.
- **Part fields:**
  - `thrust_electron_s` (`carbon`) and `srb_p120c_l` (`composite_case`) set `defaultMaterial`.
  - `thrust_atlas_m` and `thrust_sls_l` (boattail) declare `hullProfile: own`. The Atlas pods reach 1.61 R, but only on
    two sides (±X), so its profile uses 1.2 R, the round base with the same area, for the skin's drag. The model keeps
    the real pods.
  - The N1 frame carries `flags.steering`: it steers itself by throttling.
- **Kits** (option 0 of every new slot is neutral):
  - `engine`:
    - New options: cycle `sc_fuel` and `expander_bleed`, injector `swirl`, igniter `ampoule`.
    - New slots: `chamber` (channels, tubes, film, ablative), `contour` (bell, cone, aerospike) and `stability` (none,
      baffles, cavities).
    - `sc` and `coaxial` have new text.
    - Options carry `throttle` and `restarts` facts that nothing reads yet.
  - `gimbal`: new kit on `gimbal_ring`, slot power: hpu / fueldraulic / apu.
  - `segmented`: new kit on `srb_5seg_l`, `srb_ua1205_l` and `srb_s200_l`, with slots joint, nozzle and grain.
  - `ring`: new kit on `thrust_n1_l`. It copies the `thrust` slots and adds `steer`: differential throttling, or
    gimballed outer engines.
  - **Fuel-bound options** carry `"fuels"` (FUELS ids from contract.js); the design page greys them out for other
    fuels and stats falls back (lead's code):
    - cycle `sc` (oxygen-rich staged combustion): kerolox, methalox. Hot hydrogen-rich gas is the hydrogen engines'
      way, so no hydrolox engine has flown oxygen-rich.
    - cycle `sc_fuel`: hydrolox, methalox. With kerosene the fuel-rich gas would soot the turbines.
    - cycles `expander` and `expander_bleed`: hydrolox, methalox. The fuel must boil in the chamber walls.
    - cycle `ffsc`: methalox, hydrolox (Raptor; NASA's hydrogen Integrated Powerhead Demonstrator).
    - gimbal power `fueldraulic`: kerolox only.
    - The other engine options (injectors, chamber walls, nozzle shapes, extensions, igniters, stability) work with
      any of the three fuels.
  - Shapes whose real engines use a fuel-bound option keep it: saturn_sic, octaweb and falcon_heavy use fuel hydraulics.
    On a methane body (Reliable) those options are greyed out and the fallback applies.
- **Fin placement:** fins hang low on their frame, trailing edge near the engines, as on the real tails.
  - saturn_sic: `fin_l` at yFrac 0, under the engine fairings (yFrac 0.4).
  - saturn_ib: `fin_l` at 0.1.
  - n1: `fin_grid_m` at 0.05.
  - new_shepard: `fin_aft_m` at 0.05.
  - single_engine `fin_m` stays at 0.25: its bottom already sits at the frame's base. mercury_atlas has no fins.
  - Starship's flaps stay at 0.45, alongside the engine bay.
- **`data/engines.json`:**
  - 15 references added: f1, h1, j2, rs68, rd170, rd191, nk33, rd0120, be3, le9, yf100, yf77, rd275, lr87, vikas.
  - Fixed: raptor (`ffsc`, `swirl`), rs25 (`sc_fuel`), rd180 (`swirl`, `ampoule`), aj10 (no igniter: hypergolic),
    rl10 and `nozzles.vac` (expansion 280).

### Agreed changes that move numbers

- Presets: all four are unchanged (cost, TWR, Δv and reliability checked identical before and after).
- The existing igniter option `pyro`: reliability +0.2 % changes to −0.2 %, because a dud cartridge cannot be retried
  (review finding 8).
- Existing shapes now carry their real engine options, which raises their cost:
  - atlas_v: RD-180 staged combustion, swirl, start capsule.
  - vulcan and new_glenn: BE-4 staged combustion.
  - space_shuttle: RS-25 fuel-rich.
  - saturn_sic: F-1 impinging, baffles, tubes, TEA-TEB, fuel hydraulics.
  - octaweb: Merlin pintle, TEA-TEB, fuel hydraulics.
  - ariane_5: pyro.
- new_glenn has six legs. titan_ii lost its pyro igniter (its propellants light on contact).

## Balance (each shape on the Reliable preset; cost includes the $180k launch fees)

| Shape | Size | Engines | Ship + fees | TWR | Δv | Reliability | Warnings |
|---|---|---|---|---|---|---|---|
| single_engine | m | 1 × L | $3.40M | 1.36 | 5,428 | 90.0 % | none |
| single_solids | m | 1 × L + 3 boosters | $4.22M | 2.32 | 5,191 | 87.3 % | LOW_DV |
| atlas_v | m | 1 × L + 2 boosters | $4.89M | 2.40 | 5,253 | 88.4 % | LOW_DV |
| ariane_5 | l | 1 × L + 2 boosters | $4.62M | 2.49 | 5,201 | 87.3 % | LOW_DV |
| titan_ii | m | 2 × L | $4.41M | 2.60 | 4,855 | 87.6 % | LOW_DV |
| vulcan | l | 2 × M + 2 boosters | $4.81M | 2.02 | 5,116 | 85.6 % | LOW_DV |
| space_shuttle | l | 3 × S + 2 boosters | $4.50M | 1.97 | 5,087 | 87.0 % | LOW_DV |
| soyuz | m | 4 × S + 4 boosters | $4.61M | 1.60 | 5,630 | 82.3 % | none |
| saturn_sic | l | 5 × M | $5.13M | 1.89 | 4,525 | 89.7 % | LOW_DV, OVER_BUDGET |
| new_glenn | l | 7 × M | $7.02M | 2.52 | 4,243 | 86.7 % | LOW_DV, OVER_BUDGET |
| octaweb | m | 9 × S | $4.07M | 1.18 | 4,929 | 90.4 % | LOW_DV, LOW_TWR |
| mercury_atlas | m | 3 × M | $3.85M | 1.21 | 5,200 | 86.4 % | LOW_DV |
| saturn_ib | l | 8 × S | $4.22M | 1.04 | 4,845 | 88.0 % | LOW_DV, LOW_TWR |
| saturn_sii | l | 5 × M | $4.93M | 1.28 | 5,064 | 89.0 % | LOW_DV |
| n1 | l | 30 × S | $8.93M | 3.15 | 3,293 | 77.0 % | LOW_DV, LOW_RELIABILITY, OVER_BUDGET |
| titan_iiie | m | 2 × M + 2 boosters | $4.50M | 1.98 | 4,929 | 85.8 % | LOW_DV |
| energia | l | 4 × S + 4 boosters | $7.35M | 2.40 | 6,470 | 78.3 % | LOW_RELIABILITY, OVER_BUDGET |
| delta_ii_7925 | m | 1 × L + 9 boosters | $5.47M | 3.20 | 5,314 | 81.2 % | LOW_DV, OVER_BUDGET |
| proton | l | 6 × M | $6.31M | 2.23 | 4,510 | 77.4 % | LOW_DV, LOW_RELIABILITY, OVER_BUDGET |
| delta_iv_heavy | l | 1 × L + 2 boosters | $5.12M | 2.29 | 6,630 | 87.2 % | OVER_BUDGET |
| angara_a5 | m | 1 × L + 4 boosters | $6.35M | 2.49 | 6,299 | 85.5 % | OVER_BUDGET |
| new_shepard | m | 1 × L | $3.44M | 1.29 | 5,400 | 89.4 % | none |
| long_march_5 | l | 2 × M + 4 boosters | $6.05M | 2.23 | 6,299 | 83.6 % | OVER_BUDGET |
| lvm3 | m | 2 × M + 2 boosters | $4.39M | 1.92 | 5,138 | 86.0 % | LOW_DV |
| electron | s | 9 × S | $3.36M | 0.90 | 5,105 | 73.9 % | LOW_DV, LOW_TWR, LOW_RELIABILITY |
| falcon_heavy | m | 9 × S + 2 boosters | $6.14M | 2.16 | 5,561 | 87.3 % | OVER_BUDGET |
| sls | l | 4 × S + 2 boosters | $5.18M | 2.11 | 5,084 | 81.3 % | LOW_DV, OVER_BUDGET |
| h3_22 | l | 2 × M + 2 boosters | $4.35M | 1.86 | 5,208 | 87.9 % | LOW_DV |
| super_heavy | l | 33 × S | $10.65M | 3.37 | 3,171 | 76.5 % | LOW_DV, UNSTABLE, LOW_RELIABILITY, OVER_BUDGET |
| starship | l | 6 × M | $7.19M | 2.20 | 4,474 | 76.8 % | LOW_DV, LOW_RELIABILITY, OVER_BUDGET |
| ariane_64 | l | 1 × L + 4 boosters | $6.43M | 2.67 | 5,856 | 83.9 % | OVER_BUDGET |

17 of 31 fit $5M with the Reliable body. The rest stay later goals (the user's decision). Starship no longer has
engine-out (the claim has no source), hence LOW_RELIABILITY. Super Heavy reads UNSTABLE because 33 engines put the
centre of mass very low.

## Models

- **Status:** the tail modeller has shipped 44 GLBs in `public/assets/models/builder/tail/`. Scripts are in
  `src/builder/tools/blender/tail/`. The files cover:
  - every part below;
  - the existing frames, fins and the grid fin;
  - the engines' vacuum-bell versions (`engine_*_vac`);
  - the low-detail cluster engine `engine_s_lod`.
- **Model fields:** the modeller sends the `model` fields (`{ "builder": "tail/<slug>" }`, plus `lod` for `engine_s`)
  to the lead, who writes them into `parts.json`. This data pass does not touch them.
- The table below is the spec the models were built to.
- Contract: `src/builder/tools/blender/README.md`.
- Option variants are named `slot_<key>__<optionId>`.
- Legs and fins are modelled as one unit; the game places the copies.
- Booster diameters keep the real booster ÷ core ratio of the shape that uses them. Heights are the catalogue heights.

| Part | Height (m) | Diameter or width | Inner pieces (slots) | Notes |
|---|---|---|---|---|
| `engine_s`, `engine_m`, `engine_l` | 1.65 / 2.2 / 2.97 | own shape | `slot_cycle`, `slot_injector`, `slot_chamber`, `slot_contour`, `slot_nozzleExt`, `slot_igniter`, `slot_stability`, with option variants | one generator; **`engine_s` also needs `"lod": "tail/engine_s_lod"`** (≤ 2,500 triangles), because it sits in clusters of 30 and 33 |
| `thrust_atlas_m` | 1.4 | R 1.25, pods out to 1.61 R on ±X (hull profile 1.2 R, equal area) | `slot_baseShield`, `slot_feed`, `slot_pogo` | three mounts at x = −0.7 / 0 / +0.7 R, measured from photos; NASA `atlas.glb` (in the repo) has the booster section to cut |
| `thrust_twin_l` | 1.2 | R 1.6875 | thrust slots | Vulcan / H3 / Long March 5 |
| `thrust_triad_l` | 1.4 | R 1.6875 | thrust slots | Shuttle triangle |
| `thrust_sib_l` | 1.5 | R 1.6875 | thrust slots | inner engines canted 3°, outer 6°; eight fin roots |
| `thrust_sii_l` | 1.3 | R 1.6875 | thrust slots | cone of beams, aft skirt |
| `thrust_sls_l` | 1.6 | R 1.6875, boattail to 0.84 R at the base | thrust slots | hullProfile own `[[0.84,0],[0.92,0.18],[1,0.45],[1,1]]` |
| `thrust_superheavy_l` | 1.6 | R 1.6875 | thrust slots | 3 / 10 / 20 rings at 0.13 / 0.45 / 0.86 R, estimated |
| `thrust_starship_l` | 1.4 | R 1.6875 | thrust slots | steel; black tiles on one half; flap hinge fairings at ±X |
| `thrust_electron_s` | 0.8 | R 0.9375 | thrust slots | black carbon |
| `thrust_proton_l` | 1.4 | R 1.6875 | thrust slots | six lobes, open centre |
| `thrust_n1_l` | 1.8 | R 1.6875 | thrust slots + `slot_steer` (`__throttle`, `__gimbals`) | 24 + 6 engines; any flare must stay within R, or the part gets an `own` profile |
| `thrust_energia_l` | 1.5 | R 1.6875 | thrust slots | four booster attach fittings at 45° |
| `srb_5seg_l` | 11.0 | 1.49 m (3.71 ÷ 8.4 of an L core) | `slot_joint`, `slot_nozzle`, `slot_grain` | five segments, aft skirt with four hold-down posts |
| `srb_ua1205_l` | 10.6 | 2.5 m (as wide as the Titan core, M) | `slot_joint`, `slot_nozzle` (`__lit` shows the N₂O₄ nacelle), `slot_grain` | nacelle on +X |
| `srb_p120c_l` | 6.5 | 2.13 m (3.4 ÷ 5.4 of L) | `slot_grain`, `slot_nozzle` (booster kit) | one-piece black carbon case |
| `srb_3_m` | 6.0 | 1.6 m (2.5 ÷ 5.27 of L) | booster kit | carbon case, fixed nozzle |
| `srb_s200_l` | 11.5 | 2.0 m (3.2 ÷ 4.0 of M) | segmented kit | three segments, flex nozzle |
| `booster_cbc_l` | 11.3 | 3.375 m (same as the L core) | none | white engine section, RS-68 under a silver blanket, tan-orange foam |
| `booster_f9_m` | 12.0 | 2.5 m (same as the M core) | none | Octaweb, folded legs, grid fins, nose cone |
| `booster_blok_a_m` | 12.0 | 1.71 m (3.92 ÷ 7.75 of L) | none | four-chamber RD-170 |
| `booster_urm1_m` | 9.0 | 2.5 m (same as the M core) | none | one RD-191 |
| `booster_cz5_m` | 9.7 | 2.26 m (3.35 ÷ 5 of L) | none | two YF-100, slanted cone nose |
| `legs_glenn_l` | 3.6 | one leg | `slot_shock`, `slot_pads`, `slot_probes` | ×6, folded flush |
| `legs_shepard_m` | 2.6 | one leg | legs slots | ×4 |
| `gimbal_ring` (existing) | 0.5 | two actuators | `slot_power` (`__hpu`, `__fueldraulic`, `__apu`) | |

`fin_flap_l` and `fin_aft_m` now have models too (see the status above).

## Shared-code requests

Done by the lead and the modeller:
1. `art.js` has `FRAME_LOOK` entries for all 12 new thrust structures.
2. The five new liquid boosters have their own art (`liquidBoosterArt`) and models; they no longer fall back to the
   solid-booster look.
3. `tail/art.js` `internalsArt` now draws the kits `ring`, `segmented`, `gimbal` and `engine` as well as the earlier
   ones.
4. The `bay/screen.js` reliability colour (`warn`) is fixed (commit `ead2de4`).
5. Fuel-bound options: the lead greys them out on the design page and adds a fallback in stats. The data is the
   `fuels` field, set in this pass.

Still open:
- **Optional:** an option-level `cheapSeals` flag for the `tworing` joint, so the COLD_SEALS warning can fire.

## Facts kept out of player text (estimated or unconfirmed)

- **Mount positions estimated from photos:** Atlas ±0.7 R, S-II outer engines about 0.45 R, SLS 0.48 R, Super Heavy
  rings, Starship 0.17 / 0.6 R, Energia 0.47 R.
- **S-IB:** the gimbal range (7.5° on Saturn I) is not confirmed for the S-IB.
- **Game estimates:** P120C sea-level Isp 252 s; UA1205 sea-level Isp 238 s; expander-bleed Isp +2 s and −5 % thrust;
  tube-wall Isp −1 s.
- **Lengths:** URM-1 (about 25 m), Long March 5 booster (about 27.6 m), Falcon Heavy side booster with its nose cone.
- **Colours:** Energia, Angara and Long March 5 boosters, N1, Proton.
- **Unnamed engine examples:** fuel-film cooling on kerosene engines; acoustic cavities.

## Quirks of shared code this folder relies on

1. `bay/partArt.js` draws a cluster engine at every mount, scaled by `mounts.scale` and lifted by
   `height × (1 − scale)`. `engineArt()` wraps each copy in the inverse transform so it can size the engine to the real
   gap between mounts. If that transform changes, change `engineArt()`.
2. `designScene.js` and `hangarScene.js` shift every part whose id contains `fin` by `host radius − 1.2` m (made for
   Role 3's fin, which carries a +1.2 m offset). The tail's fins and grid fins carry the same offset (`FIN_SHIFT`).
3. Radial art is placed at `host radius + userData.width × 0.45`. Boosters go at `+ width / 2 + 0.05`; legs sit on the
   axis. Steering parts undo that offset to draw around the engine axis; the engine fairing sets `width = 0` to hug
   the skin.
4. Boosters are drawn from a quarter of their length below the clamp point to three quarters above it (never into the
   ground), so their nozzles sit near the core's engines.

## Main sources (read 2026-11-07)

- **Wikipedia pages on each rocket and stage:** Mercury-Redstone, Atlas LV-3B, Titan IIIC/IIIE, UA1205, S-IB, S-II,
  SLS core stage, Space Shuttle SRB (and SLS booster), Delta II, Delta IV Heavy, Falcon 9, Falcon Heavy, Super Heavy,
  Starship, New Shepard, Electron, Proton-M, N1, Energia, Angara, Ariane 6, P120, H3, Long March 5, LVM3, New Glenn,
  GEM 63.
- **Wikipedia pages on each engine and technique:** F-1, H-1, RS-25, RS-68, Raptor, Merlin, RD-170, RD-191, RD-0120,
  RD-253, NK-33, BE-3, BE-4, LE-9, YF-100, YF-77, Vikas, LR87, Rutherford, Pintle injector, Aerospike engine, Grid fin,
  Triethylborane, Pogo oscillation.
- **Other sources:**
  - Blue Origin (New Shepard).
  - ESA and SABCA (electromechanical thrust vector control on Vega and the P120C).
  - JAXA and Spaceflight Now (SRB-3 fixed nozzle).
  - NASA SA-2 press kit (Saturn I engine cant and gimbal).
  - NASA SP-194 (combustion instability).
  - Reference photos from images.nasa.gov (ids in the researcher's `models.md`).
