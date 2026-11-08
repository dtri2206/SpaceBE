# Asset provenance

## V4 wrap and console refinement

All quarter decks, seam covers, rear lattice, rail supports, stair flights, front-open inspection launcher, console shells/hardware/chairs and floor island are original geometry in `additions_v4.py`. New atlas names and normal derivatives have v4 suffixes. They reuse the same **CC0 1.0** Poly Haven [Blue Metal Plate](https://polyhaven.com/a/blue_metal_plate) and [Hangar Concrete Floor](https://polyhaven.com/a/hangar_concrete_floor) sources listed below, with original tint, grime and Cycles AO bakes. The opaque far-grating pattern is analytically generated. No additional third-party texture/model was downloaded. The HDRI remains the existing read-only CC0 [Small Hangar 01](https://polyhaven.com/a/small_hangar_01).

The supplied `vab_work_platforms_with_sls.webp` and NASA platform cutaway were viewed in Downloads only, never copied, traced or sampled. Console canvas typography, plots, schematics and UI artwork are original. All v4 screenshots depict our own rendered assets, without reference-photo content.

## v3 consoles and calm-distance pass

All console chassis, chairs, monitor arms, keyboards, phone, headset, guards, status towers, overhead supports and radial collar plates are original geometry authored in `additions.py`. The averaged opaque grating tile is generated analytically in `detail.py` from a low-contrast coverage pattern; it uses no photograph. The existing CC0 Blue Metal Plate finish supplies the new chassis/plate paint detail and AO bake inputs; no new third-party textures were downloaded.

Control-room references (viewing only, not shipped or sampled):

- NASA Launch Control Center fact sheet: https://www.nasa.gov/wp-content/uploads/2018/06/launch_control_center_final.pdf
- NASA EGS overview: https://www.nasa.gov/humans-in-space/exploration-ground-systems/exploration-ground-systems-overview/
- Artemis console reference: https://www.flickr.com/photos/nasakennedy/52351766557

All console screen imagery, plots, labels and radar graphics are our original canvas drawings. They are clearly illustrative; no flight-room screenshot or weather-radar image is used. Actual current-ship statistics come from the unchanged builder's computeShipSpec. The transfer field and weather radar are schematic mock-ups, not trajectory predictions or live feeds.

All shipped meshes, UVs, baked AO, layout data and sandbox geometry were generated specifically for SpaceB&E. No downloaded models, trademarks or NASA logos are shipped.

## CC0 texture sources (detail pass, 2026-11-08)

| Source page | Licence | Use |
|---|---|---|
| https://polyhaven.com/a/blue_metal_plate | CC0 1.0 | Painted steel scratch/roughness/normal source; tinted grey, white, yellow and red by our original geometry colours. |
| https://polyhaven.com/a/hangar_concrete_floor | CC0 1.0 | Concrete albedo, roughness and OpenGL normal. |
| https://polyhaven.com/a/metal_plate | CC0 1.0 | Initial experiment, source files retained for provenance; not used in final export. |
| https://polyhaven.com/a/small_hangar_01 | CC0 1.0 | Existing game HDRI, referenced read-only from `/assets/polyhaven/hdri/small_hangar_01_1k.hdr`; not copied into the kit. |

Poly Haven's asset licence: https://polyhaven.com/license and https://creativecommons.org/publicdomain/zero/1.0/ . Source metadata with download URLs and checksums is retained in `../textures/*.json`. Only the 1K JPEG diffuse, roughness and OpenGL normal maps were downloaded. Export normals are resized to 512 square; colour and linear ORM atlases are our own Cycles bakes at 512 or 1024. Steel grating holes and bolts are original geometry, not sampled from photographs.

Local reference photos remain in the human's Downloads directory. They were inspected only. In particular the Alamy image is copyrighted and is not copied into this project or used as a texture. The licence of `images.jpg` and the supplied render is not established, so they are reference-only as well.

NASA factual sources are linked in NOTES.md. They inform dimensions and construction cues; no NASA photograph is redistributed. Screenshots in refs/shots are original renders of this kit.
