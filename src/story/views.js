// Backdrops for Role 4's story screens: Earth or Mars seen from orbit, or deep space with our capsule.
// Each view has its own camera (graphics.camera is whatever the last state left). Built once, on first use.
import * as THREE from 'three';
import { assets, createSpaceScene, graphics } from '/src/graphics/index.js';
import { PLANETS } from '/src/core/index.js';

const SUN = new THREE.Vector3(0.86, 0.36, -0.36).normalize();
const views = {};

function lights(scene) {
  const sun = new THREE.DirectionalLight(0xfff4e6, 3.2);
  sun.position.copy(SUN).multiplyScalar(100);
  scene.add(sun, new THREE.AmbientLight(0x30405a, 0.35));
}

function planetView(name, radius, altitude, elevationDeg) {
  const scene = createSpaceScene();
  const planet = assets.get(`planet:${name}`);
  const elevation = THREE.MathUtils.degToRad(elevationDeg);
  planet.scale.setScalar(radius);
  planet.position.set(0, Math.sin(elevation), -Math.cos(elevation)).multiplyScalar(radius + altitude);
  scene.add(planet);
  lights(scene);
  return { scene, planet, camera: new THREE.PerspectiveCamera(55, 1, 0.1, 1e10) };
}

function spaceView() {
  const scene = createSpaceScene();
  lights(scene);
  const capsule = new THREE.Group();
  capsule.add(assets.get('rocketPart:capsule_m'));
  scene.add(capsule);
  const earth = assets.get('planet:earth');
  earth.scale.setScalar(PLANETS.earth.radius);
  earth.position.set(-0.5, -0.15, -1).normalize().multiplyScalar(PLANETS.earth.radius * 400);
  scene.add(earth);
  return { scene, capsule, earth, camera: new THREE.PerspectiveCamera(50, 1, 0.05, 1e10) };
}

const BUILD = {
  earth: () => planetView('earth', PLANETS.earth.radius, 170e3, -40),
  mars: () => planetView('mars', PLANETS.mars.radius, 120e3, -38),
  space: spaceView,
};

/** Shows a backdrop ('earth', 'mars' or 'space') and returns it: { scene, camera, ... }. */
export function showView(name) {
  const view = (views[name] ??= BUILD[name]());
  graphics.setSunDirection(SUN.clone());
  view.camera.position.set(0, 0, 0);
  view.camera.quaternion.identity();
  view.camera.lookAt(0, -0.2, -1);
  graphics.setView(view.scene, view.camera);
  return view;
}
