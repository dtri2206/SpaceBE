// Role 2's big scenes, built once and shared by flight (LANDING below 6 km) and surface (INTERIOR, SURFACE).
// Role 3's Mars terrain and cabin are heavy: building them and compiling their shaders on the first frame of a
// state freezes the game for seconds. prepareScenes() builds them in the background at boot instead.
import * as THREE from 'three';
import { assets, createMarsScene, getTerrainHeight, graphics } from '/src/graphics/index.js';

const cache = { mars: null, marsSky: null, lander: null, cabin: null, cabinArt: null };

/** Role 3's Mars surface with our landed ship (the lander) at the landing site, the origin. */
export function getMars() {
  if (!cache.mars) {
    const handle = createMarsScene({ sunElevation: 26 });
    cache.mars = handle.scene;
    cache.marsSky = handle.setSunElevation;
    cache.lander = assets.get('lander');
    cache.lander.position.set(0, getTerrainHeight(0, 0), 0);
    cache.mars.add(cache.lander);
  }
  return { scene: cache.mars, lander: cache.lander };
}

/** Role 3's setSunElevation(degrees, azimuthDegrees) for the shared Mars scene (the sol clock drives it). */
export function getMarsSunSetter() {
  getMars();
  return cache.marsSky;
}

/** Role 3's cabin art in its own scene. */
export function getCabin() {
  if (!cache.cabin) {
    cache.cabin = new THREE.Scene();
    cache.cabinArt = assets.get('cabin');
    cache.cabin.add(cache.cabinArt);
  }
  return { scene: cache.cabin, art: cache.cabinArt };
}

/** Build both now and compile their shaders in the background (safe to call more than once). */
export function prepareScenes() {
  for (const get of [getMars, getCabin]) {
    try {
      const { scene } = get();
      graphics.renderer?.compileAsync?.(scene, graphics.camera)?.catch?.(() => {});
    } catch (error) {
      console.warn('[surface] could not pre-build a scene:', error);
    }
  }
}
