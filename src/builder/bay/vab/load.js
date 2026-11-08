// The VAB hall data (Codex/v5 layout + the part fragments) and its GLB modules, merged exactly as the approved
// v5 sandbox merges them (sandbox/role1.hangar.v5.js), minus the mobile launcher the human removed.
// layout.json + v5/{hall,decks,access,stage}.json: placements, colliders, sliding deck segments, console bank.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export const BASE = '/assets/models/builder/hangar/';
export const BANK_DISTANCE = 22; // the human picked the 22 m bank (2026-11-08)
const PARTS = ['hall', 'decks', 'access', 'stage'];

const json = (url) => fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));

/** Texture filtering for the hall modules; far copies drop the fine maps so distant grating does not shimmer. */
export function filterMaterial(material, renderer, far = false) {
  const m = material.clone();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const key of ['map', 'aoMap', 'normalMap', 'roughnessMap', 'metalnessMap']) if (m[key]) { m[key].anisotropy = anisotropy; m[key].generateMipmaps = true; }
  if (far) { m.roughness = Math.max(0.78, m.roughness); m.metalness = 0.18; m.normalMap = null; m.roughnessMap = null; m.metalnessMap = null; m.aoMap = null; m.envMapIntensity = 0.12; }
  return m;
}

/** Layout, fragments and the merged placement / collider lists (no GLBs yet). */
export async function loadVabData() {
  const layout = await fetch(BASE + 'layout.json').then((r) => { if (!r.ok) throw Error(`hangar layout ${r.status}`); return r.json(); });
  const fragments = Object.fromEntries(await Promise.all(PARTS.map(async (n) => [n, await json(`${BASE}v5/${n}.json`)])));
  for (const f of Object.values(fragments)) Object.assign(layout.modules, f.modules ?? {});
  const all = Object.values(fragments);
  const hiddenPlacements = new Set(all.flatMap((f) => f.hidePlacements ?? []));
  const hiddenModules = new Set(all.flatMap((f) => f.hideModules ?? []));
  hiddenModules.add('mobile_launcher'); // the slim launch mount (mount.js) stands in for it
  const colliderHidden = (c) => c.kind === 'ml' || all.some((f) => (f.hideColliders ?? []).some((h) => (!h.kind || h.kind === c.kind) && (!h.region || c.center.every((v, i) => v >= h.region.min[i] && v <= h.region.max[i]))));
  const segments = Object.fromEntries([...layout.wrap.segments, ...all.flatMap((f) => f.segments ?? [])].map((s) => [s.id, s]));
  const base = [
    ...layout.placements.filter((p) => p.module !== 'platform_half'),
    ...layout.wrap.placements,
    { id: 'console_island_v4', module: layout.wrap.islandModule, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  ];
  const placements = [...base.filter((p) => !hiddenPlacements.has(p.id) && !hiddenModules.has(p.module)), ...all.flatMap((f) => f.placements ?? [])];
  const colliders = [...layout.colliders.filter((c) => c.kind !== 'platform'), ...(fragments.decks.dropV4WrapColliders ? [] : layout.wrap.colliders)]
    .filter((c) => !colliderHidden(c)).concat(all.flatMap((f) => f.colliders ?? []));
  const bank = fragments.stage?.banks?.[BANK_DISTANCE] ?? fragments.stage?.banks?.[fragments.stage?.bankDistance] ?? null;
  // the hall part may widen the walls; the player's bounds follow it
  const halfWidth = fragments.hall?.hallBounds?.max?.[0] ?? layout.hallBounds?.max?.[0] ?? 22;
  const used = new Set();
  for (const p of placements) { used.add(p.module); if (p.lod) used.add(p.lod); if (p.module === 'catwalk') used.add('catwalk_far'); }
  if (bank) { used.add(layout.wrap.consoleModule); used.add(bank.island.module); }
  const modules = [...used].filter((id) => layout.modules[id]);
  return { layout, fragments, segments, placements, colliders, bank, halfWidth, modules };
}

/**
 * Loads the GLB modules one after the other (the machine is shared; one Draco worker), with filtered materials
 * shared by name. `alive()` lets a disposed scene stop the download early.
 */
export async function loadVabModules(data, renderer, alive = () => true) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/assets/draco/');
  draco.setWorkerLimit(1);
  loader.setDRACOLoader(draco);
  const assets = new Map(), materials = new Map();
  try {
    for (const id of data.modules) {
      if (!alive()) break;
      const gltf = await loader.loadAsync(BASE + data.layout.modules[id].file);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const key = o.material.name;
        if (materials.has(key)) o.material = materials.get(key);
        else { o.material = filterMaterial(o.material, renderer, id.endsWith('_far') || id.endsWith('_lod')); materials.set(key, o.material); }
      });
      gltf.scene.updateMatrixWorld(true);
      assets.set(id, gltf.scene);
    }
  } finally {
    draco.dispose();
  }
  return { assets, materials };
}

export const disposeAssets = ({ assets, materials }) => {
  const geometries = new Set();
  for (const root of assets.values()) root.traverse((o) => { if (o.isMesh) geometries.add(o.geometry); });
  geometries.forEach((g) => g.dispose());
  for (const m of materials.values()) {
    for (const key of ['map', 'aoMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) m[key]?.dispose?.();
    m.dispose();
  }
};

export const deg = THREE.MathUtils.degToRad;
