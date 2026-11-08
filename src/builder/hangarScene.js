// The engineering bay: the round integration hall with the vehicle on its stand, the stations, the first-person
// engineer, the wall screen and the test stand. index.js owns one of these for HANGAR and GONOGO.
import * as THREE from 'three';
import { PLANETS, G0 } from '/src/core/index.js';
import { createRoom, createStand, HALL } from './bay/room.js';
import { createStations } from './bay/stations.js';
import { createPlayer } from './bay/player.js';
import { createWallScreen } from './bay/screen.js';
import { createTestStand } from './bay/teststand.js';
import { partArt } from './bay/partArt.js';
import { DEG, disposeObject, polar } from './bay/util.js';
import { BASE_RADIUS, SIZE_SCALE } from './assembly.js';
import { box, std } from './bay/util.js';

const HIGHLIGHT = new THREE.Color(0x67e8f9);
const SELECTED = new THREE.Color(0xfbbf24);

export function createHangarScene({ renderer }) {
  const scene = new THREE.Scene();
  scene.name = 'engineering-bay';
  const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 220);

  const room = createRoom(scene);
  const stand = createStand(scene);
  const stations = createStations(scene);
  renderer.localClippingEnabled = true; // the engineer's body is clipped at the neck so the camera never sits inside the head
  const player = createPlayer(scene, camera, { stations, obstacles: room.obstacles, start: polar(HALL.doorAngle, HALL.radius - 2.6, 0), gravity: PLANETS.earth.g });
  player.lookAt(0, 0);
  const wall = createWallScreen(scene, { renderer, getScene: () => scene, standTop: stand.standTop });

  const rocket = new THREE.Group();
  rocket.name = 'vehicle';
  rocket.position.y = stand.standTop;
  scene.add(rocket);
  const test = createTestStand({ scene, rocket, standTop: stand.standTop, planets: PLANETS, g0: G0 });

  const groups = new Map();
  const anchors = [];
  const glows = new Map();
  let selected = null;
  let yaw = 0;
  let layoutCache = [];

  // ---------- vehicle ----------
  function setLayout(layout, freeNodes = []) {
    for (const child of [...rocket.children]) {
      if (child.name === 'vfx-run') continue;
      rocket.remove(child);
      disposeObject(child);
    }
    groups.clear();
    anchors.length = 0;
    layoutCache = layout;
    for (const e of layout) {
      const art = partArt(e);
      art.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
      let holder = art;
      if (e.attach === 'radial') {
        const pivot = new THREE.Group();
        pivot.position.set(0, e.y, 0);
        pivot.rotation.y = e.angle * DEG;
        const isFin = /fin/.test(e.type);
        const isLegs = /leg/.test(e.type);
        if (!isFin && !isLegs) art.position.x = e.radius + (art.userData.width ?? 0.6) * 0.45;
        if (isFin) art.position.x = e.radius - 1.2;
        pivot.add(art);
        holder = pivot;
      } else {
        art.position.y = e.y;
      }
      holder.userData.partId = e.id;
      rocket.add(holder);
      groups.set(e.id, holder);
      const handleLocal = e.attach === 'radial'
        ? new THREE.Vector3(Math.cos(e.angle * DEG) * (e.radius + 0.9), e.y + e.height * 0.5, -Math.sin(e.angle * DEG) * (e.radius + 0.9))
        : new THREE.Vector3(-e.radius - 0.6, e.centerY, 0);
      anchors.push({ kind: 'handle', partId: e.id, node: null, local: handleLocal, radius: e.radius, y: e.centerY });
    }
    for (const { partId, node } of freeNodes) {
      const e = layout.find((l) => l.id === partId);
      if (!e) continue;
      const local = node === 'top' ? new THREE.Vector3(0, e.y + e.height, 0)
        : node === 'bottom' ? new THREE.Vector3(0, e.y, 0)
        : new THREE.Vector3(e.radius + 0.25, e.y + e.height * 0.5, 0);
      anchors.push({ kind: 'node', partId, node, local, radius: e.radius, y: e.y + e.height * 0.5 });
    }
    // service arms slide so their plates touch the vehicle (built for a 1.83 m reach)
    const radius = layout.reduce((r, e) => (e.attach === 'axial' ? Math.max(r, e.radius) : r), 1.25);
    for (const arm of stand.arms) arm.position.x = radius - 1.83;
    applyGlow();
  }

  function applyGlow() {
    for (const [id, holder] of groups) {
      const glow = glows.get(id);
      const color = selected === id ? SELECTED : glow ? glow.color : null;
      holder.traverse((o) => {
        if (!o.isMesh || !o.material || !('emissive' in o.material)) return;
        if (!o.material.userData.cloned) {
          o.material = o.material.clone();
          o.material.userData.cloned = true;
          o.material.userData.baseEmissive = o.material.emissive.clone();
          o.material.userData.baseIntensity = o.material.emissiveIntensity;
        }
        if (color) {
          o.material.emissive.copy(color);
          o.material.emissiveIntensity = 0.9;
        } else {
          o.material.emissive.copy(o.material.userData.baseEmissive);
          o.material.emissiveIntensity = o.material.userData.baseIntensity;
        }
      });
    }
  }

  function highlight(ids, seconds = 1.6, color = HIGHLIGHT) {
    const until = performance.now() / 1000 + seconds;
    for (const id of ids) if (groups.has(id)) glows.set(id, { until, color });
    applyGlow();
  }

  function select(id) {
    selected = id;
    applyGlow();
  }

  function worldAnchors() {
    rocket.updateMatrixWorld(true);
    const toCam = new THREE.Vector3().subVectors(camera.position, rocket.position).setY(0).normalize();
    const out = [];
    for (const a of anchors) {
      const local = a.local.clone();
      if (a.kind === 'node' && a.node === 'radial') local.set(toCam.x * (a.radius + 0.25), a.y, toCam.z * (a.radius + 0.25)).applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
      out.push({ ...a, world: local.applyMatrix4(rocket.matrixWorld) });
    }
    return out;
  }

  // ---------- spare hardware on pallets: real part art, placed once the NASA models are in ----------
  let decorated = false;
  function decorate(catalog) {
    if (decorated) return;
    decorated = true;
    const spares = [
      { id: 'capsule_s', deg: 246, r: 12.6, yaw: 0.4, collider: 0.9 }, // a return capsule by the warehouse
      { id: 'battery', deg: 236, r: 11.8, yaw: 0.2, collider: 0.6 },
      { id: 'o2_bottle', deg: 212, r: 13.4, yaw: 0, collider: 0.5 },
      { id: 'nose_pointed_m', deg: 118, r: 12.6, yaw: 0, collider: 0.9 }, // a nose cone waiting at the structures bay
      { id: 'heat_shield_m', deg: 86, r: 13.6, yaw: 0, collider: 0.9 },
    ];
    const wood = std(0x8a6a3f, { roughness: 0.9, metalness: 0 });
    for (const s of spares) {
      const def = catalog.get(s.id);
      if (!def) continue;
      const p = polar(s.deg, s.r, 0);
      const pallet = box(1.4, 0.14, 1.1, wood, { x: p.x, y: 0.07, z: p.z });
      pallet.rotation.y = -s.deg * DEG + Math.PI / 2 + s.yaw;
      pallet.castShadow = pallet.receiveShadow = true;
      const art = partArt({ type: def.id, attach: def.attach, height: def.height, def, radius: BASE_RADIUS * (SIZE_SCALE[def.size] ?? 1) });
      art.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
      art.position.set(p.x, 0.14, p.z);
      art.rotation.y = pallet.rotation.y;
      scene.add(pallet, art);
      room.obstacles.push({ x: p.x, z: p.z, r: s.collider });
    }
  }

  // ---------- stations ----------
  function nearestStation() {
    const p = player.position;
    const fwd = player.forward();
    let best = null, bestD = Infinity;
    for (const s of stations) {
      const d = Math.hypot(s.position.x - p.x, s.position.z - p.z);
      if (d > 3.2) continue;
      const to = new THREE.Vector3(s.position.x - p.x, 0, s.position.z - p.z).normalize();
      if (to.dot(fwd) < 0.35) continue;
      if (d < bestD) { best = s; bestD = d; }
    }
    return best;
  }

  function placeAtStation(id) {
    const s = stations.find((st) => st.id === id);
    if (!s) return;
    player.teleport(s.usePoint.x, s.usePoint.z);
    if (id === 'integration' || id === 'teststand') player.lookAt(0, 0); else player.lookAt(s.position.x, s.position.z);
  }

  // ---------- frame ----------
  function update(dt, controls = {}) {
    rocket.rotation.y = yaw;
    const now = performance.now() / 1000;
    let changed = false;
    for (const [id, glow] of glows) if (glow.until < now) { glows.delete(id); changed = true; }
    if (changed) applyGlow();
    for (const [id, holder] of groups) {
      const glow = glows.get(id);
      if (!glow && selected !== id) continue;
      const pulse = 0.55 + 0.45 * Math.sin(now * 6);
      holder.traverse((o) => { if (o.isMesh && o.material?.userData?.cloned) o.material.emissiveIntensity = 0.5 + 0.7 * pulse; });
    }
    player.update(dt, controls);
    test.update(dt);
  }

  function dispose() {
    for (const child of [...rocket.children]) disposeObject(child);
    player.dispose();
    wall.dispose();
  }

  return {
    scene, camera, rocket, player, stations, stand, room, wall, test, hall: HALL,
    setLayout, highlight, clearHighlight: () => { glows.clear(); applyGlow(); }, select, worldAnchors,
    decorate,
    rotateBy: (deg) => { yaw += deg * DEG; },
    nearestStation, placeAtStation, update, dispose,
    get layout() { return layoutCache; },
    get planets() { return PLANETS; },
    get g0() { return G0; },
  };
}
