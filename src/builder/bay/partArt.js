// 3D art for one catalogue part. Order of preference: real NASA hardware (bay/nasa.js) → detailed procedural
// hardware (bay/partMeshes.js) → Role 3's rocketPart meshes (legs, and anything else not covered).
import * as THREE from 'three';
import { assets } from '/src/graphics/index.js';
import { nasaPartArt } from './nasa.js';
import { finMesh, heatShieldMesh, moduleMesh, noseMesh, ringMesh, tankMesh } from './partMeshes.js';

const FAMILY_TINT = {
  control: 0x4b5563, thermal: 0x6b4a3a, recovery: 0xb45309, life: 0x1e5a6e, power: 0x1f4d8a, comms: 0x475569, protection: 0x3f3f46, science: 0x3b5a3a, seals: 0x5b2333,
};

/** Returns an Object3D for a layout entry { type, attach, height, radius, def }. */
export function partArt(entry) {
  const def = entry.def;
  const type = entry.type.toLowerCase();
  const radius = entry.radius ?? 1.25;
  if (def?.flags?.cheapSeals) return ringMesh(def, radius, 0x8a6d3b);
  if (def?.flags?.gimbal) return ringMesh(def, radius, 0x6b7280);
  const real = nasaPartArt(entry.type);
  if (real) {
    real.userData.width = entry.attach === 'radial' ? Math.min(1.2, def?.height ?? 0.8) : undefined;
    return real;
  }
  if (entry.attach === 'axial' && def) {
    if (def.fuel) return tankMesh(def, radius);
    if (/nose|cone/.test(type)) return noseMesh(def, radius);
    if (def.flags?.heatShield) return heatShieldMesh(def, radius);
    if (def.flags?.capsule || def.engine) return assets.get(`rocketPart:${entry.type}`); // Role 3's art until the real model loads
  }
  if (entry.attach === 'radial') {
    if (/fin/.test(type) && def) return finMesh(def);
    if (/leg/.test(type)) return assets.get(`rocketPart:${entry.type}`);
    if (def) return moduleMesh(def, FAMILY_TINT[def.family] ?? 0x3b4148);
  }
  return assets.get(`rocketPart:${entry.type}`);
}

export const moduleBox = (entry) => moduleMesh(entry.def ?? { height: entry.height, name: entry.type, family: 'control', id: entry.type });
export { THREE };
