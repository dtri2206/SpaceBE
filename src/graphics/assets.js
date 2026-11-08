import * as THREE from 'three';
import { createPlanet, loadPlanetMaps } from './planets.js';
import { createSpaceSky } from './sky.js';
import { createCockpit, interiorEnvironment, pbr } from './interiors.js';
import { createFlightDeck } from './flightDeck.js';
import { createCabin } from './cabin.js';
import { PROPS } from './props.js';
import { createRover, loadRoverModel } from './rover.js';
import { createLunarRover, loadLunarRoverModel } from './roverLrv.js';
import { createEngineFlame, createEntryPlasma, createExhaust, createLandingDust } from './vfx.js';

const factories = new Map();
const warned = new Set();

/** A cyan wireframe: stands in for anything without art yet, and looks deliberate rather than broken. */
export function hologram(name, [w, h, d] = [1, 1, 1]) {
  const group = new THREE.Group();
  group.name = `hologram:${name}`;
  const geometry = new THREE.BoxGeometry(w, h, d);
  const color = new THREE.Color(0.25, 1.5, 1.8);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color }));
  const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, depthWrite: false }));
  group.add(edges, fill);
  edges.position.y = fill.position.y = h / 2;
  return group;
}

const WHITE = 0xe9e6de, DARK = 0x23272c, COPPER = 0xb8743f, SILVER = 0xa8aeb4;

function lathe(points, material, segments = 48) {
  const curve = points.map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.Mesh(new THREE.LatheGeometry(curve, segments), material);
}

function band(radius, y, height, material) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.008, radius + 0.008, height, 48, 1, true), material);
  mesh.position.y = y;
  return mesh;
}

// Materials and canvas textures are made once and shared by every part, so a full rocket stays cheap.
const shared = new Map();
function cached(key, make) {
  if (!shared.has(key)) shared.set(key, make());
  return shared.get(key);
}

function canvasTex(w, h, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext('2d'), w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.RepeatWrapping;
  return texture;
}

// Panel seams, weld lines, rivet rows and stencilled text on a white skin. `ringsAt` are heights in metres.
function paintSkin(c, w, h, { height, rings, bands = [], label = true }) {
  const ppm = h / height; // pixels per metre along the part
  c.fillStyle = '#e9e6de';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { // faint panel-to-panel tone differences and speckle
    c.fillStyle = `rgba(${90 + (i % 5) * 8},${90 + (i % 7) * 5},90,0.035)`;
    c.fillRect((i * 97) % w, (i * 53) % h, 18 + (i % 40), 14 + (i % 30));
  }
  const panels = 8; // vertical seams, evenly around
  for (let i = 0; i < panels; i++) {
    const x = (i / panels) * w;
    c.fillStyle = 'rgba(60,62,66,0.55)';
    c.fillRect(x - 1.5, 0, 3, h);
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillRect(x + 2, 0, 1.5, h);
  }
  for (const y of rings) { // horizontal weld lines with a bead of rivets
    const py = h - y * ppm;
    c.fillStyle = 'rgba(70,64,58,0.8)';
    c.fillRect(0, py - 2.5, w, 5);
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.fillRect(0, py + 3, w, 1.5);
    c.fillStyle = 'rgba(40,40,44,0.55)';
    for (let x = 6; x < w; x += 14) c.fillRect(x, py - 11, 3, 3);
  }
  for (const [y0, y1, color] of bands) {
    c.fillStyle = color;
    c.fillRect(0, h - y1 * ppm, w, (y1 - y0) * ppm);
  }
  if (label) {
    for (const cx of [0, w * 0.5, w]) {
      c.save();
      c.translate(cx, h * 0.5);
      c.rotate(-Math.PI / 2);
      c.fillStyle = '#1b2127';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `700 ${Math.round(Math.min(w * 0.065, h * 0.11))}px "IBM Plex Mono", monospace`;
      c.fillText('SPACEB&E', 0, 0);
      c.font = `500 ${Math.round(Math.min(w * 0.025, h * 0.045))}px "IBM Plex Mono", monospace`;
      c.fillText('LOX / FUEL  ·  DO NOT STEP', 0, Math.min(w * 0.07, h * 0.09));
      c.restore();
    }
  }
}

const tankMaterials = (height) => cached(`tank:${height.toFixed(2)}`, () => {
  const side = pbr(0xffffff, 0.42, 0.08, { map: canvasTex(1024, Math.round(1024 * height / 7.85), (c, w, h) => paintSkin(c, w, h, { height, rings: [0.9, height * 0.5, height - 0.9], bands: [[0.12, 0.3, '#23272c'], [height - 0.3, height - 0.12, '#23272c']] })) });
  return [side, pbr(0xd9d6ce, 0.5, 0.1), pbr(0xd9d6ce, 0.5, 0.1)];
});

const noseMaterial = () => cached('nose', () => pbr(0xffffff, 0.4, 0.05, {
  map: canvasTex(1024, 512, (c, w, h) => {
    paintSkin(c, w, h, { height: 2.9, rings: [0.72, 1.45, 2.2], label: false });
    c.fillStyle = '#b3261e'; // tip band
    c.fillRect(0, 0, w, h * 0.09);
  }),
}));

const capsuleSkin = () => cached('capsuleSkin', () => pbr(0xffffff, 0.45, 0.05, {
  map: canvasTex(1024, 512, (c, w, h) => paintSkin(c, w, h, { height: 2, rings: [0.45, 1.2], label: false })),
}));

const finMaterial = () => cached('fin', () => pbr(0xc9ced3, 0.4, 0.5));
const finEdge = () => cached('finEdge', () => new THREE.LineBasicMaterial({ color: 0xff6a3d }));
const glassMat = () => cached('glass', () => new THREE.MeshStandardMaterial({ color: 0x0b1f33, roughness: 0.1, metalness: 0.6, emissive: 0x0a2a44, emissiveIntensity: 0.9 }));
const darkMat = () => cached('dark', () => pbr(0x1b1e22, 0.6, 0.5));
const steelMat = () => cached('steel', () => pbr(0x8e959c, 0.35, 0.9));
const pipeMat = () => cached('pipe', () => pbr(0xc9cdd1, 0.3, 0.9));
const scorchMat = () => cached('scorch', () => pbr(0x15110e, 0.95, 0.2, { side: THREE.BackSide }));

function blockOn(width, height, depth, material, angle, radius, y) { // a small block on the skin, facing outward at `angle`
  const m = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  m.position.set(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
  m.rotation.y = angle;
  return m;
}

// Each builder returns a part centred on the rocket's axis with its base at y = 0.
const PARTS = {
  capsule(s) {
    const g = new THREE.Group();
    g.add(lathe([[0, 0], [1.25 * s, 0], [1.25 * s, 0.12 * s], [0.5 * s, 1.75 * s], [0.34 * s, 1.95 * s], [0, 1.98 * s]], capsuleSkin()));
    g.add(band(0.96 * s, 0.72 * s, 0.05 * s, pbr(DARK, 0.5, 0.3)));
    // slope of the shell: radius = 1.25s - 0.4694 * (y - 0.12s) for y in [0.12s, 1.75s]
    const radiusAt = (y) => (1.25 * s) - ((1.25 - 0.5) / (1.63)) * (y - 0.12 * s) * 1;
    const tilt = Math.atan2(0.75, 1.63); // shell leans in
    const win = (angle, y, rr, size) => {
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(size * 1.28, size * 1.28, 0.03, 20), steelMat());
      const glass = new THREE.Mesh(new THREE.CylinderGeometry(size, size, 0.045, 20), glassMat());
      const grp = new THREE.Group();
      grp.add(rim, glass);
      grp.position.set(Math.sin(angle) * rr, y, Math.cos(angle) * rr);
      grp.rotation.set(0, angle, 0);
      grp.rotateX(Math.PI / 2 - tilt);
      return grp;
    };
    for (const a of [-0.42, 0, 0.42]) g.add(win(a, 1.05 * s, radiusAt(1.05 * s) - 0.01, 0.15 * s));
    // hatch on the far side: a rounded square outline
    const hatchY = 0.95 * s, hatchR = radiusAt(hatchY) - 0.005;
    const hatch = new THREE.Group();
    const frame = pbr(0x5b6068, 0.4, 0.7);
    const hw = 0.3 * s, hh = 0.38 * s;
    for (const [w, h, x, y] of [[hw * 2, 0.03, 0, hh], [hw * 2, 0.03, 0, -hh], [0.03, hh * 2, hw, 0], [0.03, hh * 2, -hw, 0]]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), frame);
      bar.position.set(x, y, 0);
      hatch.add(bar);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.14 * s, 0.04, 0.04), darkMat());
    handle.position.set(hw * 0.4, 0, 0.02);
    hatch.add(handle);
    hatch.position.set(0, hatchY, -hatchR);
    hatch.rotation.set(0, Math.PI, 0);
    hatch.rotateX(-tilt + 0);
    g.add(hatch);
    // four RCS thruster blocks near the shoulder, each with two nozzles
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const blk = blockOn(0.26 * s, 0.2 * s, 0.14 * s, darkMat(), a, 1.2 * s + 0.04, 0.34 * s);
      for (const dx of [-0.07 * s, 0.07 * s]) {
        const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.045 * s, 0.07 * s, 8), steelMat());
        nz.rotation.x = Math.PI / 2;
        nz.position.set(dx, 0, 0.09 * s);
        blk.add(nz);
      }
      g.add(blk);
    }
    return g;
  },
  tank(s) {
    const r = 1.25, h = 4 * s;
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48, 1), tankMaterials(h));
    body.position.y = h / 2;
    g.add(body);
    return g;
  },
  engine(s) {
    const g = new THREE.Group();
    const profile = [[1.0 * s, 0], [0.9 * s, 0.3 * s], [0.52 * s, 0.95 * s], [0.3 * s, 1.25 * s], [0.34 * s, 1.5 * s], [0.34 * s, 1.75 * s]];
    g.add(lathe(profile, cached('bell', () => pbr(COPPER, 0.32, 0.9, { side: THREE.FrontSide }))));
    const liner = lathe(profile.map(([r, y]) => [r * 0.985, y]), scorchMat()); // dark scorched inside, seen from below
    g.add(liner);
    g.add(band(0.97 * s, 0.1 * s, 0.07 * s, steelMat())); // lip
    // chamber, turbopump lump and plumbing above the bell
    g.add(lathe([[0.42 * s, 1.5 * s], [0.5 * s, 1.75 * s], [0.5 * s, 2.15 * s], [0, 2.3 * s]], steelMat()));
    const pump = new THREE.Mesh(new THREE.SphereGeometry(0.3 * s, 16, 12), pbr(0x6e757c, 0.4, 0.85));
    pump.scale.set(1, 0.8, 1);
    pump.position.set(0.42 * s, 1.95 * s, 0);
    g.add(pump);
    const pumpCap = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * s, 0.13 * s, 0.22 * s, 14), darkMat());
    pumpCap.position.set(0.42 * s, 2.2 * s, 0);
    g.add(pumpCap);
    for (const [x, z, a] of [[0.2, 0.24, 0.2], [-0.24, 0.1, -0.15], [-0.05, -0.28, 0.1]]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035 * s, 0.035 * s, 0.9 * s, 8), pipeMat());
      pipe.position.set(x * s + 0.2 * s, 1.55 * s, z * s);
      pipe.rotation.z = a;
      g.add(pipe);
    }
    const feed = new THREE.Mesh(new THREE.TorusGeometry(0.42 * s, 0.035 * s, 8, 28, Math.PI * 1.3), pipeMat());
    feed.rotation.x = Math.PI / 2;
    feed.position.y = 1.62 * s;
    g.add(feed);
    return g;
  },
  nose(s) {
    return lathe([[1.25 * s, 0], [1.15 * s, 0.45 * s], [1.05 * s, 0.9 * s], [0.84 * s, 1.4 * s], [0.62 * s, 1.9 * s], [0.4 * s, 2.35 * s], [0.18 * s, 2.7 * s], [0, 2.9 * s]], noseMaterial());
  },
  fin(s) {
    const shape = new THREE.Shape([[0, 0], [1.1 * s, -0.4 * s], [1.1 * s, 0.25 * s], [0, 1.6 * s]].map(([x, y]) => new THREE.Vector2(x, y)));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false });
    const mesh = new THREE.Mesh(geometry, finMaterial());
    mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), finEdge())); // bright outline, so it reads against black space
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5 * s, 0.09), pbr(0xd9481f, 0.5, 0.2));
    stripe.position.set(0.9 * s, -0.02 * s, 0.035);
    stripe.rotation.z = 0.05;
    mesh.add(stripe);
    mesh.position.x = 1.2;
    return mesh;
  },
  legs(s) {
    const g = new THREE.Group();
    const material = pbr(SILVER, 0.35, 0.85);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const top = dir.clone().multiplyScalar(1.2).setY(1.9 * s), foot = dir.clone().multiplyScalar(2.4 * s).setY(-0.9 * s);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, top.distanceTo(foot), 10), material);
      strut.position.copy(top).lerp(foot, 0.5);
      strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize());
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.07, 18), material);
      pad.position.copy(foot);
      g.add(strut, pad);
    }
    return g;
  },
  heatshield(s) {
    return lathe([[0, 0], [0.8 * s, 0.06 * s], [1.3 * s, 0.26 * s], [1.3 * s, 0.34 * s], [0, 0.34 * s]], pbr(0x3a2a22, 0.92, 0));
  },
};

// Side-mounted equipment with no dedicated art above: antennas, chutes, RCS, solar wings and the generic gear.
// Local frame: origin at the attachment point, +x outward, y up from the part's base; nothing goes below y = 0 or x < 0.
const EQUIP_HEIGHT = {
  rcs_pack: 0.6, gimbal_ring: 0.5, parachute: 0.7, o2_bottle: 0.9, co2_scrubber: 0.6, radiation_shelter: 1.2, solar_panel: 1.4,
  battery: 0.5, antenna_low: 0.8, antenna_high: 1, antenna_s: 0.8, armor_plate: 1, spectrometer: 0.5, ground_radar: 0.6,
  drill: 1, reaction_wheel: 0.5, radiator: 1.2, water_recycler: 0.7, splash_floats: 0.6, sample_container: 0.6, seals_cheap: 0.3,
};
const EQUIP_MATCHERS = [[/antenna|dish/, 'antenna'], [/parachute|chute/, 'parachute'], [/rcs|thruster/, 'rcs'], [/solar|panel/, 'solar']];
// Family tints, so a glance tells life support (blue) from power (amber), science (teal), thermal, protection.
const TINT = { life: 0x6f93b8, power: 0xc98a2e, science: 0x4fa6a0, thermal: 0xb9bfc5, protection: 0x5a5f66, control: 0x7d848c, recovery: 0xd9702b, comms: 0xd8d6cf, generic: 0x9aa0a6 };

function equipment(key, kind) {
  const h = EQUIP_HEIGHT[key] ?? 0.7;
  const g = new THREE.Group();
  const tint = (family) => cached(`equip:${family}`, () => pbr(TINT[family], 0.5, 0.55));
  const add = (geometry, material, x, y, z = 0, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    g.add(m);
    return m;
  };
  const box = (w, hh, d, material, x, y, z = 0) => add(new THREE.BoxGeometry(w, hh, d), material, x, y, z);
  const cyl = (r, hh, material, x, y, z = 0, seg = 18) => add(new THREE.CylinderGeometry(r, r, hh, seg), material, x, y, z);
  const mount = (w = 0.3) => box(0.06, Math.min(h, 0.5), w, steelMat(), 0.03, Math.min(h, 0.5) / 2); // saddle on the hull
  let family = 'generic', depth = 0.4;
  if (kind === 'antenna') {
    const high = /high/.test(key);
    family = 'comms';
    box(0.2, 0.05, 0.2, steelMat(), 0.1, 0.025);
    cyl(0.025, h * 0.85, steelMat(), 0.12, h * 0.425, 0, 8);
    if (high) { // dish on a short boom, tilted up and outward
      const dishR = 0.34;
      const dish = lathe([[0, 0], [dishR * 0.5, 0.03], [dishR, 0.12], [dishR * 0.98, 0.125], [dishR * 0.48, 0.045], [0, 0.012]], tint('comms'), 28);
      dish.material = cached('dishMat', () => pbr(0xe4e2dc, 0.4, 0.4, { side: THREE.DoubleSide }));
      dish.rotation.z = -0.9;
      dish.position.set(0.3, h * 0.85, 0);
      g.add(dish);
      const feed = cyl(0.012, 0.22, steelMat(), 0.3 + 0.1, h * 0.85 + 0.12, 0, 6);
      feed.rotation.z = -0.9;
      depth = 0.7;
    } else { // low gain: whip with a small ball and a disc
      add(new THREE.SphereGeometry(0.05, 12, 8), tint('comms'), 0.12, h * 0.88);
      cyl(0.1, 0.02, tint('comms'), 0.12, h * 0.55, 0, 16);
      depth = 0.25;
    }
  } else if (kind === 'parachute') {
    family = 'recovery'; depth = 0.5;
    mount(0.2);
    cyl(0.21, h * 0.78, tint('recovery'), 0.27, h * 0.39, 0, 24);
    cyl(0.215, 0.05, cached('stripe', () => pbr(0xf2efe6, 0.5, 0.1)), 0.27, h * 0.5, 0, 24);
    const cap = add(new THREE.SphereGeometry(0.21, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), steelMat(), 0.27, h * 0.78);
    cap.scale.y = 0.55;
    cyl(0.04, 0.05, darkMat(), 0.27, h * 0.78 + 0.1, 0, 10);
  } else if (kind === 'rcs') {
    family = 'control'; depth = 0.42;
    mount(0.34);
    box(0.34, h * 0.8, 0.34, tint('control'), 0.2, h * 0.5);
    for (const [y, z, tilt] of [[h * 0.92, 0, 0], [h * 0.08, 0, 0], [h * 0.5, 0.2, 1], [h * 0.5, -0.2, -1]]) { // four small nozzles
      const n = add(new THREE.CylinderGeometry(0.03, 0.055, 0.1, 10), steelMat(), 0.2, y, tilt ? z + tilt * 0.06 : 0);
      if (tilt) n.rotation.x = -tilt * Math.PI / 2;
    }
    box(0.1, 0.1, 0.06, darkMat(), 0.34, h * 0.5, 0);
  } else if (kind === 'solar') {
    family = 'power'; depth = 1.0;
    cyl(0.03, 0.3, steelMat(), 0.06, 0.15, 0, 8); // hinge post
    box(0.22, 0.06, 0.1, steelMat(), 0.11, 0.3);
    const cells = cached('solarCells', () => pbr(0x14284f, 0.35, 0.6, { emissive: 0x050c1a, emissiveIntensity: 1 }));
    const wingH = h - 0.2;
    box(0.04, wingH, 0.9, steelMat(), 0.5, 0.3 + wingH / 2, 0); // frame
    for (let i = 0; i < 3; i++) box(0.05, wingH - 0.08, 0.27, cells, 0.5, 0.3 + wingH / 2, (i - 1) * 0.3); // three cell strips
    box(0.045, 0.02, 0.9, steelMat(), 0.5, 0.3 + wingH / 2);
    // the wing leans out slightly so it reads as deployed, not as a fin
    g.children.slice(2).forEach((m) => { m.position.x += (m.position.y - 0.3) * 0.12; });
  } else {
    // generic equipment, one look per part
    switch (key) {
      case 'o2_bottle': family = 'life'; depth = 0.4; mount(0.2); cyl(0.17, h * 0.8, tint(family), 0.25, h * 0.45, 0, 20); add(new THREE.SphereGeometry(0.17, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), tint(family), 0.25, h * 0.85).scale.y = 0.8; cyl(0.04, 0.08, steelMat(), 0.25, h, 0, 10); cyl(0.172, 0.04, cached('white', () => pbr(0xf0eee8, 0.5, 0.1)), 0.25, h * 0.6, 0, 20); break;
      case 'co2_scrubber': family = 'life'; depth = 0.45; mount(0.3); box(0.3, h * 0.85, 0.3, tint(family), 0.22, h * 0.5); for (let i = 0; i < 5; i++) box(0.02, 0.025, 0.24, darkMat(), 0.38, h * 0.22 + i * h * 0.12); break;
      case 'water_recycler': family = 'life'; depth = 0.5; mount(0.3); cyl(0.22, h * 0.9, tint(family), 0.3, h * 0.5, 0, 24); for (const y of [0.2, 0.5]) cyl(0.225, 0.04, steelMat(), 0.3, h * y, 0, 24); box(0.06, 0.12, 0.12, darkMat(), 0.52, h * 0.5); break;
      case 'radiation_shelter': family = 'protection'; depth = 0.8; mount(0.7); box(0.6, h * 0.95, 0.75, cached('shelter', () => pbr(0x6b6f74, 0.7, 0.4)), 0.4, h * 0.5); for (let i = 0; i < 4; i++) box(0.04, h * 0.95, 0.12, cached('hazard', () => pbr(0xd8b22a, 0.55, 0.2)), 0.72, h * 0.5, (i - 1.5) * 0.19); box(0.62, 0.05, 0.78, steelMat(), 0.4, h * 0.97); break;
      case 'battery': family = 'power'; depth = 0.4; box(0.3, h * 0.9, 0.5, tint(family), 0.17, h * 0.5); for (let i = 0; i < 3; i++) box(0.02, h * 0.7, 0.1, darkMat(), 0.33, h * 0.5, (i - 1) * 0.15); cyl(0.03, 0.05, steelMat(), 0.17, h * 0.97, 0.15, 8); cyl(0.03, 0.05, steelMat(), 0.17, h * 0.97, -0.15, 8); break;
      case 'spectrometer': family = 'science'; depth = 0.55; mount(0.25); box(0.3, h * 0.8, 0.25, tint(family), 0.2, h * 0.5); cyl(0.07, 0.25, darkMat(), 0.45, h * 0.55, 0, 14).rotation.z = Math.PI / 2; add(new THREE.CircleGeometry(0.055, 14), glassMat(), 0.575, h * 0.55, 0).rotation.y = Math.PI / 2; break;
      case 'ground_radar': family = 'science'; depth = 0.55; mount(0.3); box(0.3, h * 0.45, 0.3, tint(family), 0.17, h * 0.7); { const pl = box(0.5, 0.04, 0.4, cached('radarPlate', () => pbr(0x2b3a3c, 0.4, 0.6)), 0.3, h * 0.35); pl.rotation.z = 0.35; } cyl(0.02, h * 0.3, steelMat(), 0.17, h * 0.45, 0, 6); break;
      case 'drill': family = 'science'; depth = 0.45; mount(0.3); box(0.3, h * 0.35, 0.3, tint(family), 0.2, h * 0.85); cyl(0.05, h * 0.65, steelMat(), 0.2, h * 0.4, 0, 10); add(new THREE.ConeGeometry(0.05, 0.14, 10), steelMat(), 0.2, 0.07, 0, Math.PI); cyl(0.07, 0.04, darkMat(), 0.2, h * 0.6, 0, 10); break;
      case 'sample_container': family = 'science'; depth = 0.4; mount(0.2); cyl(0.17, h * 0.8, tint(family), 0.23, h * 0.4, 0, 20); cyl(0.185, 0.07, steelMat(), 0.23, h * 0.84, 0, 20); box(0.05, 0.05, 0.1, darkMat(), 0.23, h * 0.95); break;
      case 'gimbal_ring': family = 'control'; depth = 0.5; { const t = add(new THREE.TorusGeometry(0.22, 0.035, 10, 28), steelMat(), 0.26, h * 0.5); t.rotation.y = Math.PI / 2; } cyl(0.04, 0.12, tint(family), 0.04, h * 0.5, 0, 10).rotation.z = Math.PI / 2; box(0.08, 0.08, 0.08, tint(family), 0.26, h * 0.5 + 0.22); break;
      case 'reaction_wheel': family = 'control'; depth = 0.5; mount(0.3); cyl(0.22, 0.2, tint(family), 0.28, h * 0.5, 0, 24); cyl(0.09, 0.24, steelMat(), 0.28, h * 0.5, 0, 12); cyl(0.225, 0.03, darkMat(), 0.28, h * 0.5 + 0.1, 0, 24); break;
      case 'radiator': family = 'thermal'; depth = 0.6; cyl(0.03, 0.2, steelMat(), 0.05, 0.1, 0, 8); box(0.03, h - 0.15, 0.7, tint(family), 0.4, 0.15 + (h - 0.15) / 2); for (let i = 0; i < 7; i++) box(0.045, h - 0.2, 0.025, steelMat(), 0.4, 0.15 + (h - 0.15) / 2, (i - 3) * 0.1); break;
      case 'splash_floats': family = 'recovery'; depth = 0.55; mount(0.3); for (const z of [-0.18, 0.18]) { const b = add(new THREE.CapsuleGeometry(0.11, h * 0.5, 6, 14), tint(family), 0.25, h * 0.5, z); b.rotation.z = 0; } box(0.14, 0.04, 0.5, darkMat(), 0.2, h * 0.95); break;
      case 'armor_plate': family = 'protection'; depth = 0.2; { const plate = box(0.07, h, 0.7, tint(family), 0.1, h / 2); plate.scale.z = 1; } for (const y of [0.15, 0.5, 0.85]) for (const z of [-0.28, 0.28]) cyl(0.03, 0.03, steelMat(), 0.15, h * y, z, 8).rotation.z = Math.PI / 2; break;
      case 'seals_cheap': family = 'generic'; depth = 0.2; { const ring = add(new THREE.TorusGeometry(0.1, 0.025, 8, 20), cached('seal', () => pbr(0x2c2a28, 0.9, 0)), 0.1, h / 2); ring.rotation.y = Math.PI / 2; } break;
      default: family = 'generic'; depth = 0.4; box(0.3, h * 0.85, 0.35, tint('generic'), 0.2, h * 0.5); box(0.06, 0.1, 0.1, darkMat(), 0.36, h * 0.5);
    }
  }
  g.userData.height = h;
  g.userData.width = depth;
  return g;
}

// Where the next part stacks on top, in metres at size 1. Fins and legs attach to the side, so they add nothing.
const PART_HEIGHT = { capsule: 1.98, tank: 4, engine: 2.2, nose: 2.9, fin: 0, legs: 0, heatshield: 0.34 };

const PART_MATCHERS = [
  [/capsule|command/, 'capsule'], [/heat|shield|tile/, 'heatshield'], [/engine|nozzle|pump|chamber/, 'engine'],
  [/nose|cone/, 'nose'], [/fin/, 'fin'], [/leg/, 'legs'], [/tank|fuel/, 'tank'],
];

// Built once per id; every call returns a clone that shares the geometry and materials, so the GPU upload and the
// launch warm-up (warmup.js) done for one rocket also cover the next.
const partTemplates = new Map();
function createRocketPart(id) {
  if (!partTemplates.has(id)) partTemplates.set(id, buildRocketPart(id));
  return partTemplates.get(id).clone(true);
}

function buildRocketPart(id) {
  const key = id.toLowerCase();
  const match = PART_MATCHERS.find(([pattern]) => pattern.test(key));
  if (!match) {
    // Side equipment (antenna, parachute, RCS, solar, batteries, bottles, science gear): procedural art per family.
    const kind = EQUIP_MATCHERS.find(([pattern]) => pattern.test(key))?.[1];
    if (!kind && !(key in EQUIP_HEIGHT)) return hologram(`rocketPart:${id}`, [1.2, 0.8, 1.2]);
    const gear = equipment(key, kind);
    gear.name = `rocketPart:${id}`;
    gear.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return gear;
  }
  const size = /(^|[_-])s($|[_-])|small/.test(key) ? 0.75 : /(^|[_-])l($|[_-])|large/.test(key) ? 1.35 : 1;
  const part = PARTS[match[1]](size);
  part.name = `rocketPart:${id}`;
  part.userData.height = PART_HEIGHT[match[1]] * size;
  part.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return part;
}

function stack(ids) {
  const group = new THREE.Group();
  let y = 0;
  for (const id of ids) {
    const part = createRocketPart(id);
    part.position.y = y;
    group.add(part);
    y += part.userData.height ?? 0;
  }
  return group;
}

function createLander({ wrecked = false } = {}) {
  const group = new THREE.Group();
  const body = stack(['engine_m', 'tank_m', 'capsule_m']);
  body.position.y = 0.5;
  const legs = createRocketPart('legs_m');
  legs.position.y = 0.9;
  group.add(body, legs);
  if (wrecked) {
    // Three years of dust, and a landing that ended a few degrees off vertical.
    group.rotation.set(0.09, 0.8, -0.14);
    group.traverse((o) => {
      if (!o.isMesh) return;
      const dust = (m) => {
        if (!m.color) return m;
        const c = m.clone();
        c.color.lerp(new THREE.Color(0.2, 0.1, 0.055), 0.82);
        c.envMapIntensity = 0.08;
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(dust) : dust(o.material);
    });
  }
  return group;
}

function register(name, factory) {
  factories.set(name, factory);
}

register('cockpit', () => createFlightDeck(createCockpit));
register('cabin', createCabin);
register('vfx:engineFlame', createEngineFlame);
register('vfx:exhaust', createExhaust);
register('vfx:entryPlasma', createEntryPlasma);
register('vfx:landingDust', createLandingDust);
register('planet:earth', () => createPlanet('earth'));
register('planet:mars', () => createPlanet('mars'));
register('sky:space', createSpaceSky);
register('lander', () => createLander());
register('rover', createRover); // the futuristic crewed rover (Blender model, rover.glb): src/graphics/rover.js
register('rover:lrv', createLunarRover); // the traditional Apollo-style rover, same interface: src/graphics/roverLrv.js
for (const [name, factory] of Object.entries(PROPS)) register(name, factory); // mission props: src/graphics/props.js

/**
 * Visuals behind names. Gameplay asks for a name and always gets an Object3D back, so art can be swapped later
 * with nobody else's code changing. Each call returns a new object.
 */
let rocketPartArt = null;
const partArtWarned = new Set();

/** Runs the external part-art hook (Role 1's models); null when there is none or it has nothing for this type. */
function externalRocketPart(type) {
  if (!rocketPartArt) return null;
  let obj = null;
  try {
    obj = rocketPartArt(type);
  } catch (err) {
    if (!partArtWarned.has(type)) {
      partArtWarned.add(type);
      console.warn(`[assets] rocket part art hook threw for "${type}", using the built-in part`, err);
    }
    return null;
  }
  if (!obj || !obj.isObject3D) return null;
  obj.name = `rocketPart:${type}`;
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  if (!(typeof obj.userData.height === 'number' && obj.userData.height >= 0)) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    // Origin sits at the base of an axial part, so the height is how far the model reaches above it.
    obj.userData.height = box.isEmpty() ? 0 : Math.max(0, box.max.y - obj.position.y);
  }
  return obj;
}

export const assets = {
  /**
   * Lets another role supply the model for `rocketPart:<type>` (see README). fn(type) must return an Object3D,
   * or null to use the built-in part. Pass null to clear.
   */
  setRocketPartArt(fn) {
    rocketPartArt = typeof fn === 'function' ? fn : null;
  },
  get(name) {
    if (name.startsWith('rocketPart:')) {
      const type = name.slice('rocketPart:'.length);
      return externalRocketPart(type) ?? createRocketPart(type);
    }
    const factory = factories.get(name);
    if (factory) return factory();
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[assets] "${name}" has no art yet, showing a hologram`);
    }
    return hologram(name);
  },
  /** Resolves when the real maps of the given `planet:*` names are ready, so get() never shows a placeholder. Other names are ignored. Also waits for the Blender rover model (rover.glb, falls back to the code-built rover if it is missing). */
  preload: (names) => Promise.all([...names.filter((n) => n.startsWith('planet:')).map((n) => loadPlanetMaps(n.slice(7))), loadRoverModel(), loadLunarRoverModel()]).then(() => {}),
  has: (name) => factories.has(name) || name.startsWith('rocketPart:'),
  names: () => [...factories.keys(), 'rocketPart:<id>'],
  register,
  environment: interiorEnvironment,
};
