import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { pbr, interiorEnvironment } from './interiors.js';

/**
 * The traditional rover, `assets.get('rover:lrv')`: modelled on NASA's Apollo Lunar Roving Vehicle. createLunarRover() serves the
 * Blender model public/assets/models/lrv.glb (scripts/blender/lrv.py) once it has loaded and falls back to the code-built
 * rover below (createProceduralLunarRover) until then, or if the file is missing. The default
 * `rover` is the futuristic one (rover.js). Both share Role 2's interface (see src/surface/roverModel.js), so either
 * can be driven with the same controller.
 * Metres, +Y up, forward is -Z, +X is the rover's right. The origin is on the ground at the middle of the wheelbase and
 * track, the wheels rest on y = 0 and the root has no transform.
 *
 *   root
 *    ├─ body meshes (static, merged per material)
 *    └─ wheelFL / wheelFR / wheelRL / wheelRR  pivots at the wheel centres: Role 2 sets pivot.rotation.y (steering)
 *         ├─ children[0]  the spinning wheel, symmetric around the X axle: Role 2 sets rotation.x
 *         └─ children[1]  hub drive motor housing (steers, does not spin)
 *
 * userData.setDust(0..1) turns the metal and fabric dusty. Every rover has its own materials, geometries are shared.
 * No lights: the console glows through emissive materials only.
 */

const WHEELBASE = 2.29, TRACK = 1.83, R = 0.41, WIDTH = 0.23;
const HB = WHEELBASE / 2, HT = TRACK / 2;
const DECK = R + 0.12; // top of the floor panels
const DUST = new THREE.Color(0xb27a54);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ---------------------------------------------------------------- shared textures and geometries */

const cache = new Map();
const memo = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

function canvasTexture(w, h, paint, { colour = true, repeat = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(canvas);
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Woven wire as an alpha-cut diamond grid, used for the wheels (zinc-coated piano wire) and the gold antenna mesh.
function wireTexture(name, wire, shade, repeatX, repeatY) {
  return memo(`wire:${name}:${repeatX}:${repeatY}`, () => {
    const t = canvasTexture(128, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.lineCap = 'butt';
      for (const [width, colour] of [[15, shade], [9, wire]]) {
        c.strokeStyle = colour;
        c.lineWidth = width;
        c.beginPath();
        c.moveTo(-8, -8); c.lineTo(w + 8, h + 8);
        c.moveTo(-8, h + 8); c.lineTo(w + 8, -8);
        c.stroke();
      }
    });
    t.repeat.set(repeatX, repeatY);
    return t;
  });
}

// Crinkled gold Mylar foil: random light and dark facets for a bump map.
const foilBump = () => memo('foil', () => canvasTexture(256, 256, (c, w, h) => {
  let s = 7;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  c.fillStyle = '#808080';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 420; i++) {
    const g = 60 + rnd() * 140;
    c.fillStyle = `rgb(${g},${g},${g})`;
    c.beginPath();
    const x = rnd() * w, y = rnd() * h;
    c.moveTo(x, y);
    c.lineTo(x + (rnd() - 0.5) * 50, y + (rnd() - 0.5) * 50);
    c.lineTo(x + (rnd() - 0.5) * 50, y + (rnd() - 0.5) * 50);
    c.fill();
  }
}, { colour: false }));

// Perforated aluminium floor panel.
const perforated = () => memo('perf', () => canvasTexture(128, 128, (c, w, h) => {
  c.fillStyle = '#c3c8cc';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#34383c';
  for (let y = 8; y < h; y += 16) for (let x = 8; x < w; x += 16) { c.beginPath(); c.arc(x, y, 4.5, 0, 6.3); c.fill(); }
}));

// Black nylon webbing for the seats.
const webbing = () => memo('webbing', () => canvasTexture(64, 64, (c, w, h) => {
  c.fillStyle = '#1b1d20';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#2c3035';
  for (let i = 0; i < w; i += 8) { c.fillRect(i, 0, 5, h); c.fillRect(0, i, w, 4); }
}));

// Display console: attitude ball, heading, speed, range, power and temperature, as an emissive texture.
const consoleScreen = () => memo('screen', () => canvasTexture(512, 288, (c, w, h) => {
  c.fillStyle = '#031014';
  c.fillRect(0, 0, w, h);
  const cyan = '#5ad8ee', amber = '#f2a53c';
  c.strokeStyle = cyan;
  c.fillStyle = cyan;
  c.lineWidth = 3;
  c.font = 'bold 22px monospace';
  // attitude ball
  c.save();
  c.beginPath(); c.arc(110, 140, 82, 0, 6.3); c.clip();
  c.fillStyle = '#12606f'; c.fillRect(0, 0, 220, 140);
  c.fillStyle = '#6b4a1a'; c.fillRect(0, 140, 220, 160);
  c.restore();
  c.beginPath(); c.arc(110, 140, 82, 0, 6.3); c.stroke();
  c.beginPath(); c.moveTo(40, 140); c.lineTo(180, 140); c.moveTo(110, 120); c.lineTo(110, 160); c.stroke();
  c.fillText('ATT', 82, 252);
  // heading dial
  c.beginPath(); c.arc(300, 98, 50, 0, 6.3); c.stroke();
  for (let a = 0; a < 12; a++) { c.beginPath(); c.moveTo(300 + Math.cos(a * 0.5236) * 42, 98 + Math.sin(a * 0.5236) * 42); c.lineTo(300 + Math.cos(a * 0.5236) * 50, 98 + Math.sin(a * 0.5236) * 50); c.stroke(); }
  c.fillStyle = amber; c.beginPath(); c.moveTo(300, 54); c.lineTo(308, 98); c.lineTo(292, 98); c.fill();
  c.fillStyle = cyan; c.fillText('HDG 247', 244, 186);
  // speed and range
  c.fillText('SPD  8.2', 224, 224);
  c.fillText('RNG 12.4', 224, 256);
  // power and temperature bars
  c.fillStyle = cyan;
  c.fillText('PWR', 410, 60);
  c.fillText('TMP', 410, 170);
  c.strokeRect(412, 72, 70, 20); c.fillStyle = cyan; c.fillRect(416, 76, 52, 12);
  c.strokeRect(412, 182, 70, 20); c.fillStyle = amber; c.fillRect(416, 186, 38, 12);
}, { repeat: false }));

const unitBox = () => memo('box', () => new THREE.BoxGeometry(1, 1, 1));
const unitTube = () => memo('tube', () => new THREE.CylinderGeometry(1, 1, 1, 8));

function uvScaled(geometry, su, sv) {
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geometry;
}

/* ---------------------------------------------------------------- body batching */

// Collects static parts and merges them into one mesh per material, so the body costs a handful of draw calls.
function createBatch() {
  const groups = new Map();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  const up = V(0, 1, 0);
  const put = (material, geometry, position, quaternion, scale = one) => {
    m.compose(position, quaternion, scale);
    if (!groups.has(material)) groups.set(material, []);
    groups.get(material).push(geometry.clone().applyMatrix4(m));
  };
  const api = {
    // any geometry at a position with an XYZ rotation
    geo(material, geometry, x, y, z, rx = 0, ry = 0, rz = 0, scale) {
      put(material, geometry, V(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), scale);
    },
    box(material, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
      put(material, unitBox(), V(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), V(w, h, d));
    },
    // a round tube from a to b
    strut(material, a, b, radius) {
      const dir = b.clone().sub(a);
      put(material, unitTube(), a.clone().add(b).multiplyScalar(0.5), q.setFromUnitVectors(up, dir.clone().normalize()), V(radius, dir.length(), radius));
    },
    // a flat strap or plate from a to b (width across, thickness t)
    bar(material, a, b, width, t) {
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const o = new THREE.Object3D();
      o.position.copy(mid);
      o.lookAt(b);
      put(material, unitBox(), mid, o.quaternion, V(width, t, a.distanceTo(b)));
    },
    build(parent) {
      for (const [material, list] of groups) {
        const mesh = new THREE.Mesh(mergeGeometries(list, false), material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        parent.add(mesh);
        list.forEach((g) => g.dispose());
      }
    },
  };
  return api;
}

/* ---------------------------------------------------------------- materials (one set per rover, so dust is per rover) */

function createMaterials() {
  const dusty = [];
  const make = (color, roughness, metalness, extra = {}, dust = 0.8) => {
    const material = pbr(color, roughness, metalness, { envMapIntensity: metalness > 0.5 ? 0.9 : 0.4, ...extra });
    dusty.push({ material, base: new THREE.Color(color), roughness, metalness, dust });
    return material;
  };
  const materials = {
    aluminium: make(0xc9ced2, 0.32, 0.92),
    anodised: make(0x9aa3ab, 0.4, 0.85),
    titanium: make(0x7b8085, 0.45, 0.8),
    floor: make(0xffffff, 0.45, 0.8, { map: perforated() }),
    fender: make(0x6f757b, 0.6, 0.05, { side: THREE.DoubleSide }, 0.9),
    seat: make(0xffffff, 0.85, 0, { map: webbing() }, 0.7),
    belt: make(0x3d4048, 0.8, 0, {}, 0.7),
    dark: make(0x24272b, 0.6, 0.35),
    thermal: make(0xe4dfd2, 0.7, 0.1, {}, 0.9),
    sack: make(0xd8d3c4, 0.9, 0, {}, 1),
    mirror: make(0xc9cdd1, 0.3, 0.7, { envMapIntensity: 0.5 }, 0.6),
    gold: make(0xdcab3c, 0.3, 1, { bumpMap: foilBump(), bumpScale: 1.2 }),
    goldMesh: make(0xffffff, 0.35, 0.95, { map: wireTexture('gold', '#e6b84a', '#a07a20', 18, 5), alphaTest: 0.5, side: THREE.DoubleSide }),
    wire: make(0xffffff, 0.45, 0.85, { map: wireTexture('zinc', '#c4cacf', '#7c8388', 56, 5), alphaTest: 0.5, side: THREE.DoubleSide }),
    wireDisc: make(0xffffff, 0.45, 0.85, { map: wireTexture('zinc', '#c4cacf', '#7c8388', 9, 9), alphaTest: 0.5, side: THREE.DoubleSide }),
    screen: pbr(0x05080a, 0.35, 0, { emissive: 0xffffff, emissiveMap: consoleScreen(), emissiveIntensity: 0.85 }),
  };
  const tmp = new THREE.Color();
  const setDust = (amount) => {
    const t = THREE.MathUtils.clamp(amount, 0, 1);
    for (const d of dusty) {
      d.material.color.copy(tmp.copy(d.base).lerp(DUST, 0.8 * t * d.dust));
      d.material.roughness = THREE.MathUtils.lerp(d.roughness, 0.95, t * d.dust);
      d.material.metalness = THREE.MathUtils.lerp(d.metalness, d.metalness * 0.3, t * d.dust);
    }
  };
  return { materials, setDust };
}

/* ---------------------------------------------------------------- wheels */

// 24 titanium chevrons around the tread: two angled bars forming a V, so about half of the tread is covered.
const chevronGeometry = () => memo('chevrons', () => {
  const arm = new THREE.BoxGeometry(0.1, 0.016, 0.022);
  const list = [];
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    for (const side of [-1, 1]) {
      const g = arm.clone();
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(-side * 0.7).setPosition(side * 0.045, 0, 0.03));
      g.applyMatrix4(new THREE.Matrix4().makeRotationX(a).setPosition(0, Math.cos(a) * (R - 0.008), Math.sin(a) * (R - 0.008)));
      list.push(g);
    }
  }
  return mergeGeometries(list, false);
});

const wheelParts = () => memo('wheelParts', () => ({
  mesh: new THREE.CylinderGeometry(R - 0.012, R - 0.012, WIDTH, 64, 1, true).rotateZ(Math.PI / 2),
  disc: new THREE.RingGeometry(0.1, R - 0.014, 48).rotateY(Math.PI / 2),
  bead: new THREE.TorusGeometry(R - 0.014, 0.007, 5, 56).rotateY(Math.PI / 2),
  hub: new THREE.CylinderGeometry(0.1, 0.1, 0.14, 24).rotateZ(Math.PI / 2),
  cap: new THREE.CylinderGeometry(0.045, 0.06, 0.2, 16).rotateZ(Math.PI / 2),
  motor: new THREE.CylinderGeometry(0.095, 0.095, 0.13, 24).rotateZ(Math.PI / 2),
  fin: new THREE.CylinderGeometry(0.105, 0.105, 0.012, 24).rotateZ(Math.PI / 2),
}));

// A wire-mesh wheel: woven piano wire, titanium chevron treads, aluminium hub. Symmetric around the X axle.
function createWheel(materials) {
  const g = wheelParts();
  const spin = new THREE.Group();
  spin.name = 'wheelSpin';
  const add = (geometry, material, x = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.x = x;
    mesh.castShadow = true;
    spin.add(mesh);
    return mesh;
  };
  add(g.mesh, materials.wire);
  add(g.disc, materials.wireDisc);
  add(g.bead, materials.anodised, WIDTH / 2 - 0.005);
  add(g.bead, materials.anodised, -WIDTH / 2 + 0.005);
  add(chevronGeometry(), materials.titanium);
  add(g.hub, materials.aluminium);
  add(g.cap, materials.anodised);
  return spin;
}

/* ---------------------------------------------------------------- parts of the body */

function chassis(b, mat) {
  // three-part chassis (front, centre, rear), each a frame of aluminium tube with a perforated floor panel
  for (const [z0, z1] of [[-1.5, -0.67], [-0.63, 0.63], [0.67, 1.5]]) {
    const len = z1 - z0, zc = (z0 + z1) / 2;
    b.geo(mat.floor, uvScaled(new THREE.BoxGeometry(0.96, 0.03, len - 0.04), 0.96 / 0.16, len / 0.16), 0, DECK - 0.015, zc);
    for (const x of [-0.5, 0.5]) b.strut(mat.aluminium, V(x, DECK - 0.01, z0), V(x, DECK - 0.01, z1), 0.026);
    for (const z of [z0 + 0.02, z1 - 0.02]) b.strut(mat.aluminium, V(-0.5, DECK - 0.01, z), V(0.5, DECK - 0.01, z), 0.022);
    for (const x of [-0.4, 0.4]) b.strut(mat.anodised, V(x, DECK - 0.1, z0 + 0.04), V(x, DECK - 0.1, z1 - 0.04), 0.018); // belly rails
    for (const x of [-0.4, 0.4]) for (const z of [z0 + 0.04, z1 - 0.04]) b.strut(mat.anodised, V(x, DECK - 0.1, z), V(x * 1.25, DECK - 0.01, z), 0.014);
  }
  // hinges between the sections
  for (const z of [-0.65, 0.65]) {
    b.strut(mat.anodised, V(-0.52, DECK + 0.005, z), V(0.52, DECK + 0.005, z), 0.03);
    for (const x of [-0.5, 0.5]) b.box(mat.dark, 0.06, 0.05, 0.1, x, DECK + 0.005, z);
  }
}

// Wheel suspension (upper and lower arms), hub motors' mounts and the fender with its extension.
function wheelStations(b, mat) {
  const fender = memo('fender', () => new THREE.CylinderGeometry(R + 0.06, R + 0.06, 0.3, 28, 1, true, Math.PI / 2 - 1.35, 2.7).rotateZ(Math.PI / 2));
  const lip = memo('lip', () => new THREE.BoxGeometry(0.3, 0.012, 0.2));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * HT, z = sz * HB;
      b.strut(mat.anodised, V(sx * 0.5, DECK + 0.03, z - 0.15), V(sx * 0.72, R + 0.08, z), 0.016); // upper arms
      b.strut(mat.anodised, V(sx * 0.5, DECK + 0.03, z + 0.15), V(sx * 0.72, R + 0.08, z), 0.016);
      b.strut(mat.anodised, V(sx * 0.5, DECK - 0.02, z - 0.15), V(sx * 0.72, R - 0.08, z), 0.016); // lower arms
      b.strut(mat.anodised, V(sx * 0.5, DECK - 0.02, z + 0.15), V(sx * 0.72, R - 0.08, z), 0.016);
      b.strut(mat.dark, V(sx * 0.62, DECK + 0.1, z), V(sx * 0.62, R - 0.02, z), 0.012); // torsion damper
      // fender over the wheel, with a tilted extension on the outer end
      b.geo(mat.fender, fender, x, R, z);
      const out = sz; // front fenders extend forward (-Z), rear fenders rearward (+Z)
      b.geo(mat.fender, lip, x, R + 0.075, z + out * 0.52, out * 0.45);
      b.strut(mat.aluminium, V(sx * 0.78, R + R * 0.95, z - 0.1), V(sx * 0.5, DECK + 0.04, z - 0.1), 0.009); // fender stays
      b.strut(mat.aluminium, V(sx * 0.78, R + R * 0.95, z + 0.1), V(sx * 0.5, DECK + 0.04, z + 0.1), 0.009);
    }
  }
}

function seats(b, mat) {
  const panY = DECK + 0.28;
  for (const x of [-0.32, 0.32]) {
    // seat pan: tube frame with webbing
    for (const dx of [-0.2, 0.2]) {
      b.strut(mat.aluminium, V(x + dx, panY, 0.06), V(x + dx, panY, 0.54), 0.014);
      b.strut(mat.aluminium, V(x + dx, DECK, 0.1), V(x + dx, panY, 0.1), 0.013); // front legs
      b.strut(mat.aluminium, V(x + dx, DECK, 0.5), V(x + dx, panY, 0.5), 0.013);
      b.strut(mat.aluminium, V(x + dx, panY, 0.54), V(x + dx * 0.95, panY + 0.5, 0.7), 0.014); // back uprights
    }
    b.strut(mat.aluminium, V(x - 0.2, panY, 0.06), V(x + 0.2, panY, 0.06), 0.014);
    b.strut(mat.aluminium, V(x - 0.19, panY + 0.5, 0.7), V(x + 0.19, panY + 0.5, 0.7), 0.013);
    b.strut(mat.aluminium, V(x - 0.2, DECK + 0.1, 0.1), V(x + 0.2, DECK + 0.1, 0.5), 0.009); // leg cross braces
    b.strut(mat.aluminium, V(x + 0.2, DECK + 0.1, 0.1), V(x - 0.2, DECK + 0.1, 0.5), 0.009);
    b.box(mat.seat, 0.4, 0.014, 0.48, x, panY + 0.01, 0.3);
    b.bar(mat.seat, V(x, panY + 0.05, 0.56), V(x, panY + 0.46, 0.69), 0.38, 0.012);
    // lap belt and shoulder straps with a buckle
    b.bar(mat.belt, V(x - 0.2, panY + 0.03, 0.4), V(x, panY + 0.06, 0.1), 0.045, 0.008);
    b.bar(mat.belt, V(x + 0.2, panY + 0.03, 0.4), V(x, panY + 0.06, 0.1), 0.045, 0.008);
    b.box(mat.aluminium, 0.06, 0.02, 0.05, x, panY + 0.065, 0.1);
    for (const dx of [-0.12, 0.12]) b.bar(mat.belt, V(x + dx, panY + 0.44, 0.69), V(x * 0.9 + dx * 0.3, panY + 0.06, 0.12), 0.04, 0.007);
    // footrest plate on two tubes, folded flat to the floor
    b.bar(mat.anodised, V(x, DECK + 0.1, -0.2), V(x, DECK + 0.03, -0.46), 0.3, 0.015);
    for (const dx of [-0.13, 0.13]) b.strut(mat.aluminium, V(x + dx, DECK, -0.1), V(x + dx, DECK + 0.1, -0.2), 0.011);
  }
}

// Console on a short pedestal in front of the seats, and the T-shaped hand controller between them. Both stay below y 1.1.
function controls(b, mat) {
  b.strut(mat.anodised, V(0, DECK, -0.36), V(0, DECK + 0.36, -0.36), 0.025);
  b.box(mat.dark, 0.4, 0.24, 0.07, 0, DECK + 0.4, -0.38, -0.5);
  const face = new THREE.PlaneGeometry(0.35, 0.197);
  b.geo(mat.screen, face, 0, DECK + 0.4 + 0.037 * Math.sin(0.5), -0.38 + 0.037 * Math.cos(0.5), -0.5);
  // switch row under the display
  for (let i = -3; i <= 3; i++) b.box(mat.aluminium, 0.02, 0.025, 0.02, i * 0.05, DECK + 0.275, -0.31, -0.5);
  // hand controller: stalk on a base plate, with the T grip on top
  b.box(mat.dark, 0.1, 0.03, 0.1, 0, DECK + 0.015, -0.1);
  b.strut(mat.aluminium, V(0, DECK + 0.03, -0.1), V(0, DECK + 0.33, -0.1), 0.014);
  b.box(mat.dark, 0.17, 0.034, 0.04, 0, DECK + 0.35, -0.1);
  b.box(mat.dark, 0.03, 0.05, 0.06, 0.09, DECK + 0.35, -0.1);
  b.box(mat.dark, 0.03, 0.05, 0.06, -0.09, DECK + 0.35, -0.1);
}

function frontEquipment(b, mat) {
  const relay = new THREE.BoxGeometry(0.5, 0.22, 0.38);
  // Lunar Communications Relay Unit: gold foil box with a radiator louvre and a small stub antenna
  b.geo(mat.gold, relay, 0, DECK + 0.11, -1.2);
  b.box(mat.mirror, 0.4, 0.008, 0.28, 0, DECK + 0.224, -1.2);
  b.strut(mat.aluminium, V(0.17, DECK + 0.22, -1.3), V(0.17, DECK + 0.42, -1.3), 0.008);
  // TV camera on its mast, low at the front
  b.strut(mat.aluminium, V(0.14, DECK, -1.43), V(0.14, DECK + 0.3, -1.43), 0.02);
  b.box(mat.dark, 0.14, 0.1, 0.2, 0.14, DECK + 0.36, -1.43);
  b.strut(mat.titanium, V(0.14, DECK + 0.36, -1.52), V(0.14, DECK + 0.36, -1.52 + 0.1), 0.035);
  b.box(mat.gold, 0.15, 0.015, 0.22, 0.14, DECK + 0.42, -1.43);
  // two batteries under thermal covers, each with a hinged dust mirror
  for (const x of [-0.28, 0.28]) {
    b.geo(mat.thermal, new THREE.BoxGeometry(0.46, 0.2, 0.26), x, DECK + 0.1, -0.82);
    b.box(mat.dark, 0.48, 0.02, 0.28, x, DECK + 0.01, -0.82);
    b.box(mat.mirror, 0.38, 0.01, 0.18, x, DECK + 0.225, -0.84, 0.25); // dust mirror, tilted a little toward the front
    b.strut(mat.aluminium, V(x - 0.2, DECK + 0.21, -0.93), V(x + 0.2, DECK + 0.21, -0.93), 0.008);
  }
}

function antennas(b, mat) {
  // umbrella high-gain antenna: gold mesh dish on a mast at the front right, opening up and back
  const x = 0.66, z = -0.78;
  b.strut(mat.aluminium, V(0.5, DECK + 0.02, z), V(x, DECK + 0.04, z), 0.016); // outrigger bracket
  b.strut(mat.aluminium, V(x, DECK, z), V(x, DECK + 0.68, z), 0.017);
  const profile = [];
  for (let i = 0; i <= 8; i++) { const r = (i / 8) * 0.34; profile.push(new THREE.Vector2(r, 0.9 * r * r)); }
  const tilt = 0.6, cy = DECK + 0.7;
  b.geo(mat.goldMesh, memo('dish', () => new THREE.LatheGeometry(profile, 28)), x, cy, z, tilt);
  b.geo(mat.gold, memo('dishRim', () => new THREE.TorusGeometry(0.34, 0.006, 5, 36).rotateX(Math.PI / 2).translate(0, 0.9 * 0.34 * 0.34, 0)), x, cy, z, tilt);
  const normal = V(0, Math.cos(tilt), Math.sin(tilt));
  b.strut(mat.aluminium, V(x, cy, z), V(x, cy, z).add(normal.clone().multiplyScalar(0.3)), 0.006); // feed boom
  b.geo(mat.gold, memo('horn', () => new THREE.ConeGeometry(0.03, 0.06, 10)), x + 0, cy + normal.y * 0.32, z + normal.z * 0.32, tilt);

  // helical low-gain antenna on a short mast at the rear left, behind the driver
  const hx = -0.55, hz = 0.8;
  b.strut(mat.aluminium, V(hx, DECK, hz), V(hx, DECK + 0.32, hz), 0.013);
  const helix = memo('helix', () => {
    class Helix extends THREE.Curve {
      getPoint(t, target = new THREE.Vector3()) {
        const a = t * Math.PI * 2 * 7;
        return target.set(Math.cos(a) * 0.05, t * 0.5, Math.sin(a) * 0.05);
      }
    }
    return new THREE.TubeGeometry(new Helix(), 112, 0.007, 5);
  });
  b.geo(mat.gold, helix, hx, DECK + 0.32, hz);
  b.strut(mat.aluminium, V(hx, DECK + 0.32, hz), V(hx, DECK + 0.84, hz), 0.007);
}

// Rear payload pallet: tool carrier rack, sample bags and a sample container.
function pallet(b, mat) {
  b.box(mat.anodised, 0.96, 0.03, 0.62, 0, DECK + 0.015, 1.12);
  for (const x of [-0.45, 0.45]) {
    b.strut(mat.aluminium, V(x, DECK, 1.38), V(x, DECK + 0.6, 1.38), 0.015); // carrier posts
    b.strut(mat.aluminium, V(x, DECK + 0.6, 1.38), V(x, DECK + 0.45, 1.0), 0.012);
  }
  b.strut(mat.aluminium, V(-0.45, DECK + 0.6, 1.38), V(0.45, DECK + 0.6, 1.38), 0.015);
  b.strut(mat.aluminium, V(-0.45, DECK + 0.45, 1.0), V(0.45, DECK + 0.45, 1.0), 0.012);
  // tools hanging in the carrier: scoop, rake, tongs and a hammer
  const tools = [[-0.3, 0.55], [-0.15, 0.5], [0.0, 0.58], [0.15, 0.5]];
  tools.forEach(([x, len], i) => {
    b.strut(mat.anodised, V(x, DECK + 0.58, 1.34), V(x + 0.02, DECK + 0.58 - len, 1.3), 0.01);
    b.box(mat.titanium, 0.07 + (i % 2) * 0.04, 0.012, 0.09, x + 0.02, DECK + 0.58 - len - 0.02, 1.3);
  });
  // sample bags, soft white sacks, and a tool case
  const sack = memo('sack', () => new THREE.SphereGeometry(0.5, 14, 10));
  [[-0.3, 0.2], [-0.1, 0.17], [0.1, 0.19], [0.3, 0.16]].forEach(([x, h], i) => {
    b.geo(mat.sack, sack, x, DECK + 0.04 + h / 2, 1.12 + (i % 2) * 0.05, 0, i, 0, V(0.2, h, 0.24));
    b.box(mat.belt, 0.2, 0.012, 0.02, x, DECK + 0.04 + h * 0.8, 1.12 + (i % 2) * 0.05);
  });
  b.box(mat.anodised, 0.36, 0.16, 0.26, 0.28, DECK + 0.11, 0.86);
  b.box(mat.dark, 0.3, 0.02, 0.01, 0.28, DECK + 0.15, 0.725);
  b.box(mat.thermal, 0.32, 0.14, 0.24, -0.28, DECK + 0.1, 0.86);
}

/* ---------------------------------------------------------------- the rover */

let logged = false;

function countTriangles(root) {
  let n = 0;
  root.traverse((o) => {
    if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  return n;
}

function createProceduralLunarRover() {
  const root = new THREE.Group();
  root.name = 'rover:lrv';
  const { materials: mat, setDust } = createMaterials();

  const body = new THREE.Group();
  body.name = 'body';
  const batch = createBatch();
  chassis(batch, mat);
  wheelStations(batch, mat);
  seats(batch, mat);
  controls(batch, mat);
  frontEquipment(batch, mat);
  antennas(batch, mat);
  pallet(batch, mat);
  batch.build(body);
  root.add(body);

  // wheel pivots: steering turns the pivot, spin turns children[0]
  const parts = wheelParts();
  for (const [name, sx, sz] of [['wheelFL', -1, -1], ['wheelFR', 1, -1], ['wheelRL', -1, 1], ['wheelRR', 1, 1]]) {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.set(sx * HT, R, sz * HB);
    pivot.add(createWheel(mat));
    const motor = new THREE.Group();
    motor.name = 'hubMotor';
    const housing = new THREE.Mesh(parts.motor, mat.dark);
    housing.position.x = -sx * 0.145;
    const fins = new THREE.Mesh(parts.fin, mat.anodised);
    fins.position.x = -sx * 0.1;
    housing.castShadow = fins.castShadow = true;
    motor.add(housing, fins);
    pivot.add(motor);
    root.add(pivot);
  }

  root.userData.setDust = setDust;
  root.userData.triangles = countTriangles(root);
  if (!logged) {
    logged = true;
    console.info(`[rover:lrv] ${Math.round(root.userData.triangles)} triangles`);
  }
  return root;
}

/* ---------------------------------------------------------------- the Blender model (GLB) */

const GLB_URL = '/assets/models/lrv.glb';
const EYE = new THREE.Vector3(-0.32, 1.48, 0.22); // left seat, looking -Z
let template = null;
let loading = null;

/** Starts loading the GLB (once). Resolves with the template, or null if it could not be loaded (the code-built rover is used). */
export function loadLunarRoverModel() {
  if (!loading) {
    loading = new GLTFLoader().loadAsync(GLB_URL).then((gltf) => {
      template = gltf.scene;
      template.name = 'rover:lrv';
      template.userData.triangles = countTriangles(template);
      console.info(`[rover:lrv] Blender model loaded, ${Math.round(template.userData.triangles)} triangles`);
      return template;
    }).catch((error) => {
      console.warn('[rover:lrv] lrv.glb not loaded, using the code-built rover:', error?.message ?? error);
      return null;
    });
  }
  return loading;
}
if (typeof window !== 'undefined') loadLunarRoverModel();

// A clone of the template with its own materials (dust is per rover), env reflections and shadows.
function cloneLunarModel() {
  const root = template.clone(true);
  for (const pivot of root.children) { // contract: children[0] is the spinning wheel, the fender (non-spinning) follows
    const spin = pivot.children.find((c) => c.name.endsWith('_spin'));
    if (spin && pivot.children[0] !== spin) pivot.children.unshift(...pivot.children.splice(pivot.children.indexOf(spin), 1));
  }
  const env = interiorEnvironment();
  const owned = new Map();
  const dusty = [];
  const own = (m) => {
    if (!owned.has(m)) {
      const c = m.clone();
      c.envMap = env;
      c.envMapIntensity = c.metalness > 0.5 ? 0.9 : 0.5;
      for (const key of ['map', 'normalMap', 'aoMap']) if (c[key]) c[key].anisotropy = 8;
      dusty.push({ material: c, base: c.color.clone(), roughness: c.roughness, metalness: c.metalness });
      owned.set(m, c);
    }
    return owned.get(m);
  };
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
    o.castShadow = true;
    o.receiveShadow = true;
  });
  const tmp = new THREE.Color();
  // Mars dust: blend the base colours toward reddish tan and make the surfaces rougher and less metallic.
  root.userData.setDust = (amount) => {
    const t = THREE.MathUtils.clamp(amount, 0, 1);
    for (const d of dusty) {
      d.material.color.copy(tmp.copy(d.base).lerp(DUST, 0.75 * t));
      d.material.roughness = THREE.MathUtils.lerp(d.roughness, 0.95, t * 0.8);
      d.material.metalness = THREE.MathUtils.lerp(d.metalness, d.metalness * 0.3, t * 0.8);
    }
  };
  root.userData.eye = EYE.clone();
  root.userData.triangles = template.userData.triangles;
  return root;
}

/** The LRV for Role 2: the Blender model when loaded, else the code-built one. */
export function createLunarRover() {
  return template ? cloneLunarModel() : createProceduralLunarRover();
}
