# Credits

The Earth and Mars maps are real imagery (below). Sky and terrain are generated in code, and so are the sounds not listed below (UI clicks, alarms and similar). Add every outside asset here with its source and license.

| Asset | Source | License |
|---|---|---|
| IBM Plex Mono (HUD font) | [@fontsource/ibm-plex-mono](https://www.npmjs.com/package/@fontsource/ibm-plex-mono) | OFL-1.1 |
| Earth day map and Earth clouds (`earth_day_*`, `earth_clouds_*`) | [Solar System Scope](https://www.solarsystemscope.com/textures/) | CC BY 4.0. Resized and converted to JPEG. |
| Mars map (`mars_*`) | [Solar System Scope](https://www.solarsystemscope.com/textures/) | CC BY 4.0. Resized and converted to JPEG. |
| Earth city lights (`earth_night_*`) | [NASA Earth Observatory, Black Marble 2016](https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg) | NASA imagery is generally not subject to copyright. Credit: NASA Earth Observatory. Resized and converted to JPEG. |
| Hangar HDRI `small_hangar_01` (`public/assets/polyhaven/hdri/`) | [Poly Haven](https://polyhaven.com/a/small_hangar_01) | CC0 1.0 |
| PBR textures `hangar_concrete_floor`, `metal_plate`, `blue_metal_plate`, `rubber_tiles` (`public/assets/polyhaven/textures/`) | [Poly Haven](https://polyhaven.com/textures) | CC0 1.0. 1k diffuse, normal (GL) and ARM maps. |
| Props `steel_frame_shelves_01`, `metal_tool_chest`, `old_military_crate`, `korean_fire_extinguisher_01`, `metal_office_desk`, `portable_welding_cart`, `portable_generator`, `industrial_storage_cart`, `tool_cart`, `bench_vice_01`, `ladder_sectioned_01`, `propane_tank`, `modular_industrial_pipes_01`, `pipe_wrench`, `drawer_cabinet`, `plastic_crate_01`, `barrel_03`, `metal_stool_01`, `industrial_pipe_lamp` (`public/assets/polyhaven/models/`) | [Poly Haven](https://polyhaven.com/models) | CC0 1.0. glTF; textures resized to 512 px JPEG (`src/builder/tools/shrink-textures.mjs`). |
| Draco mesh decoder (`public/assets/draco/`) | [three.js examples/jsm/libs/draco](https://github.com/mrdoob/three.js/tree/dev/examples/jsm/libs/draco) (Google Draco) | Apache-2.0. Needed to read the compressed NASA models. |
| Spacecraft hardware used for the builder parts (`public/assets/nasa/*.glb`): Space Shuttle main engine, Space Shuttle RCS pod, Space Shuttle Solid Rocket Booster, ESAS crew module, Stardust sample return capsule, Orbital Replacement Unit, Orbiter Docking System, Satellite Kit (bodies, radios, wings), Voyager high-gain antenna, Hubble's Cosmic Origins Spectrograph and Wide Field Planetary Camera, LADEE; plus the models kept from earlier downloads (Saturn V, External Tank, Apollo-Soyuz, Gemini, Lunar Module, Viking, Redstone, Parker, SDO, Payload, Dawn, Deep Space 1, NEAR, LRO, Swift, TDRS, DSCOVR, Spartan, Galileo, Voyager, GRACE, TESS, Kepler, MRO, ICECube, tall dish, helmet) | [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources) | NASA material is generally not subject to copyright. Credit: NASA. Models are used as-is or cut out by node name; see `src/builder/bay/nasa.js`. |
| Hardware standing in the engineering bay (`public/assets/nasa/*.glb`): Robonaut 2, Mark III suit, EMU astronaut, ACES suit, Ingenuity helicopter, Mars Global Surveyor (stowed for launch), CubeSats, Mobile Launcher, plus the rest of the set kept for later (ISS, Mir, Skylab, Canadarm, crawler, gantry, RASSOR, Ares I, Atlas, Agena, Jupiter-C, habitats, base station, EVA tools, tether, crew lock bag) | [NASA 3D Resources](https://github.com/nasa/NASA-3D-Resources) | NASA material is generally not subject to copyright. Credit: NASA. Placed by `src/builder/bay/room.js` (`nasaProp` in `bay/nasa.js`). |
| Card pictures (`public/assets/icons/*.png`) | Rendered by `src/builder/tools/bake-icons.mjs` from the models above and the game's own procedural hardware | Same licences as the models they show (NASA public domain; everything else is ours). |
| The engineer's body (`public/assets/people/cesium_man.glb`, walk animation) and `rigged_figure.glb` | [Khronos glTF Sample Assets: CesiumMan, RiggedFigure](https://github.com/KhronosGroup/glTF-Sample-Assets) | CC BY 4.0, Cesium. Clipped at the neck in first person (`src/builder/bay/player.js`). |
| Mars wind (`ambience_mars`) | [Perseverance rover's SuperCam records wind on Mars](https://commons.wikimedia.org/wiki/File:Perseverance_rover's_SuperCam_records_wind_on_Mars.oga) | Public domain. Credit: NASA/JPL-Caltech/LANL/CNES/CNRS/ISAE-Supaero. Trimmed, filtered and converted to MP3. |
| Engine rumble (`engine_rumble`) | [Artemis II live launch coverage, pad camera, NASA Kennedy Space Center](https://commons.wikimedia.org/wiki/File:Artemis_II_Live_Launch_Coverage_-_Pad_Camera_Site_4_%28KSC-20260401-AU-LMM01-0001-Artemis_II_Live_Launch_Coverage_Pad_Camera_Site_4%29.wav) | Public domain. Credit: NASA. Trimmed, filtered and converted to MP3. |
| Radio chatter (`radio_chatter`) | [Apollo 11 launch day communication relayed through Canary Station, NASA](https://commons.wikimedia.org/wiki/File:Apollo_11_launch_day_communication_relayed_through_Canary_Station.ogg) | Public domain. Credit: NASA. Trimmed, filtered and converted to MP3. |
| Ship hum (`ambience_ship`) | [BigSoundBank, "Ventilation #5"](https://bigsoundbank.com/ventilation-5-s3598.html) | CC0. Trimmed, filtered and converted to MP3. |
| Suit breathing (`suit_breath`) | [BigSoundBank, "Man Breathing"](https://bigsoundbank.com/man-breathing-s2195.html) | CC0. Trimmed, filtered and converted to MP3. |
| Radio static (`radio_static`) | [Oreocooke, "Static B"](https://commons.wikimedia.org/wiki/File:Static_B.wav) | CC0. Trimmed, filtered and converted to MP3. |

## Memorial photographs

Images for the "In Memoriam" tribute (`public/assets/tributes/`, details in `credits.json`). Downscaled copies of the Wikimedia Commons originals.

| Asset | Source | License |
|---|---|---|
| `soyuz1-komarov.jpg`: Vladimir Komarov, 1965 (portrait) | [File:%D0%92%D0%BB%D0%B0%D0%B4%D0%B8%D0%BC%D0%B8%D1%80_%D0%9A](https://commons.wikimedia.org/wiki/File:%D0%92%D0%BB%D0%B0%D0%B4%D0%B8%D0%BC%D0%B8%D1%80_%D0%9A%D0%BE%D0%BC%D0%B0%D1%80%D0%BE%D0%B2.jpg), by Valentin Cheredintsev / TASS (via Russian Ministry of Defence, 60cosmonauts.mil.ru) | CC BY 4.0 |
| `soyuz1-vehicle.jpg`: Soyuz 7K-OK(A) capsule, National Space Centre, Leicester | [File:Soyuz_7K-OK(A)_at_Space_Center.jpg](https://commons.wikimedia.org/wiki/File:Soyuz_7K-OK(A)_at_Space_Center.jpg), by Alan Saunders (Kaptain Kobold) | CC BY 2.0 |
| `challenger-crew.jpg`: STS-51-L official crew portrait, 15 November 1985 | [File:Challenger_flight_51-l_crew.jpg](https://commons.wikimedia.org/wiki/File:Challenger_flight_51-l_crew.jpg), by NASA | Public domain (NASA) |
| `columbia-crew.jpg`: STS-107 official crew photograph, 2001 | [File:Crew_of_STS-107,_official_photo.jpg](https://commons.wikimedia.org/wiki/File:Crew_of_STS-107,_official_photo.jpg), by NASA | Public domain (NASA) |
| `apollo1-crew.jpg`: Apollo 1 crew in front of Launch Complex 34 | [File:Apollo1-Crew_01.jpg](https://commons.wikimedia.org/wiki/File:Apollo1-Crew_01.jpg), by NASA | Public domain (NASA) |
| `soyuz11-crew.jpg`: Soyuz 11 cosmonauts, USSR memorial stamp 1971 (cropped) | [File:Soyuz_11_crew.jpg](https://commons.wikimedia.org/wiki/File:Soyuz_11_crew.jpg), by USSR Post | Public domain (PD-RU-exempt, cropped stamp) |

## Voices, sound effects and music (ElevenLabs)

All files in `public/assets/audio/demo/` were generated with ElevenLabs (elevenlabs.io) on a paid Starter plan: six original voices made with Voice Design (no real person's voice imitated), 44 lines with Eleven v3 text-to-speech, 20 sound effects, and 3 instrumental scores with Eleven Music. `manifest.json` lists every file with its subtitle and length.
