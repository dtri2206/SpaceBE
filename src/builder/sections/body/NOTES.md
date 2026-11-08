# Body section: notes

Owner: the body section agent (Role 1). Files: `parts.json`, `section.json`, `internals.json`, `explain.json`, `art.js`, this file, `ASSETS.md`. Wave 4 (2026-11-07) added real stage bodies from many rockets and countries; the full research (sources, reference images, the generator scripts and the balance check) is kept outside the repo in the wave 4 working folder `spaceb-wave4/body/` (`spec.json`, `models.md`, `sources.md`, `refs/`, `tools/build.mjs`).

## What is here

- **75 parts**: the 55 earlier parts with the same ids and numbers (two gain only a bonus group), and 20 new ones.
- **29 shapes**: the 11 earlier ids (three rebuilt, six with text fixes) and 18 new ones.
- **10 rows**, one new: *Attitude & settling*.
- **11 kits**: 3 new kits; 6 earlier kits extended with new slots and options. Every first option stays neutral, so the presets keep their numbers.
- **319 explain entries**, English and Vietnamese: 204 kept, 115 added, 4 shape entries rewritten.

### New parts

- **Tanks:**
  - `tank_l_kerolox_cluster`: Saturn IB, nine tanks in a bundle.
  - `tank_l_storable_cluster`: Proton, a centre tank and six outer tanks.
  - `tank_l_kerolox_spheres`: N1 Block A, two spheres inside a cone.
  - `tank_m_kerolox_bloka`: the Soyuz waisted core.
  - `tank_m_kerolox_bloki`: Soyuz third stage.
  - `tank_m_storable_titan`: Titan II.
  - `tank_m_storable_ps2`: PSLV second stage.
  - `tank_l_hydrolox_epc`: Ariane 5 core.
  - `tank_l_lh2_upper` and `tank_l_lox_hung`: the Delta IV upper stage and SLS ICPS.
  - `tank_l_methalox_orthogrid`: Vulcan.
- **Structure:**
  - `centerbody_l`: Delta IV.
  - `forward_skirt_l`, `aft_skirt_l`.
  - `avionics_skirt_l`: SLS forward skirt with the flight computers.
  - `hotstage_truss_m`: Soyuz and N1 open lattice.
  - `hotstage_truss_l`: Proton.
  - `hotstage_ring_l`: Super Heavy vented ring.
- **Side parts:** `aps_module` (S-IVB thruster pod) and `ullage_motors`. They form the new *Attitude & settling* row.

### Shapes (top to bottom stacks in `section.json`)

- **Kept:** `methalox_core`, `starship_steel`.
- **Rebuilt:**
  - `saturn_sic`: corrugated forward skirt, LOX tunnels, aluminium 2219.
  - `saturn_sivb`: aft skirt with two APS pods, ullage motors and helium spheres; waffle wall, internal insulation, cold helium; Instrument Unit with cold plates.
  - `soyuz_blok_a`: open lattice, the instrument ring, the waisted core.
- **Text fixes only** (no more fix-it hints or Mars verdicts): `delta_core`, `hydrolox_core`, `falcon9_s1`, `atlas_balloon`, `electron_carbon`, `centaur_balloon`.
- **New:** `saturn_sii`, `saturn_ib_sib`, `titan_ii`, `sls_core`, `dcss_icps`, `atlas_v_ccb`, `delta_iv_cbc`, `h2a_s1`, `long_march_5`, `energia_core`, `zenit_s1`, `pslv_ps2`, `soyuz_blok_i`, `proton_s1`, `n1_blok_a`, `super_heavy`, `vulcan_booster`, `ariane5_epc`.
- Each shape carries `sources` (URLs).
- **Left out:**
  - Falcon 9 second stage and Falcon Heavy core: same build as `falcon9_s1`.
  - New Glenn and H3: tank order not found.
  - Neutron: not flown.
  - Ariane 6: close to the generic hydrogen pair.
  - Vega: three solid stages.
  - Long March 2F, Kosmos-3M, LVM3: tank order not found.

### Kits

- **New kits:**
  - `tank_cluster` and `tank_spheres`: the tank slots without a bulkhead choice. `tank_spheres` adds `surge` suppressors (N1 flight 7L).
  - `truss_hotstage`: the heat shield on the dome below the joint, or none (Gemini 10).
- **Slots and options added to existing kits:**
  - `wall` slot in `tank`, `tank_h2`, `tank_common_h2`: integral (neutral), isogrid, orthogrid, waffle.
  - `pogo` option (feed line with a pogo accumulator) in every tank kit.
  - `pmd` option (screen channels) in every baffles slot.
  - `cold_helium`, `internal` (S-IVB internal foam) and `foam_white` options in the hydrogen kits.
  - `cooling` slot in `avionics`: passive (neutral) or cold plates with a sublimator (Saturn IU).
  - `reused_sri` option in the avionics `imu` slot (Ariane 5 flight 501): the cheapest inertial reference (−$100k), the least reliable (−1.2 %).
  - Finishes in the insulation slot (review pass 2): `tiodize` in `tank` (bare aluminium, anodised copper finish: Atlas V) and `foam_tan` in `tank_h2` (sprayed and bonded foam, tan: Delta IV, H-IIA), beside `bare`, `foam` (orange), `foam_white`, `mli` and `internal`.
- **Trade-offs:** every option has a real cost: no option is better in mass, cost and reliability at once (checked for every slot of the body kits).

## Data conventions

- **Colour and finish come only from the insulation option** (lead rule, review pass 2), never from the wall stiffening: `bare`, `foam` (orange), `foam_white`, `foam_tan`, `tiodize` (copper-tan anodised aluminium), `mli` (gold or silver blanket), `internal` (bare metal outside). Shapes set it: Atlas V `tiodize`; Delta IV and H-IIA `foam_tan`; SLS and the Shuttle tank `foam`; Long March 5, Ariane 5 and the Delta IV upper stage's hydrogen tank `foam_white` (its oxygen tank `mli`); S-IVB `internal`; Vulcan `foam`.
- **Materials.** The structure list is Al-Li 2195 (first, the modern default, flown from 1998), Al-Cu 2219, stainless, carbon and titanium. The historic new parts default to `al2219` (`defaultMaterial`): the S-IB and Proton clusters, the N1 spheres, Soyuz Blok A and Blok I, Titan II, PSLV, the Ariane 5 EPC, both Delta IV upper-stage tanks, the forward and aft skirts and both open lattices. Where the real alloy is another pre-Al-Li aluminium (2014 on Titan II and the Saturn upper stages, 7075/V95 skirts and lattices, AMg6 on the Soviet tanks) or was not found, 2219 is the nearest choice on the list. `centerbody_l` defaults to `carbon` (the Delta IV composite centerbody; the shape also sets it). `hotstage_ring_l` has no material family: welded stainless is its identity, like the other steel parts. Effect of 2219: mass ×1.07, cost ×0.8, reliability +0.2 %. The presets do not use these parts.

- **Sizes** follow `src/builder/tools/blender/README.md`: under 2.5 m S, 2.5 to 4.5 m M, over 4.5 m L. So Titan II, PSLV, Soyuz, Atlas V, Zenit and H-IIA are M, and the rest are L. (The earlier `falcon9_s1` and `delta_core` stay L; their ids and numbers are kept.)
- **Heights** keep the real height/diameter where a ship stays under about 25 m. Long stages are shortened along the barrel only; the tallest body is SLS at 18.6 m.
- **Propellant mass** follows the existing tanks per metre of the same size and propellant. It is then corrected for how the real layout fills its outline:
  - the S-IB cluster: 0.76 (tank cross-sections over the envelope);
  - Proton: 0.59;
  - the N1 spheres: from the sphere volumes that fit the cone;
  - storable propellants: ×1.15 for their higher density (Titan II, Proton, PSLV).
- **Dry mass**: the game's propellant/dry ratio is about 0.83 × the real stage's propellant/(dry − engines). That is the factor the existing Falcon 9 tank uses.
- **Storable propellants burn as kerolox** (lead decision D1; contract FUELS has only kerolox, methalox and hydrolox; `data/engines.json` does the same for the Delta II AJ10).
  - Titan II, Proton and PSLV keep the con "Toxic propellants".
  - The kerolox note sits in `detail`.
  - `look.tanks` labels show the real propellants. The PSLV labels stay neutral ("UH25 + N2O4", `look.bulkheadAt` 0.5) because which propellant is on top is not sourced.
- **The Delta IV upper stage** splits its propellant between the two parts by volume, like the Shuttle-tank pair (lead decision D2). `tank_l_lox_hung` says so in its detail.
- **Guidance bonus counts once** (lead decision D3): `avionics_ring_m`, `avionics_iu_l` and `avionics_skirt_l` share `bonusGroup: "guidance"`. So does the Blok I instrument ring (+1 %). The presets carry at most one guidance ring, so their numbers are unchanged.
- **The settling bonus counts once:** `aps_module` and `ullage_motors` share `bonusGroup: "settling"`.
- **Outer skin** (`hullProfile` and `hullSide` in `parts.json`, read by `hull.js`):
  - Tanks, skirts, rings and the open hot-staging lattices are `shell`. A full-diameter lattice stays visible (lead rule).
  - `tank_l_lox_hung` is `inner` (rMax 0.63); the skin closes round it, as the interstage does on the real stage.
  - `tank_l_kerolox_spheres` is an `own` cone from 1.0 R to 0.74 R. Its top meets the M lattice above it at the same radius, so no cone is needed there. The real Block A narrows to 0.61; the N1 Block B taper continues above, which the shape shows with the open lattice as its own part.
  - `tank_m_kerolox_bloka` is an `own` waisted profile (0.73 / 0.8 / 1.0 at the load ring / 0.9 at the top); the skin cones its narrow bottom.
  - `ullage_motors` and `aps_module` ride outside (`hullSide`).
- **Shapes preset options and materials** where the real stage calls for them (stack items `{ type, options, material }`):
  - aluminium 2219 on the S-IC and SLS tanks;
  - isogrid on Atlas V, Delta IV and H-IIA; orthogrid on SLS; waffle on Zenit, Energia and the S-IVB;
  - white foam on Long March 5 and Ariane 5;
  - LOX tunnels on the S-IC, Energia and Zenit; pogo on Titan II; triple computers on SLS.
- **Earlier conventions that still hold:**
  - A separate-dome tank next to another of the same propellant, or next to `intertank_l`, `intertank_m`, `centerbody_m` or `centerbody_l`, is one propellant of a pair.
  - Hydrogen kits start from spray-on foam.
  - Parts whose material is their identity have no `materialFamily`.
  - There is no separation choice: the game flies one stage.

## Balance (each shape on the Reliable nose and tail, one large engine; from the wave 4 build check)

| Shape | Status | Size | Body m | Propellant | Δv m/s | TWR | Ship $k |
|---|---|---|---|---|---|---|---|
| methalox_core | kept | l | 10.2 | 56.0 t | 5520 | 1.37 | 3128 |
| delta_core | text | l | 12.4 | 90.0 t | 5770 | 0.87 | 3447 |
| hydrolox_core | text | l | 17.2 | 43.1 t | 5460 | 1.35 | 4520 |
| falcon9_s1 | text | l | 10.4 | 67.0 t | 5467 | 1.15 | 3155 |
| saturn_sic | rebuilt | l | 16.6 | 108.0 t | 6013 | 0.74 | 3250 |
| saturn_sivb | rebuilt | l | 11.7 | 26.2 t | 4550 | 2.02 | 4986 |
| atlas_balloon | text | m | 9.2 | 57.5 t | 5471 | 1.34 | 3011 |
| soyuz_blok_a | rebuilt | m | 12.5 | 56.0 t | 4916 | 1.32 | 3065 |
| starship_steel | kept | l | 9.2 | 56.0 t | 5473 | 1.37 | 3082 |
| electron_carbon | text | s | 5.6 | 20.0 t | 3252 | 3.03 | 2846 |
| centaur_balloon | text | m | 9.6 | 19.7 t | 4345 | 2.62 | 3681 |
| saturn_sii | new | l | 12.0 | 26.2 t | 4636 | 2.04 | 4106 |
| saturn_ib_sib | new | l | 9.4 | 54.0 t | 4563 | 1.33 | 2817 |
| titan_ii | new | m | 8.6 | 62.0 t | 5354 | 1.23 | 2811 |
| sls_core | new | l | 18.6 | 43.1 t | 5277 | 1.33 | 4657 |
| dcss_icps | new | l | 8.2 | 16.8 t | 3757 | 2.81 | 3622 |
| atlas_v_ccb | new | m | 11.2 | 62.5 t | 5227 | 1.21 | 3154 |
| delta_iv_cbc | new | l | 17.0 | 43.1 t | 5572 | 1.37 | 4951 |
| h2a_s1 | new | m | 9.2 | 17.5 t | 3674 | 2.66 | 3775 |
| long_march_5 | new | l | 17.2 | 43.1 t | 5501 | 1.36 | 4489 |
| energia_core | new | l | 17.2 | 43.1 t | 5524 | 1.36 | 4642 |
| zenit_s1 | new | m | 11.2 | 62.5 t | 5241 | 1.21 | 3113 |
| pslv_ps2 | new | m | 8.0 | 54.5 t | 4974 | 1.36 | 2765 |
| soyuz_blok_i | new | m | 6.5 | 31.5 t | 3818 | 2.10 | 2796 |
| proton_s1 | new | l | 10.0 | 45.0 t | 4525 | 1.59 | 2814 |
| n1_blok_a | new | l | 6.9 | 18.0 t | 2918 | 3.16 | 2708 |
| super_heavy | new | l | 10.0 | 56.0 t | 5343 | 1.35 | 3142 |
| vulcan_booster | new | l | 10.4 | 64.0 t | 5785 | 1.22 | 3161 |
| ariane5_epc | new | l | 11.6 | 28.0 t | 4859 | 1.96 | 3629 |

- Reliable, Workhorse, Cold Morning and Thin Skin keep exactly the same cost, masses, Δv, TWR and reliability.
- The N1 cone holds only 18 t: the real lesson of spheres in a cone.
- Upper stages (S-II, S-IVB, ICPS, Blok I) hold what upper stages hold.

## For the body modeller (stage 2)

**Models.** All 20 models exist in `public/assets/models/builder/body/` (commit 3ce7d9f) and the 20 parts carry `"model": { "builder": "body/<slug>" }`. The table below is what they were built to.

| Slug | Part | Size, height | Real | Generator |
|---|---|---|---|---|
| `body/sib_cluster` | `tank_l_kerolox_cluster` | L r 1.6875, 8.6 m | S-IB: centre 2.67 m, eight 1.78 m tanks on a 6.53 m envelope; spider beam on top | cluster |
| `body/proton_cluster` | `tank_l_storable_cluster` | L, 8.0 m | centre 4.1 m, six 1.6 m tanks, 7.4 m across | cluster |
| `body/n1_block_a` | `tank_l_kerolox_spheres` | L base, top r 1.25, 6.0 m | cone 16.9 m to 10.3 m, kerosene sphere above a larger LOX sphere | profiled shell |
| `body/soyuz_block_a` | `tank_m_kerolox_bloka` | M, 11.0 m, own waisted profile | 2.95 m at the load ring | profiled shell |
| `body/soyuz_block_i` | `tank_m_kerolox_bloki` | M, 5.6 m | 2.66 m; kerosene, instrument band with six hatches, LOX | tank barrel |
| `body/titan2_tanks` | `tank_m_storable_titan` | M, 8.6 m | 3.05 m; white with black roll bands, UNITED STATES | tank barrel |
| `body/pslv_ps2` | `tank_m_storable_ps2` | M, 8.0 m | 2.8 m; common bulkhead, toroidal water tank | tank barrel |
| `body/ariane5_epc` | `tank_l_hydrolox_epc` | L, 9.6 m | 5.4 m; LOX over LH2, common bulkhead, white | tank barrel |
| `body/dcss_lh2` | `tank_l_lh2_upper` | L, 5.4 m | 5.1 m; white barrel with cream rings | tank barrel |
| `body/dcss_lox` | `tank_l_lox_hung` | L, inner r 1.06, 2.0 m | 3.2 m LOX tank, lengthened on the 5 m stage, silver blanket, black composite truss, red bottles | ring/skirt |
| `body/vulcan_tank` | `tank_l_methalox_orthogrid` | L, 9.6 m | 5.4 m; LOX over LNG, orange foam over orthogrid | tank barrel |
| `body/centerbody_l` | `centerbody_l` | L, 1.4 m | Delta IV composite centerbody, swing-arm plates | ring/skirt |
| `body/forward_skirt_l` | `forward_skirt_l` | L, 1.2 m | S-IC corrugated / S-II hat stringers | ring/skirt |
| `body/aft_skirt_l` | `aft_skirt_l` | L, 1.0 m | S-IVB / S-II aft skirts | ring/skirt |
| `body/sls_forward_skirt` | `avionics_skirt_l` | L, 1.4 m | SLS forward skirt, flight-computer racks | ring/skirt |
| `body/truss_hot_m` | `hotstage_truss_m` | M, 0.9 m | Soyuz and N1 open lattice | truss |
| `body/truss_hot_l` | `hotstage_truss_l` | L, 1.2 m | Proton V95 lattice | truss |
| `body/hotstage_ring` | `hotstage_ring_l` | L, 0.8 m | Super Heavy vented ring, stainless | ring/skirt |
| `body/sivb_aps` | `aps_module` | side, 0.9 m | S-IVB APS: 3 attitude thrusters + 1 ullage engine | side hardware |
| `body/ullage_motor` | `ullage_motors` | side, 1.0 m | TX-280 class solid, canted 10° | side hardware |

**Inner pieces.**
- Each model carries its own `slot_<key>` pieces, with option variants named `slot_<key>__<optionId>`.
- There is no shared library: code-drawn tanks keep the code-drawn pieces.
- Dimensions, colours and reference images for every model are in the wave 4 `models.md` and `refs/`.

**What `art.js` needs** (stage 2; not edited in the data pass):
- New `look` fields:
  - `look.build` values `cluster` (with `outer`, `center`, `ring`: the number of outer tanks and their sizes as fractions of the radius) and `spheres`.
  - `look.skin: "blanket"` (the silver-wrapped LOX tank).
  - `look.bulkheadAt` (PSLV).
- New slot art keys: `grid` (wall stiffening), `coldplate` (avionics cooling), `shield` (hot-staging heat shield).
- `centerbody_l` in the `BETWEEN` set, with the LOX tank above (`look.fuelAbove: false`).
- The finish follows the insulation option only (see Data conventions): `foam` orange, `foam_white` white, `foam_tan` tan, `tiodize` copper-tan bare aluminium, `mli` blanket, `internal` and `bare` bare metal. The wall option (`isogrid`, `orthogrid`, `waffle`) changes only the rib pattern, never the colour.

**Shapes that share tanks must look different:**

| Shared parts | Shapes | What differs |
|---|---|---|
| `tank_l_hydrolox` + `intertank_l` + `tank_l_hydrolox_stretch` | `hydrolox_core`, `long_march_5`, `energia_core` | ET: orange foam, external LOX line, cable tray. LM-5: white foam, one long duct. Energia: no outside line (LOX tunnel), waffle LH2 wall; check photos for its enamel colour |
| the same with `avionics_skirt_l` on top | `sls_core` | orthogrid under orange foam, two LOX lines on opposite sides |
| `tank_l_hydrolox` + `centerbody_l` + `tank_l_hydrolox_stretch` | `delta_iv_cbc` | dark composite centerbody, isogrid under orange foam, LOX line beside the wiring tunnel |
| `tank_m_hydrolox` + `intertank_m` + `tank_m_hydrolox` | `h2a_s1` | orange-brown foam, pale ribbed center-body band, thin raceway |
| `tank_m_kerolox_stretch` + `intertank_m` + `tank_m_kerolox` | `atlas_v_ccb`, `zenit_s1` | Atlas V: bare isogrid aluminium with the copper-tan anodised finish of the CCB, no foam, LOX line and avionics pod on the RP tank. Zenit: grey waffle, nothing outside |
| `forward_skirt_l` + kerolox L tanks + `intertank_l` | `saturn_sic` | corrugated skirt and intertank, white with the black roll pattern |
| `tank_l_hydrolox_common` | `saturn_sii`, `saturn_sivb` | S-II: forward skirt, systems tunnel, insulation outside. S-IVB: Instrument Unit, insulation inside, APS pods, waffle wall |

## Main sources

Each shape lists its own URLs in `section.json`. The ones relied on most:
- McCutcheon's Saturn stage pages on enginehistory.org: RPE08.10 (S-IC), RPE08.20 (S-II), RPE08.30 (S-IVB), RPE08.31 (IU), RPE07 (Saturn I/IB), RPE06 (Titan), RPE05 (Atlas).
- NASA image library cutaways 0100981, 9801810, 0100983, 0100984, 0100801 and 9801795.
- NASA fact sheets: Shuttle Super Lightweight Tank, SLS core stage, ICPS.
- ULA user's guides: Atlas V 2010, Delta IV 2013, Vulcan.
- Ariane 5 User's Manual (Issue 5) and ESA pages.
- Arianespace Soyuz user's manual (2012).
- MHI H-IIA user's manual.
- RussianSpaceWeb: Soyuz, Proton, N1.
- B.I. Gubanov on buran.ru: Energia, Zenit.
- Wikipedia for figures that other sources did not give.

## Not confirmed (kept out of player text)

- The PSLV second stage tank order.
- The Soyuz Block A waist and top diameters (only the 2.95 m maximum is sourced).
- The N1 sphere diameters.
- Why the Vulcan and H-IIA cores look orange (seen in photos; not named in documents).
- Whether the Long March 5 and Ariane 5 white is paint or a foam topcoat.
- The Energia enamel colour.
- The Super Heavy vented-ring vent count and mass.
- Dry masses where sources disagree (S-II, S-IVB, Titan II, SLS, N1).
- The S-IVB waffle angle.
