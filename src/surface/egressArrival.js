// Role 2: egress cinematic part 2: arriving on the mid-deck down the ladder (INTERIOR). Pure timeline + overlay driver.
import { createEgressOverlay } from '/src/flight/hud/egressOverlay.js';

export const ARRIVAL_SECONDS = 2.2;
const START_HEIGHT = 1.3, STEPS = 4, STEP_DROP = START_HEIGHT / STEPS, STEP_FIRST = 0.2, STEP_GAP = 0.4, STEP_LEN = 0.16;
const TURN_FROM = 1.55, TURN_LEN = 0.5;
const CAPTION = { from: 0.5, to: 1.9, text: 'Mid-deck. Home for the next sols.' };
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ease = (x) => { const u = clamp01(x); return u * u * (3 - 2 * u); };

/** Camera for the real ladder: top/bottom = { x, y, z } world eye points (cabin.js ladderTopCabin / ladderBottom).
 *  Descends top to bottom with the rung steps, facing the ladder (yaw π, +Z), then turns to face into the cabin (yaw 0, -Z). */
export function ladderCamera(p, top, bottom) {
  const k = Math.max(0, Math.min(1, p.climb));
  return { x: top.x + (bottom.x - top.x) * k, y: top.y + (bottom.y - top.y) * k, z: top.z + (bottom.z - top.z) * k, yaw: Math.PI * (1 - p.turn) };
}

/** { dy: camera height above normal eye (m), pitch: extra pitch (rad), fade: black 1..0, caption, done } at time t. */
export function arrivalPose(t) {
  let drop = 0, bounce = 0;
  for (let i = 0; i < STEPS; i++) {
    const a = STEP_FIRST + i * STEP_GAP;
    drop += STEP_DROP * ease((t - a) / STEP_LEN);
    const after = t - (a + STEP_LEN);
    if (after > 0) bounce += 0.012 * Math.exp(-after * 18) * Math.sin(after * 40);
  }
  const turn = ease((t - TURN_FROM) / TURN_LEN); // 0 = facing the ladder (+Z), 1 = facing into the cabin (-Z)
  const dy = Math.max(0, START_HEIGHT - drop) + (t >= ARRIVAL_SECONDS ? 0 : bounce);
  const pitch = -0.3 * (1 - ease((t - 0.2) / 1.6));
  const fade = 1 - ease(t / 0.6);
  const caption = t >= CAPTION.from && t < CAPTION.to ? CAPTION.text : null;
  return { dy: t >= ARRIVAL_SECONDS ? 0 : dy, pitch: t >= ARRIVAL_SECONDS ? 0 : pitch, fade, caption, turn, climb: 1 - drop / START_HEIGHT, done: t >= ARRIVAL_SECONDS };
}

export function createArrival() {
  const overlay = createEgressOverlay({ fade: 1 });
  let t = 0;
  return {
    get done() { return t >= ARRIVAL_SECONDS; },
    skip() { t = ARRIVAL_SECONDS; },
    update(dt) {
      t = Math.min(ARRIVAL_SECONDS, t + Math.max(0, dt));
      const p = arrivalPose(t);
      overlay.setFade(p.fade);
      overlay.setCaption(p.caption);
      return p;
    },
    dispose() { overlay.dispose(); },
  };
}
