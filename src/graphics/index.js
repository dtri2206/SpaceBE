/**
 * Role 3 public API. Other roles import from this file only.
 *
 *   import { graphics, assets, getTerrainHeight, cinematic, createMarsScene, createSpaceScene } from '/src/graphics/index.js';
 *   import { audio } from '/src/audio/index.js';
 *   import '/src/ui/theme.css';
 *
 *   graphics.init({ container, quality: 'high' });
 *   const { scene } = createMarsScene();
 *   graphics.setView(scene, camera);
 *   // In your game loop:
 *   graphics.render(dt);
 *
 * Objects with userData.onFrame(dt, camera) are updated automatically during render.
 *
 * Coordinates: metres, +Y up. In space scenes keep the camera near the origin and move the planets instead.
 * At 640,000 m from the origin a 32-bit position is only good to about 6 cm, and a cockpit would visibly shake.
 */
import * as THREE from 'three';
import {
  BlendFunction, BloomEffect, ChromaticAberrationEffect, Effect, EffectComposer, EffectPass, NoiseEffect,
  RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect,
} from 'postprocessing';
import { QUALITY, sharedUniforms, state } from './shared.js';
import { bindCinematic, cinematic } from './cinematic.js';
import { assets } from './assets.js';
import { getTerrainHeight, DELTA } from './terrain.js';
import { createMarsScene } from './marsSurface.js';
import { createLaunchSite } from './launchSite.js';
import { startWarmup } from './warmup.js';
import { capsuleIdFor } from './capsuleCockpit.js';

export { assets, cinematic, createLaunchSite, createMarsScene, DELTA, getTerrainHeight, capsuleIdFor }; // capsuleIdFor(ship?) -> 'apollo' for any capsule ship, null for Dream Chaser / Starship (flight deck)

const REST_VIGNETTE = { offset: 0.36, darkness: 0.5 };
// A stray NaN/Inf pixel (the cockpit on the pad produced some at certain look angles) is spread over the whole frame by the
// bloom blur and the frame goes black. This pass runs before bloom and turns such pixels into a finite colour.
class FiniteGuardEffect extends Effect {
  constructor() {
    super('FiniteGuardEffect', `void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
      vec3 c = inputColor.rgb;
      if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
      outputColor = vec4(min(c, vec3(1000.0)), inputColor.a);
    }`, { blendFunction: BlendFunction.SET });
  }
}
const shakeRotation = new THREE.Quaternion();
const shakeEuler = new THREE.Euler();
const savedRotation = new THREE.Quaternion();

class Graphics {
  renderer = null;
  composer = null;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1e10);
  effects = { vignette: 0, blackout: 0, shake: 0 };
  #container = null;
  #passes = {};
  #vignette = null;
  #fadeEl = null;
  #blackoutEl = null;
  // automatic resolution: lowers the pixel ratio when frames are slow, and raises it again when there is room
  #auto = { on: true, step: 0, settleUntil: 0, last: 0, sum: 0, count: 0, windowStart: 0, slow: 0, fast: 0, hold: 0, retryAt: 0, retryDelay: 30000, raisedAt: 0 };

  /** Safe to call more than once. Returns the graphics object. */
  init({ container = document.body, quality = 'high' } = {}) {
    if (this.renderer) return this;
    state.quality = quality in QUALITY ? quality : 'high';
    this.#container = container;

    const renderer = new THREE.WebGLRenderer({
      powerPreference: 'high-performance',
      antialias: false,
      stencil: false,
      depth: false,
      logarithmicDepthBuffer: true,
    });
    renderer.toneMapping = THREE.NoToneMapping; // ToneMappingEffect does it, after bloom
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    container.append(renderer.domElement);
    this.renderer = state.renderer = renderer;

    const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    const camera = this.camera;
    const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.35, luminanceSmoothing: 0.3, intensity: 0.7, radius: 0.72 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.#vignette = new VignetteEffect(REST_VIGNETTE);
    const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    grain.blendMode.opacity.value = 0.06;
    const aberration = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.00055, 0.00045), radialModulation: true, modulationOffset: 0.4 });

    this.#passes = {
      render: new RenderPass(this.scene, camera),
      guard: new EffectPass(camera, new FiniteGuardEffect()),
      hdr: new EffectPass(camera, bloom, tone),
      smaa: new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })),
      lens: new EffectPass(camera, aberration),
      finish: new EffectPass(camera, this.#vignette, grain),
    };
    Object.values(this.#passes).forEach((pass) => composer.addPass(pass));
    this.composer = composer;

    this.#fadeEl = this.#overlay(30);
    this.#blackoutEl = this.#overlay(29);
    this.setQuality(state.quality);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    bindCinematic(this);
    return this;
  }

  #overlay(zIndex) {
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:${zIndex}`;
    this.#container.append(el);
    return el;
  }

  /** Choose what to draw. Pass your own camera, or keep using graphics.camera. */
  setView(scene, camera = this.camera) {
    this.init();
    this.scene = scene;
    this.camera = camera;
    this.#autoReset(2000); // shaders compile on the first frames, so those frames say nothing about speed
    this.composer.setMainScene(scene);
    this.composer.setMainCamera(camera);
    this.resize();
  }

  /** Draws one frame. Call once per frame with seconds since the last one. */
  render(dt = 1 / 60) {
    this.init();
    this.#autoMeasure();
    sharedUniforms.uTime.value += dt;
    const { scene, camera } = this;
    scene.traverseVisible((o) => o.userData.onFrame?.(dt, camera));

    const shake = this.effects.shake;
    if (shake > 0) {
      const t = sharedUniforms.uTime.value;
      const size = 0.012 * shake;
      shakeEuler.set(
        (Math.sin(t * 47) + Math.sin(t * 71.3)) * size,
        (Math.sin(t * 53.7) + Math.sin(t * 83.1)) * size,
        Math.sin(t * 61.1) * size * 0.6,
      );
      savedRotation.copy(camera.quaternion);
      camera.quaternion.multiply(shakeRotation.setFromEuler(shakeEuler));
      camera.updateMatrixWorld();
    }
    this.composer.render(dt);
    if (shake > 0) camera.quaternion.copy(savedRotation);
  }

  /** Gameplay-driven screen effects, each 0..1: vignette (g-force, low O2), blackout, shake. */
  setEffects({ vignette, blackout, shake } = {}) {
    this.init();
    if (vignette !== undefined) {
      this.effects.vignette = vignette;
      this.#vignette.offset = THREE.MathUtils.lerp(REST_VIGNETTE.offset, 0.02, vignette);
      this.#vignette.darkness = THREE.MathUtils.lerp(REST_VIGNETTE.darkness, 1, vignette);
    }
    if (blackout !== undefined) {
      this.effects.blackout = blackout;
      this.#blackoutEl.style.opacity = blackout;
    }
    if (shake !== undefined) this.effects.shake = shake;
  }

  /** Fade the screen to a colour: await graphics.fade({ to: 1, duration: 2, color: '#000' }). */
  fade({ to = 1, duration = 1, color = '#000' } = {}) {
    this.init();
    const el = this.#fadeEl;
    el.style.background = color;
    el.style.transition = `opacity ${duration}s linear`;
    el.style.opacity = to;
    return new Promise((resolve) => setTimeout(resolve, duration * 1000));
  }

  /** The direction towards the Sun, used by planets and the space sky. */
  setSunDirection(direction) {
    sharedUniforms.uSunDir.value.copy(direction).normalize();
  }

  get sunDirection() {
    return sharedUniforms.uSunDir.value;
  }

  get quality() {
    return state.quality;
  }

  /** 'low' or 'high'. Effects and resolution change at once; textures and rocks change for scenes built afterwards. */
  setQuality(quality) {
    this.init();
    if (!(quality in QUALITY)) return;
    state.quality = quality;
    const high = quality === 'high';
    this.#passes.lens.enabled = high;
    this.#auto.step = 0;
    this.#applyPixelRatio();
  }

  get #basePixelRatio() {
    return Math.min(window.devicePixelRatio, QUALITY[state.quality].pixelRatio);
  }

  #applyPixelRatio() {
    const base = this.#basePixelRatio;
    this.renderer.setPixelRatio(base * (1 - 0.1 * this.#auto.step)); // 4 steps down, to 0.6 x the quality's ratio
    this.resize();
    this.#autoReset(500);
  }

  /** The pixel ratio in use now (the quality's ratio, or lower while auto resolution is helping). */
  get pixelRatioNow() {
    return this.renderer ? this.renderer.getPixelRatio() : 0;
  }

  /** Automatic resolution, on by default: slow frames lower the pixel ratio (floor 0.6 x), spare time raises it back. */
  setAutoResolution(on) {
    this.#auto.on = Boolean(on);
    if (!on && this.#auto.step !== 0 && this.renderer) {
      this.#auto.step = 0;
      this.#applyPixelRatio();
    }
    this.#autoReset(500);
  }

  #autoReset(ms) {
    const a = this.#auto;
    const now = performance.now();
    a.settleUntil = now + ms;
    a.last = 0;
    a.sum = a.count = a.slow = a.fast = a.hold = 0;
    a.windowStart = now;
  }

  // Called once per render. Frame time is the gap between renders, in windows of 0.5 s.
  //   average above 20 ms for 2 s (4 windows) -> one step down.
  //   average under 13 ms for 6 s (12 windows) -> one step up.
  //   Screens locked to 60 Hz never get under 13 ms, so a held 60 fps (under 18 ms) for a retry delay also tries one step up;
  //   each retry that has to step down again within 15 s doubles the delay (30 s up to 8 min), so it settles instead of pumping.
  #autoMeasure() {
    const a = this.#auto;
    if (!a.on) return;
    const now = performance.now();
    const gap = a.last ? now - a.last : 0;
    a.last = now;
    if (now < a.settleUntil || gap <= 0 || gap > 250) return; // settling, first frame, or the tab was hidden
    a.sum += gap;
    a.count++;
    if (now - a.windowStart < 500) return;
    const avg = a.sum / a.count;
    a.sum = a.count = 0;
    a.windowStart = now;
    a.slow = avg > 20 ? a.slow + 1 : 0;
    a.fast = avg < 13 ? a.fast + 1 : 0;
    a.hold = avg < 18 ? a.hold + 1 : 0;
    if (a.slow >= 4 && a.step < 4) {
      if (a.raisedAt && now - a.raisedAt < 15000) a.retryDelay = Math.min(a.retryDelay * 2, 480000);
      a.step++;
      a.retryAt = now + a.retryDelay;
      this.#applyPixelRatio();
    } else if (a.step > 0 && (a.fast >= 12 || (a.hold >= 2 * (a.retryDelay / 1000) && now > a.retryAt))) {
      a.step--;
      a.raisedAt = now;
      this.#applyPixelRatio();
    }
  }

  resize() {
    const el = this.#container;
    const width = el === document.body ? window.innerWidth : el.clientWidth;
    const height = el === document.body ? window.innerHeight : el.clientHeight;
    if (!width || !height) return;
    this.composer.setSize(width, height);
    if (this.camera.isPerspectiveCamera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }
}

export const graphics = new Graphics();
state.ensure = () => graphics.init();
startWarmup(graphics);

/** Stars, Milky Way and Sun in a new scene. Add planets from assets.get('planet:earth') and position them yourself. */
export function createSpaceScene() {
  const scene = new THREE.Scene();
  scene.name = 'space';
  scene.add(assets.get('sky:space'));
  return scene;
}
