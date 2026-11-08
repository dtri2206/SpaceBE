// The engineering stations around the hall: each is one job of a real launch team, as a machine the player uses.
// A station is a launch-control desk: a steel pedestal, a brushed-aluminium top, three monitors on a tilted panel
// (the centre one is live, the sides show telemetry), keyboard, a lit nameplate and an equipment cabinet.
import * as THREE from 'three';
import { HALL } from './room.js';
import { DEG, box, canvasTexture, cylinder, drawScreen, glow, polar, shadowed, std } from './util.js';

export const STATIONS = [
  { id: 'integration', name: 'Vehicle integration', role: 'Lead integration engineer', deg: 0, prompt: 'Open the integration console', blurb: 'Stack the vehicle on the stand: attach, move and remove parts, symmetry, blueprints.' },
  { id: 'propulsion', name: 'Propulsion workshop', role: 'Propulsion engineer', deg: 52, prompt: 'Open the propulsion workshop', blurb: 'Chambers, nozzles, turbopumps and the tanks that feed them.' },
  { id: 'structures', name: 'Structures & aero bay', role: 'Structures engineer', deg: 104, prompt: 'Open the structures bay', blurb: 'Nose cones, fins, landing gear, heat shields, parachutes.' },
  { id: 'crew', name: 'Crew systems lab', role: 'Life-support engineer', deg: 156, prompt: 'Open the crew systems lab', blurb: 'Capsules, oxygen, shelter, power, comms and the science the mission is for.' },
  { id: 'warehouse', name: 'Parts warehouse', role: 'Logistics', deg: 226, prompt: 'Open the parts inventory', blurb: 'Every part the agency can buy, with pictures and what it is for.' },
  { id: 'teststand', name: 'Test & launch readiness', role: 'Test conductor', deg: 304, prompt: 'Open the test console', blurb: 'Static fire on the stand, a hold-down liftoff test, then the readiness poll.' },
  { id: 'handbook', name: "Engineer's handbook", role: 'You', deg: 150, prompt: 'Read the handbook', blurb: 'How to build a ship that comes back, and your own notes.', radius: HALL.radius - 2.3, isDesk: true },
  { id: 'launchwindow', name: 'Launch pad', role: 'Pad manager', deg: 332, prompt: 'Open the launch pad desk', blurb: 'Choose the launch complex and its ground hardware: flame trench, water, clamps, tower. The weather is what the day brings.', small: true },
];

const SCREEN_W = 640, SCREEN_H = 360;
const CONSOLE_RADIUS = 9.4;
const FONT = '"IBM Plex Mono", monospace';

const PANEL = std(0x262b31, { roughness: 0.55, metalness: 0.6 });
const PANEL_LIGHT = std(0x3a4149, { roughness: 0.5, metalness: 0.55 });
const ALU = std(0xb4b9bf, { roughness: 0.28, metalness: 0.9 });
const BLACK = std(0x0f1215, { roughness: 0.7, metalness: 0.3 });
const RUBBER = std(0x121416, { roughness: 0.95, metalness: 0 });

// Side monitors: telemetry drawn once per station (a strip chart on the left, a value grid on the right).
function telemetryTexture(kind, seed) {
  const { texture, redraw } = canvasTexture(256, 256);
  redraw((ctx, w, h) => {
    ctx.fillStyle = '#05121b';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(103,232,249,0.16)';
    ctx.lineWidth = 1;
    for (let x = 16; x < w; x += 30) { ctx.beginPath(); ctx.moveTo(x, 36); ctx.lineTo(x, h - 12); ctx.stroke(); }
    for (let y = 36; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(12, y); ctx.lineTo(w - 12, y); ctx.stroke(); }
    ctx.fillStyle = '#67e8f9';
    ctx.font = `600 13px ${FONT}`;
    ctx.textBaseline = 'top';
    if (kind === 'plot') {
      ctx.fillText(['CHAMBER PRESSURE', 'LOADS  kN', 'CABIN  kPa', 'TANK TEMP  K', 'STOCK LEVELS', 'HOLD-DOWN LOAD', 'WIND  m/s', 'RANGE'][seed % 8], 14, 14);
      const colors = ['#67e8f9', '#fbbf24', '#4ade80'];
      colors.forEach((c, i) => {
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 14; x <= w - 14; x += 3) {
          const t = x / 19 + seed * 1.3 + i * 2.1;
          const y = h * 0.42 + i * 34 + Math.sin(t) * 18 + Math.sin(t * 3.7) * 5 + Math.cos(x / 61 + seed) * 7;
          if (x === 14) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
    } else {
      ctx.fillText('SYSTEM STATUS', 14, 14);
      const names = ['PWR', 'COM', 'GN&C', 'ECLS', 'PROP', 'TCS', 'RNG', 'FTS', 'NET'];
      for (let i = 0; i < 9; i++) {
        const cx = 14 + (i % 3) * 78, cy = 44 + Math.floor(i / 3) * 68;
        ctx.fillStyle = 'rgba(103,232,249,0.08)';
        ctx.fillRect(cx, cy, 70, 58);
        const ok = (i * 7 + seed * 3) % 11 !== 4;
        ctx.fillStyle = ok ? '#4ade80' : '#fbbf24';
        ctx.fillRect(cx + 6, cy + 8, 8, 8);
        ctx.fillStyle = 'rgba(217,244,247,0.9)';
        ctx.font = `600 12px ${FONT}`;
        ctx.fillText(names[i], cx + 20, cy + 6);
        ctx.font = `16px ${FONT}`;
        ctx.fillText(`${((i * 37 + seed * 11) % 90 + 10).toFixed(0)}.${(i + seed) % 10}`, cx + 6, cy + 30);
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    for (let yy = 0; yy < h; yy += 3) ctx.fillRect(0, yy, w, 1);
  });
  return texture;
}

function keyboardTexture() {
  const { texture, redraw } = canvasTexture(256, 96);
  redraw((ctx, w, h) => {
    ctx.fillStyle = '#15181b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2a2f34';
    for (let r = 0; r < 5; r++) for (let c = 0; c < 15; c++) ctx.fillRect(6 + c * 16.4, 6 + r * 17.5, 13, 13);
    ctx.fillRect(6 + 3 * 16.4, 6 + 4 * 17.5, 9 * 16.4 - 3, 13); // space bar
  });
  return texture;
}

function nameplateTexture(text) {
  const { texture, redraw } = canvasTexture(1024, 96);
  redraw((ctx, w, h) => {
    ctx.fillStyle = '#071722';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(103,232,249,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.fillStyle = '#67e8f9';
    ctx.font = `600 46px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.toUpperCase(), w / 2, h / 2 + 2);
  });
  return texture;
}

function monitor(width, height, material, { x = 0, y = 0, z = 0, tilt = 0, yaw = 0 } = {}) {
  const g = new THREE.Group();
  const bezel = box(width + 0.05, height + 0.05, 0.035, BLACK);
  bezel.castShadow = true;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  screen.position.z = 0.019;
  g.add(bezel, screen);
  g.position.set(x, y, z);
  g.rotation.set(tilt, yaw, 0);
  return g;
}

function cabinet(x) {
  const g = new THREE.Group();
  const body = box(0.62, 1.5, 0.72, PANEL, { y: 0.75 });
  const door = box(0.56, 1.3, 0.02, PANEL_LIGHT, { y: 0.78, z: 0.37 });
  g.add(body, door);
  for (let i = 0; i < 6; i++) g.add(box(0.46, 0.012, 0.01, BLACK, { y: 0.3 + i * 0.1, z: 0.385 })); // vents
  for (let i = 0; i < 8; i++) {
    const on = i % 3 !== 2;
    g.add(box(0.03, 0.03, 0.01, glow(on ? 0x4ade80 : 0xfbbf24, 2.5), { x: -0.2 + i * 0.055, y: 1.3, z: 0.385 }));
  }
  g.add(box(0.5, 0.05, 0.01, BLACK, { y: 1.2, z: 0.385 }));
  shadowed(g);
  g.position.x = x;
  return g;
}

/** A launch-control desk. Local +z faces the player (outward); the vehicle is behind the monitors. */
function consoleMesh(station, index) {
  const g = new THREE.Group();
  const w = station.small ? 1.3 : 2.1;
  // pedestal and top
  g.add(box(w, 0.07, 0.72, RUBBER, { y: 0.035, z: -0.04 }));
  g.add(box(w, 0.68, 0.7, PANEL, { y: 0.41, z: -0.05 }));
  g.add(box(w - 0.12, 0.5, 0.02, PANEL_LIGHT, { y: 0.42, z: 0.31 }));
  for (let i = 0; i < 4; i++) g.add(box(w - 0.3, 0.014, 0.01, BLACK, { y: 0.26 + i * 0.09, z: 0.325 }));
  const top = box(w + 0.1, 0.04, 0.88, ALU, { y: 0.77, z: 0.02 });
  g.add(top, box(w + 0.1, 0.05, 0.03, RUBBER, { y: 0.77, z: 0.46 }));
  // monitor panel
  const panel = new THREE.Group();
  panel.position.set(0, 0.79, -0.34);
  panel.rotation.x = 0.16; // leans back, so the player looks slightly down at the screens
  const back = box(w, 0.74, 0.07, PANEL, { y: 0.4 });
  panel.add(back);
  const { texture, redraw } = canvasTexture(SCREEN_W, SCREEN_H);
  const centreW = station.small ? 0.78 : 0.98;
  const live = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  panel.add(monitor(centreW, centreW * 0.5625, live, { y: 0.4, z: 0.04 }));
  if (!station.small) {
    const sideW = 0.44;
    const left = new THREE.MeshBasicMaterial({ map: telemetryTexture('plot', index), toneMapped: false });
    const right = new THREE.MeshBasicMaterial({ map: telemetryTexture('grid', index), toneMapped: false });
    panel.add(monitor(sideW, sideW, left, { x: -(centreW / 2 + sideW / 2 + 0.06), y: 0.4, z: 0.03, yaw: 0.22 }));
    panel.add(monitor(sideW, sideW, right, { x: centreW / 2 + sideW / 2 + 0.06, y: 0.4, z: 0.03, yaw: -0.22 }));
  }
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.1), new THREE.MeshBasicMaterial({ map: nameplateTexture(station.name), toneMapped: false }));
  plate.position.set(0, 0.86, 0.04);
  panel.add(box(w, 0.12, 0.06, PANEL, { y: 0.86, z: 0.0 }), plate);
  g.add(panel);
  // keyboard, trackball, handset
  const keyboard = box(0.52, 0.022, 0.18, new THREE.MeshStandardMaterial({ map: keyboardTexture(), roughness: 0.8 }), { x: -0.1, y: 0.8, z: 0.24 });
  const trackball = cylinder(0.035, 0.035, 0.03, BLACK, { x: 0.3, y: 0.805, z: 0.24 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), std(0xd9dde2, { roughness: 0.3, metalness: 0.1 }));
  ball.position.set(0.3, 0.83, 0.24);
  g.add(keyboard, trackball, ball);
  if (!station.small) {
    g.add(box(0.06, 0.03, 0.2, BLACK, { x: -w / 2 + 0.2, y: 0.805, z: 0.22 })); // handset cradle
    g.add(cylinder(0.025, 0.025, 0.2, BLACK, { x: -w / 2 + 0.2, y: 0.835, z: 0.22 }).rotateX(Math.PI / 2));
  }
  // under-desk light strip and the standby LED
  g.add(box(w - 0.2, 0.02, 0.02, glow(0x67e8f9, 2), { y: 0.745, z: 0.44 }));
  g.add(box(0.03, 0.03, 0.01, glow(0x4ade80, 2.5), { x: w / 2 - 0.12, y: 0.62, z: 0.325 }));
  if (!station.small) g.add(cabinet(w / 2 + 0.5));
  shadowed(g);
  g.traverse((o) => { if (o.isMesh && o.material?.isMeshBasicMaterial) o.castShadow = false; });
  const lamp = new THREE.PointLight(0x67e8f9, 5, 4, 2);
  lamp.position.set(0, 1.5, 0.5);
  g.add(lamp);
  return { group: g, redraw, texture };
}

function deskScreen() {
  const g = new THREE.Group();
  const cover = std(0x7a2f1f, { roughness: 0.75, metalness: 0 });
  const book = box(0.32, 0.05, 0.24, cover, { y: 0.775 });
  book.castShadow = true;
  const pages = box(0.3, 0.04, 0.22, std(0xe8e2d2, { roughness: 0.95 }), { y: 0.775 });
  const { texture, redraw } = canvasTexture(256, 192);
  redraw((ctx, w, h) => {
    ctx.fillStyle = '#7a2f1f';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#d9b26f';
    ctx.lineWidth = 4;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    ctx.fillStyle = '#f1dfb0';
    ctx.font = `700 26px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText("ENGINEER'S", w / 2, 80);
    ctx.fillText('HANDBOOK', w / 2, 112);
  });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.22), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 }));
  label.rotation.x = -Math.PI / 2;
  label.position.set(0, 0.801, 0);
  const metal = std(0x2a2f34, { metalness: 0.8, roughness: 0.4 });
  const lampArm = box(0.04, 0.5, 0.04, metal, { x: 0.5, y: 1.0, z: -0.2 });
  const shade = cylinder(0.05, 0.12, 0.14, metal, { x: 0.42, y: 1.22, z: -0.16 });
  shade.rotation.z = 0.6;
  const bulb = new THREE.PointLight(0xffe2b0, 5, 3, 2);
  bulb.position.set(0.38, 1.1, -0.1);
  g.add(book, pages, label, lampArm, shade, bulb);
  return { group: g, redraw, texture };
}

/** Creates the stations in `scene`. Returns [{ ...def, position, usePoint, group, setScreen }]. */
export function createStations(scene) {
  const out = [];
  STATIONS.forEach((def, index) => {
    const radius = def.radius ?? CONSOLE_RADIUS;
    const position = polar(def.deg, radius, 0);
    const built = def.isDesk ? deskScreen() : consoleMesh(def, index);
    built.group.position.copy(position);
    // local +z points outward, towards the player, who stands on the outer side and looks over the desk at the vehicle
    built.group.rotation.y = -def.deg * DEG + Math.PI / 2;
    scene.add(built.group);
    const station = { ...def, position, group: built.group, usePoint: polar(def.deg, radius + (def.isDesk ? -1.0 : 1.25), 0) };
    station.setScreen = ({ lines = [], status = null } = {}) => built.redraw((ctx, w, h) => drawScreen(ctx, w, h, { title: def.name, lines: [{ text: def.role, color: 'rgba(134,166,173,0.95)' }, '', ...lines], status, scale: 1 }));
    station.setScreen({ lines: [def.blurb] });
    out.push(station);
  });
  return out;
}
