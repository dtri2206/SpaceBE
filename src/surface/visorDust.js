// Mars dust on the helmet visor (Role 2). Pure logic, no DOM: the suit HUD draws `opacity`.
//   accumulate(dt, { speed, mode }) : mode 'walk' (slow), 'drive' (much faster, scales with speed)
//   burst(amount)                   : bumps and falls throw up a puff
//   clear()                         : the airlock brushes the suit off
// level is 0..1; `opacity` is the overlay alpha and never exceeds MAX_DUST_OPACITY, so the HUD stays readable.
export const MAX_DUST_OPACITY = 0.35;
export const DUST_RATES = { walk: 0.0035, drive: 0.006 }; // level per metre travelled

export function createVisorDust({ walkRate = DUST_RATES.walk, driveRate = DUST_RATES.drive } = {}) {
  let level = 0;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return {
    get level() { return level; },
    get opacity() { return level * MAX_DUST_OPACITY; },
    accumulate(dt, { speed = 0, mode = 'walk' } = {}) {
      if (!(dt > 0) || !(speed > 0.2)) return level;
      level = clamp(level + dt * speed * (mode === 'drive' ? driveRate : walkRate));
      return level;
    },
    burst(amount = 0.1) { level = clamp(level + Math.max(0, amount)); return level; },
    clear() { level = 0; },
  };
}
