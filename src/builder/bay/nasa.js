// Real spacecraft hardware for the catalogue parts: public-domain models from github.com/nasa/NASA-3D-Resources
// (public/assets/nasa/*.glb), cut out by node name where a file holds a whole vehicle, then normalised so every
// part stands on y = 0, centred on the stack axis, scaled to its catalogue height. Credit: NASA.
// Files load on demand (requestPartArt): nothing downloads until a part is on the stand or on the design page.
// Also Role 1's own Blender models (a part's `model: { builder: '<section>/<slug>' }`, public/assets/models/builder/):
// built to the game's contract (src/builder/tools/blender/README.md), so they are used exactly as exported, with no
// normalising; their inner pieces are the nodes named slot_<key> (or slot_<key>__<optionId>).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const BASE = '/assets/nasa/';
const BUILDER_BASE = '/assets/models/builder/';
const draco = new DRACOLoader();
draco.setDecoderPath('/assets/draco/'); // the decoder copied from three/examples/jsm/libs/draco/gltf (Apache-2.0)
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);

/**
 * Which model each part uses (filled from the parts' `model` field by registerNasaModels). `nodes` selects children by name (whole file when absent); `up` says which model axis
 * becomes the vertical: 'x' | 'y' | 'z' | 'long' (longest side) | 'short' (shortest side); `thin` optionally turns the
 * thinnest side towards +x (outward, for panels and dishes); `flip` turns the part upside down; `tint` recolours
 * untextured models; `fit` scales by 'height' (default) or 'width'.
 */
export const NASA_PARTS = {};

/** The extra copies a Blender model may ship ("model": { "builder", "lod", "vac", "lodVac", "lodSpike" }). */
export const COPY_KEYS = ['lod', 'vac', 'lodVac', 'lodSpike'];

/** Reads each part's `model` field (sections/<id>/parts.json) into NASA_PARTS. Call once with the catalogue. */
export function registerNasaModels(catalog) {
  for (const def of catalog.parts) {
    if (def.model?.builder) {
      NASA_PARTS[def.id] = { builder: def.model.builder };
      // its other copies: lod (low detail, for big clusters), vac (the vacuum bell), lodVac and lodSpike (low detail
      // with the vacuum bell or the aerospike)
      for (const k of COPY_KEYS) if (typeof def.model[k] === 'string') NASA_PARTS[`${def.id}#${k}`] = { builder: def.model[k] };
    }
    else if (def.model?.model) NASA_PARTS[def.id] = def.model;
  }
  return Object.keys(NASA_PARTS).length;
}

const files = new Map(); // model slug -> Promise<scene|null>
const protos = new Map(); // part id -> normalised Object3D (prototype)
const pending = new Map(); // part id -> Promise

const failures = new Map(); // slug -> message
function loadFile(slug, url = `${BASE}${slug}.glb`) {
  if (!files.has(slug)) {
    files.set(slug, new Promise((resolve) => loader.load(url, (g) => resolve(g.scene), undefined, (error) => {
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
  out.traverse((o) => { o.userData.sharedGeometry = true; }); // copies share these buffers: disposeObject keeps them
  return out;
}

/**
 * Loads the model one part needs and builds its prototype. Resolves to true when real art is ready for it
 * (false for parts without a model or when the file is missing). Never throws.
 */
export function requestPartArt(partId, catalog) {
  const cfg = NASA_PARTS[partId];
  const def = catalog.get(partId.split('#')[0]);
  if (!cfg || !def) return Promise.resolve(false);
  if (protos.has(partId)) return Promise.resolve(true);
  if (!pending.has(partId)) {
    const file = cfg.builder ? loadFile(`builder:${cfg.builder}`, `${BUILDER_BASE}${cfg.builder}.glb`) : loadFile(cfg.model);
    pending.set(partId, file.then((scene) => {
      if (!scene) return false;
      try {
        const proto = cfg.builder ? builderProto(scene) : normalise(scene, cfg, def.height);
        if (proto) protos.set(partId, proto);
        return !!proto;
      } catch (error) {
        console.warn(`[nasa] could not prepare ${partId} from ${cfg.model}:`, error);
        return false;
      }
    }));
  }
  return pending.get(partId);
}

/** Loads the models for a list of part ids. Resolves to the number that now have real art. */
export async function preloadNasaParts(catalog, ids = Object.keys(NASA_PARTS)) {
  ids = [...ids, ...COPY_KEYS.flatMap((k) => ids.filter((id) => NASA_PARTS[`${id}#${k}`]).map((id) => `${id}#${k}`))]; // its low-detail and vacuum copies load with it
  const results = await Promise.all([...new Set(ids)].map((id) => requestPartArt(id, catalog)));
  if (failures.size) console.warn('[nasa] models that did not load:', Object.fromEntries(failures));
  return results.filter(Boolean).length;
}

/** A Blender model built to the contract: used as exported (origin, scale and orientation are already the game's). */
function builderProto(scene) {
  const proto = scene.clone(true);
  proto.traverse((o) => { o.userData.sharedGeometry = true; }); // copies share these buffers: disposeObject keeps them
  proto.updateMatrixWorld(true);
  proto.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return proto;
}

/**
 * Shows only the chosen look of each inner piece of a Blender model: for every slot key, slot_<key>__<optionId> when
 * that option is fitted (options: { key: optionId }) and the model has it, else the plain slot_<key> (the first
 * option's look); every other variant is hidden. A shown piece may hide other slots through its glTF extras
 * ({ "hides": "nozzleExt" } or a list), e.g. an aerospike or a conical nozzle that replaces the bell extension.
 */
export function applyChoices(object, options = null) {
  const slots = new Map();
  // only the outermost slot_ nodes count: three.js names the per-material children of a node after its mesh data, which
  // Blender often names like the node (slot_x__y_1, slot_x__y_2…)
  const insideSlot = (o) => { for (let p = o.parent; p; p = p.parent) if (p.name?.startsWith('slot_')) return true; return false; };
  object.traverse((o) => {
    if (!o.name?.startsWith('slot_') || insideSlot(o)) return;
    const [key, variant] = o.name.slice(5).split('__');
    if (!slots.has(key)) slots.set(key, { base: null, variants: new Map() });
    const s = slots.get(key);
    if (variant) s.variants.set(variant, o); else s.base = o;
  });
  const shown = new Map();
  for (const [key, s] of slots) {
    const pick = s.variants.get(options?.[key]) ?? s.base;
    if (s.base) s.base.visible = false;
    for (const v of s.variants.values()) v.visible = false;
    if (pick) { pick.visible = true; shown.set(key, pick); }
  }
  for (const node of shown.values()) {
    const hides = node.userData?.hides;
    for (const key of [].concat(hides ?? [])) { const other = shown.get(key); if (other) other.visible = false; }
  }
  return object;
}

/**
 * A ground model of the Launch pad card (public/assets/models/builder/pad/<slug>.glb, built to the "Ground models"
 * rules of src/builder/tools/blender/README.md, used whole: sections/pad/art.js places and scales its nodes). Resolves
 * to the loaded scene, shared: copy it with clone() and never change it. Resolves to null when the file is missing;
 * each file loads once; never throws.
 */
export function loadGroundModel(slug) {
  return loadFile(`builder:${slug}`, `${BUILDER_BASE}${slug}.glb`).then((scene) => {
    scene?.updateMatrixWorld(true);
    scene?.traverse((o) => { o.userData.sharedGeometry = true; }); // pieces cloned from it share its buffers
    return scene;
  });
}

/** Is this part drawn by one of Role 1's Blender models (when loaded)? */
export const isBuilderModel = (partId) => !!NASA_PARTS[partId]?.builder;

/**
 * The model's own inner piece for a kit slot, placed where it sits in the part, or null: the node named
 * slot_<key>__<optionId> when the model has a version for that choice, else slot_<key>.
 */
export function modelSlotPiece(partId, key, optionId = null) {
  const proto = protos.get(partId);
  if (!proto || !NASA_PARTS[partId]?.builder) return null;
  const node = (optionId && proto.getObjectByName(`slot_${key}__${optionId}`)) || proto.getObjectByName(`slot_${key}`);
  if (!node) return null;
  const copy = bakedClone(node);
  copy.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone(); });
  return copy;
}

/**
 * The slot keys a Blender model's chosen pieces replace (their glTF extras "hides"), e.g. the glass dome replaces the
 * docking port: { key: the slot whose piece replaces it }. options: { slotKey: optionId }.
 */
export function modelSlotHides(partId, options = null) {
  const proto = protos.get(partId);
  const out = {};
  if (!proto || !NASA_PARTS[partId]?.builder) return out;
  const keys = new Set();
  proto.traverse((o) => { if (o.name?.startsWith('slot_')) keys.add(o.name.slice(5).split('__')[0]); });
  for (const key of keys) {
    const id = options?.[key];
    const node = (id && proto.getObjectByName(`slot_${key}__${id}`)) || proto.getObjectByName(`slot_${key}`);
    for (const k of [].concat(node?.userData?.hides ?? [])) if (k !== key) out[k] = key;
  }
  return out;
}

export const hasNasaArt = (partId) => protos.has(partId);
export const wantsNasaArt = (partId) => !!NASA_PARTS[partId] && !protos.has(partId);

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
