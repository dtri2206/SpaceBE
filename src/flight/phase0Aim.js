// Aim-and-click picking for Phase 0: which checklist button is under the screen-centre reticle (three.js side; the rules are in phase0.js).
// Works on both cockpits by node name: procedural group `btn:<id>` (children btnCap / btnLamp) and the GLB flight deck meshes
// `btnCap.<id>` / `btnLamp.<id>` (GLTFLoader strips '.' and ':' so they arrive as btnCap<id> / btnLamp<id>; both spellings match).
import * as THREE from 'three';
import { CHECKLIST_STEPS, buttonIdOfName } from './phase0.js';

const raycaster = new THREE.Raycaster();
const box = new THREE.Box3(), sphere = new THREE.Sphere(), centre = new THREE.Vector2(0, 0), tmp = new THREE.Vector3();
const cache = new WeakMap(); // cockpit -> Map(id -> Mesh[])
const SLACK = 1.6; // the caps are small: a ray passing within 1.6 x the button's radius still counts

/** → Map(id -> meshes) for the checklist ids found in `cockpit` (an id with no mesh is absent). */
export function buttonMeshes(cockpit) {
  if (!cockpit) return new Map();
  let map = cache.get(cockpit);
  if (map) return map;
  map = new Map();
  cockpit.traverse((o) => {
    const id = buttonIdOfName(o.name, CHECKLIST_STEPS);
    if (!id) return;
    const list = map.get(id) ?? [];
    if (o.isMesh) list.push(o); else o.traverse((c) => { if (c.isMesh) list.push(c); });
    map.set(id, list);
  });
  for (const [id, list] of map) if (!list.length) map.delete(id);
  if (map.size) cache.set(cockpit, map); // only cache a real result (a GLB may still be filling in)
  return map;
}

export const hasButton = (cockpit, id) => buttonMeshes(cockpit).has(id);

/** World-space centre of a button (for the debug aimAt), or null. */
export function buttonCentre(cockpit, id, out = new THREE.Vector3()) {
  const meshes = buttonMeshes(cockpit).get(id);
  if (!meshes) return null;
  box.makeEmpty();
  for (const m of meshes) box.expandByObject(m);
  return box.getCenter(out);
}

/** The checklist button id under the centre of `camera`'s view, or null. Call after the camera and rig are positioned. */
export function pickButton(cockpit, camera) {
  const map = buttonMeshes(cockpit);
  if (!map.size) return null;
  camera.updateMatrixWorld(true);
  raycaster.setFromCamera(centre, camera);
  let best = null, bestScore = Infinity;
  for (const [id, meshes] of map) {
    cockpit.updateWorldMatrix(true, false);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    let score = Infinity;
    if (hit) score = hit.distance * 1e-3; // a real hit always beats a near miss
    else {
      box.makeEmpty();
      for (const m of meshes) box.expandByObject(m);
      box.getBoundingSphere(sphere);
      const d = raycaster.ray.distanceToPoint(sphere.center);
      const along = tmp.copy(sphere.center).sub(raycaster.ray.origin).dot(raycaster.ray.direction);
      if (along > 0 && d <= sphere.radius * SLACK) score = 1 + d / sphere.radius;
    }
    if (score < bestScore) { bestScore = score; best = id; }
  }
  return best;
}
