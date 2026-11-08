// Interactable system (Role 2): the shared "press/hold E" mechanic for ship stations, Mars tasks
// (Role 4 places scan points, samples, data logs through this API) and doors. TEAM_PROMPT §15.1.
//
// const ia = createInteractables();
// const off = ia.register({ id: 'scan-1', position: { x, y, z }, prompt: 'Hold E to scan', hold: 3,
//                           radius: 2, enabled: () => true, onUse: () => {...} });
// each frame: const ui = ia.update(dt, walker.eye, walker.lookDir, eHeld);
//   ui.focused → { id, prompt, holdProgress } | null      (HUD shows the prompt + progress ring)
// on E keydown: ia.press()   (tap interactions fire immediately; hold ones fire after `hold` seconds)

export function createInteractables() {
  const items = new Map();
  let focused = null;
  let holdT = 0;
  let pressedThisFrame = false;

  const usable = (it) => (typeof it.enabled === 'function' ? it.enabled() : it.enabled !== false);

  function pick(eye, dir) {
    let best = null;
    let bestScore = -Infinity;
    for (const it of items.values()) {
      if (!usable(it)) continue;
      const dx = it.position.x - eye.x, dy = it.position.y - eye.y, dz = it.position.z - eye.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > (it.radius ?? 1.6)) continue;
      const facing = dist > 1e-6 ? (dx * dir.x + dy * dir.y + dz * dir.z) / dist : 1;
      if (facing < (it.minFacing ?? 0.55)) continue; // must look roughly at it
      const score = facing * 2 - dist; // prefer what you look at, then what's close
      if (score > bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  const promptOf = (it) => (typeof it.prompt === 'function' ? it.prompt() : it.prompt);

  return {
    register(def) {
      if (!def?.id || !def.position || typeof def.onUse !== 'function') throw new Error('register: id, position, onUse required');
      items.set(def.id, { hold: 0, ...def });
      return () => items.delete(def.id);
    },
    unregister(id) { items.delete(id); },
    get(id) { return items.get(id); },
    get size() { return items.size; },
    clear() { items.clear(); focused = null; holdT = 0; },

    press() { pressedThisFrame = true; },

    update(dt, eye, lookDir, useHeld = false) {
      const it = pick(eye, lookDir);
      if (it !== focused) { focused = it; holdT = 0; }
      let used = null;
      if (it) {
        if (it.hold > 0) {
          holdT = useHeld ? holdT + dt : 0;
          if (holdT >= it.hold) { holdT = 0; used = it; }
        } else if (pressedThisFrame) {
          used = it;
        }
      }
      pressedThisFrame = false;
      if (used) used.onUse(used);
      return {
        focused: it ? { id: it.id, prompt: promptOf(it), holdProgress: it.hold > 0 ? Math.min(1, holdT / it.hold) : null } : null,
        used: used?.id ?? null,
      };
    },
  };
}

