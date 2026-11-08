// 3D art for one catalogue part. Order of preference: the part's own section art (sections/<id>/art.js) → real NASA
// hardware (bay/nasa.js, from the part's `model` field) → detailed procedural hardware (bay/partMeshes.js) → Role 3's
// rocketPart meshes (legs, and anything else not covered). An engine under a multi-engine thrust structure is drawn as
// the whole cluster.
import * as THREE from 'three';
import { assets } from '/src/graphics/index.js';
import { withoutFlightArt } from '../flightArtGate.js';
import { nasaPartArt, isBuilderModel, applyChoices } from './nasa.js';
import {
  adapterMesh, airbagMesh, avionicsRingMesh, chuteMesh, finMesh, heatShieldMesh, hiadMesh, instrumentMesh, kickMotorMesh, moduleMesh, noseMesh,
  pafMesh, ringMesh, rtgMesh, sectionMesh, solarWingMesh, sphereMesh, spinTableMesh, srbMesh, tankMesh, thrustMesh, trussMesh, wiringTunnelMesh,
} from './partMeshes.js';
import * as noseArt from '../sections/nose/art.js';
import * as bodyArt from '../sections/body/art.js';
import * as tailArt from '../sections/tail/art.js';

const SECTION_ART = { nose: noseArt, body: bodyArt, tail: tailArt };

const FAMILY_TINT = {
  control: 0x4b5563, thermal: 0x6b4a3a, recovery: 0xb45309, life: 0x1e5a6e, power: 0x1f4d8a, comms: 0x475569, protection: 0x3f3f46, science: 0x3b5a3a, seals: 0x5b2333, structure: 0x4b5563,
};

/** Procedural art for a part (no real model). Null when only Role 3's generic mesh applies. */
function proceduralArt(entry) {
  const def = entry.def;
  if (!def) return null;
  const type = entry.type.toLowerCase();
  const radius = entry.radius ?? 1.25;
  if (entry.attach === 'axial') {
    if (def.adapter) return adapterMesh(def);
    if (def.mounts) return thrustMesh(def, radius);
    if (def.fuel) return tankMesh(def, radius);
    if (/nose|fairing/.test(type)) return noseMesh(def, radius);
    if (/hiad/.test(type)) return hiadMesh(def, radius);
    if (def.flags?.heatShield) return heatShieldMesh(def, radius);
    if (/interstage|centerbody/.test(type)) return sectionMesh(def, radius);
    if (/truss/.test(type)) return trussMesh(def, radius);
    if (/avionics/.test(type)) return avionicsRingMesh(def, radius);
    if (/paf/.test(type)) return pafMesh(def, radius);
    if (/spin_table/.test(type)) return spinTableMesh(def, radius);
    if (def.booster) return kickMotorMesh(def, radius);
    return null;
  }
  if (/fin/.test(type)) return finMesh(def);
  if (def.booster) return srbMesh(def);
  if (/helium|nitrogen/.test(type)) return sphereMesh(def, /nitrogen/.test(type) ? 0xb9c6d2 : 0xd8dde2);
  if (/wiring/.test(type)) return wiringTunnelMesh(def);
  if (/solar_wing/.test(type)) return solarWingMesh(def);
  if (/rtg/.test(type)) return rtgMesh(def);
  if (def.flags?.parachute) return chuteMesh(def, /drogue/.test(type) ? 0xd9d7d1 : 0xe08a3a);
  if (/airbag/.test(type)) return airbagMesh(def);
  if (/camera/.test(type)) return instrumentMesh(def, 'camera');
  if (/star_tracker/.test(type)) return instrumentMesh(def, 'tracker');
  if (/weather/.test(type)) return instrumentMesh(def, 'weather');
  if (/seismo/.test(type)) return instrumentMesh(def, 'seismo');
  if (/leg/.test(type)) return null;
  return moduleMesh(def, FAMILY_TINT[def.family] ?? 0x3b4148);
}

/**
 * An inflatable heat shield packed for launch (when the skin covers it): the deflated tube stack folded tight round
 * its centre plug, under a woven thermal blanket, all within the stack radius. Inflated, it would be far wider.
 */
function packedHiadMesh(def, radius) {
  const h = def.height;
  const g = new THREE.Group();
  const blanket = new THREE.MeshStandardMaterial({ color: 0x9b7a52, roughness: 0.92, metalness: 0.02 });
  const tube = new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.85, metalness: 0.02 });
  g.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.42, radius * 0.5, h * 0.9, 32), new THREE.MeshStandardMaterial({ color: 0x5b6168, roughness: 0.5, metalness: 0.6 })), { position: new THREE.Vector3(0, h * 0.45, 0) }));
  const folds = 4;
  for (let i = 0; i < folds; i++) {
    const r = radius * (0.62 + 0.07 * i), t = Math.min(h / (folds * 2.2), radius * 0.09);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, t, 10, 48), i % 2 ? blanket : tube);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = h * (0.18 + 0.2 * i);
    g.add(ring);
  }
  return g;
}

/** Art for one part, without cluster handling. */
function singleArt(entry) {
  const def = entry.def;
  const radius = entry.radius ?? 1.25;
  if (entry.covered && /hiad/.test(def?.id ?? '')) return packedHiadMesh(def, radius); // stowed under the skin for launch
  // Role 1's Blender model, once loaded, wins over the code-drawn art (which shows while it downloads)
  if (isBuilderModel(entry.type)) {
    // an engine with a vacuum nozzle uses its vacuum-bell copy when the model has one; only the chosen inner looks show
    const vac = entry.engine?.nozzle === 'vac' ? nasaPartArt(`${entry.type}#vac`) : null;
    const model = vac ?? nasaPartArt(entry.type);
    if (model) {
      applyChoices(model, entry.options);
      model.userData.width = entry.attach === 'radial' ? Math.min(1.2, def?.height ?? 0.8) : undefined;
      if (def?.booster && entry.attach === 'radial') model.userData.srb = true;
      // the section's art may dress the model (a booster dropped to its clamp and given struts, a bell tinted by fuel)
      const wrapped = def?.section && SECTION_ART[def.section]?.wrapModel?.(model, entry);
      return wrapped ?? model;
    }
  }
  const own = def?.section && SECTION_ART[def.section]?.partArt?.(entry);
  if (own) return own;
  if (def?.flags?.cheapSeals) return ringMesh(def, radius, 0x8a6d3b);
  if (def?.flags?.gimbal) return ringMesh(def, radius, 0x6b7280);
  const real = nasaPartArt(entry.type);
  if (real) {
    real.userData.width = entry.attach === 'radial' ? Math.min(1.2, def?.height ?? 0.8) : undefined;
    if (def?.booster && entry.attach === 'radial') real.userData.srb = true;
    return real;
  }
  const made = proceduralArt(entry);
  if (made) return made;
  return withoutFlightArt(() => assets.get(`rocketPart:${entry.type}`)); // Role 3's own art (legs, capsules and engines until the real model loads)
}

/** Returns an Object3D for a layout entry { type, attach, height, radius, def, cluster? }. */
export function partArt(entry) {
  const c = entry.cluster;
  if (!c || !entry.def?.engine || (c.count ?? 1) <= 1) return singleArt(entry);
  // a cluster: the same engine at every mount, scaled to fit under the thrust structure, tops level with the frame
  const g = new THREE.Group();
  const r = c.hostRadius ?? entry.radius ?? 1.25;
  const s = c.scale ?? 0.4;
  const spots = (c.layout ?? []).slice(0, c.count);
  // a big cluster (Super Heavy's 33) draws the engine's low-detail model when it has one with the fitted look: lod for
  // the sea-level bell, lodVac for the vacuum bell, lodSpike for the aerospike; any other look draws the full model
  const contour = entry.options?.contour ?? 'bell';
  const lodKey = contour === 'aerospike' ? 'lodSpike' : contour !== 'bell' ? null : entry.engine?.nozzle === 'vac' ? 'lodVac' : 'lod';
  const lod = (c.count ?? 1) > 9 && lodKey ? nasaPartArt(`${entry.type}#${lodKey}`) : null;
  for (const [fx, fz] of spots) {
    const lodCopy = lod ? lod.clone(true) : null;
    const one = lodCopy ? (SECTION_ART[entry.def?.section]?.wrapModel?.(lodCopy, entry) ?? lodCopy) : singleArt(entry); // the section sizes it like the full model
    one.scale.multiplyScalar(s);
    one.position.set(fx * r, entry.height * (1 - s), fz * r);
    g.add(one);
  }
  g.userData.cluster = c.count;
  return g;
}

/** Section art may also provide the pieces inside a part (exploded view). Null = the shared default. */
export function sectionInternalsArt(def, options, dims) {
  return (def?.section && SECTION_ART[def.section]?.internalsArt?.(def, options, dims)) || null;
}

export const moduleBox = (entry) => moduleMesh(entry.def ?? { height: entry.height, name: entry.type, family: 'control', id: entry.type });
export { THREE };
