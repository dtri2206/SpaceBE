import * as THREE from 'three';

const target = new THREE.Vector3();
let current = null;
let context = null;

/** Called once by graphics.init(). */
export function bindCinematic(ctx) {
  context = ctx;
}

function easeInOut(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Plays a scripted camera move.
 *
 *   await cinematic.play({
 *     camera,                 // optional, defaults to the camera in graphics.setView()
 *     cameraPath: [{ position: [x, y, z], lookAt: [x, y, z] }, ...],  // two or more points
 *     duration: 12,           // seconds
 *     fades: [{ at: 0, to: 0, duration: 2 }, { at: 11, to: 1, duration: 1, color: '#000' }],
 *     onUpdate: (t) => {},    // t runs 0..1
 *   });
 *
 * While cinematic.active is true, gameplay should leave the camera alone. Resolves when it ends or on cinematic.stop().
 */
export const cinematic = {
  get active() {
    return current !== null;
  },
  play({ camera = context?.camera, cameraPath = [], duration = 5, fades = [], onUpdate, ease = easeInOut } = {}) {
    this.stop();
    const points = (list) => list.map((v) => new THREE.Vector3(...v));
    const hasPath = cameraPath.length >= 2;
    const positions = hasPath ? new THREE.CatmullRomCurve3(points(cameraPath.map((p) => p.position))) : null;
    const looks = hasPath ? new THREE.CatmullRomCurve3(points(cameraPath.map((p) => p.lookAt))) : null;
    const pending = [...fades].sort((a, b) => a.at - b.at);
    const start = performance.now();
    return new Promise((resolve) => {
      const run = { resolve, frame: 0 };
      current = run;
      const tick = (now) => {
        if (current !== run) return;
        const elapsed = (now - start) / 1000;
        while (pending.length && pending[0].at <= elapsed) context?.fade(pending.shift());
        const t = Math.min(1, elapsed / duration);
        if (hasPath && camera) {
          const e = ease(t);
          positions.getPoint(e, camera.position);
          camera.lookAt(looks.getPoint(e, target));
        }
        onUpdate?.(t);
        if (t < 1) {
          run.frame = requestAnimationFrame(tick);
        } else {
          current = null;
          resolve();
        }
      };
      run.frame = requestAnimationFrame(tick);
    });
  },
  stop() {
    if (!current) return;
    cancelAnimationFrame(current.frame);
    const { resolve } = current;
    current = null;
    resolve();
  },
};
