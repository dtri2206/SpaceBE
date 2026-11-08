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
