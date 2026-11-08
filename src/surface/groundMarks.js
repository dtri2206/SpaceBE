// Rover wheel tracks and astronaut boot prints on the Mars sand (Role 2).
// Pure part (Node-testable): createRingCursor, createDistanceSampler, createStepper.
// Three.js part: createGroundMarks() builds ONE track mesh per wheel side (preallocated BufferGeometry, ring buffer)
// and ONE InstancedMesh for boot prints. Materials and geometries are created once and reused.
import * as THREE from 'three';

export const TRACK_SPACING = 0.25; // m of travel between track points
export const TRACK_CAP = 1500; // quads per side (~375 m of tracks)
export const TRACK_WIDTH = 0.23; // LRV wheel width
export const STEP_STRIDE = 0.7; // m of walking per boot print (alternating feet)
export const PRINT_CAP = 400;
export const PRINT_SIZE = { w: 0.12, l: 0.3 };

/** Ring buffer bookkeeping: next() returns the slot to overwrite; count saturates at cap. */
export function createRingCursor(cap) {
  let head = 0, count = 0;
  return {
    get count() { return count; },
    get head() { return head; },
    next() { const i = head; head = (head + 1) % cap; count = Math.min(cap, count + 1); return i; },
  };
}

/** Emits a sample every `spacing` metres of travel. `jump` m or more between calls = teleport: restart. */
export function createDistanceSampler(spacing = TRACK_SPACING, jump = 5) {
  let last = null;
  return {
    reset() { last = null; },
    // returns null, or { x, z, fromX, fromZ } when a new sample is due
    update(x, z) {
      if (!last) { last = { x, z }; return null; }
      const d = Math.hypot(x - last.x, z - last.z);
      if (d > jump) { last = { x, z }; return null; }
      if (d < spacing) return null;
      const out = { x, z, fromX: last.x, fromZ: last.z };
      last = { x, z };
      return out;
    },
  };
}

/** One boot print per `stride` metres of walking, alternating left (-1) / right (+1) foot. */
export function createStepper(stride = STEP_STRIDE, jump = 5) {
  const sampler = createDistanceSampler(stride, jump);
  let side = 1;
  return {
    reset() { sampler.reset(); },
    update(x, z) {
      const s = sampler.update(x, z);
      if (!s) return null;
      const dx = s.x - s.fromX, dz = s.z - s.fromZ, d = Math.hypot(dx, dz) || 1;
      side = -side;
      return { x, z, dirX: dx / d, dirZ: dz / d, side };
    },
  };
}

function treadTexture() {
  const c = document.createElement('canvas');
  c.width = 32; c.height = 80;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 32, 80);
  g.fillStyle = 'rgba(0,0,0,0.9)';
  g.beginPath(); // sole outline, heel and ball of the foot
  g.roundRect(3, 2, 26, 52, 10); g.fill();
  g.roundRect(6, 58, 20, 20, 7); g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = 'rgba(0,0,0,0.55)'; // tread grooves
  for (let y = 8; y < 52; y += 7) g.fillRect(6, y, 20, 2.5);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createGroundMarks({ getGroundHeight, trackHalf = 0.915 } = {}) {
  const group = new THREE.Group();
  group.name = 'groundMarks';
  group.frustumCulled = false;
  const LIFT = 0.03;

  // ---- wheel tracks: each ring slot is its own quad (prev wheel position -> current), so wrap-around never draws a bogus strip ----
  const trackMat = new THREE.MeshBasicMaterial({
    color: 0x24120a, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const index = new Uint32Array(TRACK_CAP * 6);
  for (let i = 0; i < TRACK_CAP; i++) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
  const sides = [-1, 1].map(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRACK_CAP * 4 * 3), 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, trackMat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    group.add(mesh);
    return { geo, mesh, ring: createRingCursor(TRACK_CAP), prev: null };
  });
  const sampler = createDistanceSampler(TRACK_SPACING);

  function wheelPoint(side, x, z, rx, rz) {
    const wx = x + rx * trackHalf * side, wz = z + rz * trackHalf * side;
    return { wx, wz, ex: rx * TRACK_WIDTH / 2, ez: rz * TRACK_WIDTH / 2 };
  }

  /** rover: { x, z, right:{x,z}, onGround, overturned } while driving */
  let lastRover = null;
  function addRoverTracks(rover) {
    if (rover !== lastRover) { lastRover = rover; breakTracks(); } // switched rovers: no ribbon between them
    const smp = sampler.update(rover.x, rover.z);
    if (!smp || !rover.onGround) { if (!rover.onGround) sampler.reset(); return false; }
    const r = rover.right;
    sides.forEach((sd, k) => {
      const side = k === 0 ? -1 : 1;
      const cur = wheelPoint(side, rover.x, rover.z, r.x, r.z);
      const prev = sd.prev;
      sd.prev = cur;
      if (!prev) return;
      const i = sd.ring.next();
      const a = sd.geo.attributes.position.array;
      const pts = [[prev.wx - prev.ex, prev.wz - prev.ez], [prev.wx + prev.ex, prev.wz + prev.ez], [cur.wx - cur.ex, cur.wz - cur.ez], [cur.wx + cur.ex, cur.wz + cur.ez]];
      for (let v = 0; v < 4; v++) {
        a[(i * 4 + v) * 3] = pts[v][0];
        a[(i * 4 + v) * 3 + 1] = getGroundHeight(pts[v][0], pts[v][1]) + LIFT;
        a[(i * 4 + v) * 3 + 2] = pts[v][1];
      }
      sd.geo.attributes.position.needsUpdate = true;
      sd.geo.setDrawRange(0, sd.ring.count * 6);
    });
    return true;
  }
  function breakTracks() { sampler.reset(); sides.forEach((s) => { s.prev = null; }); } // lifted off / got out: no ribbon across the gap

  // ---- boot prints: one InstancedMesh, oldest overwritten ----
  const printGeo = new THREE.PlaneGeometry(PRINT_SIZE.w, PRINT_SIZE.l);
  printGeo.rotateX(-Math.PI / 2);
  const printMat = new THREE.MeshBasicMaterial({
    map: treadTexture(), color: 0x120804, transparent: true, opacity: 0.8, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const prints = new THREE.InstancedMesh(printGeo, printMat, PRINT_CAP);
  prints.count = 0;
  prints.frustumCulled = false;
  prints.renderOrder = 2;
  group.add(prints);
  const printRing = createRingCursor(PRINT_CAP);
  const stepper = createStepper(STEP_STRIDE);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  function addPrint(p) {
    const h = 0.5;
    const hx = getGroundHeight(p.x + h, p.z) - getGroundHeight(p.x - h, p.z);
    const hz = getGroundHeight(p.x, p.z + h) - getGroundHeight(p.x, p.z - h);
    n.set(-hx, 2 * h, -hz).normalize();
    q.setFromUnitVectors(up, n);
    qy.setFromAxisAngle(up, Math.atan2(-p.dirX, -p.dirZ));
    q.multiply(qy);
    const px = p.x - p.dirZ * 0.11 * p.side, pz = p.z + p.dirX * 0.11 * p.side; // feet ~22 cm apart (right of travel = +side)
    pos.set(px, getGroundHeight(px, pz) + LIFT, pz);
    m.compose(pos, q, one);
    const i = printRing.next();
    prints.setMatrixAt(i, m);
    prints.count = printRing.count;
    prints.instanceMatrix.needsUpdate = true;
  }

  return {
    object: group,
    get trackCount() { return sides[0].ring.count; },
    get printCount() { return printRing.count; },
    /** Press one boot print into the sand now ({ x, z, dirX, dirZ, side }: side -1 left foot, +1 right), e.g. the first step. */
    stamp(p) { addPrint(p); },
    /** call every outside frame. mode: 'drive' (rover) | 'walk' (walker, only while on the ground) */
    update({ mode, rover, walker }) {
      if (mode === 'drive') { stepper.reset(); if (!rover.onGround) breakTracks(); else addRoverTracks(rover); }
      else {
        breakTracks();
        if (walker.onGround) { const p = stepper.update(walker.pos.x, walker.pos.z); if (p) addPrint(p); } else stepper.reset();
      }
    },
  };
}
