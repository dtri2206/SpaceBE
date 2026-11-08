// Real spacecraft hardware for the catalogue parts: public-domain models from github.com/nasa/NASA-3D-Resources
// (public/assets/nasa/*.glb), cut out by node name where a file holds a whole vehicle, then normalised so every
// part stands on y = 0, centred on the stack axis, scaled to its catalogue height. Credit: NASA.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const BASE = '/assets/nasa/';
const draco = new DRACOLoader();
draco.setDecoderPath('/assets/draco/'); // the decoder copied from three/examples/jsm/libs/draco/gltf (Apache-2.0)
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

/**
 * Which model each part uses. `nodes` selects children by name (whole file when absent); `up` says which model axis
 * becomes the vertical: 'x' | 'y' | 'z' | 'long' (longest side) | 'short' (shortest side); `thin` optionally turns the
 * thinnest side towards +x (outward, for panels and dishes); `flip` turns the part upside down; `tint` recolours
 * untextured models; `fit` scales by 'height' (default) or 'width'.
 */
export const NASA_PARTS = {
  engine_s: { model: 'shuttle_engines', up: 'x', tint: 0x8d9399, forceTint: true, metalness: 0.7, roughness: 0.42 }, // a Space Shuttle main engine
  engine_m: { model: 'shuttle_engines', up: 'x', tint: 0x8d9399, forceTint: true, metalness: 0.7, roughness: 0.42 }, // a Space Shuttle main engine
  engine_l: { model: 'shuttle_engines', up: 'x', tint: 0x8d9399, forceTint: true, metalness: 0.7, roughness: 0.42 }, // a Space Shuttle main engine
  capsule_s: { model: 'stardust_capsule', up: 'short', tint: 0xe6e3dc, roughness: 0.5 },
  capsule_m: { model: 'esas_crew_module', up: 'z', flip: true, tint: 0xd3d1cb, roughness: 0.6, metalness: 0.15 },
  capsule_l: { model: 'esas_crew_module', up: 'z', flip: true, tint: 0xd3d1cb, roughness: 0.6, metalness: 0.15 },
  rcs_pack: { model: 'shuttle_rcs', up: 'x', tint: 0xb9bcc0 },
  solar_panel: { model: 'satkit_wings1', up: 'long', thin: true },
  radiator: { model: 'satkit_wings1', up: 'long', thin: true, tint: 0xd8dde2 },
  antenna_low: { model: 'satkit_radio1', up: 'long' },
  antenna_high: { model: 'satkit_radio3', up: 'long', thin: true },
  battery: { model: 'oru', up: 'y', tint: 0xcfd3d8 },
  co2_scrubber: { model: 'oru', up: 'y', tint: 0xbfc7cf },
  water_recycler: { model: 'oru', up: 'y', tint: 0xc9d6df },
  radiation_shelter: { model: 'docking_system', up: 'x', tint: 0xd9dcdf },
  o2_bottle: { model: 'satkit_body1', up: 'long', tint: 0xe4e7ea },
  parachute: { model: 'satkit_body2', up: 'long', tint: 0xe08a3a },
  reaction_wheel: { model: 'satkit_body3', up: 'long', tint: 0xb9bec4 },
  spectrometer: { model: 'satkit_body3', up: 'long', tint: 0x9fb6c7 },
  ground_radar: { model: 'satkit_radio2', up: 'long', thin: true },
  drill: { model: 'satkit_body1', up: 'long', tint: 0x8d9298 },
  sample_container: { model: 'satkit_body2', up: 'long', tint: 0xd0d4d8 },
};

const files = new Map(); // model slug -> Promise<scene|null>
const protos = new Map(); // part id -> normalised Object3D (prototype)
let ready = false;

const failures = new Map(); // slug -> message
function loadFile(slug) {
  if (!files.has(slug)) {
    files.set(slug, new Promise((resolve) => loader.load(`${BASE}${slug}.glb`, (g) => resolve(g.scene), undefined, (error) => {
      failures.set(slug, String(error?.message ?? error));
      resolve(null);
    })));
  }
  return files.get(slug);
}
export const nasaFailures = () => Object.fromEntries(failures);

function bakedClone(node) {
  const c = node.clone(true);
  c.position.set(0, 0, 0);
  c.quaternion.identity();
  c.scale.set(1, 1, 1);
  c.updateMatrix();
  c.applyMatrix4(node.matrixWorld);
  return c;
}

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

function normalise(source, cfg, height) {
  source.updateMatrixWorld(true);
  const group = new THREE.Group();
  if (cfg.nodes) {
    for (const name of cfg.nodes) {
      const node = source.getObjectByName(name);
      if (node) group.add(bakedClone(node));
    }
  } else {
    for (const child of source.children) group.add(bakedClone(child));
  }
  if (!group.children.length) return null;
  // pick the vertical axis
  let box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  const dims = ['x', 'y', 'z'];
  let upAxis = cfg.up ?? 'y';
  if (upAxis === 'long') upAxis = dims[[size.x, size.y, size.z].indexOf(Math.max(size.x, size.y, size.z))];
  if (upAxis === 'short') upAxis = dims[[size.x, size.y, size.z].indexOf(Math.min(size.x, size.y, size.z))];
  const holder = new THREE.Group();
  holder.add(group);
  if (upAxis !== 'y') group.quaternion.setFromUnitVectors(AXES[upAxis], AXES.y);
  if (cfg.thin) {
    // after the vertical is set, turn the thinnest horizontal side towards +x
    holder.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(holder);
    const s = box.getSize(new THREE.Vector3());
    if (s.z < s.x) holder.rotation.y = Math.PI / 2;
  }
  if (cfg.flip) holder.rotateX(Math.PI);
  holder.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(holder);
  const s = box.getSize(new THREE.Vector3());
  const scale = cfg.fit === 'width' ? height / Math.max(s.x, s.z) : height / Math.max(s.y, 1e-6);
  const centre = box.getCenter(new THREE.Vector3());
  const out = new THREE.Group();
  holder.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
  holder.scale.setScalar(scale);
  out.add(holder);
  out.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.material = mats.map((m) => {
      const std = m.isMeshStandardMaterial ? m.clone() : new THREE.MeshStandardMaterial({ color: m.color ?? 0xdddddd, map: m.map ?? null });
      if (cfg.tint && (!std.map || cfg.forceTint)) std.color.set(cfg.tint);
      if (cfg.roughness != null) std.roughness = cfg.roughness;
      if (cfg.metalness != null) std.metalness = cfg.metalness;
      else if (!std.map) { std.metalness = Math.min(std.metalness, 0.4); std.roughness = Math.max(std.roughness, 0.35); }
      std.side = THREE.FrontSide;
      return std;
    });
    if (o.material.length === 1) o.material = o.material[0];
  });
  out.userData.nasa = cfg.model;
  return out;
}

/** Loads every model the table needs and builds the prototypes. Resolves when done (missing files are skipped). */
export async function preloadNasaParts(catalog) {
  const slugs = [...new Set(Object.values(NASA_PARTS).map((c) => c.model))];
  const scenes = Object.fromEntries(await Promise.all(slugs.map(async (s) => [s, await loadFile(s)])));
  for (const [partId, cfg] of Object.entries(NASA_PARTS)) {
    const def = catalog.get(partId);
    const scene = scenes[cfg.model];
    if (!def || !scene) continue;
    try {
      const proto = normalise(scene, cfg, def.height);
      if (proto) protos.set(partId, proto);
    } catch (error) {
      console.warn(`[nasa] could not prepare ${partId} from ${cfg.model}:`, error);
    }
  }
  ready = true;
  if (failures.size) console.warn('[nasa] models that did not load:', Object.fromEntries(failures));
  return protos.size;
}

export const nasaReady = () => ready;
export const hasNasaArt = (partId) => protos.has(partId);

/** A fresh copy of the real model for this part, or null when there is none (yet). */
export function nasaPartArt(partId) {
  const proto = protos.get(partId);
  if (!proto) return null;
  const copy = proto.clone(true);
  copy.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone(); });
  return copy;
}

/**
 * A real NASA model as hall equipment: loaded and normalised like a part (standing on y = 0, centred, `height`
 * metres tall, or `fit: 'width'` metres wide). Resolves to null when the file is missing, never throws.
 */
export async function nasaProp(slug, cfg = {}, height = 1) {
  const scene = await loadFile(slug);
  if (!scene) return null;
  try {
    return normalise(scene, { ...cfg, model: slug }, height);
  } catch (error) {
    console.warn(`[nasa] could not prepare prop ${slug}:`, error);
    return null;
  }
}
