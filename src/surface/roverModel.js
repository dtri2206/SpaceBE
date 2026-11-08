// Rover model (Role 2): Role 3's `assets.get('rover')` is the REAL rover (optional userData.eye = driver's eye).
// The procedural LRV below (buildLrv) is a TEMPORARY placeholder, used only while `assets.has('rover')` is false.
// It is shaped like the Apollo Lunar Roving Vehicle: aluminium chassis, wire-mesh wheels with chevron treads, fenders, two seats, the
// T-handle hand controller and display console, the umbrella high-gain antenna, the TV camera and a rear tool pallet.
// Origin on the ground at the middle of the wheelbase, forward = −Z (RoverController's heading convention).
//
// const model = createRoverModel();  scene.add(model.object);  each frame: model.update(rover, dt)
import * as THREE from 'three';
import { assets } from '/src/graphics/index.js';
import { ROVER } from './RoverController.js';

const WHEELS = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];

function mat(color, metalness = 0.6, roughness = 0.45, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function tube(length, radius, material, axis = 'x') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.castShadow = true;
  return m;
}

// Wire-mesh wheel: woven zinc-coated piano wire, titanium chevron treads, aluminium hub (LRV).
function wheel(material) {
  const r = ROVER.wheelRadius, w = 0.23;
  const spin = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 28, 3, true), mat(0x9aa0a6, 0.8, 0.5, { wireframe: true }));
  mesh.rotation.z = Math.PI / 2;
  spin.add(mesh);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const tread = box(w * 0.9, 0.02, 0.05, material);
    tread.position.set(0, Math.cos(a) * r, Math.sin(a) * r);
    tread.rotation.x = -a;
    spin.add(tread);
  }
  const hub = tube(w * 0.6, 0.12, mat(0x6d737a, 0.7, 0.4));
  spin.add(hub);
  return spin;
}

// TEMPORARY placeholder: only used while `assets.has('rover')` is false. Role 3's model is the real one; delete this later.
function buildLrv() {
  const root = new THREE.Group();
  root.name = 'rover';
  const aluminium = mat(0xc9ccd0, 0.75, 0.35);
  const dark = mat(0x2b2e33, 0.4, 0.6);
  const gold = mat(0xc8a24a, 0.9, 0.3);
  const fender = mat(0x8a8f96, 0.3, 0.6);
  const hb = ROVER.wheelbase / 2, ht = ROVER.track / 2, r = ROVER.wheelRadius;
  const deckY = r + 0.12;

  // chassis: three-section frame with a floor
  const chassis = new THREE.Group();
  chassis.name = 'chassis';
  chassis.add(box(1.2, 0.05, ROVER.wheelbase + 0.7, dark, 0, deckY, 0));
  for (const x of [-0.6, 0.6]) {
    const rail = tube(ROVER.wheelbase + 0.8, 0.035, aluminium, 'z');
    rail.position.set(x, deckY + 0.04, 0);
    chassis.add(rail);
  }
  for (const z of [-hb, 0, hb]) {
    const cross = tube(ROVER.track + 0.1, 0.03, aluminium, 'x');
    cross.position.set(0, deckY, z);
    chassis.add(cross);
  }
  // fenders over the wheels
  for (const [x, z] of [[-ht, -hb], [ht, -hb], [-ht, hb], [ht, hb]]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.06, r + 0.06, 0.28, 16, 1, true, -Math.PI / 2, Math.PI), fender);
    f.rotation.z = Math.PI / 2;
    f.position.set(x, r, z);
    f.material.side = THREE.DoubleSide;
    chassis.add(f);
  }
  // two tubular seats with black webbing (the driver sits on the left, like the Apollo commander)
  for (const x of [-0.32, 0.32]) {
    chassis.add(box(0.46, 0.05, 0.46, dark, x, deckY + 0.28, 0.25));
    const back = box(0.46, 0.5, 0.05, dark, x, deckY + 0.55, 0.48);
    back.rotation.x = -0.25;
    chassis.add(back);
    for (const sx of [-0.21, 0.21]) {
      const leg = tube(0.28, 0.02, aluminium, 'y');
      leg.position.set(x + sx, deckY + 0.14, 0.25);
      chassis.add(leg);
    }
  }
  // control and display console between the seats (low, below the driver's sight line), with the T-handle
  const console_ = box(0.26, 0.14, 0.1, dark, 0, deckY + 0.3, -0.2);
  console_.rotation.x = 0.5;
  chassis.add(console_);
  const screen = box(0.22, 0.1, 0.01, mat(0x0b1a1f, 0.2, 0.3, { emissive: 0x0f3a40, emissiveIntensity: 0.6 }), 0, deckY + 0.31, -0.25);
  screen.rotation.x = 0.5;
  chassis.add(screen);
  const stick = tube(0.2, 0.012, aluminium, 'y');
  stick.position.set(0, deckY + 0.3, 0.0);
  chassis.add(stick, box(0.1, 0.025, 0.025, dark, 0, deckY + 0.41, 0.0));
  // umbrella high-gain antenna on a mast (front right, dish tilted up and back) and the low-gain antenna (rear right)
  const mast = tube(0.6, 0.018, aluminium, 'y');
  mast.position.set(0.72, deckY + 0.3, -1.05);
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.25, 16, 1, true), mat(0xdedede, 0.5, 0.5, { wireframe: true }));
  dish.position.set(0.72, deckY + 0.65, -1.0);
  dish.rotation.x = Math.PI - 0.5; // opening faces up and back toward +Z
  const lowGain = tube(0.75, 0.025, gold, 'y');
  lowGain.position.set(0.5, deckY + 0.5, 1.0);
  chassis.add(mast, dish, lowGain);
  // TV camera and the gold-foil comms relay unit at the front, low
  chassis.add(box(0.36, 0.2, 0.3, gold, 0, deckY + 0.15, -1.2));
  const camMast = tube(0.2, 0.02, aluminium, 'y');
  camMast.position.set(0.0, deckY + 0.3, -1.25);
  chassis.add(camMast, box(0.12, 0.07, 0.2, dark, 0.0, deckY + 0.42, -1.27));
  // rear pallet: tool carrier and sample bags
  chassis.add(box(0.9, 0.36, 0.42, mat(0x8c7a5a, 0.2, 0.8), 0, deckY + 0.2, 1.25));
  root.add(chassis);

  // wheels: steer pivot → spinning wheel
  for (const [name, x, z] of [['wheelFL', -ht, -hb], ['wheelFR', ht, -hb], ['wheelRL', -ht, hb], ['wheelRR', ht, hb]]) {
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.set(x, r, z);
    pivot.add(wheel(mat(0x7c8288, 0.85, 0.35)));
    root.add(pivot);
  }
  return root;
}

export function createRoverModel() {
  const object = assets.has?.('rover') ? assets.get('rover') : buildLrv();
  const wheels = WHEELS.map((n) => object.getObjectByName(n)).filter(Boolean);
  let spinAngle = 0;
  return {
    object,
    // Driver's eye in rover coordinates (left seat), for the first-person camera.
    // Role 3's model may set userData.eye if its driver's seat is elsewhere
    eye: object.userData.eye?.clone?.() ?? new THREE.Vector3(-0.32, ROVER.wheelRadius + 0.12 + 0.95, 0.22),
    update(rover, dt) {
      object.position.set(rover.x, rover.y, rover.z);
      object.rotation.set(rover.pitch, rover.heading, -rover.roll, 'YXZ');
      spinAngle -= (rover.speed / ROVER.wheelRadius) * dt;
      const maxAngle = Math.atan(ROVER.wheelbase / (2 * ROVER.turnRadius));
      for (const w of wheels) {
        const front = w.name.endsWith('FL') || w.name.endsWith('FR');
        w.rotation.y = rover.steer * maxAngle * (front ? 1 : -1); // four-wheel steering: rear wheels turn the other way
        if (w.children[0]) w.children[0].rotation.x = spinAngle;
      }
    },
  };
}
