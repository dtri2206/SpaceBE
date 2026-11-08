// Role 2: Mars dusk and "Pale Blue Dot". Pure logic (no three.js, no DOM) so it can be tested in Node.
//   - a compressed sol clock: the Sun sinks from the landing-day elevation to twilight while the player is outside
//   - helmet zoom: smooth FOV easing toward ~8 degrees while Z is held
//   - an "is the camera looking at Earth" angle test (Earth's fixed direction comes from Role 3's sky shader)

export const DAY_ELEVATION = 26; // degrees: the elevation the Mars scene is built with (landing view stays here)
export const DUSK_ELEVATION = -2; // degrees: sky.js uDusk ~ 0.98, so Earth shows; the glow still lights the terrain
export const DAY_AZIMUTH = 118; // createMarsScene's default
export const DUSK_AZIMUTH = 245; // sets in the direction of Earth (Earth is the evening star next to the Sun)
export const DUSK_AFTER_S = 360; // real seconds of EVA from day to dusk (tune here)
export const EARTH_VISIBLE_ELEVATION = 0.5; // below this the sky shader's Earth is bright enough to hint at
export const SUN_UPDATE_INTERVAL_S = 0.25; // setSunElevation updates uniforms and the light: at most 4 times a second
export const EARTH_DIRECTION = (() => { const l = Math.hypot(-0.42, 0.2, -0.88); return { x: -0.42 / l, y: 0.2 / l, z: -0.88 / l }; })();
export const NORMAL_FOV = 70;
export const ZOOM_FOV = 8;
export const ZOOM_RATE = 6; // 1/s: exponential approach, about 0.4 s to feel settled
export const EARTH_LOOK_DEGREES = 3;

/** progress 0..1 -> { elevation, azimuth } (smoothstep, so the Sun lingers at both ends). */
export function sunAt(progress) {
  const p = Math.min(1, Math.max(0, progress));
  const t = p * p * (3 - 2 * p);
  return { elevation: DAY_ELEVATION + (DUSK_ELEVATION - DAY_ELEVATION) * t, azimuth: DAY_AZIMUTH + (DUSK_AZIMUTH - DAY_AZIMUTH) * t };
}

export const FAST_DUSK_PERCENT = 30; // mid-mission Mars Exploration percent at which dusk arrives quickly (Pale Blue Dot moment)...
export const FAST_DUSK_AFTER_S = 25; // ...once the player has been outside this many seconds
export const FAST_DUSK_S = 20; // real seconds of the fast dusk (ease from the current Sun to twilight)

// Once per mission: set when the fast dusk starts, cleared by astronaut.reset() with the other per-mission state.
export const fastDuskMission = { started: false };
export const resetFastDusk = () => { fastDuskMission.started = false; };

/** Mirror of Role 4's trigger (src/story/index.js): enough progress, long enough outside, not yet started, not already dusk. */
export function shouldStartFastDusk({ percent = 0, secondsOutside = 0, started = false, isDusk = false } = {}) {
  return !started && !isDusk && percent >= FAST_DUSK_PERCENT && secondsOutside >= FAST_DUSK_AFTER_S;
}

/** apply(elevation, azimuth) is called at most every `interval` seconds, and only when the Sun has moved. */
export function createSolClock({ apply, duration = DUSK_AFTER_S, interval = SUN_UPDATE_INTERVAL_S } = {}) {
  let elapsed = 0, sinceApply = interval, applied = null;
  let fast = null; // { t, duration, from: { elevation, azimuth } } while the fast dusk runs
  const sun = () => {
    if (!fast) return sunAt(elapsed / duration);
    const p = Math.min(1, fast.t / fast.duration), e = p * p * (3 - 2 * p);
    return {
      elevation: fast.from.elevation + (DUSK_ELEVATION - fast.from.elevation) * e,
      azimuth: fast.from.azimuth + (DUSK_AZIMUTH - fast.from.azimuth) * e,
    };
  };
  const flush = (force) => {
    const { elevation, azimuth } = sun();
    if (!force && (sinceApply < interval || (applied && applied.elevation === elevation && applied.azimuth === azimuth))) return false;
    apply?.(elevation, azimuth);
    applied = { elevation, azimuth };
    sinceApply = 0;
    return true;
  };
  return {
    get elapsed() { return elapsed; },
    get progress() { return Math.min(1, elapsed / duration); },
    get elevation() { return sun().elevation; },
    get isDusk() { return sun().elevation <= EARTH_VISIBLE_ELEVATION; },
    get fastDusk() { return !!fast; },
    update(dt) {
      if (dt <= 0) return false;
      elapsed = Math.min(duration, elapsed + dt);
      if (fast) {
        fast.t = Math.min(fast.duration, fast.t + dt);
        if (fast.t >= fast.duration) { elapsed = duration; fast = null; } // arrived: the normal clock is at dusk too
      }
      sinceApply += dt;
      return flush(false);
    },
    jumpToDusk() { fast = null; elapsed = duration; flush(true); },
    /** Ease from the current Sun to twilight over `seconds`. No-op when already dusk or already fast. */
    startFastDusk(seconds = FAST_DUSK_S) {
      if (fast || this.isDusk) return false;
      fast = { t: 0, duration: Math.max(0.001, seconds), from: sun() };
      return true;
    },
  };
}

/** One easing step of the helmet camera FOV. */
export function easeFov(current, held, dt, { normal = NORMAL_FOV, zoomed = ZOOM_FOV, rate = ZOOM_RATE } = {}) {
  const target = held ? zoomed : normal;
  const next = target + (current - target) * Math.exp(-rate * Math.max(0, dt));
  return Math.abs(next - target) < 0.01 ? target : next;
}

/** Angle in degrees between a look direction and Earth (both need not be normalised). */
export function angleToEarthDeg(dir, earth = EARTH_DIRECTION) {
  const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
  const dot = (dir.x * earth.x + dir.y * earth.y + dir.z * earth.z) / l;
  return (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;
}

export const isLookingAtEarth = (dir, fov, maxDeg = EARTH_LOOK_DEGREES, earth = EARTH_DIRECTION) =>
  fov <= 15 && angleToEarthDeg(dir, earth) <= maxDeg;

/** Calm caption: shows for `seconds` once the conditions hold, never again after that (once per mission). */
export function createEarthCaption({ seconds = 8 } = {}) {
  let remaining = 0, done = false;
  return {
    get visible() { return remaining > 0; },
    get done() { return done; },
    update(dt, looking) {
      if (!done && looking) { done = true; remaining = seconds; }
      else if (remaining > 0) remaining = Math.max(0, remaining - dt);
      return remaining > 0;
    },
  };
}
