// The ONLY code allowed to touch localStorage. Everything is wrapped in try/catch.
const KEY = 'hackathon_save_v1';
let memory = {}; // fallback when storage is unavailable

/** Returns the saved object (never throws). */
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) memory = JSON.parse(raw);
  } catch {
    /* keep memory */
  }
  return memory;
}

/** Merge a partial object into the save. Returns the new save. */
function update(partial) {
  memory = { ...load(), ...partial };
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* storage full or blocked: memory still works for this session */
  }
  return memory;
}

/** Erase the save. */
function reset() {
  memory = {};
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const save = { load, update, reset };
