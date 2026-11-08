// MR-01 unlock logic (Role 2), pure JS, testable in node.
// The futuristic MR-01 rover stays locked until Mars Exploration reaches 50 %, then unlocks once per mission.
// Feed it percentages from getProgress() / the `progress:changed` event; reset() with the astronaut for a new mission.
export const MR01_UNLOCK_PERCENT = 50;
export const MR01_LOCKED_PROMPT = `MR-01 locked: reach ${MR01_UNLOCK_PERCENT}% Mars Exploration`;
export const MR01_UNLOCKED_NOTICE = 'MR-01 unlocked: faster rover available by the lander';

export function createMr01Unlock({ threshold = MR01_UNLOCK_PERCENT, onUnlock } = {}) {
  let percent = 0, unlocked = false, noticePending = false;
  const open = () => { if (unlocked) return false; unlocked = true; noticePending = true; onUnlock?.(); return true; };
  return {
    get unlocked() { return unlocked; },
    get percent() { return percent; },
    /** latest Mars Exploration percent (any junk is ignored); returns true on the call that unlocks */
    setPercent(p) {
      const n = Number(p);
      if (!Number.isFinite(n)) return false;
      percent = n;
      return n >= threshold ? open() : false;
    },
    /** debug only (?debug=1): unlock right now */
    debugUnlock: open,
    /** true exactly once after unlocking: show the "unlocked" notice then (when the player is outside to see it) */
    takeNotice() { const v = noticePending; noticePending = false; return v; },
    reset() { percent = 0; unlocked = false; noticePending = false; },
  };
}

// Shared by the surface module and astronaut.reset(): one unlock state per mission.
export const mr01Unlock = createMr01Unlock();
