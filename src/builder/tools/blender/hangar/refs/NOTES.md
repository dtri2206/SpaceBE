# HB3 reference notes — 2026-11-08

Own geometry, measured by visual comparison, not a surveyed engineering replica.

NASA's [2017 platform installation account](https://www.nasa.gov/blogs/groundsystems/2017/02/21/media-view-new-work-platforms-for-nasas-space-launch-system/) identifies ten levels, A, B, C, D, E, F, G, H, J, K (no I); A highest, K lowest; twenty opposing halves. Rail-mounted platforms move vertically and horizontally for different vehicles. The game kit uses eleven **numeric** levels 01–11, every 6 m from 11 to 71 m, per the human's brief. These numbers do not claim to be NASA's actual floor elevations.

NASA's [VAB facilities page](https://www.nasa.gov/kennedy/partnerships/vehicleassemblybuilding/) gives 525 ft building height (160.02 m), 456 ft external door height (138.99 m), two 250-ton east–west bridge cranes, two 325-ton cranes, and a 175-ton transfer-aisle crane. The 175-ton crane is not a second overhead crane in HB3. Our single bridge spans the game's X direction; it is a visually scaled module without a simulated lifting rating. At 80 m interior height the kit is roughly half the real building height. The 44 × 44 m footprint is the agreed gameplay envelope, not a claim about the surveyed dimensions of one NASA bay.

The [NASA work-platform factsheet](https://www.nasa.gov/wp-content/uploads/2015/03/vabhighbay3_workplatformsfs.pdf) describes access to particular SLS and Orion interfaces. The game instead chooses service levels from ship height and retracts levels above the top. Real mobile launchers ride on crawler tracks, not railway rails: the two steel guide tracks requested here are a game staging cue, not a reproduction of the crawlerway.

## Visual decisions

- User-provided `VAB-Platforms-side-section-photo-1500x1000.jpg`: opposing deck halves, deep fascia and ribs, bright inner lips, thin white rails with intermediate rail and toe boards, red services, repeated braced bays.
- `images.jpg`: deep dark gaps and overlapping X bracing around a slim central vehicle; preserve the sense of looking through multiple structural planes.
- The clean render is useful for masses but the photographic references govern lattice density.
- Rails remain 1.1 m high; witness figure 1.8 m; cab 2.4 × 2.4 × 2.6 m; crew walkway 1.5 m wide. Architectural dimensions scale down while human-access details retain human scale.
- ML deck datum 7 m. Console rectangle X ±10, Z −20…−12 kept empty. Side tower decks are fixed; inner halves translate into the tower racks.
- `Ground look-up` camera is 12 m in front of the ML front edge (Z −20), at Y 1.7 m, FOV 70 degrees.
- No photograph or third-party mesh is embedded in an exported asset. Comparison captures in `shots/` contain only our rendered geometry. Compare them on screen alongside the original reference, not by redistributing the reference.
