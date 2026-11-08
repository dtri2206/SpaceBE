// Event bus. Every event name and its required payload keys are in contract.js (EVENTS).
import { EVENTS } from './contract.js';

const listeners = new Map(); // name -> Set<fn>

/** Subscribe. Returns a function that unsubscribes. */
export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => off(name, fn);
}

/** Subscribe for one call only. Returns an unsubscribe function. */
export function once(name, fn) {
  const stop = on(name, (payload) => {
    stop();
    fn(payload);
  });
  return stop;
}

/** Unsubscribe. */
export function off(name, fn) {
  listeners.get(name)?.delete(fn);
}

/** Send an event. Unknown names and missing payload keys log console.error but are still delivered. */
export function emit(name, payload = {}) {
  const required = EVENTS[name];
  if (!required) {
    console.error(`[events] unknown event "${name}". Every event must be listed in src/core/contract.js (EVENTS).`);
  } else {
    for (const key of required) {
      if (payload == null || !(key in payload)) {
        console.error(`[events] event "${name}" is missing required key "${key}".`);
      }
    }
  }
  for (const fn of [...(listeners.get(name) ?? [])]) {
    try {
      fn(payload);
    } catch (error) {
      console.error(`[events] a listener of "${name}" threw:`, error);
    }
  }
}
