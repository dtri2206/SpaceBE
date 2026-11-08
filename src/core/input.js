// The ONLY code allowed to listen to the keyboard and mouse. Everyone else uses this.
// onPress handlers and the Esc handler are removed automatically on every state change (main.js calls clear()).
const down = new Set();
const pressHandlers = new Map(); // code -> Set<fn>
let escapeHandler = null;
let mouseX = 0;
let mouseY = 0;
let wheelY = 0;
let selfRelease = false; // we released the pointer ourselves, so it wasn't the player pressing Esc

function typingInField() {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function runSafely(fn) {
  try {
    fn?.();
  } catch (error) {
    console.error('[input] handler threw:', error);
  }
}

export const input = {
  /** True while the key (a KeyboardEvent.code such as 'KeyW' or 'Space') is held. Mouse buttons count as keys while the pointer is locked: 'Mouse0' left, 'Mouse1' middle, 'Mouse2' right. */
  isDown: (code) => down.has(code),
  /** Call fn when the key (or 'Mouse0'/'Mouse1'/'Mouse2', pointer locked only) is pressed. Returns an off function. Removed automatically on state change. */
  onPress(code, fn) {
    if (!pressHandlers.has(code)) pressHandlers.set(code, new Set());
    pressHandlers.get(code).add(fn);
    return () => pressHandlers.get(code)?.delete(fn);
  },
  /** Called when Esc is pressed in the current state. Esc itself always releases pointer lock. */
  onEscape(fn) {
    escapeHandler = fn;
  },
  /** Mouse movement in pixels since the last call (only while the pointer is locked). */
  mouseDelta() {
    const delta = { x: mouseX, y: mouseY };
    mouseX = 0;
    mouseY = 0;
    return delta;
  },
  /** Mouse wheel deltaY in pixels (lines x16, pages x window height) summed since the last call; resets like mouseDelta(). Positive = wheel down. */
  wheelDelta() {
    const delta = wheelY;
    wheelY = 0;
    return delta;
  },
  lockPointer() {
    try {
      const result = document.body.requestPointerLock?.();
      result?.catch?.(() => {});
    } catch { /* pointer lock can be refused; ignore */ }
  },
  unlockPointer() {
    try {
      if (document.pointerLockElement) {
        selfRelease = true;
        document.exitPointerLock();
      }
    } catch { /* ignore */ }
  },
  isLocked: () => !!document.pointerLockElement,
  /** Used by main.js on every state change. */
  clear() {
    pressHandlers.clear();
    escapeHandler = null;
    down.clear();
    mouseX = 0;
    mouseY = 0;
    wheelY = 0;
  },
};

window.addEventListener('keydown', (event) => {
  if (typingInField()) return; // typing in a text field must never trigger game keys
  if (event.code === 'Tab' || event.code === 'Space') event.preventDefault();
  if (event.repeat) return;
  down.add(event.code);
  if (event.code === 'Escape') {
    input.unlockPointer();
    runSafely(escapeHandler);
  }
  for (const fn of [...(pressHandlers.get(event.code) ?? [])]) runSafely(fn);
});

// While the pointer is locked, browsers can use Esc to release it without sending keydown, so losing the lock counts as Esc.
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement) releaseMouseButtons();
  if (!document.pointerLockElement && !selfRelease) runSafely(escapeHandler);
  selfRelease = false;
});

// Mouse buttons act as key codes 'Mouse0' (left), 'Mouse1' (middle), 'Mouse2' (right), only while the pointer is locked,
// so the click that locks the pointer is never counted. Held buttons are released when the lock is lost or the window blurs.
function releaseMouseButtons() {
  for (const code of [...down]) if (code.startsWith('Mouse')) down.delete(code);
}
window.addEventListener('mousedown', (event) => {
  if (!input.isLocked()) return;
  const code = `Mouse${event.button}`;
  if (down.has(code)) return;
  down.add(code);
  for (const fn of [...(pressHandlers.get(code) ?? [])]) runSafely(fn);
});
window.addEventListener('mouseup', (event) => down.delete(`Mouse${event.button}`)); // always, so a button can never stick
window.addEventListener('contextmenu', (event) => { if (input.isLocked()) event.preventDefault(); });

window.addEventListener('keyup', (event) => down.delete(event.code));
window.addEventListener('blur', () => down.clear()); // also releases Mouse buttons

window.addEventListener('mousemove', (event) => {
  if (!input.isLocked()) return;
  mouseX += event.movementX;
  mouseY += event.movementY;
});

// True when something between the event target and the game root can scroll itself (Guidebook, report, ...).
function insideScrollable(target) {
  for (let el = target; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (el.tagName === 'CANVAS') return false;
    const style = getComputedStyle(el);
    const scrolls = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1;
    if (scrolls) return true;
  }
  return false;
}

// Non-passive so we can stop the page scrolling while the player zooms; scrollable HTML panels keep their own wheel.
window.addEventListener('wheel', (event) => {
  if (typingInField()) return;
  if (insideScrollable(event.target)) return;
  const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
  wheelY += event.deltaY * scale;
  event.preventDefault();
}, { passive: false });
