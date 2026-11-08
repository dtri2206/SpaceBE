// The VAB structure as instanced batches (one InstancedMesh per module x mesh node x material x near/far), with the
// v5 sandbox's distance LOD (decks measured to their footprint) and the sliding deck segments.
// Unlike the sandbox, static placements are not cloned on every rebuild: each module's mesh nodes are measured once
// and an instance matrix is placement matrix x node matrix. Only the posed parts (elevator cab, crew arm, crane, door)
// keep a cloned node tree.
import * as THREE from 'three';
import { deg, filterMaterial } from './load.js';

const POSED = new Set(['elevator', 'crewArm', 'crane', 'door']);
const DECK_LOD = [14, 12, 16]; // first choice, back to near below, to far above (hysteresis)
const PART_LOD = [22, 19, 25];

function chosen(o) { for (let n = o; n; n = n.parent) if (n.name.startsWith('slot_cut__')) return false; return true; }

export function createHall({ scene, data, assets, materials, renderer, camera }) {
  const { layout, segments, placements } = data;
  const group = new THREE.Group();
  group.name = 'vab-hall';
  scene.add(group);

  // ---- per module: its mesh nodes relative to the module root ----
  const nodeCache = new Map();
  function nodesOf(id) {
    if (nodeCache.has(id)) return nodeCache.get(id);
    const root = assets.get(id);
    const out = [];
    root?.updateMatrixWorld(true);
    root?.traverse((n) => { if (n.isMesh && chosen(n)) out.push({ name: n.name, geometry: n.geometry, material: n.material, local: n.matrixWorld.clone() }); });
    nodeCache.set(id, out);
    return out;
  }
  const farMaterials = new Map();
  const farMaterial = (m) => { if (!farMaterials.has(m)) farMaterials.set(m, filterMaterial(m, renderer, true)); return farMaterials.get(m); };
  const lensMaterial = (m, close) => {
    const key = 'lamp-lens-' + close;
    if (!materials.has(key)) { const c = m.clone(); c.name = key; c.emissiveIntensity = close ? 1.8 : 0.35; materials.set(key, c); }
    return materials.get(key);
  };
  const visibleNode = (p, name) => {
    if (name.startsWith('opt_') && !(p.showNodes ?? segments[p.segment]?.showNodes ?? []).includes(name)) return false;
    if (name.startsWith('seam_cover_') && p.segment && !(segments[p.segment]?.seamCoverIds ?? []).includes(name)) return false;
    return true;
  };

  // ---- per placement state: slide offset, posed clone, its base matrix ----
  const states = new Map();
  const tmp = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(), euler = new THREE.Euler();
  for (const p of placements) {
    const s = { p, offset: 0, matrix: new THREE.Matrix4(), clones: new Map(), holder: null, slots: [] };
    states.set(p.id, s);
  }
  function placementMatrix(s) {
    const p = s.p;
    pos.fromArray(p.position);
    if (p.dynamic === 'wrapSegment') { pos.x += p.axis[0] * s.offset; pos.y += p.axis[1] * s.offset; pos.z += p.axis[2] * s.offset; }
    quat.setFromEuler(euler.set(deg(p.rotation[0]), deg(p.rotation[1]), deg(p.rotation[2])));
    scl.fromArray(p.scale ?? [1, 1, 1]);
    return s.matrix.compose(pos, quat, scl);
  }
  /** The cloned node tree of a posed placement (one per module id, since LOD may swap the module). */
  function holderOf(s, id) {
    if (!s.clones.has(id)) {
      const holder = new THREE.Group();
      holder.add(assets.get(id).clone(true));
      holder.position.fromArray(s.p.position);
      holder.rotation.set(...s.p.rotation.map(deg));
      holder.scale.fromArray(s.p.scale ?? [1, 1, 1]);
      s.clones.set(id, holder);
    }
    return s.clones.get(id);
  }

  // ---- footprint LOD ----
  const lodChoices = new Map();
  const footprints = new Map();
  function footprint(p) {
    if (footprints.has(p.id)) return footprints.get(p.id);
    const b = layout.modules[p.module]?.bounds;
    let box = null;
    if (b) {
      const a = deg(p.rotation?.[1] ?? 0), c = Math.cos(a), s = Math.sin(a);
      box = new THREE.Box3();
      for (const x of [b.min[0], b.max[0]]) for (const z of [b.min[2], b.max[2]]) for (const y of [b.min[1], b.max[1]]) box.expandByPoint(new THREE.Vector3(p.position[0] + x * c + z * s, p.position[1] + y, p.position[2] - x * s + z * c));
    }
    footprints.set(p.id, box);
    return box;
  }
  const at = new THREE.Vector3();
  function distant(p) {
    const deck = p.dynamic === 'wrapSegment', previous = lodChoices.get(p.id), t = deck ? DECK_LOD : PART_LOD;
    const threshold = previous === undefined ? t[0] : previous ? t[1] : t[2];
    const box = deck ? footprint(p) : null;
    const d2 = box ? box.distanceToPoint(camera.position) ** 2 : camera.position.distanceToSquared(at.fromArray(p.position));
    return d2 > threshold * threshold;
  }

  // ---- build the batches ----
  let batches = [];
  let moving = []; // placements whose instances follow them every frame (sliding decks, posed parts)
  let buildCount = 0;
  function build() {
    buildCount++;
    for (const b of batches) { group.remove(b.mesh); b.mesh.dispose(); }
    batches = [];
    moving = [];
    const map = new Map();
    for (const s of states.values()) {
      const p = s.p;
      const far = distant(p);
      lodChoices.set(p.id, far);
      let id = far && p.lod ? p.lod : p.module;
      if (p.module === 'catwalk' && far) id = 'catwalk_far';
      if (!assets.has(id)) continue;
      s.slots = [];
      const posed = POSED.has(p.dynamic);
      let nodes;
      if (posed) {
        const holder = holderOf(s, id);
        s.holder = holder;
        holder.updateMatrixWorld(true);
        nodes = [];
        holder.traverse((n) => { if (n.isMesh && chosen(n)) nodes.push({ name: n.name, geometry: n.geometry, material: n.material, node: n }); });
      } else nodes = nodesOf(id);
      const close = p.module === 'lamp' ? camera.position.distanceTo(at.fromArray(p.position)) < 20 : false;
      for (const n of nodes) {
        if (!visibleNode(p, n.name)) continue;
        let material = far ? farMaterial(n.material) : n.material;
        if (p.module === 'lamp' && n.name === 'body') material = lensMaterial(n.material, close);
        const key = `${id}/${n.name}/${material.name}/${material.uuid}`;
        let b = map.get(key);
        if (!b) { b = { geometry: n.geometry, material, count: 0, mesh: null }; map.set(key, b); }
        s.slots.push({ batch: b, index: b.count++, node: n.node ?? null, local: n.local ?? null });
      }
      if (p.dynamic) moving.push(s);
    }
    for (const b of map.values()) {
      b.mesh = new THREE.InstancedMesh(b.geometry, b.material, b.count);
      b.mesh.frustumCulled = false;
      b.mesh.matrixAutoUpdate = false;
      if (b.count > 0) b.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(b.mesh);
      batches.push(b);
    }
    for (const s of states.values()) write(s);
    for (const b of batches) b.mesh.instanceMatrix.needsUpdate = true;
    lastLod.copy(camera.position);
  }
  function write(s) {
    if (!s.slots.length) return;
    if (s.holder) {
      s.holder.updateMatrixWorld(true);
      for (const slot of s.slots) slot.batch.mesh.setMatrixAt(slot.index, slot.node.matrixWorld);
    } else {
      const m = placementMatrix(s);
      for (const slot of s.slots) slot.batch.mesh.setMatrixAt(slot.index, tmp.multiplyMatrices(m, slot.local));
    }
    for (const slot of s.slots) slot.batch.mesh.instanceMatrix.needsUpdate = true;
  }

  // ---- sliding decks: the v5 top-down wave ----
  let mode = 'close', waveStart = -10, clock = 0, fits = null;
  const targetOf = (p) => (mode === 'retract' || fits?.[p.level]?.[p.segment]?.retract ? p.retracted ?? 4 : 0);
  function setMode(next, { instant = false } = {}) {
    mode = next;
    waveStart = clock;
    if (instant) for (const s of states.values()) if (s.p.dynamic === 'wrapSegment') { s.offset = targetOf(s.p); write(s); }
  }
  function setFits(f) {
    fits = f;
    for (const s of states.values()) if (s.p.dynamic === 'wrapSegment') { s.offset = targetOf(s.p); write(s); } // a new ship: decks jump to their place
  }

  // ---- per frame ----
  const lastLod = new THREE.Vector3(1e9, 0, 0);
  let lodTimer = 0;
  function update(dt, { lod = true } = {}) {
    clock += dt;
    for (const s of moving) {
      const p = s.p;
      if (p.dynamic !== 'wrapSegment') continue;
      if (clock - waveStart < (10 - p.level) * 0.045) continue;
      const target = targetOf(p);
      if (Math.abs(s.offset - target) < 1e-4) { if (s.offset !== target) { s.offset = target; write(s); } continue; }
      s.offset = THREE.MathUtils.damp(s.offset, target, 5.5, dt);
      write(s);
    }
    lodTimer += dt;
    if (lod && lodTimer > 0.75 && camera.position.distanceToSquared(lastLod) > 16) {
      lodTimer = 0;
      lastLod.copy(camera.position);
      for (const s of states.values()) if (Boolean(lodChoices.get(s.p.id)) !== distant(s.p)) { build(); break; }
    }
  }
  /** Re-reads a posed placement after its nodes were moved (the crew arm). */
  function repose(dynamic, fn) {
    for (const s of states.values()) {
      if (s.p.dynamic !== dynamic) continue;
      for (const holder of s.clones.values()) fn(holder);
      write(s);
    }
  }
  const offsetOf = (level, segment) => {
    for (const s of moving) if (s.p.level === level && s.p.segment === segment && s.p.module === (segments[segment]?.module ?? s.p.module)) return s.offset;
    return 0;
  };
  /** True while any deck is still sliding. */
  const sliding = () => moving.some((s) => s.p.dynamic === 'wrapSegment' && Math.abs(s.offset - targetOf(s.p)) > 0.02);

  function dispose() {
    for (const b of batches) { group.remove(b.mesh); b.mesh.dispose(); }
    batches = [];
    for (const m of farMaterials.values()) m.dispose();
    scene.remove(group);
  }

  return {
    group, build, update, setMode, setFits, repose, offsetOf, sliding, dispose,
    get mode() { return mode; },
    get batches() { return batches; },
    get buildCount() { return buildCount; },
    states,
  };
}

/** Ground-level box colliders (the player walks the floor only for now) and a push-out resolver. */
export function groundColliders(data) {
  return data.colliders
    .filter((c) => c.kind !== 'floor' && c.dynamic !== 'wrapSegment' && c.center[1] - c.size[1] / 2 < 1.8 && c.center[1] + c.size[1] / 2 > 0.05)
    .map((c) => ({ minX: c.center[0] - c.size[0] / 2, maxX: c.center[0] + c.size[0] / 2, minZ: c.center[2] - c.size[2] / 2, maxZ: c.center[2] + c.size[2] / 2, kind: c.kind }));
}

/** Pushes a point of radius r out of boxes [{minX,maxX,minZ,maxZ}] and circles [{x,z,r}], and keeps it in the hall. */
export function resolveCollisions(p, r, boxes, circles, half) {
  for (const c of circles) {
    const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + r;
    if (d < min) { const k = d > 1e-4 ? min / d : 0; p.x = d > 1e-4 ? c.x + dx * k : c.x + min; p.z = d > 1e-4 ? c.z + dz * k : p.z; }
  }
  for (const b of boxes) {
    if (p.x <= b.minX - r || p.x >= b.maxX + r || p.z <= b.minZ - r || p.z >= b.maxZ + r) continue;
    const push = [[b.minX - r - p.x, 'x'], [b.maxX + r - p.x, 'x'], [b.minZ - r - p.z, 'z'], [b.maxZ + r - p.z, 'z']];
    let best = push[0];
    for (const q of push) if (Math.abs(q[0]) < Math.abs(best[0])) best = q;
    p[best[1]] += best[0];
  }
  const lim = half - 0.5;
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.z = Math.max(-lim, Math.min(lim, p.z));
}
