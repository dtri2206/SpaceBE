// First-person engineer: walking, running and jumping with WASD / Shift / Space, mouse look through core input,
// a real rigged human body (CesiumMan, CC-BY 4.0) that walks when you walk and shows when you look down, and a
// handheld tablet. The scene says what is solid: collide(position, radius) pushes the engineer out of it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { box, canvasTexture, cylinder, drawScreen, std } from './util.js';

const EYE = 1.65;
const WALK = 2.6, RUN = 4.6; // m/s
const ACCEL = 14;
const RADIUS = 0.35;
const JUMP = 3.4; // m/s upwards
const BODY_HEIGHT = 1.72;

export function createPlayer(scene, camera, { collide: solid = () => {}, start = { x: 11.5, z: 2.5 }, yaw = Math.PI / 2, gravity = 9.8 } = {}) {
  const pos = new THREE.Vector3(start.x, 0, start.z);
  const vel = new THREE.Vector3();
  const look = { yaw, pitch: -0.08 };
  let bob = 0, bobAmp = 0, walked = 0;
  let vy = 0, height = 0, grounded = true, jumpQueued = false;

  // ----- body: a rigged human if the file is there, a simple suit otherwise -----
  const body = new THREE.Group();
  scene.add(body);
  let mixer = null, walkAction = null, humanLoaded = false;
  const fallback = new THREE.Group();
  const suit = std(0x1f2f52, { roughness: 0.9, metalness: 0 });
  fallback.add(box(0.42, 0.62, 0.24, suit, { y: 1.12 }), box(0.38, 0.16, 0.22, suit, { y: 0.76 }));
  const legs = [];
  for (const dx of [-0.11, 0.11]) {
    const leg = new THREE.Group();
    leg.position.set(dx, 0.72, 0);
    leg.add(cylinder(0.085, 0.075, 0.36, suit, { y: -0.18 }), cylinder(0.07, 0.065, 0.34, suit, { y: -0.53 }), box(0.12, 0.08, 0.26, std(0x16191c, { roughness: 0.6 }), { y: -0.72, z: 0.05 }));
    fallback.add(leg);
    legs.push(leg);
  }
  body.add(fallback);
  const neckPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.48); // hides the head from the inside: keeps y <= 1.48 m
  new GLTFLoader().load('/assets/people/cesium_man.glb', (gltf) => {
    const human = gltf.scene;
    const bbox = new THREE.Box3().setFromObject(human);
    const size = bbox.getSize(new THREE.Vector3());
    const scale = BODY_HEIGHT / Math.max(size.y, 0.1);
    human.scale.setScalar(scale);
    bbox.setFromObject(human);
    human.position.y -= bbox.min.y;
    human.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      o.material = o.material.clone();
      o.material.clippingPlanes = [neckPlane];
      o.material.clipShadows = false;
      if (o.material.color) o.material.color.multiplyScalar(0.9);
      o.material.roughness = 0.85;
    });
    mixer = new THREE.AnimationMixer(human);
    const clip = gltf.animations[0];
    if (clip) {
      walkAction = mixer.clipAction(clip);
      walkAction.play();
      walkAction.timeScale = 0;
    }
    body.remove(fallback);
    body.add(human);
    humanLoaded = true;
  }, undefined, () => { /* keep the fallback body */ });

  // ----- tablet in the right hand, attached to the camera -----
  const hands = new THREE.Group();
  const skin = std(0xd9a883, { roughness: 0.7 });
  const hand = new THREE.Group();
  hand.add(cylinder(0.04, 0.045, 0.26, std(0x1f2f52, { roughness: 0.9 }), { y: -0.13 }), box(0.08, 0.04, 0.1, skin, { y: -0.3 }));
  hand.position.set(0.24, -0.22, -0.36);
  hand.rotation.x = -1.05;
  hand.rotation.z = 0.3;
  const tablet = new THREE.Group();
  const { texture, redraw } = canvasTexture(512, 360);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.165), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  screen.rotation.x = -Math.PI / 2;
  screen.position.y = 0.007;
  tablet.add(box(0.27, 0.012, 0.19, std(0x15191c, { roughness: 0.5, metalness: 0.6 })), screen);
  tablet.position.set(0.2, -0.3, -0.44);
  tablet.rotation.x = 0.95;
  tablet.rotation.z = -0.12;
  hands.add(hand, tablet);
  hands.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  camera.add(hands);
  scene.add(camera);
  const setTablet = ({ title = 'Engineer tablet', lines = [], status = null } = {}) => redraw((ctx, w, h) => drawScreen(ctx, w, h, { title, lines, status, scale: 0.8 }));
  setTablet({ lines: ['WASD walk · Shift run · Space jump', 'E uses the machine in front of you.'] });

  // ----- collisions -----
  const collide = () => solid(pos, RADIUS);

  function update(dt, { forward = 0, right = 0, run = false, jump = false, lookDelta = { x: 0, y: 0 }, sensitivity = 1, invertY = false, frozen = false } = {}) {
    if (!frozen) {
      look.yaw -= lookDelta.x * 0.0022 * sensitivity;
      look.pitch -= lookDelta.y * 0.0022 * sensitivity * (invertY ? -1 : 1);
      look.pitch = Math.max(-1.45, Math.min(1.3, look.pitch));
    }
    const speed = run ? RUN : WALK;
    const dir = new THREE.Vector3(Math.sin(look.yaw) * -forward + Math.cos(look.yaw) * right, 0, Math.cos(look.yaw) * -forward - Math.sin(look.yaw) * right);
    if (dir.lengthSq() > 1) dir.normalize();
    const target = frozen ? new THREE.Vector3() : dir.multiplyScalar(speed);
    vel.lerp(target, 1 - Math.exp(-dt * (grounded ? ACCEL : 2)));
    pos.addScaledVector(vel, dt);
    collide();
    // jumping
    if (jump && !frozen && grounded && !jumpQueued) { vy = JUMP; grounded = false; jumpQueued = true; }
    if (!jump) jumpQueued = false;
    if (!grounded) {
      vy -= gravity * dt;
      height += vy * dt;
      if (height <= 0) { height = 0; vy = 0; grounded = true; }
    }
    const moving = grounded ? vel.length() : 0;
    walked += moving * dt;
    bobAmp += ((moving > 0.3 ? 1 : 0) - bobAmp) * Math.min(1, dt * 8);
    bob = Math.sin(walked * 2.3 * Math.PI) * 0.028 * bobAmp;

    camera.position.set(pos.x, EYE + height + bob, pos.z);
    camera.rotation.set(look.pitch, look.yaw, Math.sin(walked * 2.3 * Math.PI * 0.5) * 0.006 * bobAmp, 'YXZ');
    body.position.set(pos.x + Math.sin(look.yaw) * 0.14, height, pos.z + Math.cos(look.yaw) * 0.14);
    body.rotation.y = look.yaw + Math.PI; // the model faces +z; we look down -z
    neckPlane.constant = 1.48 + height;
    if (mixer) {
      if (walkAction) walkAction.timeScale = moving > 0.3 ? (run ? 1.7 : 1.1) : 0;
      mixer.update(dt);
    } else {
      const swing = Math.sin(walked * 2.3 * Math.PI) * 0.55 * bobAmp;
      legs[0].rotation.x = swing;
      legs[1].rotation.x = -swing;
    }
    hands.position.y = bob * 0.5;
  }

  return {
    get position() { return pos; },
    get yaw() { return look.yaw; },
    get pitch() { return look.pitch; },
    get humanLoaded() { return humanLoaded; },
    forward: () => new THREE.Vector3(-Math.sin(look.yaw), 0, -Math.cos(look.yaw)),
    update, setTablet, body, hands,
    lookAt(x, z, pitch = null) { look.yaw = Math.atan2(-(x - pos.x), -(z - pos.z)); if (pitch !== null) look.pitch = pitch; },
    setPitch(p) { look.pitch = Math.max(-1.45, Math.min(1.3, p)); },
    teleport(x, z, yaw = look.yaw) { pos.set(x, 0, z); vel.set(0, 0, 0); look.yaw = yaw; height = 0; vy = 0; grounded = true; },
    dispose() { scene.remove(body); camera.remove(hands); },
  };
}
