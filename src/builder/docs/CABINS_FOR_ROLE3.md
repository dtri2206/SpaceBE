# SpaceB&E: every crew cabin the builder offers (for Role 3's interiors)

From Role 1 (Myklede), 2026-11-08, written from the game's own data on branch `role1-builder` (commit 14e984b).

## Tóm tắt cho bạn đọc trước (tiếng Việt)

- **Có cabin nào không có cửa sổ không? Không có.**
  - Cả 17 loại khoang lái người chơi chọn được đều dùng chung một bộ lựa chọn "Windows" với 3 kiểu, kiểu nào cũng có kính:
    - **small**: ô cửa nhỏ, là kiểu mặc định;
    - **panoramic**: cửa sổ lớn kiểu New Shepard;
    - **cupola**: vòm kính ở mũi, thay chỗ cổng ghép nối.
  - Chỉ có New Shepard mặc định là cửa sổ lớn.
  - Ngoài đời, mọi tàu chở người từng bay đều có cửa sổ. Tàu chở hàng không người (Progress, Cygnus, HTV, ATV) thì không có, nhưng trong game các kiểu đó vẫn chở người trong một khoang chung Mk1/Mk2/Mk3 do game vẽ.
- **Khoang Role 3 đang có:** một khoang hình hộp 4 × 8 m cho tàu đổ bộ sao Hỏa (`src/graphics/cabin.js`), có 1 cửa sổ trước và 4 ô cửa tròn. Khoang này chưa đổi theo loại khoang người chơi chọn.
- **Cách biết người chơi đang bay khoang nào:** `getShip().parts` có `type` của khoang (danh sách ở bảng dưới). Kiểu cửa sổ người chơi chọn hiện **chưa** có trong ShipSpec; Role 1 sẽ thêm (xem mục 4).
- Phần dưới viết bằng tiếng Anh để AI của Role 3 đọc và tra cứu tiếp. Những chỗ ghi **[verify]** là con số tôi chưa kiểm chứng bằng nguồn gốc, AI của bạn nên tra lại.

## 1. Facts the game is built on

- Every crew cabin is a part with `flags.capsule` in `src/builder/sections/nose/parts.json`. All of them use the same inner-options kit, `capsule` (`src/builder/sections/nose/internals.json`). The kit's slots are:
  - `computer`: single, triple, quad
  - `lifeSupport`: open, regenerative
  - `couches`: fixed contour couches; shock-attenuating couches (Apollo, Orion); ejection seats (Gemini, Vostok)
  - **`windows`**: `small` (small ports, Soyuz-like, the default); `panoramic` (New Shepard-like, the largest windows flown); `cupola` (a glass dome in the nose, as on Crew Dragon *Resilience* for Inspiration4, 2021; it replaces the docking port)
  - `hatch`: `outward` side hatch with quick release (Apollo after Apollo 1, Dragon; the default); `inward` plug hatch (Apollo 1); `top` hatch only (Soyuz and Shenzhou descent modules)
  - `docking`: `none`; `probe_drogue` (Apollo); `ssvp` (Soyuz); `apas` (APAS-75/89/95); `nds` (NASA Docking System / IDSS: Orion, Starliner, Dragon); `cbm` (berthing ring: Cygnus, HTV, Dragon 1)
  - `atmosphere`: sea-level air (Soyuz, Shuttle, Dragon, Orion); pure O₂ at one-third pressure (Mercury, Gemini, Apollo); N₂/O₂ on the pad then O₂ in space (Apollo from Apollo 7)
  - `suits`: shirt-sleeves; pressure suits (Sokol, ACES, Dragon IVA)
  - `landing`: splashdown; soft-landing rockets (Soyuz, Shenzhou); hard landing (Vostok); airbags (Starliner)
- **There is no "no windows" option.** Every crew cabin has glass. Every crewed spacecraft that has flown had windows. Only uncrewed cargo craft have none, and in the game those shapes still carry a generic crew capsule (Mk1/Mk2/Mk3, see the table).
- **Game sizes.** The builder has three stack diameters: S 1.875 m, M 2.5 m, L 3.375 m. A real cabin is scaled to the size class of its rocket, keeping its shape and proportions. The walkable interior (INTERIOR state) is a separate, human-scale space; today it is 4 m × 8 m (`src/graphics/cabin.js`).
- **Exterior models.** The Blender exteriors are `public/assets/models/builder/nose/<id>.glb`, built by `src/builder/tools/blender/nose/capsules.py` (+ `inner.py`). Each one holds:
  - nodes `slot_windows`, `slot_windows__panoramic` and `slot_windows__cupola`: the three window looks; the game shows only the one fitted;
  - the same `slot_<key>` / `slot_<key>__<option>` pieces for couches, hatch, docking, landing and suits.

  So the exterior window layout of each look can be read straight from these files, for example in Blender or https://gltf-viewer.donmccurdy.com/.

## 2. Every cabin the player can fly

Columns: the part `type` in ShipSpec; the real craft; the shapes on the Nose card that use it; the game's size and height; the exterior model; the real crew and pressurised volume; the real windows; the real cockpit.

### 2.1 With a Blender model (real craft)

| type | Real craft | Nose shapes | Game size | Model |
|---|---|---|---|---|
| `capsule_vostok` | Vostok 3KA descent module (1961–63), sphere 2.3 m across, about 2.4 t | `fairing_capsule`, `voskhod` | M, 2.25 m | `nose/capsule_vostok.glb` (157 KB) |
| `capsule_mercury` | Mercury (1959–63), 1.89 m across the shield, about 2.9 m tall to the antenna canister | `mercury` | S, 2.92 m | `nose/capsule_mercury.glb` (147 KB) |
| `capsule_gemini` | Gemini re-entry module (1964–66), 2.29 m at the base | `gemini` | S, 1.84 m | `nose/capsule_gemini.glb` (156 KB) |
| `capsule_apollo` | Apollo command module (1966–75), 3.91 m wide, 3.48 m tall with the probe | `apollo` | L, 2.80 m | `nose/capsule_apollo.glb` (189 KB) |
| `capsule_soyuz` | Soyuz TMA/MS descent module, 2.17 × 2.24 m | `soyuz_7k`, `soyuz` | S, 2.06 m | `nose/capsule_soyuz.glb` (152 KB) |
| `capsule_shenzhou` | Shenzhou re-entry module (since 1999), 2.52 m wide | `shenzhou` | S, 1.64 m | `nose/capsule_shenzhou.glb` (150 KB) |
| `capsule_orion` | Orion crew module (Artemis), 5.03 m × 3.35 m | `big_cabin` | L, 2.25 m | `nose/capsule_orion.glb` (181 KB) |
| `capsule_dragon` | Crew Dragon (since 2019), 4 m wide | `crew_dragon`, `cargo_dragon` | M, 2.20 m | `nose/capsule_dragon.glb` (174 KB) |
| `capsule_starliner` | Boeing Starliner crew module (since 2019), 4.6 m wide | `starliner` | L, 2.30 m | `nose/capsule_starliner.glb` (176 KB) |
| `capsule_gaganyaan` | ISRO Gaganyaan crew module (test module 3.1 m wide) | `gaganyaan` | S, 1.95 m | `nose/capsule_gaganyaan.glb` (171 KB) |
| `capsule_newshepard` | Blue Origin New Shepard crew capsule (crewed since 2021), 15 m³ | `new_shepard` (panoramic windows fitted) | M, 2.00 m | `nose/capsule_newshepard.glb` (184 KB) |
| `capsule_mengzhou` | CMSA Mengzhou (prototype flew 2020) | `mengzhou` | L, 2.30 m | `nose/capsule_mengzhou.glb` (163 KB) |
| `dream_chaser` | Sierra Space Dream Chaser, about 9 m long, lifting body | `dream_chaser` | L, 5.30 m | `nose/dream_chaser.glb` (133 KB) |
| `starship_nose` | SpaceX Starship upper stage, 9 m wide (no crew cabin has flown yet) | `starship` | L, 4.90 m | `nose/starship_nose.glb` (192 KB) |

### 2.2 Generic cabins drawn by code (no Blender model)

| type | What it stands for | Nose shapes |
|---|---|---|
| `capsule_s` (Mk1) | Mercury-class one-seat cone | `progress`, `cygnus`, `htv`, `atv`, `hope`, `mom`, `electron` |
| `capsule_m` (Mk2) | Gemini to Crew Dragon class cone | `bare_capsule`, `dawn_stack` |
| `capsule_l` (Mk3) | Apollo / Orion class cone | `mars_rover`, `new_glenn` |

These shapes are real cargo craft or payload fairings. The game still needs a crew cabin, so the generic cone rides under them.

## 3. The real interiors, to research and model

Crew count, pressurised volume, windows and cockpit per craft. Numbers marked [verify] are from memory and must be checked against NASA, ESA, Roscosmos, CMSA, ISRO or manufacturer sources.

### Vostok (`capsule_vostok`, also Voskhod)
- **Crew:** 1. Voskhod crammed in 3 without ejection seat or suits.
- **Volume:** about 1.6 m³ [verify].
- **Windows:** 3 portholes [verify]: one in the entry hatch, one beside the head, and the Vzor optical orientation sight under the cosmonaut's feet.
- **Cockpit:** an ejection seat filling most of the sphere, a small instrument panel with the Globus navigation globe, a manual-orientation handle.

### Mercury (`capsule_mercury`)
- **Crew:** 1.
- **Volume:** about 1.7 m³.
- **Windows:** early on (Freedom 7), 2 small side portholes and a periscope screen. From Liberty Bell 7 onward, a trapezoidal window in front of the pilot's face [verify which flights].
- **Cockpit:** a contour couch moulded to each astronaut, a dense switch-and-gauge panel, a hand controller under the right hand.

### Gemini (`capsule_gemini`)
- **Crew:** 2, side by side.
- **Volume:** about 2.55 m³.
- **Windows:** 2, one in each crewman's hatch.
- **Cockpit:** two ejection seats, each under its own hatch; the centre panel shared; very cramped (often compared to the front seat of a small car).

### Apollo CM (`capsule_apollo`)
- **Crew:** 3, abreast.
- **Volume:** about 6.17 m³ habitable.
- **Windows:** 5: 2 forward-facing rendezvous windows, 2 side windows, 1 in the side hatch.
- **Cockpit:**
  - three couches on struts, the main display console about 2 m wide across the top;
  - the lower equipment bay below the couches' feet, with the guidance and navigation station, sextant and telescope;
  - the tunnel to the docking probe overhead.

### Soyuz descent module (`capsule_soyuz`)
- **Crew:** 3.
- **Volume:** about 3.5 m³.
- **Windows:** 2 side portholes [verify count] plus the Vzor periscope sight.
- **Cockpit:**
  - Kazbek couches with knees drawn up; the commander in the middle;
  - the Neptun-ME glass panel on TMA-M and MS;
  - the hatch above, leading up into the orbital module.

### Shenzhou re-entry module (`capsule_shenzhou`)
- **Crew:** 3.
- **Windows:** portholes [verify count and placement].
- **Cockpit:** a Soyuz-like layout about 15 % larger; three couches; the hatch above to the orbital module.

### Orion crew module (`capsule_orion`)
- **Crew:** 4.
- **Volume:** about 8.95 m³ habitable.
- **Windows:** 4 crew windows plus 1 in the side hatch [verify the exact count and placement].
- **Cockpit:** a glass cockpit with three large displays and rotational and translational hand controllers; the seats in two rows (2 + 2); the side hatch.

### Crew Dragon (`capsule_dragon`)
- **Crew:** 4 (designed for up to 7).
- **Volume:** about 9.3 m³ pressurised.
- **Windows:**
  - Normally 4 side windows plus 1 in the side hatch [verify].
  - The cupola option: the docking adapter replaced by a glass dome (Inspiration4, 2021).
- **Cockpit:** three large touchscreens hinged over a single row of four reclined seats; the side hatch; the docking hatch in the nose.

### Starliner (`capsule_starliner`)
- **Crew:** 4 normally, up to 7.
- **Volume:** about 11 m³.
- **Windows:** 5 [verify].
- **Cockpit:** a glass cockpit with some physical switches and hand controllers; the side hatch; the NDS docking port on top.

### Gaganyaan (`capsule_gaganyaan`)
- **Crew:** 3.
- **Windows:** [verify].
- **Cockpit:** a double-walled cabin, a pressurised metal shell inside the outer heat-shielded shell; three seats [verify the layout].

### New Shepard (`capsule_newshepard`)
- **Crew:** 6.
- **Volume:** 15 m³.
- **Windows:** 6 very large windows, one beside each seat, the largest flown in space.
- **Cockpit:** six reclining seats in a ring around a central column that holds the solid escape motor; no flight controls (the flight is autonomous); a ring of soft panels.

### Mengzhou (`capsule_mengzhou`)
- **Crew:** up to 7 in low orbit, 3 for the Moon [verify].
- **Windows:** [verify].
- **Cockpit:** [verify]. A reusable cabin with its heat shield built in.

### Dream Chaser (`dream_chaser`)
- **Crew:** the cargo version (*Tenacity*) is uncrewed; a crewed version for up to 7 was proposed [verify].
- **Windows:** cockpit windows on the crewed concept [verify].
- **Cockpit:** a lifting-body spaceplane flown to a runway; a pilot cockpit up front on the crewed concept.

### Starship (`starship_nose`)
- **Crew:** a crewed version is planned; no crew cabin has flown.
- **Windows:** large windows near the nose in SpaceX's renders [verify against current SpaceX material].
- **Cockpit:** a concept only. It is a very large, multi-deck pressurised volume.

### Generic Mk1, Mk2, Mk3 (`capsule_s`, `capsule_m`, `capsule_l`)
- **What they are:** game-made cones standing for the classes above: Mercury, Gemini/Dragon, Apollo/Orion.
- **Windows:** come from the `windows` option. They have no Blender model; the code draws them in `bay/partMeshes.js` / `sections/nose/art.js`.

## 4. Linking the interior to what the player built

- **Already available:** `getShip().parts` lists every part of the confirmed ship, and the crew cabin is the part whose `type` is one of the ids in §2. Role 3 can choose an interior variant from that type today. For example: a cone cabin for the capsules, a lifting-body cockpit for Dream Chaser, a large deck for Starship.
- **Coming from Role 1** (after the current flight-effects work is merged; not in the ShipSpec yet): a `ShipSpec.stats.cabin` object:

  ```
  stats.cabin = { type, windows: 'small'|'panoramic'|'cupola', hatch: 'outward'|'inward'|'top', docking: 'none'|'probe_drogue'|'ssvp'|'apas'|'nds'|'cbm', couches: 'fixed'|'shock'|'ejection', atmosphere, suits, crew, volumeM3 }
  ```

  It is an optional field. A missing one means "use your default cabin". With it, the interior can show the window layout, hatch position, docking tunnel and seats the player actually chose. Please tell Role 1 if you want other fields.
- **Keep every station.** The interior must keep all `STATIONS` from `src/core/contract.js`: `pilotSeat`, `o2Station`, `suitLocker`, `commsConsole`, `sampleStorage`, `airlock`, `bunk`. Role 2's surface code places them through `group.userData.stations`.
- **Scale.** Real cabins are tiny: Mercury 1.7 m³, Soyuz 3.5 m³. A walkable game interior needs room for the player's first-person camera and the seven stations. The current 4 × 8 m Mars-lander cabin is far bigger than any capsule, so a "habitat/lander" interior is a reasonable fiction. If the interior should follow the capsule, a sensible rule is to keep the real layout cues (window positions, hatch side, couch arrangement, panel style) and scale the volume up to stay walkable.

## 5. Good sources for the interiors

- NASA History Office (history.nasa.gov):
  - *Apollo Operations Handbook*, CM interior and the "Apollo Command Module News Reference";
  - *Project Gemini Familiarization Manual*;
  - *Project Mercury Familiarization Manual*.
- Smithsonian National Air and Space Museum 3D scans (CC0): the Apollo 11 command module *Columbia*, inside and out, at https://3d.si.edu.
- NASA Orion reference guide (nasa.gov, "Orion Reference Guide").
- SpaceX Crew Dragon press kits and NASA Commercial Crew pages.
- Boeing Starliner press kit (CFT, 2024).
- For Soyuz: RussianSpaceWeb (russianspaceweb.com) and Roscosmos / Energia.
- For Shenzhou and Mengzhou: CMSA (cmse.gov.cn).
- For Gaganyaan: ISRO (isro.gov.in).
- Blue Origin New Shepard: blueorigin.com.
