// Role 1's art in the flight scenes, agreed by all four roles (docs/DECISIONS.md, docs/SHARE_PROBLEMS.md):
//   rocketPart:<type>      the hangar's own part models, through Role 3's assets.setRocketPartArt
//   builder:rocketSkin     the outer skin (fairings, skirts, cones, the equipment bay) in ShipSpec coordinates
//   builder:launchPad      the launch complex the player chose, its equipment, sized to the ship; userData.top is the
//                          height of the mount where the ship's base sits
// Role 2 places them in the LAUNCH scene. Everything is built from the ship as confirmed (the builder's assembly).
import * as THREE from 'three';
import { partArt } from './bay/partArt.js';
import { skinFor, mountRadial } from './bay/hullArt.js';
import { padArt } from './sections/pad/art.js';
import { padSetup } from './sections/pad/effects.js';
import { weatherFor } from './weather.js';
import launchData from './data/launch.json';
import { flightArtGate } from './flightArtGate.js';

/**
 * registerFlightArt({ assets, getAssembly, getSpec, padSection })
 * assets: Role 3's public assets object; getAssembly(): the confirmed Assembly; getSpec(): the flown ShipSpec (or null);
 * padSection: sections.pad.
 */
export function registerFlightArt({ assets, getAssembly, getSpec, padSection }) {
  // one layout and one skin per version of the ship (flight asks for every part in a burst)
  let cache = { version: -1, a: null, layout: null, skin: null };
  const current = () => {
    const a = getAssembly?.();
    if (!a?.parts?.length) return null;
    if (cache.a !== a || cache.version !== a.version) {
      const layout = a.layout();
      cache = { version: a.version, a, layout, skin: skinFor(layout) };
    }
    return cache;
  };

  // partArt falls back to assets.get('rocketPart:…') for a few parts (legs): inside the builder, and inside this hook,
  // that call must reach Role 3's built-in part (flightArtGate)
  let busy = false;
  assets.setRocketPartArt((type) => {
    if (busy || flightArtGate.bypass) return null;
    const c = current();
    const e = c?.layout.find((x) => x.type === type);
    if (!e) return null;
    busy = true;
    try { return partFor(e, c); } finally { busy = false; }
  });

  assets.register('builder:rocketSkin', () => {
    const g = new THREE.Group();
    g.name = 'builder:rocketSkin';
    const c = current();
    if (c) g.add(skinFor(c.layout).object); // a fresh copy: the flight scene owns and may dispose it
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  });

  assets.register('builder:launchPad', () => {
    const c = current();
    const spec = getSpec?.() ?? null;
    const launch = spec?.launch ?? getAssembly?.()?.launch ?? {};
    const setup = padSetup(launch, padSection);
    const tempC = Number.isFinite(spec?.launch?.tempC) ? spec.launch.tempC : weatherFor(launch, { pad: padSection, launchData }).tempC;
    const axial = (c?.layout ?? []).filter((e) => e.attach === 'axial');
    const radius = axial.reduce((r, e) => Math.max(r, e.radius ?? 1.25), 1.25);
    const height = axial.reduce((t, e) => Math.max(t, e.y + e.height), 0);
    const made = padArt({ site: setup.complex, slot: { tempC }, equipment: setup.choices }, { radius, height, layout: c?.layout ?? null });
    const g = made?.object ?? new THREE.Group();
    g.name = 'builder:launchPad';
    g.userData.top = made?.top ?? 0;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  });
}

/** The model for one layout entry, in the origin convention of Role 3's README (setRocketPartArt row). */
function partFor(e, c) {
  const hidden = new Set(c.skin.hull.insideIds ?? []);
  const out = new THREE.Group();
  if (e.attach === 'radial') {
    if (hidden.has(e.id)) { out.userData.height = 0; return out; } // rides inside the skin: drawn with the skin's bay
    const art = partArt(e);
    const pivot = mountRadial(art, e, c.layout); // the hangar's placement, measured from the rocket's axis
    // flight puts the origin at the attachment point (ShipSpec x, z) with +x outward: keep only the offset from it
    art.position.x -= Math.hypot(e.x ?? 0, e.z ?? 0);
    pivot.remove(art);
    out.add(art);
    out.userData.height = e.height;
    return out;
  }
  const art = partArt(e);
  art.position.y = 0;
  out.add(art);
  // flight re-stacks axial parts by height: report the distance to the next axial part above, so gaps the skin fills
  // (an equipment bay) keep their ShipSpec spacing
  const above = c.layout.filter((x) => x.attach === 'axial' && x.y > e.y + 1e-3).reduce((m, x) => Math.min(m, x.y), Infinity);
  out.userData.height = Number.isFinite(above) ? above - e.y : e.height;
  return out;
}
