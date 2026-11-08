import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { isSaturated, installControls, installHands, addProceduralHands } from './cockpitRuntime.js';

const URL = '/assets/models/flightdeck.glb';
const DECK_ALBEDO = 0.2; // see loadDeck
const loader = new GLTFLoader();
let deckTemplate = null;
let deckLoad = null;

function loadDeck() {
  if (!deckLoad) {
    deckLoad = loader.loadAsync(URL).then(({ scene }) => {
      scene.name = 'flightdeck:v3.1';
      // The pad's sun and sky lights are strong, so the light grey deck washed out to white and the ceiling fixtures bloomed.
      // Darken the unlit-colour materials a little and cap emissive glow, so the deck keeps the contrast of the Blender renders.
      const seen = new Set();
      scene.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m || seen.has(m)) continue;
          seen.add(m);
          // the engine-flame light glints off the printed panels (rough 0.5) and blows some of them out to white squares: make them matte
          if (m.name === 'label2') { m.roughness = 1; m.metalness = 0; m.color.multiplyScalar(0.3); }
          if (m.name === 'fixture') m.emissiveIntensity = Math.min(m.emissiveIntensity, 0.35);
          else if (m.name === 'label2') m.emissiveIntensity = Math.min(m.emissiveIntensity, 0.8);
          else if (m.isMeshStandardMaterial && m.emissive.getHex() === 0 && !m.transparent && m.metalness < 0.3 && !/^fabric/.test(m.name) && !isSaturated(m.color)) m.color.multiplyScalar(DECK_ALBEDO);
        }
      });
      deckTemplate = scene;
      return scene;
    }).catch((err) => {
      console.error('[flightdeck] model failed to load; keeping procedural cockpit', err);
      return null;
    });
  }
  return deckLoad;
}

// Start loading during boot, while the player is in the menu or hangar.
if (typeof window !== 'undefined') loadDeck();

/** Load the Shuttle-style deck now (warm-up and tests). */
export const preloadFlightDeck = () => loadDeck();

function installDeck(group) {
  if (!deckTemplate) return false;
  const model = deckTemplate.clone(true);
  model.name = 'flightdeck:v3.1';
  group.clear();
  group.add(model);
  group.userData.triangles = 56500;

  const cabinLight = new THREE.PointLight(0xfff0e2, 2.6, 5, 1.6);
  cabinLight.position.set(0, 0.45, 0.05);
  const screenLight = new THREE.PointLight(0x67e8f9, 0.22, 2, 2);
  screenLight.position.set(0, -0.2, -0.62);
  const alarmGlow = new THREE.PointLight(0xff2a1f, 0, 5, 2);
  alarmGlow.position.set(0, 0.75, -0.4);
  group.add(cabinLight, screenLight, alarmGlow);
  // FLIGHT MODE sits on the tilted instrument panel (17 deg): its caps press in along the panel normal, not along world y.
  const PANEL_NORMAL = new THREE.Vector3(0, Math.sin(0.2967), Math.cos(0.2967));
  // gloved hands on the stick and throttle (the deck model has none): built here, driven by the same code as the capsule cabins
  addProceduralHands(model);
  const ctrl = installControls(group, model, { panelNormal: PANEL_NORMAL, lights: { cabinLight, alarmGlow, cabinBase: 2.6 } });
  installHands(group, model, ctrl, { tip: { R: new THREE.Vector3(0, 0.33 - 0.05, 0), L: new THREE.Vector3(0, 0.17 - 0.05, 0) } });
  return true;
}

export function createFlightDeck(createFallback) {
  const group = deckTemplate ? new THREE.Group() : createFallback();
  group.name = 'cockpit';
  const oldFrame = group.userData.onFrame;
  let installed = false;
  const install = () => {
    if (installed || !deckTemplate) return;
    installed = installDeck(group);
  };
  if (deckTemplate) {
    install();
    return group;
  }
  loadDeck().then(install);
  group.userData.onFrame = (...args) => {
    install();
    if (!installed) oldFrame?.(...args);
  };
  return group;
}
