// Pictures of parts for the catalogue cards: each part's own 3D art rendered once to a small image (cached).
import * as THREE from 'three';
import { assets } from '/src/graphics/index.js';
import { partArt } from './bay/partArt.js';
import { SIZE_SCALE, BASE_RADIUS } from './assembly.js';

export function createIconRenderer({ renderer, size = 512 }) {
  const cache = new Map();
  const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 100);
  const key = new THREE.DirectionalLight(0xfff4e6, 2.0);
  key.position.set(3, 5, 4);
  const fill = new THREE.DirectionalLight(0x8ea4c8, 0.9);
  fill.position.set(-4, 2, -3);
  const rim = new THREE.DirectionalLight(0x67e8f9, 1.4);
  rim.position.set(0, 3, -5);
  scene.add(key, fill, rim, new THREE.AmbientLight(0x405060, 0.5), new THREE.HemisphereLight(0xdfe9ff, 0x202428, 0.45));
  const pixels = new Uint8Array(size * size * 4);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  function render(def) {
    const entry = { type: def.id, attach: def.attach, height: def.height, def, radius: BASE_RADIUS * (SIZE_SCALE[def.size] ?? 1) };
    const art = partArt(entry);
    const holder = new THREE.Group();
    holder.add(art);
    holder.rotation.y = -0.4;
    scene.add(holder);
    scene.environment = assets.environment?.() ?? null;
    scene.environmentIntensity = 0.3; // untextured white hardware must not blow out
    const box = new THREE.Box3().setFromObject(holder);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dist = sphere.radius / Math.sin((camera.fov * Math.PI) / 360) * 1.15;
    camera.position.copy(sphere.center).add(new THREE.Vector3(0.9, 0.55, 1.1).normalize().multiplyScalar(dist));
    camera.lookAt(sphere.center);
    camera.updateProjectionMatrix();
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    scene.remove(holder);
    holder.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.()); });
    const image = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) { // flip vertically: GL rows start at the bottom
      const src = (size - 1 - y) * size * 4;
      image.data.set(pixels.subarray(src, src + size * 4), y * size * 4);
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }

  // Side elevation for the vehicle diagram: orthographic, straight from the front, transparent, at a fixed
  // pixels-per-metre so the stacked pictures line up like an engineering drawing.
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  const sideCache = new Map();
  function renderSide(def, ppm) {
    const entry = { type: def.id, attach: def.attach, height: def.height, def, radius: BASE_RADIUS * (SIZE_SCALE[def.size] ?? 1) };
    const art = partArt(entry);
    const holder = new THREE.Group();
    holder.add(art);
    scene.add(holder);
    scene.environment = assets.environment?.() ?? null;
    scene.environmentIntensity = 0.3;
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    const widthM = Math.max(size.x, 0.3) * 1.08, heightM = Math.max(size.y, 0.2) * 1.06;
    const w = Math.min(size_, Math.max(32, Math.round(widthM * ppm))), hpx = Math.min(size_, Math.max(32, Math.round(heightM * ppm)));
    ortho.left = -widthM / 2; ortho.right = widthM / 2; ortho.top = heightM / 2; ortho.bottom = -heightM / 2;
    ortho.position.set(centre.x, centre.y, centre.z + 20);
    ortho.lookAt(centre.x, centre.y, centre.z);
    ortho.updateProjectionMatrix();
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevViewport = renderer.getViewport(new THREE.Vector4());
    const prevScissor = renderer.getScissor(new THREE.Vector4());
    const prevScissorTest = renderer.getScissorTest();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.setViewport(0, 0, w, hpx);
    renderer.setScissor(0, 0, w, hpx);
    renderer.setScissorTest(true);
    renderer.render(scene, ortho);
    renderer.readRenderTargetPixels(rt, 0, 0, w, hpx, pixels);
    renderer.setRenderTarget(prevTarget);
    renderer.setViewport(prevViewport);
    renderer.setScissor(prevScissor);
    renderer.setScissorTest(prevScissorTest);
    renderer.setClearColor(prevClear, prevAlpha);
    scene.remove(holder);
    holder.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.()); });
    const c = document.createElement('canvas');
    c.width = w; c.height = hpx;
    const cx = c.getContext('2d');
    const image = cx.createImageData(w, hpx);
    for (let y = 0; y < hpx; y++) {
      const src = (hpx - 1 - y) * w * 4;
      image.data.set(pixels.subarray(src, src + w * 4), y * w * 4);
    }
    cx.putImageData(image, 0, 0);
    return { url: c.toDataURL('image/png'), widthM, heightM, size: { x: size.x, y: size.y } };
  }
  const size_ = size;

  return {
    /** Data URL of the part's picture (rendered on first use). */
    iconFor(def) {
      if (!cache.has(def.id)) {
        try { cache.set(def.id, render(def)); } catch { cache.set(def.id, ''); }
      }
      return cache.get(def.id);
    },
    /** { url, widthM, heightM } side elevation at `ppm` pixels per metre (cached per part and ppm). */
    sideViewFor(def, ppm = 60) {
      const key = `${def.id}@${ppm}`;
      if (!sideCache.has(key)) {
        try { sideCache.set(key, renderSide(def, ppm)); } catch { sideCache.set(key, { url: '', widthM: 1, heightM: def.height }); }
      }
      return sideCache.get(key);
    },
    /** Forget rendered pictures (after the real models arrive). */
    reset() { cache.clear(); sideCache.clear(); },
    dispose() { rt.dispose(); cache.clear(); sideCache.clear(); },
  };
}
