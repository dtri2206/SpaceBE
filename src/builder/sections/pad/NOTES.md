# Launch pad section: notes

Owner: the pad agent (Role 1). The pad is the ground hardware under the rocket at a real launch complex (decided
2026-11-07, `src/builder/CLAUDE.md` section 6): no date picking. Wave 4 (2026-11-07) brought it to 31 real complexes
across nine regions and eight new pieces of equipment, with sizes from the ratio rules of
`src/builder/tools/blender/README.md` ("Ground models"). Files:

| File | What |
|---|---|
| `section.json` | `sites` = the 31 launch complexes (each with `region`, `years`, `kit`, `climate`, `scale`, `fee`, `holdFee`, `designKN`, `aliases`, `look`, facts), `equipment` = the 8 kinds of ground hardware (36 options), each option with its physical numbers |
| `effects.js` | `padSetup`, `complexOf`, `kitFee`, `heatLimitOf`, `liftoffOn`, `padEffects` (pure, Node-tested) |
| `../../weather.js` | `weatherFor`: launch-day forecast, actual temperature, HOLD fees (pure) |
| `../../designPad.js` (+ `designPad.css`) | the Launch pad card (region headings in the complex list, `REGION_NAMES`) |
| `art.js` | the pad under the ship, each complex's look, the card pictures (`icon`, `only`), `PAD_MODELS` and `padModelIds` (the Blender models) |
| `explain.json` | `pad:<id>`, `equip:<key>`, `equip:<key>/<option>` in English and Vietnamese |
| `../../tests/pad.test.mjs` | `node src/builder/tests/pad.test.mjs` |

`createSections` (sections.js) keeps only `sites` and `equipment` of this folder's `section.json`, so every number lives
on a complex or an option; the model constants are named exports of `effects.js`.

## The 31 complexes

In `section.json` order, region by region; within a region the strong pads first and the small historic ones last.
SLC-40 stays first: the default complex and the tests' first site. Historic pads are offered as they were (`years`).

- **United States:** SLC-40, LC-39A (Apollo kit), LC-39B (Artemis), Starbase Pad 1 (2023–2025), Starbase Pad 2 (2026),
  SLC-41, SLC-4E, LC-34 (Saturn I/IB, Apollo 1 and 7), SLC-17 (Delta II, the Mars rovers), Wallops Pad 0A (Antares),
  LC-19 (Gemini), LC-14 (Mercury-Atlas).
- **Russia and Kazakhstan:** Baikonur Site 110 (N1, Energia-Buran), Baikonur Site 81 (`site81`, Proton), Gagarin's Start,
  Vostochny Site 1S, Plesetsk Site 43.
- **Europe, at Kourou:** ELA-4 (Ariane 6), ELA-3 (Ariane 5), ELS (Soyuz).
- **China:** Wenchang LC-101, Xichang LC-2, Jiuquan LC-43/921 (Shenzhou).
- **Japan:** Yoshinobu LA-Y1, Uchinoura M pad (Nozomi, Hayabusa). **India:** Sriharikota FLP (Mangalyaan).
  **South Korea:** Naro LC-2 (Nuri). **Brazil:** Alcântara VLS pad.
- **Pacific Ocean and New Zealand:** Sea Launch Odyssey, Rocket Lab LC-1, Omelek Island (Falcon 1).

## Where a choice comes from

- `assembly.launch` = `{ site, day, seed?, pad: { key: optionId }, forecast?, repairDue? }`.
  - `site` is the complex id (the old field name, so `sections.padState` and old saves keep working).
  - `pad` holds only the player's own choices; everything else comes from the complex's `kit` (`padSetup`).
  - Choosing a complex on the card resets `pad`, `day`, `forecast` and the old `slot`.
- Old saves: an old `site` id lands on a complex through `aliases` (`cape` → SLC-40, `vandenberg` → SLC-4E, `kourou` →
  ELA-3, `baikonur` → Gagarin's Start, `proton` → Baikonur Site 81). Since wave 4 the old id `plesetsk` is a complex of
  its own (it used to land on Gagarin's Start). `starbase`, `wenchang`, `tanegashima`, `mahia` keep their ids; an
  unknown or missing one lands on the first complex (SLC-40). The old `slot: 'cold'` (Cape's free cold window,
  `data/launch.json` `legacyFront`) becomes a 2 °C cold front on day 0; the other old slot ids mean nothing now.
  Every old equipment id still exists.
- `spec.launch` = `{ tempC (the forecast), complex, site, day, pad }`. asBuilt.js flies `actualC` at confirm.

## Heat limit and the four consequences (effects.js)

```
heatLimitKN = mount.heatKN × complex.scale × (deluge.heatF + mount.waterPlate if there is water)
r = thrustSL / heatLimit;  excess = max(0, r − 1)
throttle   = max(1 / r, MIN_THROTTLE 0.6, 1.15 · m·g / thrustSL)   (only when excess > 0; m, g passed by stats.js)
residual   = max(0, r · throttle − 1)            still over the limit at that throttle
overload   = residual + DOSE_SHARE 0.5 × (excess − residual)
(a) liftoffLossMps = g × CLEAR_S 7 s × (1 − throttle)          (no g from the caller: throttle 1, no loss, full overload)
(b) damageChance   = min(0.5, 0.25 × overload × mount.debris × deluge.debrisF)
(c) repairFee      = min($280k, $250k × overload × mount.repair × deluge.debrisF × (1 + 0.25 × tower.exposure)), ≥ $5k, in $5k steps
(d) holdDownCatch  = clamps.catch (any bad engine, debris-hurt or built badly; asBuilt.js rolls it)
reliability  = Σ option.reliability − min(1.5 %, 0.4 % per 1,000 kN × deluge.acousticF)
lightningRisk = day lightning × (0.5 × lightning.strikeF + 0.5 × weather.triggerF)
fee = complex.fee + Σ option.fee + weather.fee (days of HOLD) + launch.repairDue
```

Why these shapes (unchanged since wave 3): the jet's power is ½·F·vₑ, so the heat and the sound a pad takes grow with
thrust; a mount and trench are designed for a thrust. g always comes from the caller (no gravity literal). Held back
for the first seconds, the ship climbs slower and fights gravity longer: g · t · (1 − throttle) of Δv. The overload
keeps half its heat dose. Damage and repairs are deliberate game values (STS-124 tore 3,500 bricks from LC-39A's trench
in 2008, about $2.5 M; Starship's first flight cratered Starbase in 2023). Water soaks up heat, sound and loose concrete
(STS-1's overpressure in 1981). Hold-down: the Saturn V's arms let go once all five F-1s were at full thrust; the
Shuttle shut down on the pad five times. The clamps count once: as the catch, not also as reliability. The board line
for the clamps comes from the option (`clamps.holdLine`, `{holdS}` = its seconds): the Soyuz support arms are not
clamps (`holdBy: 'weight'`).

### Calibration (about one tenth of each pad's design thrust)

The game's ships are about a tenth of the real rockets (Reliable: 70 t and 943 kN), so each kit's heat limit is about a
tenth of the liftoff thrust of the rocket the pad was built for (`designKN`; pad.test checks 0.08–0.14 for all 31).
SLC-40 is kept a little higher than its Titan IV-B (about 15 MN) so Workhorse fits. Mount base values: slab 320,
raised 900, flame pit or bucket 1,550, trench 1,700, mobile platform 2,000 kN. With their own kits, through
`computeShipSpec` (the presets on each complex):

| Complex | Region · years | Kit fee | Heat limit | Design thrust | Reliable | Workhorse | Day of HOLD |
|---|---|---|---|---|---|---|---|
| SLC-40 | usa · 1965– | $180k | 2,055 kN | 15,000 kN | full thrust | full thrust | $21k |
| LC-39A | usa · 1967– | $283k | 3,806 kN | 34,500 kN | full thrust | full thrust | $45k |
| LC-39B | usa · 1969– | $280k | 3,913 kN | 39,140 kN | full thrust | full thrust | $41.25k |
| Starbase Pad 1 | usa · 2023–2025 | $255k | 7,547 kN | 75,000 kN | full thrust | full thrust | $15k |
| Starbase Pad 2 | usa · 2026– | $265k | 9,068 kN | 90,600 kN | full thrust | full thrust | $15k |
| SLC-41 | usa · 1965– | $205k | 1,794 kN | 17,000 kN | full thrust | full thrust | $30k |
| SLC-4E | usa · 1964– | $137k | 1,591 kN | 15,900 kN | full thrust | 92 %, −5.4 m/s, 1 % damage, $10k | $21k |
| LC-34 | usa · 1961–1968 | $143k | 712 kN | 7,120 kN | 84 %, −11.2 m/s, 4 % damage, $50k | 92 %, −5.4 m/s, 27 % damage, $280k | $26.25k |
| SLC-17 | usa · 1957–2011 | $168k | 405 kN | 4,050 kN | 84 %, −11.2 m/s, 12 % damage, $150k | 92 %, −5.4 m/s, 34 % damage, $280k | $22.5k |
| Wallops Pad 0A | usa · 2013– | $192k | 384 kN | 3,844 kN | 84 %, −11.2 m/s, 6 % damage, $85k | 92 %, −5.4 m/s, 15 % damage, $225k | $18.75k |
| LC-19 | usa · 1959–1966 | $120k | 191 kN | 1,910 kN | 84 %, −11.2 m/s, 37 % damage, $280k | 92 %, −5.4 m/s, 50 % damage, $280k | $18.75k |
| LC-14 | usa · 1957–1966 | $140k | 159 kN | 1,600 kN | 84 %, −11.2 m/s, 47 % damage, $280k | 92 %, −5.4 m/s, 50 % damage, $280k | $25k |
| Baikonur Site 110 | russia · 1969–1988 | $213k | 3,501 kN | 35,000 kN | full thrust | full thrust | $30k |
| Baikonur Site 81 | russia · 1965– | $123k | 1,000 kN | 10,000 kN | full thrust | 92 %, −5.4 m/s, 12 % damage, $155k | $22.5k |
| Gagarin's Start | russia · 1957–2019 | $108k | 449 kN | 4,000 kN | 84 %, −11.2 m/s, 16 % damage, $200k | 92 %, −5.4 m/s, 49 % damage, $280k | $22.5k |
| Vostochny Site 1S | russia · 2016– | $146k | 400 kN | 4,000 kN | 84 %, −11.2 m/s, 20 % damage, $255k | 92 %, −5.4 m/s, 50 % damage, $280k | $26.25k |
| Plesetsk Site 43 | russia · 1965– | $105k | 400 kN | 4,000 kN | 84 %, −11.2 m/s, 20 % damage, $255k | 92 %, −5.4 m/s, 50 % damage, $280k | $18.75k |
| ELA-4 | europe · 2024– | $245k | 1,958 kN | 19,600 kN | full thrust | full thrust | $37.5k |
| ELA-3 | europe · 1996–2023 | $220k | 1,504 kN | 14,000 kN | full thrust | 92 %, −5.4 m/s, 1 % damage, $5k | $37.5k |
| ELS | europe · 2011–2022 | $165k | 400 kN | 4,000 kN | 84 %, −11.2 m/s, 20 % damage, $255k | 92 %, −5.4 m/s, 50 % damage, $280k | $30k |
| Wenchang LC-101 | china · 2016– | $245k | 1,088 kN | 10,620 kN | full thrust | 92 %, −5.4 m/s, 2 % damage, $35k | $30k |
| Xichang LC-2 | china · 1990– | $130k | 592 kN | 5,923 kN | 84 %, −11.2 m/s, 5 % damage, $70k | 92 %, −5.4 m/s, 20 % damage, $280k | $18.75k |
| Jiuquan LC-43/921 | china · 1999– | $188k | 590 kN | 5,900 kN | 84 %, −11.2 m/s, 3 % damage, $55k | 92 %, −5.4 m/s, 11 % damage, $210k | $22.5k |
| Yoshinobu LA-Y1 | japan · 1994– | $180k | 988 kN | 9,900 kN | full thrust | 92 %, −5.4 m/s, 4 % damage, $65k | $30k |
| Uchinoura M pad | japan · 1962– | $93k | 378 kN | 3,780 kN | 84 %, −11.2 m/s, 23 % damage, $280k | 92 %, −5.4 m/s, 50 % damage, $280k | $20k |
| Sriharikota FLP | india · 1993– | $157k | 768 kN | 7,680 kN | 84 %, −11.2 m/s, 1 % damage, $15k | 92 %, −5.4 m/s, 13 % damage, $160k | $18.75k |
| Naro LC-2 | korea · 2009– | $153k | 294 kN | 2,942 kN | 84 %, −11.2 m/s, 20 % damage, $280k | 92 %, −5.4 m/s, 50 % damage, $280k | $22.5k |
| Alcântara VLS pad | brazil · 1990– | $98k | 121 kN | 1,212 kN | 84 %, −11.2 m/s, 50 % damage, $280k | 92 %, −5.4 m/s, 50 % damage, $280k | $20k |
| Sea Launch Odyssey | pacific · 1999–2014 | $115k | 725 kN | 7,250 kN | 84 %, −11.2 m/s, 2 % damage, $25k | 92 %, −5.4 m/s, 14 % damage, $175k | $33.75k |
| Rocket Lab LC-1 | pacific · 2016– | $80k | 22 kN | 224 kN | 84 %, −11.2 m/s, 50 % damage, $280k | 92 %, −5.4 m/s, 50 % damage, $280k | $9k |
| Omelek Island | pacific · 2006–2009 | $85k | 41 kN | 410 kN | 84 %, −11.2 m/s, 50 % damage, $280k | 92 %, −5.4 m/s, 50 % damage, $280k | $30k |

18 of 31 complexes hold Reliable back, so 13 take it at full thrust; only 8 take Workhorse at full thrust (SLC-40,
LC-39A, LC-39B, both Starbase pads, SLC-41, Site 110, ELA-4). The small historic pads were built for small rockets. LC-39A stays the dearest kit ($283k), Rocket Lab LC-1 the
cheapest ($80k), Starbase Pad 2 takes the most fire, LC-1 the least. Reliable and Workhorse launch from SLC-40 for $180k
(the crew escape chute added $8k in wave 4). Fees are game values: complex $10k–$50k ($140k at Starbase, renting
SpaceX's own site), options $3k–$65k, hold $15k–$60k a day × the propellant loading's `holdF`.

## Equipment added in wave 4 (real basis; numbers are game values)

- **clamps `tulip`** (support arms): the R-7/Soyuz rocket hangs by its sides in four arms over the pit and is not
  bolted down; the engines burn about 17 s through preliminary and intermediate stages before the thrust passes the
  weight, then counterweights swing the arms back (RussianSpaceWeb, ESA). catch 0.35, holdS 17, `holdBy: 'weight'`.
  Gagarin's Start, Plesetsk, Vostochny and ELS use it.
- **tower `tsm`** (tail service masts): Shuttle platforms 2 × 9.4 m, Saturn V launchers 3, SLS ML-1 2 × ~10 m.
- **tower `gantry`** (swing-up service gantry): two halves raised round the Soyuz and lowered about 45 min before
  launch (RussianSpaceWeb). Reliability 0.0045 (below the fixed tower: no option is a plain loss, pad.test).
- **tower `mst`** (mobile service tower): Vostochny (about 50 m, 1,600 t, 12 m/min), ELS (52 m, 80 m rollback), ELA-4
  (89 m, 8,200 t, 120 m rollback), SLC-17 (126 ft), Sriharikota FLP (3,200 t). The catch tower's reliability rose to
  0.006 in wave 4 so it is no plain loss against the fixed tower.
- **access `chute`**: SpaceX's SLC-40 crew tower chute, tested 26 February 2024. **access `blastroom`**: Apollo LC-39's
  express lifts, slide tube, rubber ramp and blast room 12 m under the pad (Moonport, NASA SP-4204); reliability 0.005.
- **deluge `iop`**: Pad 39B's ignition overpressure and sound suppression (about 400,000 gal, under 30 s); the water
  troughs added after STS-1.
- **lightning `rod`**: the lightning rod on Starbase's tower.
- Changed texts: `mount/deflector` (now the one-way pit or bucket: Gagarin's pit, Pad 39B's 2018 ramp, Starbase Pad 2's
  steel flame diverter), `mount/trench`, `mount/mlp` (no more 870 t Ariane table: unconfirmed), `access/slidewire`
  (Artemis: four baskets, 1,335 ft cables, armoured vehicles).
- `access.escape` (crewEscape) is shown on the card; nothing in the game rolls a pad emergency yet. The fuel-farm effect
  (a farm that stores only some propellants) is not in the game (the lead's decision, wave 4).

## Weather (weather.js)

- Climate of each complex: a January day (a northern-winter Mars window; summer at Mahia): `meanC`, `swingC` (day-to-day
  spread), `windKts`, `windSwingKts`, `lightning` (chance of lightning near the pad), `sky`. January normals 1991–2020
  where a station table exists (NOAA, Météo-France, CMA, JMA, KMA, IMD, INMET via the Wikipedia climate tables): Cape
  16 °C (Titusville 15.3), Wallops 3.3, Starbase 17, Vandenberg 12, Baikonur −9.6, Vostochny −24.4 (Svobodny), Plesetsk
  −12.5 (RETScreen), Kourou 26.6 (ELA-3 keeps 26.6 since wave 4), Jiuquan −10.4 (Ejin Banner), Xichang 10.2, Wenchang
  18.7, Tanegashima 11, Uchinoura 7.5 (Kanoya), Sriharikota 25.5 (Nellore), Naro 1.6 (Goheung), Alcântara 27.6 (São
  Luís), Kwajalein 27.4, Sea Launch 27 (Kiritimati), Mahia 18. Winds and lightning chances are game values.
- Forecast: `meanC + anomaly`, the anomaly carrying over from day to day (`anomaly(d) = 0.6 · anomaly(d−1) + swing ·
  0.8 · noise`, an AR(1) chain).
- `actualC = forecastC + clamp(errorC · noise, ±2 · errorC)`. `errorC` from the weather watch: 3 °C (look at the sky),
  1.5 °C (balloons), 0.6 °C (radar and field mills).
- noise = a bell curve of four hashed uniforms (`fnv` + `mulberry32`) of complex id, day, `launch.seed` and a channel:
  the same save always gets the same weather; no random calls.
- `launch.forecast` = `{ day, tempC, windKts?, lightning?, label?, seed? }` fixes one day (Cold Morning: a 2 °C cold front
  on day 0). It belongs to one campaign: once `launch.seed` moves on (index.js after a flight) the climate rules again.
- HOLD: `launch.day + 1`. `holdFee` = complex.holdFee × propellant.holdF; `fee` = holdFee × day, paid at confirm.

Presets: Reliable, Workhorse and Thin Skin launch from SLC-40 on day 0. Cold Morning launches from SLC-40 with every
piece of equipment at its cheapest (a skimped pad, so its LOW_RELIABILITY stays) on a 2 °C cold front with no weather
watch: the actual temperature comes out below freezing, as the Cold Morning ending says.

## Art (art.js): the ratio rules

Sizes follow `src/builder/tools/blender/README.md` ("Ground models"), with H = the ship's height and D = its width:

| Piece | Size in art.js | Real basis |
|---|---|---|
| Service tower (`fixed`, `rss`) | top 1.10 × H above its deck (`look.towerH`: LC-34 0.95 × H above the pedestal) | Saturn V tower 116 m / 110.6 m; ML-1 ~105 m above its deck / SLS 98 m |
| Catch tower | mount top + 1.05 × H | Starbase 146 m beside a 121–124 m Starship |
| Strongback | 1.02 × H | Falcon 9 |
| Soyuz gantry | two halves 0.95 × H, swung 18° back | photos (no published height) |
| Mobile service tower | 3 × D square, 1.15 × H tall, rolled back on rails | Vostochny 48 m and 24.5 m square / Soyuz 46 m |
| Tower width, distance | 1.3 × D wide (2.2–5 m), its face about 1 × D off the hull | Saturn 12.2 m / 10.1 m; ML-1 12.2 m / 8.4 m |
| Opening under the ship | 1.2 × D | Saturn launcher 14 m / 10.1 m; LC-34 7.9 m / 6.6 m |
| Launch ring or table | 1.9 × D outside | LC-34 pedestal 13 m / 6.6 m |
| Mobile platform deck | 3 × D across (longer on the tower side when a launch umbilical tower rides on it), 0.75 × D high on 0.65 × D pedestals | 49 × 41 × 7.6 m on 6.7 m / 10.1 m |
| Flame trench | 1.9 × D wide, pad 1.2 × D above its floor | LC-39: 18 m, 12 m / 10.1 m |
| Tail service masts | 1.15 × D on a deck | Shuttle 9.4 m / 8.4 m; ML-1 ~10 m |
| Raised mount | 1.2–2.2 × D tall by the complex's scale | LC-34 8 m / 6.6 m; Starbase ~20 m / 9 m |

New pieces in wave 4: tail service masts with their hoods and hoses, the Soyuz support arms drawn from `clamps = tulip`
(on any mount; their counterweights hang below the ring where there is room), four support posts at the rim when there
are no clamps, the swing-up gantry, the rolled-back mobile service tower (the crew stair tower then stands at −70°),
the escape chute (packed; deployed in its own card picture), the blast room's slide tube and entrance, water bags over
the opening (`iop`), the lightning rod (on the tallest tower, else on a pole), ten new grounds (`wallops`, `gobi`,
`xichang`, `sriharikota`, `naro`, `alcantara`, `atoll`, `kagoshima`, `amur`, `ocean`: Sea Launch stands on a steel deck
on the sea) and the tower colour `grey` (`TOWER`). Far-field gear (water tower, lightning towers, spheres, radar) keeps
its wave-3 placement. The crawlerway ramp at a mobile platform starts at the hardstand's edge and its lanes stop inside
the ground disc.

## Blender models (wave 4; `PAD_MODELS` and `padModelIds` in art.js)

25 ground models, `public/assets/models/builder/pad/<id>.glb`, about 1.5 MB in all (cap 12 MB), built by
`src/builder/tools/blender/pad/build.py` (`padlib.py`, `mounts.py`, `towers.py`, `farfield.py`, `ml1.py`), which also
writes `pieces.json` there: each piece's anchor, scaling, nodes, triangles and size. Every piece is built for the
reference ship (20 m × 2.5 m) and stays within 20,000 triangles and 400 KB. Credits: `ASSETS.md`.

How art.js uses them: `padArt` asks `bay/nasa.js` `loadGroundModel` for the files the complex needs (each file once,
only when that complex is shown; never for card pictures, `icon`), draws the code pieces meanwhile, and when the files
have arrived draws again and swaps the contents of the same group in place (keeping the studio's dim and tint). A
missing file keeps the code piece. Every placement keeps the code's numbers (hardstand height, deck, `top`, tower top),
so the ship never moves when a model arrives. Scaling follows the README: mounts uniformly by D / 2.5 (their height
fitted to the code's `top`), towers' `body` in height to the ratio rule with `head` carried to the top, arms and clamps
posed and stretched to the hull, far-field gear (built at real size) drawn at the size the code gives it, its pipes
toward the pad. A hardstand (node `hardstand`) does not cast shadows on itself.

Anchors: a mount, deck or table on the rocket's axis on the ground (y = 0); a tower at the centre of its base, its
face toward the rocket on −X (the gantry: one half; the MST: its centre, the ship's axis when closed round it); far-field
pieces at the centre of their base. Named nodes: `attach_*` points the art uses, `pose_*` moving parts on their pivots.

| Model id | Piece (real basis) | Used for | Nodes the art uses | Tris, KB |
|---|---|---|---|---|
| `pad/slab` | concrete slab with its scorch | mount `slab` | `hardstand`, `attach_deck` | 520, 43 |
| `pad/trench` | raised hardstand 1.2 D, trench 1.9 D wide, brick walls, the launch table over it | mount `trench`; under `mlp` (no table) | `table`, `deflector_wedge` (LC-39A, LC-34 style) or `deflector_ramp` (Pad 39B, 2018), `hardstand` | 2,130, 86 |
| `pad/mount_raised` | Starbase Pad 1: six legs, table with 20 clamps, booster QD, water-cooled plate | mount `raised` (Starbase, LC-1, Omelek) | `plate` (hidden without water), `hardstand` | 3,440, 61 |
| `pad/mount_olm2` | Starbase Pad 2: square mount on four legs over a dug trench, diverter | mount `deflector` at `starbase2` | `hardstand` | 1,224, 77 |
| `pad/pedestal_lc34` | LC-34's concrete pedestal, open on four sides, eight arms, wedge deflector on rails | mount `raised` at `lc34` | `holddown` (hidden: clamps fit the ship), `deflector_wedge` | 1,514, 44 |
| `pad/pit` | Gagarin's Start: platform at the pit's edge, steel-faced slope, green ring on four legs | mount `deflector` (every other complex) | `attach_ring`, `hardstand` | 900, 48 |
| `pad/mlp_saturn` | Saturn V mobile launcher base, its tower stands on the deck | mount `mlp` with a fixed tower riding on it (LC-39A) | `attach_tower`, `holddown` and `tsm` (hidden) | 2,188, 50 |
| `pad/mlp_shuttle` | Shuttle-era platform: three holes, rainbirds, posts | mount `mlp` otherwise (SLC-41, Tanegashima; Wenchang and Jiuquan, whose platforms roll to fixed towers at the pad, `TOWER_AT_PAD`) | `rainbirds`, `posts` and `tsm` (hidden) | 3,428, 58 |
| `pad/ml1` | NASA's Mobile Launcher 1 (public domain), cut at its deck into `base` (ends within 1 m of the deck; `ml1.py` checks it) and `tower` | mount `mlp` at `lc39b` (brings its own tower) | `base`, `tower` (stretched to 1.10 H), `attach_tower` | 19,296, 197 |
| `pad/table_ela3` | Ariane 5's launch table on its pad over the flame duct, two yellow masts | mount `mlp` at `ela3` | `masts`, `hardstand` | 4,600, 119 |
| `pad/holddown` | Falcon-style clamp, Saturn V hold-down arm (each base, column, head), SLS post, tail service mast | clamps `hold` / `release`; the TSMs | `clamp_*`, `arm_saturn_*` (column stretched to the grip height), `tsm` | 896, 28 |
| `pad/tower_fixed` | umbilical tower 1.3 D wide, floors, stairs, lift, hammerhead crane, three swing arms | tower `fixed`, `rss` | `body` (1.10 H), `head` (grows with the tower), `pose_arm_1` (copied to each fitted arm), `top_mast` (hidden: the lightning mast on a tower is 0.12 H), `paint` recoloured | 7,694, 98 |
| `pad/rss` | the Shuttle's rotating service structure on its hinge column | tower `rss` (beside `tower_fixed`) | `pose_rss` (swung −120°), `rail` | 1,732, 42 |
| `pad/catch_tower` | Starbase tower, carriage, chopsticks, ship QD arm, rod | tower `catch` (the whole tower, rod included, mount top + 1.05 H) | `body`, `head`, `pose_carriage`, `pose_chopstick_a/b`, `pose_arm_qd` | 3,466, 57 |
| `pad/strongback` | Falcon 9 transporter-erector: frame, clamps, lines, pistons | tower `strongback` | `pose_frame` (leaned 4°), `body`, `pose_clamp_1..3` | 2,604, 29 |
| `pad/soyuz_gantry` | one half of the Soyuz service gantry, green, yellow floors | tower `gantry` (two copies) | whole, in the code's turned and tilted frame | 2,140, 32 |
| `pad/mst` | enclosed mobile service tower, clad, doors, bogies | tower `mst` | `pose_door_a/b` (swung open) | 4,336, 46 |
| `pad/soyuz_launcher` | the four Soyuz support arms with counterweights | clamps `tulip` | `pose_arm_1` (copied, turned and scaled to the ship's side) | 3,344, 70 |
| `pad/crew_arm` | crew access arm: enclosed walkway and white room | every access option | `pose_arm`, `walkway` (stretched), `white_room` | 544, 14 |
| `pad/egress` | Artemis slidewire basket, landing-zone bunker | access `slidewire`, `blastroom` | `basket` (four, on the wires), `bunker` | 504, 26 |
| `pad/water_tower` | Pad 39B's water tower (88.8 m real) | deluge `tower`, `iop` | whole | 2,144, 34 |
| `pad/lightning_tower` | Pad 39B's catenary tower (184 m real) | lightning `mast`, `catenary` | whole; wires by code | 3,874, 50 |
| `pad/sphere`, `pad/sphere_lox` | LC-39's LH2 (1.25 M gal) and LOX (900,000 gal) spheres | propellant `auto`, `loadgo` | whole | 5,964 / 5,868, 67 / 66 |
| `pad/weather_gear` | radar under its radome, field mill, wind tower | weather `radar` | `radar`, `field_mill` | 1,696, 19 |

**Far field (review pass 2).** So that a ship never looks crowded: a mobile service tower rolls back until its face is
at least 1.3 × H from the ship's axis (real rollbacks are 1.3-2.6 × H: ELS 80 m, Vostochny 80-140 m, ELA-4 120 m);
free-standing lightning masts and the catenary towers stand at least 1.2 × H out (Pad 39B) and the mast keeps out of the
studio camera's first line of sight; the weather station and its balloon stand out with them; the ground disc grows to
hold them (`groundR`), and a model's long trench run-out is shortened to stay on it (`keepInside`). At sea (Sea Launch)
the code's steel deck stays, the fire falls off its edge, and there is no storage, tanker or weather station on the water.

**One exception to the ratio rules: ML-1.** Its base keeps its real proportions, 5.7 × 4.9 D (48 × 41 m beside the
SLS core's 8.4 m), instead of the "deck about 3 × D" rule: the ship must stand over its exhaust hole the way the SLS
core does (the hole is 9.4 m for the 8.4 m core). At LC-39B the trench hardstand under it is drawn 1.45 times wider so
its pedestals stand on concrete. Accepted by the lead (2026-11-07).

Reference photos (NASA, public domain): the wave-4 research folder `spaceb-wave4/pad/refs/` (two SpaceX photos there
are reference only); Starbase was built from published descriptions only.

## Sources

The wave-4 research (`spaceb-wave4/pad/sources.md`, `notes/`) lists every URL per complex. Main ones: NASA fact sheets
for Pad 39B and Mobile Launcher 1, NASA SP-4204 *Moonport* (LC-34, LC-39 deflectors, egress), the Cape Canaveral Space
Force Museum pages (LC-14, LC-17, LC-19, LC-34), RussianSpaceWeb (Baikonur sites 1, 31, 81, 110, Vostochny, ELS), CNES
(ELA-4), ISRO (FLP, PSLV-C25), JAXA, NASA mission pages (Mercury, Gemini, Apollo, Artemis), Spaceflight Now,
NASASpaceflight, collectSPACE, Wikipedia (climate tables; single-source facts are marked below).

### Not confirmed (kept off the cards; game choices stay)

- SLC-40: four lightning towers (wave 3). LC-39A: lightning protection on the Apollo launch umbilical tower; the 13 m
  trench depth was dropped (Moonport: pad 12 m above ground, trench floor at ground level).
- LC-39B: the OIG repair figure for Artemis I (excerpt only); the LH2 sphere's 1.25 M gal (NASA) vs 1.4 M gal.
- Starbase Pad 2: Super Heavy V3 thrust about 90 MN (33 Raptor 3); the trench's direction and the diverter's build.
- LC-34: umbilical tower 73 m (museum) vs about 70 m (Moonport); lightning protection; the kit's water.
- SLC-17, LC-14, LC-19: flame bucket types, hold-down, water and lightning (kits are best fits); Atlas LV-3B thrust;
  Delta II 7925 liftoff thrust (a sum, not a published figure).
- Wallops: the ~$13 M repair (Wikipedia citing SpaceNews); hold-down on the Antares mount.
- Site 110: tower heights, water and lightning; Energia thrust about 35 MN (computed).
- Site 81: which pad flew the first Proton; service tower size; the flame duct layout.
- Gagarin's Start: the flame pit's depth (45 m or 35 m: no source settles it). Vostochny: tower 48.3 m or 52 m.
- Plesetsk: a proper January normal (−12.5 °C from RETScreen).
- ELA-4: when the gantry rolls back; Ariane 64 thrust (derived). ELA-3: the 870 t table (dropped).
- Wenchang: the 1,800 t platform and 91.7 m tower (Chinese Wikipedia only, dropped). Xichang: the 76 m tower with
  rotating floors (Baidu only, dropped). Jiuquan: the tower height and an escape slide (dropped; the kit uses an arm).
- Tanegashima: rollout 12 h or 15 h before launch. Naro: the 45 m structure (dropped). Sriharikota: MST 3,200 t vs
  3,450 t. Alcântara: tower size. Uchinoura: the M-V's elevation angle; the tower is fixed and the launcher swings out
  (the kit uses `mst` for its enclosed, clear-of-the-fire effect).
- Rocket Lab LC-1: platform mass (dropped), hold-down and deflector. Omelek: the erector and mount.
- Sea Launch: water on the Odyssey; RD-171 sea-level thrust.

## Requests to the lead

- Done by the lead: `stats.js` passes `g` and `wetMass`; designPage gives `ui.g` (the card's preview uses it).
- `bay/stations.js`: the `launchwindow` station's blurb still says "Pick the launch window: the soonest is cold and free".
- `designPage.js` draws its own pad icons (`padIcon`, `equipIcon`) with the same keys as designPad.js: fine as long as
  both call `padArt` the same way.
- Role 2/3's launch scene: `flightArt.js` registers `builder:launchPad` from `padArt`, so the ratio rules above reach the
  LAUNCH scene too.
