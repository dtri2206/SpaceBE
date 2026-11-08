# Nose section: notes

## What is here (wave 4, 2026-11-07)

- 97 parts (47 kept, 50 new), 2 new families (`orbital` "Nose modules", `service` "Service modules & trunks"), 11 rows, 28 shapes
  (9 kept ids improved, 19 new), 10 kits (3 new: `rcs`, `service_module`, `module`; 4 extended: `capsule`, `ablative_shield`,
  `escape_tower`, `chute`). Every new first option is neutral, so presets and old saves are unchanged.
- Rows, top to bottom: escape tower, nose cover / fairing, **orbital & cargo module** (new: what rides on the capsule's nose
  under the fairing), crew capsule, heat shield, **service module, trunk & adapter** (now also picks family `service`);
  side rows as before, the crew row also lists parts with the `airlock` flag.
- Shapes, in card order: mercury, fairing_capsule (Vostok), voskhod, gemini, apollo, soyuz_7k, soyuz, shenzhou, big_cabin
  (Orion), crew_dragon, starliner, gaganyaan, new_shepard, mengzhou, starship, bare_capsule, cargo_dragon (Dragon 1),
  progress, cygnus, htv, atv, dream_chaser, dawn_stack, mars_rover, new_glenn, hope, mom, electron.
- Real capsules are new parts (`capsule_mercury`, `capsule_gemini`, `capsule_apollo`, `capsule_soyuz`, `capsule_shenzhou`,
  `capsule_orion`, `capsule_dragon`, `capsule_starliner`, `capsule_gaganyaan`, `capsule_newshepard`, `capsule_mengzhou`,
  `capsule_vostok`, `dream_chaser`, `starship_nose`); the generic Mk1–Mk3 stay as they were (presets use them).
- Capsules that carry their own heat shield (flags `capsule` + `heatShield`): capsule_vostok (ablator all over the sphere),
  capsule_mengzhou (so it sits inside the 5.2 m fairing at its real ratio), dream_chaser (belly tiles), starship_nose
  (tiles, `fragileShield`). They are listed in the capsule row (first matching row).
- Cargo craft (progress, cygnus, htv, atv) keep the generic Mk1 capsule: their hold rides on its nose like Soyuz's orbital
  module. Each shape says the real craft carried no crew (lead decision, review pass 1).
- hull.test pins two shapes: dawn_stack flies the aluminium 9.5-ft Delta II fairing (`nose_biconic_m`, review pass 2;
  the test checks its fairing reaches the spin table), and big_cabin keeps `las_orion` as a tower (no fairing on an S-IVB).
- Part data carries its own `hullProfile` (hull.js reads it before data/hull.json). Modules under a fairing are `inner`;
  exposed service modules are `shell` (their wall is the skin).

## Size rule and scale (contract, tools/blender/README.md "Which size")

The nose takes the size of the stage it sits on (under 2.5 m S, 2.5–4.5 m M, over 4.5 m L), and the whole nose uses one
factor k = game diameter / that stage's diameter, so a capsule keeps its real ratio to its fairing. Exceptions kept on
purpose: Apollo and Orion are scaled from the spacecraft (the SLA / adapter cone belongs to the body); Starliner stays L
over an M Atlas (lead); dawn_stack stays M (Delta II is 2.44 m, a kept shape).

| Shape | Size | Stage | k |
|---|---|---|---|
| mercury | S | Redstone 1.78 m | 1.0 (capsule 1.89 m) |
| fairing_capsule, voskhod | M | Vostok Block E 2.56 m | 0.977 |
| gemini | M | Titan II 3.05 m | 0.82 |
| soyuz, soyuz_7k, progress | M | Soyuz Block I 2.66 m | 0.92–0.94 |
| shenzhou | M | Long March 2F 3.35 m | 0.746 |
| crew_dragon, cargo_dragon | M | Falcon 9 3.66 m | 0.683 |
| new_shepard | M | New Shepard 3.7 m | 0.68 |
| gaganyaan | M | LVM3 4.0 m | 0.625 |
| hope | M | H-IIA 4.0 m | 0.625 |
| mom | M | PSLV 2.8 m | 0.89 (fairing 3.2 m) |
| electron | S | Electron 1.2 m | 1.56 |
| apollo | L | (CM 3.91 m) | 0.863 |
| big_cabin | L | (CM 5.03 m) | 0.671 |
| starliner | L | (CM 4.56 m) | 0.74 |
| mengzhou | L | Long March 5B 5.0 m | 0.675 |
| cygnus | L fairing over S | Falcon 9 | 0.65 (fairing 5.2 m) |
| htv | L | H-IIB 5.2 m | 0.649 |
| atv, dream_chaser | L | Ariane 5 / Vulcan 5.4 m | 0.625 |
| mars_rover | L | Atlas V 5 m fairing | 0.65 |
| new_glenn | L | New Glenn 7 m | 0.48 |
| starship | L | Starship 9 m | 0.375 |

Escape-tower trusses are drawn at about 0.55 of their scaled length (motors keep their proportions); nothing else is
shortened. The longest real noses make ships of 28–32 m on the bodies that can lift them (accepted by the lead).

## Budget (review pass 2): cheapest flying ship per shape

Search: the reviewer's `review-nose/pass2/search-repo.mjs` on the repo data as it stands (with the shared-code changes of
review pass 2: landing legs survive tail switches, a shape keeps crew equipment that does a different job). The Reliable
preset with its equipment, every body shape × every tail shape × no or two `srb_s` × no extra tank / `tank_l_kerolox` /
`tank_m_methalox` / `tank_l_methalox` × no or four `fin_l` × with or without `gimbal_ring`; flies = Δv ≥ 5,400 m/s and no
LOW_DV, LOW_TWR, UNSTABLE, LOW_RELIABILITY.

| Shape | Ship + fees | Δv (m/s) | Height (m) | Body + tail + extras (other warnings) |
|---|---|---|---|---|
| mercury (kept) | $3.16M | 5469 | 20.9 | titan_ii + single_engine |
| fairing_capsule (kept) | $3.49M | 5547 | 23.2 | vulcan_booster + single_engine |
| voskhod | $4.17M | 5497 | 26.9 | pslv_ps2 + single_engine + 2srb_s + tank_l_kerolox |
| gemini (kept) | $3.58M | 5409 | 19.8 | atlas_balloon + single_engine |
| apollo (kept) | $4.91M | 5409 | 30.2 | titan_ii + single_engine + 2srb_s + tank_l_kerolox |
| soyuz_7k | $4.66M | 5494 | 31.3 | titan_ii + single_engine + 2srb_s + tank_l_kerolox |
| soyuz (kept) | $4.80M | 5484 | 31.3 | titan_ii + single_engine + 2srb_s + tank_l_kerolox |
| shenzhou | $4.67M | 5556 | 31.0 | titan_ii + single_engine + 2srb_s + tank_l_kerolox |
| big_cabin (kept) | $4.87M | 5403 | 28.2 | titan_ii + single_engine + 2srb_s + tank_l_kerolox |
| crew_dragon (kept) | $4.70M | 5444 | 23.2 | pslv_ps2 + single_engine + 2srb_s + tank_l_kerolox |
| starliner | $4.92M | 5409 | 22.5 | titan_ii + single_engine + 2srb_s + tank_l_kerolox |
| gaganyaan | $4.38M | 5471 | 27.1 | pslv_ps2 + single_engine + 2srb_s + tank_l_kerolox |
| new_shepard | $3.00M | 5438 | 16.1 | titan_ii + single_engine (NO_HEAT_SHIELD) |
| mengzhou | $4.44M | 5401 | 26.1 | pslv_ps2 + single_engine + 2srb_s + tank_l_kerolox |
| starship | $3.89M | 5455 | 23.8 | pslv_ps2 + single_engine + 2srb_s + tank_l_kerolox |
| bare_capsule (kept) | $3.40M | 5428 | 18.0 | methalox_core + single_engine |
| cargo_dragon | $3.69M | 5536 | 19.7 | vulcan_booster + single_engine |
| progress | $4.24M | 5501 | 27.6 | pslv_ps2 + single_engine + 2srb_s + tank_l_kerolox |
| cygnus | $4.65M | 5578 | 30.3 | titan_ii + single_engine + 2srb_s + tank_l_kerolox + 4fin_l |
| htv | $4.75M | 5524 | 28.7 | titan_ii + single_engine + 2srb_s + tank_l_kerolox + 4fin_l |
| atv | $4.68M | 5548 | 28.8 | titan_ii + single_engine + 2srb_s + tank_l_kerolox + 4fin_l |
| dream_chaser | $4.72M | 5511 | 29.3 | titan_ii + single_engine + 2srb_s + tank_l_kerolox + 4fin_l |
| dawn_stack (kept) | $4.20M | 5493 | 24.5 | vulcan_booster + single_engine |
| mars_rover | $4.65M | 5484 | 26.6 | titan_ii + single_engine + 2srb_s + tank_l_kerolox |
| new_glenn | $4.51M | 5495 | 27.3 | titan_ii + single_engine + 2srb_s + tank_l_kerolox |
| hope | $3.42M | 5487 | 20.3 | atlas_balloon + single_engine |
| mom | $3.40M | 5498 | 20.0 | atlas_balloon + single_engine |
| electron | $3.07M | 5449 | 18.6 | titan_ii + single_engine |

All 28 fly within $5M on at least one combination. Every kept shape fits.

### Orion (big_cabin), review pass 2

With the crew equipment the Reliable preset keeps, Orion needed $4.91M at Δv 5,376 (LOW_DV) at its cheapest. Changes:
- `capsule_orion` 4,300 → 4,100 kg: the real crew module (about 9.3 t at liftoff, Artemis I) scaled by the nose factor
  0.671² is about 4.2 t, so 4.1 t stays within about 2 % of the real ratio. The service module was not trimmed: at 520 kg it
  is already far lighter than the real ESM's share.
- The shape no longer fits the shock-absorbing couches (`couches: shock`, +40 kg): Orion's real seats do absorb landing
  loads, and the player can fit them. The reverse-flow escape motor (visible on the model) stays.
- Result: $4.87M at Δv 5,403 (titan_ii + single_engine + 2 srb_s + tank_l_kerolox). Other trims that also fly: a 4,150 kg
  capsule without the reverse motor ($4.81M, Δv 5,401).

### Real hardware options on the shapes (after the models, commit 834291e)

The ship shows a slot's first option when a shape sets none, so the shapes set the real ones (stack items
`{ type, options }` in section.json):
- `las_soyuz` motor ring, steering grid fins (soyuz, soyuz_7k); `las_shenzhou` steering grid fins; `las_gaganyaan` motor
  staged, steering grid fins; `las_orion` motor reverse-flow.
- Fairings: pneumatic pushers on Falcon 9 (`fairing_composite_l`, cygnus), Electron (`nose_pointed_s`) and New Glenn
  (`fairing_newglenn`); acoustic blankets on the large fairings (`fairing_composite_l`, `fairing_newglenn`, `nose_pointed_l`
  on atv and dream_chaser, `nose_hammerhead_m` on mars_rover, `fairing_h2b`, `fairing_cz5`).
- `vostok_instrument_module` engine main (fairing_capsule, voskhod); `soyuz_service_module` power solar wings (soyuz,
  progress): the neutral first options, written out so the shapes say what they carry.

Left off because they would push a kept shape over $5M:
- `les_tower_apollo` steering canards (+40 kg, +$45k) on apollo. The real Apollo tower had canards; the player can fit them.
- `las_orion` steering ACM (+90 kg, +$120k) and `capsule_orion` shock couches on big_cabin (see above).
- New Glenn's fairing separation system is not confirmed by a source read (TODO verify); the pneumatic choice follows the
  modeller's reference.

## Blender models (the plan the nose modeller worked from)

The models are committed (834291e, 65 GLBs; ASSETS.md lists them); this table is the original plan. A part has
`"model": { "builder": "nose/<slug>" }` only when its GLB exists. Scripts in
`src/builder/tools/blender/nose/`, output `public/assets/models/builder/nose/<slug>.glb`. Caps: about 200 KB for a capsule,
about 120 KB for a module or fairing, 20k triangles each, all inner pieces (`slot_<key>`, `slot_<key>__<option>`) inside
the part's own GLB (no shared library). The section stays under 12 MB.

| Slug | Part | Size, height (m) | Priority | Inner slots worth modelling |
|---|---|---|---|---|
| capsule_vostok | capsule_vostok | M, 2.25 (real 2.3 m sphere × 0.977) | 1 | couches (ejection seat), hatch, windows |
| capsule_mercury | capsule_mercury | S, 2.92 | 1 | couches (contour), hatch, windows |
| capsule_gemini | capsule_gemini | S, 1.84 | 1 | couches (two ejection seats), hatch |
| capsule_apollo | capsule_apollo | L, 2.80 | 1 | couches (struts), hatch (Smithsonian CC0 hatch, decimated), docking (probe) |
| capsule_soyuz | capsule_soyuz | S, 2.06 | 1 | couches (Kazbek), hatch (top), landing (six rockets) |
| capsule_orion | capsule_orion | L, 2.25 | 1 | couches, hatch, docking (NDS) |
| capsule_dragon | capsule_dragon | M, 2.20 | 1 | couches, docking (NDS), windows (cupola variant) |
| starship_nose | starship_nose | L, 4.90 | 1 | couches, docking |
| capsule_shenzhou | capsule_shenzhou | S, 1.64 | 2 | as Soyuz (four rockets) |
| capsule_starliner | capsule_starliner | L, 2.30 | 2 | landing (airbags), docking |
| capsule_gaganyaan | capsule_gaganyaan | S, 1.95 | 2 | couches, hatch |
| capsule_newshepard | capsule_newshepard | M, 2.00 | 2 | couches (six), windows, escape motor |
| dream_chaser | dream_chaser | L, 5.60 | 2 | couches, docking (CBM) |
| capsule_mengzhou | capsule_mengzhou | L, 2.30 | 3 | landing (airbags) |
| les_mercury, les_apollo, las_soyuz, las_orion | existing towers | as in parts.json | 1 | motor, jettison, steering variants |
| las_shenzhou, las_gaganyaan | new towers | M, 4.5 / 5.0 | 2 | motor, steering (grid fins) |
| vostok_instrument_module, gemini_adapter, apollo_sm, soyuz_service_module, orion_esm | service modules | as in parts.json | 1 | power, engine |
| soyuz_orbital_module, shenzhou_service_module, starliner_sm, cygnus_sm, atv_propulsion, cruise_stage_mars, shenzhou_orbital_module | modules | as in parts.json | 2 | power / docking |
| fairing_delta2 (nose_biconic_m), fairing_atlas5 (nose_hammerhead_m), fairing_falcon9 (fairing_composite_l), fairing_bg54 (nose_pointed_l), fairing_soyuz2 (nose_blunt_m), fairing_electron (nose_pointed_s), vostok_shroud, fairing_newglenn, fairing_h2, fairing_h2b, fairing_cz5, fairing_pslv | fairings | as in parts.json | 2 | split, pushers |
| bpc_apollo, nosecap_dragon (open variant), nose_gemini_rr, nose_dragon1, chute_single_main, chute_cluster_4, volga_airlock | small | as in parts.json | 2–3 | canopy |

Priority 3 modules keep the code-drawn art: soyuz_7k_service_module, gaganyaan_sm, mengzhou_sm, htv_propulsion,
htv_logistics, atv_icc, progress_cargo_module, cygnus_pcm, shooting_star, dragon1_trunk, voskhod_backup_retro,
retropack_mercury. Until stage 2 the new axial modules and fairings have no art of their own in `art.js` (the skin still
draws the shroud round them).

## Options kept on purpose (history lessons or realism, honest text)

- Docking (capsule and module kits): mass and cost only; the flight never docks. Kept so a real ship can be built as it was.
- `chute/canopy/parafoil` and `ablative_shield/ablator/heat_sink`: worse than another option on purpose: they show why
  capsules fly round canopies (X-38 and Gemini's paraglider never landed a crew) and ablators (Mercury's suborbital heat sink).
- `capsule/atmosphere/pure_o2`, `pad_mix` (Apollo 1) and `capsule/suits/none` (Soyuz 11): real trade-offs in mass, cost
  and reliability; no ShipSpec field (lead decision).
- `volga_airlock`, `soyuz_orbital_module`, `shenzhou_orbital_module`: the `airlock` flag has no game effect yet; they cost
  mass and money for realism and the first spacewalk's history.

## Facts still to verify (kept out of player text; sources in the wave-4 research folder sources.md)

Vostok shroud dimensions and colour; Vostok and Shenzhou ablator materials; Voskhod soft-landing rocket and the airlock's
name (Volga); Mercury heat-sink flights and tower mass; Gemini capsule colour; Apollo LES details beyond the News Reference,
SPS area ratio, backshell 32.5° or 33°; Soyuz reserve canopy area (570 m²), shroud and tower size; Shenzhou main canopy
1,200 m² and escape motor thrust; Mengzhou dimensions and mass; Orion backshell 32.5° or 30°, window count, no docking
mechanism on Artemis I/II; Crew Dragon dry mass, trunk size, sidewall angle, Mark 3 chutes; Starliner SM height; Gaganyaan
operational module size (3.5 m on Wikipedia; the game uses the flown 3.1 m TV-D1 module); New Shepard capsule size, mass and
heat protection; Dream Chaser folded span and flight date; Falcon 9 fairing mass; New Glenn fairing length; Long March 5
normal fairing length; Dragon 1 nose-cone jettison; NDS and probe masses; X-38 parafoil area; Starship nose-section height;
every mission date quoted.

## Review pass 1 (2026-11-07), applied

Kept shapes fit $5M again (game-light Apollo SM and Orion ESM, Crew Dragon back to M with the existing Crew Dragon trunk);
the size rule above; no "TODO verify" in player text; facts fixed (Apollo pad air 60 % O₂ / 40 % N₂, Sokol-K from Soyuz 12 and
Sokol-KV2 from Soyuz T-2, Crew Dragon PICA-3, BLA a sprayed filled silicone, New Glenn fairing in two halves, APAS-89/95
petals inward, the Mars rover stack rode inverted, stale Dragon and window references); every option has a real trade-off
or is listed above; Vostok sphere meets its module without a ledge; Starship nose has no top node; Apollo backshell 32.5°;
drogues on soyuz_7k and shenzhou; cargo shapes say the real craft was uncrewed.

## Earlier (wave 2–3)

- Capsules are drawn procedurally in `art.js`; every capsule nose ends in the 0.9 m docking ring (`NECK`) that towers, covers
  and fairings seat on. A fairing with a capsule under it (directly, or under modules that fit inside: hull.js) is drawn as a
  shroud.
- Escape towers and abort pods share `flags.bonusGroup: "abort"` (one escape system counts). `flags.abortTower` marks parts a
  flight that drops hardware would throw away about 2.5 minutes after launch.
