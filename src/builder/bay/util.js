// Small helpers shared by the engineering-bay scene files.
import * as THREE from 'three';

export const DEG = Math.PI / 180;

export const std = (color, { roughness = 0.6, metalness = 0.2, ...extra } = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
export const glow = (color, power = 1.6) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power) });

export function shadowed(object, cast = true, receive = true) {
  object.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  return object;
}

export function box(w, h, d, material, { x = 0, y = 0, z = 0 } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

export function cylinder(rTop, rBottom, h, material, { x = 0, y = 0, z = 0, segments = 24 } = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material);
  m.position.set(x, y, z);
  return m;
}

/** A straight tube between two points (pipes, cables, railings). */
export function tube(a, b, radius, material, segments = 10) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
  const len = from.distanceTo(to);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, segments), material);
  m.position.copy(from).lerp(to, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  return m;
}

/** Position on the ring: angle in degrees, radius in metres. */
export const polar = (deg, r, y = 0) => new THREE.Vector3(Math.cos(deg * DEG) * r, y, Math.sin(deg * DEG) * r);

/** Makes a canvas texture and returns { texture, ctx, canvas, redraw(fn) } so screens can be redrawn cheaply. */
export function canvasTexture(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return {
    texture, ctx, canvas,
    redraw(fn) {
      fn(ctx, width, height);
      texture.needsUpdate = true;
    },
  };
}

/** Draws a HUD-style screen: dark background, thin frame, title and lines. */
export function drawScreen(ctx, w, h, { title = '', lines = [], accent = '#67e8f9', scale = 1, status = null }) {
  ctx.fillStyle = '#04101a';
  ctx.fillRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(103,232,249,0.08)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2 * scale;
  ctx.strokeRect(8 * scale, 8 * scale, w - 16 * scale, h - 16 * scale);
  ctx.fillStyle = accent;
  ctx.font = `600 ${22 * scale}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(title.toUpperCase(), 22 * scale, 20 * scale);
  if (status) {
    ctx.fillStyle = status.color ?? accent;
    ctx.font = `600 ${18 * scale}px "IBM Plex Mono", monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(status.text, w - 22 * scale, 22 * scale);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = 'rgba(217,244,247,0.9)';
  ctx.font = `${17 * scale}px "IBM Plex Mono", monospace`;
  let y = 60 * scale;
  for (const line of lines) {
    if (typeof line === 'object') {
      ctx.fillStyle = line.color ?? 'rgba(217,244,247,0.9)';
      ctx.fillText(line.text, 22 * scale, y);
      ctx.fillStyle = 'rgba(217,244,247,0.9)';
    } else ctx.fillText(line, 22 * scale, y);
    y += 24 * scale;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let yy = 0; yy < h; yy += 3) ctx.fillRect(0, yy, w, 1);
}

/** Frees an object's GPU buffers. Geometry shared with a loaded model (userData.sharedGeometry) is kept: the model's
 * prototype and every other copy still use it. Materials are per copy (nasaPartArt clones them), so they are freed. */
/**
 * Objects taken out of a scene, disposed a few frames later (tick() once per frame): by then the new objects drawn in
 * their place use the same shader programs, so three.js keeps those programs instead of freeing them and compiling
 * them again (a 1-3 s freeze on every shape switch).
 */
export function createDisposalQueue(frames = 3) {
  let queue = [];
  return {
    add(obj) { if (obj) queue.push({ obj, left: frames }); },
    tick() {
      if (!queue.length) return;
      const keep = [];
      for (const q of queue) { q.left -= 1; if (q.left > 0) keep.push(q); else disposeObject(q.obj); }
      queue = keep;
    },
    flush() { for (const q of queue) disposeObject(q.obj); queue = []; },
  };
}

export function disposeObject(obj) {
  // every node of a loaded model's copy carries sharedGeometry (its buffers belong to the cached model); what the art
  // adds under such a copy later (a fairing's see-through skirt, struts, clamps) does not, and is freed
  obj.traverse((o) => {
    if (o.geometry && !o.userData?.sharedGeometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.());
  });
}
