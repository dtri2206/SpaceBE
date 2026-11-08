// Frame driver for the pitch demo: pure, no browser APIs, no game imports (Node tests it: tests/demo-inert.test.mjs).
//
// The demo used to be called by src/core/main.js every frame (demo.update(dt, state) right before graphics.render).
// Role 2 may not edit core, and requestAnimationFrame is reserved for main.js (scripts/check-static.mjs rule 5), so
// the demo rides core's own loop instead: while it is wanted, `target[method]` (graphics.render) is wrapped so that
// tick(dt) runs first, with the same dt core passes (already clamped to 0.1 s), at the same point of the frame.
// While it is not wanted (normal play, the trigger keys not all held) nothing is wrapped: a timer only checks
// wanted() every pollMs, and the game's frame is exactly what it was without the demo.

export const MAX_DT = 0.1; // s, same clamp as core's loop
export const POLL_MS = 50;

/**
 * createFrameDriver({ target, method, tick, wanted, onError }) -> { poll, attach, detach, attached }
 *   target     the object whose method core calls once per frame (graphics), or a function returning it (read late,
 *              so an import cycle at boot cannot catch it before its module ran)
 *   tick(dt)   the demo's per-frame update
 *   wanted()   true while the demo needs frames (trigger held, demo running, pending start, preview playing)
 *   poll()     call on a timer: attaches when wanted
 * After each tick the wrapper checks wanted() and takes itself off when the demo no longer needs frames.
 */
export function createFrameDriver({ target, method = 'render', tick, wanted, onError = (error) => console.error('[demo] frame:', error) }) {
  const host = () => (typeof target === 'function' ? target() : target);
  let wrapper = null;
  let owner = null;
  let hadOwn = false;
  let ownValue;

  function attach() {
    const t = host();
    if (wrapper || !t || typeof t[method] !== 'function') return false;
    owner = t;
    const target = t;
    hadOwn = Object.prototype.hasOwnProperty.call(target, method);
    ownValue = target[method];
    const original = target[method];
    const self = function demoFrame(dt, ...rest) {
      if (wrapper === self) {
        try { tick(Math.min(Number.isFinite(dt) ? Math.max(0, dt) : 0, MAX_DT)); } catch (error) { onError(error); }
        let keep = false;
        try { keep = !!wanted(); } catch (error) { onError(error); }
        if (!keep) detach();
      }
      return original.call(this, dt, ...rest);
    };
    wrapper = self;
    target[method] = self;
    return true;
  }

  function detach() {
    if (!wrapper) return;
    if (owner[method] === wrapper) {
      if (hadOwn) owner[method] = ownValue;
      else delete owner[method]; // back to the class method: the object is as it was
    }
    wrapper = null;
    owner = null; // a wrapper someone else wrapped again stays in the chain but no longer ticks
  }

  function poll() {
    if (wrapper) return;
    let want = false;
    try { want = !!wanted(); } catch (error) { onError(error); }
    if (want) attach();
  }

  return { poll, attach, detach, get attached() { return !!wrapper; } };
}

/**
 * Starts polling once per page. `env` gives the timer (setInterval) and the global to mark; returns false (and does
 * nothing) outside a browser page, e.g. in Node tests, or when it already runs.
 */
export function startPolling(driver, { env = globalThis, ms = POLL_MS } = {}) {
  if (typeof env?.window === 'undefined' || typeof env?.document === 'undefined' || typeof env?.setInterval !== 'function') return false;
  if (env.__demoDriverStarted) return false; // a second import (HMR, test page) must not start a second timer
  env.__demoDriverStarted = true;
  env.setInterval(() => driver.poll(), ms);
  return true;
}

/** The demo ship always carries CHUTE_UNTESTED (once). Returns the same spec when nothing changes. */
export function withDemoWarnings(spec) {
  if (!spec || typeof spec !== 'object') return spec;
  const warnings = Array.isArray(spec.warnings) ? spec.warnings : [];
  if (warnings.includes('CHUTE_UNTESTED')) return spec;
  return { ...spec, warnings: [...warnings, 'CHUTE_UNTESTED'] };
}
