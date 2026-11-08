// Loads the CC0 Poly Haven assets listed in data/bayAssets.json (HDRI, PBR texture sets, GLTF props).
// Everything is optional: a missing file simply means a procedural fallback, never a broken scene.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import manifest from '../data/bayAssets.json';

const BASE = '/assets/polyhaven/';
const textureLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();
const rgbeLoader = new HDRLoader();
const cache = new Map();

const load = (loader, url) => new Promise((resolve) => loader.load(url, resolve, undefined, () => resolve(null)));

/** { map, normalMap, aoMap, roughnessMap, metalnessMap } or null. The arm map carries AO (R), roughness (G), metalness (B). */
export async function loadTextureSet(name, { repeat = [1, 1] } = {}) {
  const entry = manifest.textures?.[name];
  if (!entry) return null;
  const key = `tex:${name}:${repeat.join('x')}`;
  if (cache.has(key)) return cache.get(key);
  const promise = (async () => {
    const [diff, nor, arm] = await Promise.all([
      entry.diff ? load(textureLoader, BASE + entry.diff) : null,
      entry.nor_gl ? load(textureLoader, BASE + entry.nor_gl) : null,
      entry.arm ? load(textureLoader, BASE + entry.arm) : null,
    ]);
    if (!diff) return null;
    for (const t of [diff, nor, arm]) {
      if (!t) continue;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
      t.anisotropy = 8;
    }
    diff.colorSpace = THREE.SRGBColorSpace;
    return { map: diff, normalMap: nor ?? undefined, aoMap: arm ?? undefined, roughnessMap: arm ?? undefined, metalnessMap: arm ?? undefined };
  })();
  cache.set(key, promise);
  return promise;
}

/** A MeshStandardMaterial with the texture set applied, or the fallback colour when the set is missing. */
export async function pbrMaterial(name, { repeat, color = 0x808080, roughness = 0.8, metalness = 0.1, fallbackColor = color } = {}) {
  const set = await loadTextureSet(name, { repeat });
  if (!set) return new THREE.MeshStandardMaterial({ color: fallbackColor, roughness, metalness });
  return new THREE.MeshStandardMaterial({ color: 0xffffff, ...set, roughness: 1, metalness: set.metalnessMap ? 1 : metalness });
}

/** Equirectangular HDRI for scene.environment. Null if missing. */
export async function loadEnvironment(name) {
  const rel = manifest.hdris?.[name];
  if (!rel) return null;
  const key = `hdri:${name}`;
  if (cache.has(key)) return cache.get(key);
  const promise = load(rgbeLoader, BASE + rel).then((t) => {
    if (t) t.mapping = THREE.EquirectangularReflectionMapping;
    return t;
  });
  cache.set(key, promise);
  return promise;
}

/** A fresh clone of a GLTF prop (shadows on), or null if missing. */
export async function loadProp(name) {
  const rel = manifest.models?.[name];
  if (!rel) return null;
  const key = `model:${name}`;
  if (!cache.has(key)) cache.set(key, load(gltfLoader, BASE + rel).then((g) => g?.scene ?? null));
  const scene = await cache.get(key);
  if (!scene) return null;
  const clone = scene.clone(true);
  clone.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return clone;
}

export const hasAssets = () => !!(manifest.hdris && Object.keys(manifest.hdris).length);
