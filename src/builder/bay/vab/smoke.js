// Cheap smoke puffs where the decks run on their tracks when they retract: one Points object, one draw call,
// a soft canvas sprite, per-puff size and alpha. No lights, no extra passes.
import * as THREE from 'three';

const MAX = 96;
const LIFE = 2.4;

function puffTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createSmoke(scene) {
  const position = new Float32Array(MAX * 3), colour = new Float32Array(MAX * 4), size = new Float32Array(MAX);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colour, 4).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('psize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const map = puffTexture();
  const material = new THREE.PointsMaterial({ size: 1, map, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float psize;')
      .replace('gl_PointSize = size;', 'gl_PointSize = size * psize;');
  };
  material.customProgramCacheKey = () => 'vab-smoke';
  const points = new THREE.Points(geometry, material);
  points.name = 'vab-smoke';
  points.frustumCulled = false;
  points.visible = false;
  scene.add(points);
  const puffs = [];

  /** Queues a puff at (x, y, z) after `delay` seconds, drifting along (dx, dz). */
  function puff(x, y, z, delay = 0, dx = 0, dz = 0) {
    if (puffs.length >= MAX) return;
    puffs.push({ x, y, z, dx, dz, age: -delay, grow: 0.8 + Math.random() * 0.5, tint: 0.62 + Math.random() * 0.12 });
  }

  function update(dt) {
    for (let i = puffs.length - 1; i >= 0; i--) { puffs[i].age += dt; if (puffs[i].age > LIFE) puffs.splice(i, 1); }
    points.visible = puffs.length > 0;
    if (!points.visible) return;
    let n = 0;
    for (const p of puffs) {
      const t = Math.max(0, p.age) / LIFE, live = p.age > 0 ? 1 : 0;
      position[n * 3] = p.x + p.dx * t * 2.2;
      position[n * 3 + 1] = p.y - t * 0.6;
      position[n * 3 + 2] = p.z + p.dz * t * 2.2;
      colour.set([p.tint, p.tint, p.tint * 1.02, live * 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.6 + 0.08)) * (1 - t)], n * 4);
      size[n] = (1.6 + 5.5 * Math.sqrt(t)) * p.grow * live;
      n++;
    }
    geometry.setDrawRange(0, n);
    for (const k of ['position', 'color', 'psize']) geometry.attributes[k].needsUpdate = true;
  }

  return {
    puff, update, points,
    get active() { return puffs.length > 0; },
    dispose() { scene.remove(points); geometry.dispose(); material.dispose(); map.dispose(); },
  };
}
