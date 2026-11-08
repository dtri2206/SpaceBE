// "First humans on Mars": the demo-mode replacement of the first-step cinematic (~34 s, automatic, first person).
// Part 1 is pure timeline maths (firstHumansPose); part 2 builds the props (glove, rock, flag, dust) and drives the camera.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const FH_TOTAL = 34;
export const FH_FADE_START = 33;
export const FH_LADDER_TOP = 0.85; // m above eye height at the hatch (camera ~2.5 m up)
export const FH_BASE_Z = 4.1; // ladder foot (lander at the origin, hatch at z 3.6)
export const FH_HOP_STEP = 1.1; // m per hop
export const FH_BACKOFF = 3;
const T = { touch: 3.0, hop0: 3.4, hopLen: 1.4, hops: 4, crouch: [9.0, 10.2], reach: [10.2, 11.6], lift: [11.6, 12.3], uncrouch: [11.6, 13.4],
  spin: [12.3, 14.6], away: [14.6, 15.4], turnBack: [15.4, 17.0],
  // taking the flag from the holder on the backpack: look over the right shoulder + reach, draw the folded pole, extend it in front of the visor
  reachBack: [17.0, 17.8], draw: [17.8, 18.8], tele: [18.8, 19.6], rod: [19.4, 20.0], unfurl: [19.7, 20.3], place: [20.3, 20.9],
  sink: [21.0, 22.8], poleAway: [22.8, 23.6], back: [25.4, 30.4] };
export const FH_SHOULDER_YAW = (25 * Math.PI) / 180, FH_SHOULDER_PITCH = (15 * Math.PI) / 180;
export const FH_EVENTS = [
  { t: T.touch, name: 'touch' },
  ...Array.from({ length: T.hops }, (_, i) => ({ t: T.hop0 + T.hopLen * (i + 1), name: `land${i + 1}` })),
  { t: T.reach[1], name: 'grab' }, { t: T.away[1], name: 'rockStow' },
  { t: T.reachBack[1], name: 'flagGrab' }, { t: T.tele[0], name: 'poleExtend' }, { t: T.unfurl[0], name: 'unfurl' },
  { t: T.sink[1], name: 'plant' }, { t: FH_TOTAL, name: 'done' },
];
export const FH_CAPTIONS = [
  { a: 3.0, b: 7.0, text: 'Jezero Crater, Mars · Sol 1' },
  { a: 11.8, b: 15.4, text: 'The first rock picked up by a human hand on Mars.' },
  { a: 20.3, b: 28.4, text: 'A flag on Mars. Like the Apollo flags, it needs a rod: the air is too thin to lift it.' },
  { a: 31.4, b: 33.8, text: 'Time to go home.' },
];
export const FH_ROCK_AHEAD = 0.7; // rock distance ahead of the player at the end of the hops
export const FH_FLAG_BEHIND = 1.5; // the flag stands this far back toward the lander from the player (z)

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
const seg = (t, [a, b]) => smooth((t - a) / (b - a));
const lin = (t, [a, b]) => clamp01((t - a) / (b - a));

function ladderDescent(t) { // 0 at the hatch, 1 at the ground, in 4 rung steps
  const u = clamp01(t / T.touch), k = u * 4;
  if (k >= 4) return 1;
  const i = Math.floor(k);
  return (i + smooth((k - i) / 0.45)) / 4;
}

/** Everything the scene needs at time t (s). z: metres along +Z from the world origin; dy: relative to eye height; yaw/pitch: three Euler. */
export function firstHumansPose(t) {
  t = Math.min(FH_TOTAL, Math.max(0, t));
  let dy = FH_LADDER_TOP * (1 - ladderDescent(t));
  dy += -0.06 * Math.sin(Math.PI * clamp01((t - 2.8) / 0.7)); // boots land
  let hopZ = 0;
  for (let i = 0; i < T.hops; i++) {
    const a = T.hop0 + T.hopLen * i, u = (t - a) / T.hopLen;
    if (u >= 0 && u <= 1) {
      dy += 0.4 * Math.sin(Math.PI * u) - 0.05 * Math.sin(Math.PI * clamp01((u - 0.85) / 0.15));
      hopZ += FH_HOP_STEP * smooth(u);
    } else if (u > 1) hopZ += FH_HOP_STEP;
  }
  const crouch = seg(t, T.crouch) - seg(t, T.uncrouch);
  dy += -0.95 * crouch;
  const back = seg(t, T.back);
  const bob = 0.02 * Math.sin(Math.PI * lin(t, T.back)) * Math.abs(Math.sin(6 * Math.PI * lin(t, T.back)));
  dy += bob;
  const zEnd = FH_BASE_Z + FH_HOP_STEP * T.hops;
  const z = FH_BASE_Z + hopZ + FH_BACKOFF * back;
  const shoulder = seg(t, T.reachBack) - seg(t, T.draw); // 0..1..0: head turned over the right shoulder
  const yaw = Math.PI * seg(t, [3.0, 4.0]) - Math.PI * seg(t, T.turnBack) + 0.08 * seg(t, [26, 34]) - FH_SHOULDER_YAW * shoulder;
  const pitch = -1.0 * seg(t, T.crouch) + 0.88 * seg(t, T.uncrouch) + 0.2 * seg(t, T.turnBack) - 0.09 * seg(t, [26, 34]) - FH_SHOULDER_PITCH * shoulder;
  const sink = seg(t, T.sink);
  const rockPhase = t >= T.reach[0] && t < T.away[1], polePhase = t >= T.reachBack[0] && t < T.poleAway[1];
  const cap = FH_CAPTIONS.find((c) => t >= c.a && t < c.b);
  return {
    t, x: 0, z, zEnd, dy, pitch, yaw, shoulder,
    hand: {
      visible: rockPhase || polePhase,
      mode: polePhase ? 'pole' : 'rock',
      reach: seg(t, T.reach), lift: seg(t, T.lift), spin: Math.PI * 2 * seg(t, T.spin), away: seg(t, T.away),
      reachBack: seg(t, T.reachBack), draw: seg(t, T.draw), place: seg(t, T.place), poleAway: seg(t, T.poleAway),
      grip: t >= T.reachBack[0] ? 1 - 0.85 * seg(t, [17.0, 17.4]) + 0.85 * seg(t, [17.4, T.reachBack[1]]) : seg(t, [T.reach[1] - 0.5, T.reach[1]]),
    },
    rock: t < T.reach[1] ? 'ground' : t < T.away[1] ? 'held' : 'gone',
    pole: { visible: t >= T.reachBack[1], h: 0.25 - 0.55 * sink, tele: seg(t, T.tele), rod: seg(t, T.rod) }, // h: bottom of the pole above the ground
    flag: { unfurl: seg(t, T.unfurl) }, // 0 = furled against the pole, 1 = full 0.9 x 0.6 m, unrolled from the pole side
    caption: cap ? cap.text : '',
    fade: seg(t, [FH_FADE_START, FH_TOTAL]),
    done: t >= FH_TOTAL,
  };
}

/** Event names with time in (a, b]; each fires exactly once when a timeline is stepped. */
export function firstHumansEvents(a, b) {
  return FH_EVENTS.filter((e) => e.t > a && e.t <= b).map((e) => e.name);
}

// ===================== scene side =====================
// Pitch demo voice/sfx cues (src/flight/demo/audio.js EVENT_CUES 'fh:*'); does nothing outside the demo.
const demoCue = (name) => { try { globalThis.__demo?.cue?.(name); } catch { /* demo audio only */ } };
const FH_CUES = { touch: 'fh:touch', unfurl: 'fh:unfurl', done: 'fh:done' };

const rng = (seed) => { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

export function drawUsFlag(w = 760, h = 400) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const sh = h / 13;
  for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#FFFFFF' : '#B22234'; g.fillRect(0, i * sh, w, Math.ceil(sh)); }
  const cw = w * 0.4, ch = sh * 7;
  g.fillStyle = '#3C3B6E'; g.fillRect(0, 0, cw, ch);
  g.fillStyle = '#FFFFFF';
  const star = (cx, cy, r) => {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.382 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    g.closePath(); g.fill();
  };
  for (let row = 0; row < 9; row++) {
    const n = row % 2 === 0 ? 6 : 5;
    for (let j = 0; j < n; j++) star(((row % 2 === 0 ? 2 * j + 1 : 2 * j + 2) * cw) / 12, ((row + 1) * ch) / 10, sh * 0.4);
  }
  return c;
}

function dustTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function createDust(parent) {
  const map = dustTexture(), parts = [], rnd = rng(7);
  return {
    burst(x, y, z, n = 16, power = 1) {
      for (let i = 0; i < n; i++) {
        const m = new THREE.SpriteMaterial({ map, color: 0xc2663f, transparent: true, depthWrite: false, opacity: 0.6 });
        const sp = new THREE.Sprite(m);
        sp.position.set(x, y + 0.03, z);
        const a = rnd() * Math.PI * 2, v = (0.3 + rnd() * 0.9) * power;
        parts.push({ sp, vx: Math.cos(a) * v, vy: (0.2 + rnd() * 0.7) * power, vz: Math.sin(a) * v, age: 0, life: 1.4 + rnd() * 0.8, s0: 0.12 + rnd() * 0.1 });
        parent.add(sp);
      }
    },
    update(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        if (p.age >= p.life) { p.sp.removeFromParent(); p.sp.material.dispose(); parts.splice(i, 1); continue; }
        const k = p.age / p.life, drag = Math.exp(-2.2 * dt);
        p.vx *= drag; p.vz *= drag; p.vy = p.vy * drag - 1.2 * dt;
        p.sp.position.x += p.vx * dt; p.sp.position.y += p.vy * dt; p.sp.position.z += p.vz * dt;
        p.sp.scale.setScalar(p.s0 + k * 0.7);
        p.sp.material.opacity = 0.55 * (1 - k) * Math.min(1, p.age * 6);
      }
    },
    dispose() { for (const p of parts) { p.sp.removeFromParent(); p.sp.material.dispose(); } parts.length = 0; map.dispose(); },
  };
}

function buildRock(seed = 3) {
  const geo = new THREE.IcosahedronGeometry(0.1, 2), pos = geo.attributes.position, rnd = rng(seed), v = new THREE.Vector3();
  const phase = [rnd() * 6, rnd() * 6, rnd() * 6];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = 1 + 0.22 * Math.sin(v.x * 38 + phase[0]) * Math.cos(v.y * 31 + phase[1]) + 0.12 * Math.sin(v.z * 57 + phase[2]);
    v.multiplyScalar(n);
    v.y *= 0.8;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5c3426, roughness: 1, flatShading: true }));
}

/** First-person glove (built like the cockpit glove: rounded boxes + capsules). Fingers toward -Z, palm faces -Y, sleeve runs back toward +Z (the camera). Returns { group, setGrip(0..1) }. */
function buildGlove() {
  const fabric = new THREE.MeshStandardMaterial({ color: 0xe9e7e2, roughness: 0.8, emissive: 0x1c1b19 });
  const seam = new THREE.MeshStandardMaterial({ color: 0xb4b3b0, roughness: 0.8, emissive: 0x141414 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x9a9da1, roughness: 0.6, metalness: 0.25 });
  const g = new THREE.Group();
  const rb = (w, h, d, r, mat = fabric) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)), mat);
  const cap = (r, len, mat = fabric) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat); m.rotation.x = Math.PI / 2; return m; };
  // back of hand / palm: 9 cm wide, 9 cm long, 3 cm thick
  const palm = rb(0.09, 0.03, 0.09, 0.013); palm.position.set(0, 0, -0.045); g.add(palm);
  const knuckles = rb(0.092, 0.012, 0.016, 0.005, seam); knuckles.position.set(0, 0.012, -0.088); g.add(knuckles);
  // four fingers, three segments each (about 8 cm in all), curling toward the palm side (-Y)
  const fingers = [];
  [[-0.033, 1.0], [-0.011, 1.08], [0.011, 1.04], [0.033, 0.86]].forEach(([x, f]) => {
    const lens = [0.032 * f, 0.026 * f, 0.022 * f], rad = [0.0098, 0.0092, 0.0085];
    const root = new THREE.Group(); root.position.set(x, 0, -0.09);
    let parent = root; const joints = [];
    lens.forEach((len, k) => {
      const j = new THREE.Group(); if (k) j.position.z = -lens[k - 1];
      const seg = cap(rad[k], len - rad[k] * 1.4); seg.position.z = -len / 2; j.add(seg);
      parent.add(j); parent = j; joints.push(j);
    });
    g.add(root); fingers.push(joints);
  });
  // thumb opposing the fingers, from the side of the palm
  const thumb = new THREE.Group(); thumb.position.set(0.05, -0.004, -0.03);
  const t1 = new THREE.Group(); const ts1 = cap(0.0125, 0.02); ts1.position.z = -0.0175; t1.add(ts1);
  const t2 = new THREE.Group(); t2.position.z = -0.035; const ts2 = cap(0.0115, 0.014); ts2.position.z = -0.014; t2.add(ts2);
  t1.add(t2); thumb.add(t1); g.add(thumb);
  // wrist ring, cuff and a short sleeve with seams
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.022, 20), grey); ring.rotation.x = Math.PI / 2; ring.position.z = 0.012; g.add(ring);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.05, 0.05, 20), fabric); cuff.rotation.x = Math.PI / 2; cuff.position.z = 0.048; g.add(cuff);
  const cuffSeam = new THREE.Mesh(new THREE.CylinderGeometry(0.0505, 0.0505, 0.006, 20), seam); cuffSeam.rotation.x = Math.PI / 2; cuffSeam.position.z = 0.074; g.add(cuffSeam);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.052, 0.3, 20), fabric); sleeve.rotation.x = Math.PI / 2; sleeve.position.z = 0.226; g.add(sleeve);
  const sleeveSeam = new THREE.Mesh(new THREE.CylinderGeometry(0.0575, 0.0575, 0.006, 20), seam); sleeveSeam.rotation.x = Math.PI / 2; sleeveSeam.position.z = 0.19; g.add(sleeveSeam);
  const fill = new THREE.PointLight(0xfff0e0, 0.7, 1.6, 2); fill.position.set(0, 0.25, 0.15); g.add(fill); // soft fill so the glove is never flat
  const CURL = [1.15, 1.25, 0.95];
  return {
    group: g,
    setGrip(k) {
      fingers.forEach((js, fi) => js.forEach((j, n) => { j.rotation.x = -k * CURL[n] * (fi === 3 ? 0.92 : 1) - (n === 0 ? 0.05 : 0.08); }));
      thumb.rotation.set(-k * 0.55, 0.65 - k * 0.15, 0);
      t1.rotation.x = -k * 0.35; t2.rotation.x = -k * 0.5;
    },
  };
}

function buildFlag() {
  // 2 m telescoping pole (0.7 m collapsed) + folding top rod + a 0.9 m x 0.6 m cloth that is unrolled by vertex animation (the mesh is never scaled)
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xcfd2d6, roughness: 0.4, metalness: 0.7 });
  const cyl = (r, len, rotZ = false) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), metal); if (rotZ) m.rotation.z = Math.PI / 2; return m; };
  const segA = cyl(0.016, 0.7), segB = cyl(0.0135, 0.65), segC = cyl(0.011, 0.65);
  segA.position.y = 0.35;
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.015, 10, 8), metal);
  g.add(segA, segB, segC, finial);
  const pivot = new THREE.Group(); pivot.position.z = 0.03; g.add(pivot);
  const rodA = cyl(0.009, 0.5, true), rodB = cyl(0.0075, 0.45, true);
  rodA.position.x = 0.25; pivot.add(rodA, rodB);
  const tex = new THREE.CanvasTexture(drawUsFlag(750, 500)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const W = 0.9, H = 0.6, sx = 180, sy = 10, R0 = 0.006, C = 0.0003;
  const geo = new THREE.PlaneGeometry(W, H, sx, sy); geo.translate(W / 2, -H / 2, 0);
  const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
  g.add(cloth);
  const base = geo.attributes.position.array.slice();
  const sm = (x) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
  return {
    group: g, cloth,
    /** tele/rod/unfurl 0..1. Vertex animation only: the cloth spirals up around its pole-side edge and is unrolled from the pole side; once flat it gets a very slight ripple (air ~1 % of Earth's). */
    setForm(time, tele, rod, unfurl) {
      const L = 0.7 + 1.3 * tele;
      segB.position.y = 0.375 + 0.65 * tele; segC.position.y = L - 0.325; finial.position.y = L;
      pivot.position.y = L - 0.05;
      pivot.rotation.z = -Math.PI / 2 * (1 - sm(rod / 0.75));
      rodB.position.x = 0.25 + 0.475 * sm((rod - 0.5) / 0.5);
      cloth.position.set(0.02 + 0.03 * (1 - unfurl), L - 0.05, 0.03);
      const p = geo.attributes.position, s = unfurl * W, rip = unfurl * unfurl;
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        if (x <= s) {
          p.setXYZ(i, x, y, rip * (0.012 * Math.sin(x * 6 - time * 0.9) * (x / W) + 0.006 * Math.sin(y * 8 + time * 0.6) + 0.006 * (-y / H)));
        } else { // still rolled: Archimedean spiral around (s, R0), arc length x - s
          const phi = (Math.sqrt(R0 * R0 + 2 * C * (x - s)) - R0) / C, r = R0 + C * phi;
          p.setXYZ(i, s + r * Math.sin(phi), y, R0 - r * Math.cos(phi));
        }
      }
      p.needsUpdate = true; geo.computeVertexNormals();
    },
    dispose() { tex.dispose(); geo.dispose(); },
  };
}

/** The slim flag tube on the right side of the backpack. Local +Y = the open end (the tip is at the origin), the tube runs back along -Y. stub = the pole end sticking out while the flag is still stowed. */
function buildHolder() {
  const fabric = new THREE.MeshStandardMaterial({ color: 0xe9e7e2, roughness: 0.8, emissive: 0x1c1b19 });
  const seam = new THREE.MeshStandardMaterial({ color: 0xb4b3b0, roughness: 0.8, emissive: 0x141414 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x9a9da1, roughness: 0.6, metalness: 0.25 });
  const g = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.042, 0.4, 16), fabric); tube.position.y = -0.2; g.add(tube);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0435, 0.0435, 0.012, 16), seam); band.position.y = -0.14; g.add(band);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 16), grey); cap.position.y = -0.0175; g.add(cap);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.036, 16), new THREE.MeshBasicMaterial({ color: 0x0c0c0d })); hole.rotation.x = -Math.PI / 2; hole.position.y = 0.002; g.add(hole);
  const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 10), new THREE.MeshStandardMaterial({ color: 0xcfd2d6, roughness: 0.4, metalness: 0.7 })); stub.position.y = 0.09; g.add(stub);
  return { group: g, stub };
}

/**
 * Builds the sequence in `scene`. update(dt, camera) moves the camera and props and returns { done, fade, caption, events }.
 * hooks: { terrain(x,z) -> y, onEvent(name, pose) }.
 */
export function createFirstHumans({ scene, terrain, onEvent }) {
  const root = new THREE.Group(); scene.add(root);
  const dust = createDust(root);
  const rock = buildRock(), glove = buildGlove(), flag = buildFlag(), holder = buildHolder();
  const zEnd = FH_BASE_Z + FH_HOP_STEP * T.hops;
  const rockX = 0.12, rockZ = zEnd + FH_ROCK_AHEAD, flagZ = zEnd - FH_FLAG_BEHIND;
  rock.position.set(rockX, terrain(rockX, rockZ) + 0.07, rockZ);
  rock.rotation.set(0.4, 1.1, 0.2);
  flag.group.visible = false; glove.group.visible = false; holder.group.visible = false;
  root.add(rock, glove.group, flag.group, holder.group);
  const groundF = terrain(0, flagZ);
  const state = { t: 0, time: 0, skipped: false, rockHeld: false };
  const STOW = new THREE.Vector3(0.24, -0.58, -0.12), HOLD = new THREE.Vector3(0.0, -0.09, -0.56);
  // everything below is in camera space: the holder tip over the right shoulder, the pole at rest in the holder / held in front of the visor
  const DH = new THREE.Vector3(0.1, 0.8, -0.6).normalize(), DEXT = new THREE.Vector3(-0.05, 0.72, -0.69).normalize(), BHELD = new THREE.Vector3(0.2, -0.55, -0.5);
  const Y_AXIS = new THREE.Vector3(0, 1, 0), Z_AXIS = new THREE.Vector3(0, 0, 1), IDENT = new THREE.Quaternion();
  const qHold = new THREE.Quaternion().setFromUnitVectors(Y_AXIS, DH), bas = new THREE.Matrix4(), bx = new THREE.Vector3(), bz = new THREE.Vector3(), bd = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmp2 = new THREE.Vector3(), eul = new THREE.Euler();

  function toLocal(camera, w) { return tmpV.copy(w).sub(camera.position).applyQuaternion(tmpQ.copy(camera.quaternion).invert()).clone(); }

  function fire(names, pose) {
    for (const n of names) {
      if (n === 'touch') dust.burst(0, terrain(0, FH_BASE_Z) , FH_BASE_Z - 0.2, 20, 1.1);
      else if (n.startsWith('land')) dust.burst(0, terrain(0, pose.z), pose.z, 8, 0.7);
      else if (n === 'grab') { glove.group.add(rock); rock.position.set(0, -0.062, -0.07); rock.rotation.set(0, 0, 0); rock.scale.setScalar(0.8); state.rockHeld = true; }
      else if (n === 'rockStow') { rock.removeFromParent(); }
      else if (n === 'plant') dust.burst(0, groundF, flagZ, 22, 1.2);
      demoCue(FH_CUES[n] ?? (n.startsWith('land') ? 'fh:land' : null));
      onEvent?.(n, pose);
    }
  }

  return {
    get t() { return state.t; },
    skip() { state.skipped = true; },
    update(dt, camera) {
      const prev = state.t;
      if (state.time === 0) demoCue('fh:start');
      state.time += dt;
      let t = prev + dt;
      if (state.skipped && t < FH_FADE_START) t = FH_FADE_START; // jump to the end: events in between still fire
      state.t = t = Math.min(FH_TOTAL, t);
      const pose = firstHumansPose(t);
      fire(firstHumansEvents(prev, t), pose);

      const gy = terrain(pose.x, pose.z);
      camera.position.set(pose.x, gy + 1.65 + pose.dy, pose.z);
      camera.quaternion.setFromEuler(eul.set(pose.pitch, pose.yaw, 0, 'YXZ'));
      camera.updateMatrixWorld(true);

      // holder (backpack, right side): only seen while the head is turned over the shoulder
      const sh = pose.shoulder, cq = camera.quaternion;
      const tipL = new THREE.Vector3(0.9 - 0.48 * sh, -0.4 + 0.1 * sh, 0.3 - 0.75 * sh);
      holder.group.visible = sh > 0.002;
      holder.stub.visible = !pose.pole.visible;
      holder.group.position.copy(tipL).applyQuaternion(cq).add(camera.position);
      holder.group.quaternion.copy(cq).multiply(qHold);

      // flag pole: drawn from the holder, brought to the front, extended, then moved to the ground spot and planted
      const f = flag.group, h = pose.hand, gl = glove.group;
      f.visible = pose.pole.visible;
      const dirW = new THREE.Vector3(0, 1, 0);
      if (f.visible) {
        const O = tipL.clone().addScaledVector(DH, -0.25).lerp(BHELD, h.draw), D = bd.copy(DH).lerp(DEXT, h.draw).normalize();
        bz.copy(Z_AXIS).addScaledVector(D, -D.dot(Z_AXIS)).normalize(); bx.crossVectors(D, bz);
        const qLocal = new THREE.Quaternion().setFromRotationMatrix(bas.makeBasis(bx, D, bz));
        f.quaternion.copy(cq).multiply(qLocal).slerp(IDENT, h.place);
        f.position.copy(O).applyQuaternion(cq).add(camera.position).lerp(tmpV.set(0, groundF + pose.pole.h, flagZ), h.place);
        dirW.applyQuaternion(f.quaternion);
      }
      flag.setForm(state.time, pose.pole.tele, pose.pole.rod, pose.flag.unfurl);

      // glove
      gl.visible = h.visible;
      if (h.visible) {
        const w = new THREE.Vector3();
        if (h.mode === 'rock') {
          const p = new THREE.Vector3();
          if (!state.rockHeld) p.copy(STOW).lerp(toLocal(camera, tmp2.set(rockX, rock.position.y + 0.075, rockZ)), h.reach);
          else p.copy(toLocal(camera, tmp2.set(rockX, terrain(rockX, rockZ) + 0.145, rockZ)));
          if (state.rockHeld || h.lift > 0) p.lerp(HOLD, h.lift);
          p.lerp(STOW, h.away);
          gl.rotation.set(-0.25 - 0.3 * h.lift, 0, 0);
          if (h.lift > 0) rock.rotation.set(0.3, h.spin, 0.15);
          w.copy(p).applyQuaternion(cq).add(camera.position);
        } else {
          if (f.visible) w.copy(f.position).addScaledVector(dirW, 0.25 + 0.9 * h.place); // the glove holds the pole
          else w.copy(STOW).lerp(tipL, h.reachBack).applyQuaternion(cq).add(camera.position); // reaching back to the holder
          w.lerp(tmp2.copy(STOW).applyQuaternion(cq).add(camera.position), h.poleAway);
          gl.rotation.set(0, 0, Math.PI / 2);
        }
        gl.position.copy(w);
        gl.quaternion.copy(cq).multiply(tmpQ.setFromEuler(gl.rotation));
        glove.setGrip(h.grip);
      }
      dust.update(dt);
      if (pose.caption !== state.caption) { state.caption = pose.caption; if (pose.caption === FH_CAPTIONS.at(-1).text) demoCue('fh:gohome'); } // a_gohome with "Time to go home."
      return { done: pose.done, fade: pose.fade, caption: pose.caption, pose };
    },
    endPosition() { return { x: 0, z: FH_BASE_Z + FH_HOP_STEP * T.hops + FH_BACKOFF, yaw: 0 }; },
    dispose() { dust.dispose(); flag.dispose(); root.removeFromParent(); },
  };
}
