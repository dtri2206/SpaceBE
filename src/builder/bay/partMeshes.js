// Detailed procedural hardware for the parts that must stack cleanly (tanks, nose cones, heat shields, fins, rings)
// and for equipment without a real model yet. Metres, base at y = 0, centred on the stack axis.
import * as THREE from 'three';
import { canvasTexture, std } from './util.js';

const WHITE = 0xf1f0ec, FOAM = 0xd9772f, DARK = 0x23272c, STEEL = 0xaab1b8, CHAR = 0x2a211c;
const textures = new Map();

function panelBump(key = 'panel', lines = 6, rivets = true) {
  if (textures.has(key)) return textures.get(key);
  const { texture, redraw } = canvasTexture(512, 512);
  redraw((ctx, w, h) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#5a5a5a';
    ctx.lineWidth = 3;
    for (let i = 1; i < lines; i++) { const y = (h / lines) * i; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    for (let i = 0; i < 8; i++) { const x = (w / 8) * i + 16; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    if (rivets) {
      ctx.fillStyle = '#9a9a9a';
      for (let i = 1; i < lines; i++) for (let j = 0; j < 32; j++) { ctx.beginPath(); ctx.arc((w / 32) * j + 8, (h / lines) * i + 10, 2.2, 0, Math.PI * 2); ctx.fill(); }
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  textures.set(key, texture);
  return texture;
}

function hexBump() {
  if (textures.has('hex')) return textures.get('hex');
  const { texture, redraw } = canvasTexture(512, 512);
  redraw((ctx, w, h) => {
    ctx.fillStyle = '#8c8c8c';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3c3c3c';
    ctx.lineWidth = 4;
    const r = 26;
    for (let row = 0; row < 14; row++) for (let col = 0; col < 14; col++) {
      const cx = col * r * 1.75 + (row % 2 ? r * 0.875 : 0), cy = row * r * 1.5;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) { const a = (Math.PI / 3) * k + Math.PI / 6; ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
      ctx.closePath();
      ctx.stroke();
    }
  });
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  textures.set('hex', texture);
  return texture;
}

function decalTexture(text, sub, key) {
  const k = `decal:${key ?? text}`;
  if (textures.has(k)) return textures.get(k);
  const { texture, redraw } = canvasTexture(512, 256);
  redraw((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    // a small flag block and the agency mark, like real stage markings
    ctx.fillStyle = '#1d4ed8';
    ctx.fillRect(24, 40, 70, 48);
    for (let i = 0; i < 7; i++) { ctx.fillStyle = i % 2 ? '#ffffff' : '#dc2626'; ctx.fillRect(94, 40 + i * 7, 110, 7); }
    ctx.fillStyle = '#111';
    ctx.font = '700 64px "IBM Plex Mono", monospace';
    ctx.textBaseline = 'top';
    ctx.fillText(text, 24, 110);
    ctx.font = '500 30px "IBM Plex Mono", monospace';
    ctx.fillStyle = '#333';
    ctx.fillText(sub, 26, 186);
  });
  textures.set(k, texture);
  return texture;
}

const lathe = (pts, material, segments = 64) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segments), material);

function ringFrame(radius, y, material, thickness = 0.05) {
  const t = new THREE.Mesh(new THREE.TorusGeometry(radius + thickness * 0.6, thickness, 8, 64), material);
  t.rotation.x = Math.PI / 2;
  t.position.y = y;
  return t;
}

/** A propellant tank: painted shell with ring frames, raceways, feedlines and markings. Hydrolox wears orange foam. */
export function tankMesh(def, radius) {
  const h = def.height;
  const fuel = def.fuel?.type ?? 'methalox';
  const g = new THREE.Group();
  const bump = panelBump('tank', 5, true);
  bump.repeat.set(6, Math.max(1, Math.round(h / 1.2)));
  const shellMat = fuel === 'hydrolox'
    ? new THREE.MeshStandardMaterial({ color: FOAM, roughness: 0.95, metalness: 0, bumpMap: bump, bumpScale: 0.004 })
    : new THREE.MeshStandardMaterial({ color: fuel === 'kerolox' ? 0xe4e2dc : WHITE, roughness: 0.42, metalness: 0.12, bumpMap: bump, bumpScale: 0.006 });
  const shell = lathe([[radius * 0.86, 0], [radius, 0.1], [radius, h - 0.1], [radius * 0.86, h]], shellMat);
  g.add(shell);
  const dark = std(DARK, { roughness: 0.55, metalness: 0.6 });
  g.add(ringFrame(radius, 0.12, dark, 0.04), ringFrame(radius, h - 0.12, dark, 0.04));
  for (let y = 1.1; y < h - 0.6; y += 1.25) g.add(ringFrame(radius, y, std(fuel === 'hydrolox' ? 0xc26a2b : 0xd6d4ce, { roughness: 0.5, metalness: 0.3 }), 0.025));
  // raceway (cable tunnel) and two feedlines along the side, like the Saturn and Shuttle tanks
  const race = new THREE.Mesh(new THREE.BoxGeometry(0.22, h - 0.3, 0.12), std(0xd9d7d1, { roughness: 0.5, metalness: 0.2 }));
  race.position.set(radius * 0.97, h / 2, 0);
  g.add(race);
  const pipeMat = std(STEEL, { roughness: 0.35, metalness: 0.9 });
  for (const a of [2.2, 2.6]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, h - 0.4, 12), pipeMat);
    pipe.position.set(Math.cos(a) * radius * 1.02, h / 2, Math.sin(a) * radius * 1.02);
    g.add(pipe);
  }
  // band and markings
  const band = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.004, radius + 0.004, 0.18, 64, 1, true), std(fuel === 'kerolox' ? 0x1f2937 : fuel === 'hydrolox' ? 0x1f2937 : 0x0ea5b7, { roughness: 0.6 }));
  band.position.y = h * 0.22;
  g.add(band);
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshStandardMaterial({ map: decalTexture('SB&E', fuel.toUpperCase(), fuel), transparent: true, roughness: 0.6 }));
  decal.position.set(Math.cos(-0.9) * (radius + 0.012), h * 0.62, Math.sin(-0.9) * (radius + 0.012));
  decal.lookAt(decal.position.clone().multiplyScalar(2).setY(h * 0.62));
  g.add(decal);
  return g;
}

/** Nose cone: a Haack-series ogive with panel lines and a metal tip. */
export function noseMesh(def, radius) {
  const h = def.height;
  const pts = [];
  const C = /blunt/.test(def.id) ? 1 / 3 : 0;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const theta = Math.acos(1 - 2 * t);
    const r = (radius / Math.sqrt(Math.PI)) * Math.sqrt(theta - Math.sin(2 * theta) / 2 + C * Math.pow(Math.sin(theta), 3));
    pts.push([Math.max(0.001, r), h - t * h]);
  }
  const bump = panelBump('nose', 4, false);
  bump.repeat.set(4, 2);
  const g = new THREE.Group();
  g.add(lathe(pts.reverse(), new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.4, metalness: 0.1, bumpMap: bump, bumpScale: 0.004 })));
  const tip = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.09, h * 0.12, 24), std(STEEL, { roughness: 0.3, metalness: 0.9 }));
  tip.position.y = h - h * 0.06;
  g.add(tip, ringFrame(radius, 0.08, std(DARK, { roughness: 0.55, metalness: 0.6 }), 0.035));
  return g;
}

/** Heat shield: ablative (charred honeycomb) or ceramic tiles (grey grid). */
export function heatShieldMesh(def, radius) {
  const h = def.height;
  const tiles = !!def.flags?.fragileShield;
  const bump = hexBump();
  bump.repeat.set(tiles ? 10 : 6, tiles ? 4 : 2);
  const mat = new THREE.MeshStandardMaterial({ color: tiles ? 0x5b5f66 : CHAR, roughness: tiles ? 0.75 : 0.92, metalness: 0.05, bumpMap: bump, bumpScale: 0.01 });
  const g = new THREE.Group();
  g.add(lathe([[0, 0], [radius * 0.72, 0.03], [radius * 1.04, h * 0.6], [radius * 1.04, h], [0, h]], mat));
  g.add(ringFrame(radius * 1.04, h - 0.02, std(STEEL, { roughness: 0.4, metalness: 0.85 }), 0.03));
  return g;
}

/** A tapered fin with a spar and two ribs. Points along +x, root at x = 0. */
export function finMesh(def) {
  const h = def.height, span = h * 0.68;
  const shape = new THREE.Shape([[0, 0], [span, -h * 0.25], [span, h * 0.12], [span * 0.35, h * 0.86], [0, h]].map(([x, y]) => new THREE.Vector2(x, y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
  const g = new THREE.Group();
  const fin = new THREE.Mesh(geo, std(0xdcdad4, { roughness: 0.45, metalness: 0.25 }));
  fin.position.z = -0.03;
  g.add(fin);
  const rib = std(0x8b9096, { roughness: 0.5, metalness: 0.6 });
  for (const t of [0.3, 0.62]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(span * (1 - t) * 0.9, 0.03, 0.085), rib);
    r.position.set(span * (1 - t) * 0.45 + span * t * 0.5, h * (1 - t) * 0.5 + h * 0.05, 0);
    g.add(r);
  }
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.085), rib);
  edge.position.set(0.02, h / 2, 0);
  g.add(edge);
  return g;
}

/** Sealed equipment module with a label, grab rails and connectors (fallback for parts without a real model). */
export function moduleMesh(def, tint = 0x3b4148) {
  const h = def.height, w = Math.min(1.1, Math.max(0.5, h * 0.6));
  const g = new THREE.Group();
  const bump = panelBump('module', 3, true);
  bump.repeat.set(2, 2);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshStandardMaterial({ color: tint, roughness: 0.5, metalness: 0.55, bumpMap: bump, bumpScale: 0.004 }));
  body.position.y = h / 2;
  g.add(body);
  const rail = std(STEEL, { roughness: 0.35, metalness: 0.9 });
  for (const s of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, h * 0.6, 8), rail);
    r.position.set(s * w * 0.36, h / 2, w * 0.55);
    g.add(r);
  }
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10), std(0xf59e0b, { roughness: 0.5, metalness: 0.4 }));
    c.rotation.x = Math.PI / 2;
    c.position.set(-w * 0.3 + i * w * 0.3, h * 0.12, w * 0.52);
    g.add(c);
  }
  const label = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, w * 0.4), new THREE.MeshStandardMaterial({ map: decalTexture(def.name.split(' ')[0].toUpperCase().slice(0, 7), def.family.toUpperCase(), def.id), transparent: true, roughness: 0.6 }));
  label.position.set(0, h * 0.62, w * 0.505);
  g.add(label);
  g.userData.width = w;
  return g;
}

/** A thin ring around the body (seals, gimbal ring). */
export function ringMesh(def, radius, color = 0x8a6d3b) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius + 0.03, def.height / 2, 10, 72), std(color, { roughness: 0.6, metalness: 0.5 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = def.height / 2;
  g.add(ring);
  g.userData.width = 0.2;
  g.userData.ring = true;
  return g;
}

// ---------- stage structure, solid motors and equipment without a real model ----------
const ALU_MAT = () => std(0xc9ccd0, { roughness: 0.38, metalness: 0.85 });
const DARK_MAT = () => std(DARK, { roughness: 0.55, metalness: 0.6 });

/** Skin section with stringers and ring frames (interstage, centerbody): a hollow cylinder of the stack radius. */
export function sectionMesh(def, radius) {
  const h = def.height;
  const g = new THREE.Group();
  const bump = panelBump('section', 3, true);
  bump.repeat.set(8, 1);
  const skin = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h, 64, 1, true), new THREE.MeshStandardMaterial({ color: /center/.test(def.id) ? 0xe9e7e1 : 0x2b3238, roughness: 0.5, metalness: 0.5, bumpMap: bump, bumpScale: 0.004, side: THREE.DoubleSide }));
  skin.position.y = h / 2;
  g.add(skin);
  const frame = DARK_MAT();
  g.add(ringFrame(radius, 0.06, frame, 0.04), ringFrame(radius, h - 0.06, frame, 0.04));
  // vertical stringers on the outside, like a real interstage
  const stringer = std(0x9aa0a6, { roughness: 0.45, metalness: 0.8 });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.04, h - 0.2, 0.05), stringer);
    s.position.set(Math.cos(a) * (radius + 0.02), h / 2, Math.sin(a) * (radius + 0.02));
    s.rotation.y = -a;
    g.add(s);
  }
  if (/inter/.test(def.id)) {
    // access door and the separation charge line
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), std(0x1a1f24, { roughness: 0.6 }));
    door.position.set(radius + 0.03, h * 0.45, 0);
    door.rotation.y = Math.PI / 2;
    g.add(door, ringFrame(radius, h * 0.5, std(0xf59e0b, { roughness: 0.6 }), 0.015));
  }
  return g;
}

/** Open support truss (miniskirt): rings top and bottom joined by diagonal struts. */
export function trussMesh(def, radius) {
  const h = def.height;
  const g = new THREE.Group();
  const strut = std(0x8f969c, { roughness: 0.4, metalness: 0.85 });
  const r = radius * 0.92;
  g.add(ringFrame(r, 0.04, strut, 0.045), ringFrame(r, h - 0.04, strut, 0.045));
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p0 = new THREE.Vector3(Math.cos(a0) * r, 0.04, Math.sin(a0) * r);
    const p1 = new THREE.Vector3(Math.cos(a1) * r, h - 0.04, Math.sin(a1) * r);
    const p2 = new THREE.Vector3(Math.cos(a1) * r, 0.04, Math.sin(a1) * r);
    const p3 = new THREE.Vector3(Math.cos(a0) * r, h - 0.04, Math.sin(a0) * r);
    for (const [a, b] of [[p0, p1], [p2, p3]]) {
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 8), strut);
      m.position.copy(a).lerp(b, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(m);
    }
  }
  // a short inner skirt (the miniskirt) so the truss reads as a stage and not as a cage
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, h * 0.6, 48, 1, true), std(0xd9d7d1, { roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }));
  skirt.position.y = h * 0.5;
  g.add(skirt);
  return g;
}

/** Guidance electronics ring: a short skin with equipment boxes bolted around the inside face, lids outward. */
export function avionicsRingMesh(def, radius) {
  const h = def.height;
  const g = new THREE.Group();
  const skin = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, h, 64, 1, true), std(0xe4e2dc, { roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide }));
  skin.position.y = h / 2;
  g.add(skin, ringFrame(radius, 0.03, DARK_MAT(), 0.03), ringFrame(radius, h - 0.03, DARK_MAT(), 0.03));
  const boxes = [[0x1f2937, 0.5], [0xb45309, 0.34], [0x374151, 0.42], [0x0e7490, 0.3], [0x1f2937, 0.46], [0x6b7280, 0.36]];
  boxes.forEach(([c, w], i) => {
    const a = (i / boxes.length) * Math.PI * 2 + 0.3;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.7, 0.22), std(c, { roughness: 0.5, metalness: 0.5 }));
    b.position.set(Math.cos(a) * (radius - 0.14), h / 2, Math.sin(a) * (radius - 0.14));
    b.rotation.y = -a + Math.PI / 2;
    g.add(b);
  });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.004, radius + 0.004, h * 0.2, 64, 1, true), std(0x0ea5b7, { roughness: 0.6 }));
  band.position.y = h * 0.5;
  g.add(band);
  return g;
}

/** Payload attach fitting: a truncated cone with a bolted ring on top and a clamp band at the base. */
export function pafMesh(def, radius) {
  const h = def.height;
  const g = new THREE.Group();
  g.add(lathe([[radius * 0.98, 0], [radius * 0.98, 0.06], [radius * 0.62, h - 0.04], [radius * 0.62, h], [radius * 0.5, h], [radius * 0.5, h - 0.05], [radius * 0.9, 0.06], [radius * 0.9, 0]], std(0xcfd3d8, { roughness: 0.4, metalness: 0.7, side: THREE.DoubleSide })));
  g.add(ringFrame(radius * 0.62, h - 0.02, ALU_MAT(), 0.035), ringFrame(radius * 0.98, 0.03, std(0xf59e0b, { roughness: 0.5, metalness: 0.4 }), 0.03));
  const bolt = std(0x4b5563, { roughness: 0.5, metalness: 0.7 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 8), bolt);
    b.position.set(Math.cos(a) * radius * 0.56, h + 0.01, Math.sin(a) * radius * 0.56);
    g.add(b);
  }
  return g;
}

/** Spin table: a flat bearing plate with a toothed ring, and the clamp band above it. */
export function spinTableMesh(def, radius) {
  const h = def.height;
  const g = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.9, radius * 0.9, h * 0.45, 64), std(0x9aa0a6, { roughness: 0.4, metalness: 0.8 }));
  plate.position.y = h * 0.225;
  g.add(plate);
  const teeth = std(0x4b5563, { roughness: 0.5, metalness: 0.8 });
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.05, h * 0.3, 0.09), teeth);
    t.position.set(Math.cos(a) * radius * 0.93, h * 0.225, Math.sin(a) * radius * 0.93);
    t.rotation.y = -a;
    g.add(t);
  }
  g.add(ringFrame(radius * 0.82, h * 0.72, std(0xf59e0b, { roughness: 0.55, metalness: 0.4 }), h * 0.14)); // the Marman clamp band
  const latch = new THREE.Mesh(new THREE.BoxGeometry(0.16, h * 0.4, 0.12), std(0x1f2937, { roughness: 0.5, metalness: 0.6 }));
  latch.position.set(radius * 0.86, h * 0.72, 0);
  g.add(latch);
  return g;
}

/** Spherical solid kick motor with a short nozzle, in a titanium case. */
export function kickMotorMesh(def, radius) {
  const h = def.height;
  const g = new THREE.Group();
  const r = Math.min(radius * 0.78, h * 0.38);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 28), std(0xb7b1a5, { roughness: 0.35, metalness: 0.9 }));
  sphere.position.y = h - r - 0.04;
  g.add(sphere);
  const nozzle = lathe([[r * 0.22, 0.02], [r * 0.6, 0.02], [r * 0.25, h - r * 1.6 - 0.04], [r * 0.22, h - r * 1.6 - 0.04]], std(0x3b3f45, { roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }));
  g.add(nozzle);
  g.add(ringFrame(r * 0.95, h - r - 0.04, std(0x6b7280, { roughness: 0.5, metalness: 0.7 }), 0.02)); // the case weld line
  const igniter = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12), std(0xf59e0b, { roughness: 0.5, metalness: 0.4 }));
  igniter.position.y = h - 0.02;
  g.add(igniter);
  // an open adapter ring so the stack above has something to sit on
  g.add(ringFrame(radius * 0.9, h - 0.02, DARK_MAT(), 0.03), ringFrame(radius * 0.9, 0.03, DARK_MAT(), 0.03));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, h - 0.1, 8), std(0x8f969c, { roughness: 0.4, metalness: 0.8 }));
    strut.position.set(Math.cos(a) * radius * 0.9, h / 2, Math.sin(a) * radius * 0.9);
    g.add(strut);
  }
  return g;
}

/** Strap-on solid motor: a long case with a conical nose, aft skirt and nozzle. Points up; base at y = 0. */
export function srbMesh(def) {
  const h = def.height, r = Math.max(0.3, h * 0.085);
  const g = new THREE.Group();
  const bump = panelBump('srb', 4, false);
  bump.repeat.set(4, 3);
  const caseMat = new THREE.MeshStandardMaterial({ color: 0xece9e2, roughness: 0.45, metalness: 0.15, bumpMap: bump, bumpScale: 0.004 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h * 0.72, 32), caseMat);
  body.position.y = h * 0.14 + h * 0.36;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(r, h * 0.14, 32), caseMat);
  nose.position.y = h * 0.86 + h * 0.07;
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.1, h * 0.06, 32, 1, true), std(0x3b3f45, { roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }));
  skirt.position.y = h * 0.11;
  const nozzle = lathe([[r * 0.3, 0], [r * 0.85, 0], [r * 0.4, h * 0.11], [r * 0.3, h * 0.11]], std(0x2a2e33, { roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }));
  g.add(body, nose, skirt, nozzle);
  for (const y of [h * 0.3, h * 0.5, h * 0.7]) g.add(ringFrame(r, y, std(0x9aa0a6, { roughness: 0.5, metalness: 0.6 }), 0.015)); // segment joints
  const band = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.003, r + 0.003, h * 0.03, 32, 1, true), std(0x0ea5b7, { roughness: 0.6 }));
  band.position.y = h * 0.8;
  g.add(band);
  // attach struts towards the core (-x side)
  const strut = std(0x6b7280, { roughness: 0.5, metalness: 0.7 });
  for (const y of [h * 0.2, h * 0.75]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 0.08), strut);
    s.position.set(-r - 0.2, y, 0);
    g.add(s);
  }
  g.userData.width = r * 2;
  g.userData.srb = true;
  return g;
}

/** A pressure sphere in a cradle of straps (helium, nitrogen, oxygen). */
export function sphereMesh(def, color = 0xd8dde2) {
  const h = def.height, r = h * 0.42;
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 24), std(color, { roughness: 0.28, metalness: 0.75 }));
  ball.position.y = h * 0.5;
  g.add(ball);
  const strap = std(0x374151, { roughness: 0.6, metalness: 0.4 });
  for (const rot of [0, Math.PI / 2]) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(r + 0.01, 0.014, 6, 48), strap);
    t.position.y = h * 0.5;
    t.rotation.y = rot;
    g.add(t);
  }
  const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 12), strap);
  boss.position.y = h * 0.5 + r + 0.04;
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 10), std(0xf59e0b, { roughness: 0.5, metalness: 0.5 }));
  valve.position.set(0.05, h * 0.5 + r + 0.1, 0);
  valve.rotation.z = Math.PI / 2;
  g.add(boss, valve);
  const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.12, h * 0.9, 0.16), strap);
  bracket.position.set(-r - 0.04, h * 0.5, 0);
  g.add(bracket);
  g.userData.width = r * 2;
  return g;
}

/** Wiring tunnel: a long half-round raceway that lies along the tank wall. */
export function wiringTunnelMesh(def) {
  const h = def.height;
  const g = new THREE.Group();
  const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, h, 20, 1, false, 0, Math.PI), std(0xd9d7d1, { roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide }));
  cover.rotation.y = -Math.PI / 2;
  cover.position.y = h / 2;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.02, h, 0.28), std(0x6b7280, { roughness: 0.5, metalness: 0.6 }));
  back.position.y = h / 2;
  g.add(cover, back);
  const rivet = std(0x8f969c, { roughness: 0.5, metalness: 0.7 });
  for (let y = 0.15; y < h; y += 0.3) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.3), rivet);
    r.position.y = y;
    g.add(r);
  }
  g.userData.width = 0.3;
  return g;
}

/** A deployable solar wing: a long thin panel of cells on a yoke. Stands up; the yoke is at the base. */
export function solarWingMesh(def) {
  const h = def.height, w = h * 0.42;
  const g = new THREE.Group();
  const { texture, redraw } = canvasTexture(256, 512);
  redraw((ctx, cw, ch) => {
    ctx.fillStyle = '#0b1f3a';
    ctx.fillRect(0, 0, cw, ch);
    ctx.strokeStyle = '#6c87b5';
    ctx.lineWidth = 2;
    for (let x = 0; x <= cw; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke(); }
    for (let y = 0; y <= ch; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(120,160,220,0.18)';
    for (let x = 0; x < cw; x += 32) for (let y = 0; y < ch; y += 32) if ((x / 32 + y / 32) % 3 === 0) ctx.fillRect(x + 3, y + 3, 26, 26);
  });
  const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.86, 0.04), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.3, metalness: 0.5 }));
  panel.position.y = h * 0.14 + h * 0.43;
  g.add(panel);
  const yoke = std(0x8f969c, { roughness: 0.4, metalness: 0.8 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, h * 0.16, 12), yoke);
  stem.position.y = h * 0.08;
  const hinge = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.06, 0.1), yoke);
  hinge.position.y = h * 0.15;
  g.add(stem, hinge);
  g.userData.width = w;
  g.userData.thin = true;
  return g;
}

/** An RTG: a finned cylinder on a bracket, with the warm end marked. */
export function rtgMesh(def) {
  const h = def.height;
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, h * 0.9, 24), std(0x2a2e33, { roughness: 0.5, metalness: 0.7 }));
  core.position.y = h * 0.5;
  g.add(core);
  const fin = std(0xcfd3d8, { roughness: 0.35, metalness: 0.8 });
  for (let i = 0; i < 8; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.02, h * 0.8, 0.3), fin);
    f.position.y = h * 0.5;
    f.rotation.y = (i / 8) * Math.PI;
    g.add(f);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 24), std(0xf59e0b, { roughness: 0.5, metalness: 0.4, emissive: 0x7a3a00, emissiveIntensity: 0.6 }));
  cap.position.y = h * 0.96;
  g.add(cap);
  g.userData.width = 0.6;
  return g;
}

/** Parachute canister with a lid and a lanyard eye (the chute is packed inside). */
export function chuteMesh(def, color = 0xe08a3a) {
  const h = def.height;
  const g = new THREE.Group();
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, h * 0.8, 24), std(color, { roughness: 0.6, metalness: 0.2 }));
  can.position.y = h * 0.4;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, h * 0.08, 24), std(0xf1f0ec, { roughness: 0.5, metalness: 0.3 }));
  lid.position.y = h * 0.84;
  const eye = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 8, 20), std(0x8f969c, { roughness: 0.4, metalness: 0.8 }));
  eye.position.y = h * 0.93;
  g.add(can, lid, eye);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.14), new THREE.MeshStandardMaterial({ map: decalTexture(def.name.split(' ')[0].toUpperCase().slice(0, 7), 'CHUTE', def.id), transparent: true, roughness: 0.6 }));
  label.position.set(0, h * 0.45, 0.235);
  g.add(label);
  g.userData.width = 0.5;
  return g;
}

/** Inflatable heat shield: stacked fabric tori under a conical cloth, packed on a ring. */
export function hiadMesh(def, radius) {
  const h = def.height;
  const g = new THREE.Group();
  const cloth = std(0xc8a06a, { roughness: 0.85, metalness: 0.05 });
  for (let i = 0; i < 4; i++) {
    const r = radius * (1.12 - i * 0.18), t = h * 0.14;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, t, 10, 64), cloth);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = h * 0.16 + i * h * 0.2;
    g.add(ring);
  }
  g.add(lathe([[0, 0.02], [radius * 1.2, h * 0.1], [radius * 1.2, h * 0.14], [0, h * 0.08]], std(0x8c5a2b, { roughness: 0.9, side: THREE.DoubleSide })));
  g.add(ringFrame(radius * 0.9, h - 0.03, std(STEEL, { roughness: 0.4, metalness: 0.85 }), 0.03));
  return g;
}

/** A stack of folded airbags around a short drum (Pathfinder style). */
export function airbagMesh(def) {
  const h = def.height;
  const g = new THREE.Group();
  const bag = std(0xe8e4da, { roughness: 0.9, metalness: 0 });
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 14), bag);
    b.scale.set(1, 0.62, 1);
    b.position.set(Math.cos(i * 1.3) * 0.12, h * (0.18 + i * 0.16), Math.sin(i * 1.3) * 0.12);
    g.add(b);
  }
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, h * 0.9, 16), std(0x374151, { roughness: 0.6, metalness: 0.5 }));
  drum.position.y = h * 0.5;
  g.add(drum);
  g.userData.width = 0.6;
  return g;
}

/** A small instrument on a pedestal with a lens (camera, star tracker, weather booms, seismometer). */
export function instrumentMesh(def, kind = 'camera') {
  const h = def.height;
  const g = new THREE.Group();
  const body = std(0x374151, { roughness: 0.5, metalness: 0.6 });
  const gold = std(0xc9a24a, { roughness: 0.3, metalness: 0.9 });
  if (kind === 'camera') {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.2), body);
    head.position.y = h * 0.78;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, h * 0.7, 10), std(0x9aa0a6, { roughness: 0.4, metalness: 0.8 }));
    mast.position.y = h * 0.35;
    g.add(head, mast);
    for (const dx of [-0.1, 0.1]) {
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.06, 16), std(0x0b1220, { roughness: 0.2, metalness: 0.6 }));
      lens.rotation.x = Math.PI / 2;
      lens.position.set(dx, h * 0.78, 0.12);
      g.add(lens);
    }
  } else if (kind === 'tracker') {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, h * 0.7, 20), gold);
    tube.rotation.x = -0.6;
    tube.position.y = h * 0.5;
    const baffle = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.07, h * 0.3, 20, 1, true), std(0x0b1220, { roughness: 0.8, side: THREE.DoubleSide }));
    baffle.rotation.x = -0.6;
    baffle.position.set(0, h * 0.5 + Math.cos(0.6) * h * 0.4, Math.sin(0.6) * h * 0.4);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.2), body);
    base.position.y = 0.04;
    g.add(tube, baffle, base);
  } else if (kind === 'weather') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.18), body);
    box.position.y = h * 0.3;
    g.add(box);
    for (const [dx, ang] of [[0.2, 0.3], [-0.2, -0.3]]) {
      const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, h * 0.6, 8), std(0xd9d7d1, { roughness: 0.5 }));
      boom.position.set(dx, h * 0.6, 0);
      boom.rotation.z = ang;
      const cup = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), std(0xf1f0ec, { roughness: 0.6 }));
      cup.position.set(dx * 1.6, h * 0.9, 0);
      g.add(boom, cup);
    }
  } else {
    // seismometer: a dome under a wind shield
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(0xd9b26f, { roughness: 0.4, metalness: 0.7 }));
    dome.position.y = h * 0.3;
    const shield = new THREE.Mesh(new THREE.ConeGeometry(0.28, h * 0.5, 24, 1, true), std(0xe8e4da, { roughness: 0.8, side: THREE.DoubleSide }));
    shield.position.y = h * 0.55;
    g.add(dome, shield);
  }
  g.userData.width = 0.5;
  return g;
}

// ---------- thrust structures and adapters (shared fallbacks; the tail and body sections may draw their own) ----------
const SCALE_OF = { s: 0.75, m: 1, l: 1.35 };

/** A thrust structure: a short conical skirt with stringers and an engine mount plate (holes for each engine). */
export function thrustMesh(def, radius) {
  const h = def.height;
  const g = new THREE.Group();
  const skin = lathe([[radius, h], [radius, h * 0.7], [radius * 0.94, 0.04], [radius * 0.9, 0]], std(0x2b3238, { roughness: 0.5, metalness: 0.55, side: THREE.DoubleSide }));
  g.add(skin);
  g.add(ringFrame(radius, h - 0.04, std(DARK, { roughness: 0.55, metalness: 0.6 }), 0.04));
  const stringer = std(0x9aa0a6, { roughness: 0.45, metalness: 0.8 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.04, h * 0.9, 0.05), stringer);
    s.position.set(Math.cos(a) * (radius * 0.97 + 0.02), h * 0.48, Math.sin(a) * (radius * 0.97 + 0.02));
    s.rotation.y = -a;
    g.add(s);
  }
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.9, radius * 0.9, 0.08, 48), std(0x6b7280, { roughness: 0.5, metalness: 0.7 }));
  plate.position.y = 0.04;
  g.add(plate);
  const m = def.mounts ?? { count: 1, layout: [[0, 0]], scale: 1 };
  const holeMat = std(0x15181b, { roughness: 0.9 });
  for (const [fx, fz] of (m.layout ?? []).slice(0, m.count ?? 1)) {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.32 * (m.scale ?? 1), radius * 0.32 * (m.scale ?? 1), 0.1, 24), holeMat);
    hole.position.set(fx * radius, 0.03, fz * radius);
    g.add(hole);
  }
  return g;
}

/** A conical adapter between two diameters (def.adapter = { top, bottom } size letters). */
export function adapterMesh(def) {
  const h = def.height;
  const rt = BASE_R * (SCALE_OF[def.adapter?.top] ?? 1), rb = BASE_R * (SCALE_OF[def.adapter?.bottom] ?? 1);
  const g = new THREE.Group();
  const bump = panelBump('adapter', 3, true);
  bump.repeat.set(8, 1);
  g.add(lathe([[rb, 0], [rb, 0.05], [rt, h - 0.05], [rt, h]], new THREE.MeshStandardMaterial({ color: 0xe9e7e1, roughness: 0.45, metalness: 0.2, bumpMap: bump, bumpScale: 0.004, side: THREE.DoubleSide })));
  g.add(ringFrame(rb, 0.04, std(DARK, { roughness: 0.55, metalness: 0.6 }), 0.035), ringFrame(rt, h - 0.04, std(DARK, { roughness: 0.55, metalness: 0.6 }), 0.035));
  return g;
}
const BASE_R = 1.25;
