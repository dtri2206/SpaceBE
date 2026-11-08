// Debug only (?debug=1): Enter skips the current activity, i.e. jumps to the next game state.
// For the mapped states this REPLACES the modules' own Enter handlers (input.js asks us first).
import { STATES } from './contract.js';
import { requestState, getState } from './state.js';
import { input } from './input.js';
import { ui } from './ui.js';

const S = STATES;
export const SKIP_NEXT = {
  [S.MENU]: S.HANGAR, [S.HANGAR]: S.GONOGO, [S.GONOGO]: S.PRELAUNCH, [S.PRELAUNCH]: S.LAUNCH,
  [S.LAUNCH]: S.ORBIT, [S.ORBIT]: S.CRUISE, [S.CRUISE]: S.ENTRY, [S.ENTRY]: S.LANDING,
  [S.LANDING]: S.INTERIOR, [S.INTERIOR]: S.RETURN, [S.SURFACE]: S.INTERIOR,
};

export function inEditableField(el = globalThis.document?.activeElement) {
  return !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.isContentEditable);
}

function toast(text) {
  try {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);padding:6px 14px;background:rgba(0,0,0,.75);color:#fff;font:14px monospace;border-radius:4px;pointer-events:none';
    ui.mountPersistent(el, { layer: 'menu' });
    setTimeout(() => ui.unmount(el), 1000);
  } catch { /* the toast is optional */ }
}

/** Returns true when the key press was taken by the skip (modules must not see it). */
export function handleSkipKey(event) {
  try {
    if (event.code !== 'Enter' || event.repeat) return false;
    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false;
    if (inEditableField()) return false;
    const next = SKIP_NEXT[getState()];
    if (!next) return false;
    if (requestState(next)) toast(`Skipped → ${next}`);
    return true;
  } catch (error) {
    console.error('[skip] failed:', error);
    return true;
  }
}

export function startSkip() {
  if (new URLSearchParams(location.search).get('debug') !== '1') return;
  input.setKeyInterceptor(handleSkipKey);
}
