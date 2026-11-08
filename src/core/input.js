// The ONLY code allowed to listen to the keyboard and mouse. Everyone else uses this.
// onPress handlers and the Esc handler are removed automatically on every state change (main.js calls clear()).
const down = new Set();
const pressHandlers = new Map(); // code -> Set<fn>
let escapeHandler = null;
let mouseX = 0;
let mouseY = 0;
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
  /** True while the key (a KeyboardEvent.code such as 'KeyW' or 'Space') is held. */
  isDown: (code) => down.has(code),
  /** Call fn when the key is pressed. Returns an off function. Removed automatically on state change. */
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
  if (!document.pointerLockElement && !selfRelease) runSafely(escapeHandler);
  selfRelease = false;
});

window.addEventListener('keyup', (event) => down.delete(event.code));
window.addEventListener('blur', () => down.clear());

window.addEventListener('mousemove', (event) => {
  if (!input.isLocked()) return;
  mouseX += event.movementX;
  mouseY += event.movementY;
});
