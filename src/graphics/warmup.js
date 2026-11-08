// Compiles the shaders LAUNCH will need while the player is still on the PRELAUNCH screen.
//
// Entering LAUNCH adds the cockpit (3 point lights), the engine flame and exhaust (1 light) and the rocket parts to
// the launch site scene. Three.js bakes the light count into every lit material's shader, so without this the first
// LAUNCH frame recompiled the whole site (about 100 ms). Here the same objects are added to the real site scene for
// the length of one synchronous compile call, then removed again, so the programs are ready and cached.
import * as THREE from 'three';
import { events, getShip, getState } from '/src/core/index.js';
import { assets } from './assets.js';
import { latestLaunchSite } from './launchSite.js';
import { preloadCockpit } from './capsuleCockpit.js';
import { prebuildCabin } from './cabin.js';

// [rocket visible, cockpit visible]. On the pad the cockpit view also shows the engine flame (1 more point light, 4 in all),
// so that combination needs its own programs too.
const VIEWS = [[false, true], [true, false], [true, true]];

let done = new WeakSet();
let pending = null; // the temporary warm-up objects while they sit in the site scene

function dropPending() {
  pending?.removeFromParent();
  pending = null;
}

function warm(graphics) {
  const renderer = graphics.renderer;
  const site = latestLaunchSite();
  if (!renderer || !site || done.has(site) || !renderer.compileAsync) return;
  // The extras below sit at the pad for a moment; never do that to a scene that is on screen (if a future PRELAUNCH
  // shows the launch site itself, the shaders compile on the first LAUNCH frame as before).
  if (graphics.scene === site.scene) return;
  done.add(site);
  const extras = new THREE.Group();
  extras.name = 'warmup';
  const cockpit = assets.get('cockpit');
  const rig = new THREE.Group();
  rig.add(cockpit);
  const rocket = new THREE.Group();
  const parts = getShip()?.parts?.length ? getShip().parts : [{ type: 'engine_m' }, { type: 'tank_l' }, { type: 'capsule_m' }];
  for (const type of new Set(parts.map((p) => p.type))) rocket.add(assets.get(`rocketPart:${type}`));
  rocket.add(assets.get('vfx:engineFlame'), assets.get('vfx:exhaust'));
  extras.add(rig, rocket);
  site.scene.add(extras);
  pending = extras;
  // The composer renders into a half-float buffer, which changes the shader key; compile for that target.
  // Flight shows either the cockpit (3 point lights) or the rocket from outside (the flame's 1 light), never both,
  // so both light counts are compiled: otherwise pressing C would recompile the whole site.
  const target = graphics.composer?.inputBuffer ?? null;
  const previous = renderer.getRenderTarget();
  const compiles = [];
  try {
    renderer.setRenderTarget(target);
    for (const [rocketVisible, cockpitVisible] of VIEWS) {
      rocket.visible = rocketVisible;
      cockpit.visible = cockpitVisible;
      compiles.push(renderer.compileAsync(site.scene, graphics.camera).catch(() => {}));
    }
  } finally {
    renderer.setRenderTarget(previous);
  }
  // compileAsync cannot build the shadow-depth programs or upload geometry and textures; a tiny real render does.
  Promise.all(compiles).then(() => requestIdle(() => {
    try {
      if (getState() !== 'PRELAUNCH') return; // the player already left; LAUNCH renders for real now
      drawOnce(renderer, graphics.composer?.inputBuffer, site.scene, graphics.camera, rocket, cockpit);
    } finally {
      dropPending();
      requestIdle(() => { try { warmCabin(graphics); } catch (error) { console.warn('[graphics] cabin warm-up skipped:', error); } });
    }
  }));
}

// The Apollo cabin stands behind the cockpit (through its aft hatch) when the crew float out in ORBIT (cockpit.userData.attachCabin). Building it takes about 300 ms and its
// shaders about as long, so both happen here: the cabin goes into createCabin()'s pool, and its materials are compiled in a throw-away scene with the
// same lights as the flight's space view (1 sun, 1 ambient, the cockpit's 3 point lights and the entry plasma's), because the light counts are baked
// into the shaders. Nothing is shown: the scene is never rendered.
function warmCabin(graphics) {
  const renderer = graphics.renderer;
  if (!renderer?.compileAsync || getState() !== 'PRELAUNCH') return;
  const cockpit = assets.get('cockpit');
  if (!cockpit.userData.attachCabin) return; // flight deck (no aft hatch)
  const cabin = prebuildCabin();
  const scene = new THREE.Scene();
  scene.add(new THREE.DirectionalLight(0xfff4e6, 3), new THREE.AmbientLight(0x8ea4c8, 0.25));
  cockpit.add(assets.get('vfx:entryPlasma'));
  scene.add(cockpit);
  cockpit.userData.attachCabin(cabin);
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(graphics.composer?.inputBuffer ?? null);
    renderer.compileAsync(scene, graphics.camera).catch(() => {}).then(() => requestIdle(() => {
      // a real draw into the composer's buffer uploads the cabin's geometry and textures (compile does not); the next real frame clears it
      const probe = graphics.composer?.inputBuffer;
      const before = renderer.getRenderTarget();
      try {
        if (probe && getState() === 'PRELAUNCH') {
          renderer.setRenderTarget(probe);
          renderer.render(scene, graphics.camera);
        }
      } finally {
        renderer.setRenderTarget(before);
        cockpit.userData.detachCabin?.();
      }
    }));
  } finally {
    renderer.setRenderTarget(previous);
  }
}

// Draws into the composer's own buffer (the same formats the real frame uses, so the GPU pipelines match). Nothing
// is shown: the next real frame clears it.
function drawOnce(renderer, probe, scene, camera, rocket, cockpit) {
  if (!probe) return;
  const culled = [];
  scene.traverse((o) => { if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
  const previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(probe);
    for (const [rocketVisible, cockpitVisible] of VIEWS) {
      rocket.visible = rocketVisible;
      cockpit.visible = cockpitVisible;
      renderer.render(scene, camera);
    }
  } finally {
    renderer.setRenderTarget(previous);
    for (const o of culled) o.frustumCulled = true;
  }
}

function requestIdle(fn) {
  if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 1500 });
  else setTimeout(fn, 300);
}

export function startWarmup(graphics) {
  events.on('state:changed', ({ to }) => {
    if (to !== 'PRELAUNCH') { dropPending(); return; }
    // the cockpit this ship will fly in has to be loaded before its shaders can be warmed (a capsule cabin loads on demand)
    requestIdle(() => preloadCockpit().then(() => { try { warm(graphics); } catch (error) { console.warn('[graphics] launch warm-up skipped:', error); } }));
  });
}
