// Pad-fire screen effect: one bright flash, then a fade to black over `seconds`. Nothing graphic.
export function createFireFlash({ parent }) {
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:#fff;opacity:0;z-index:50';
  parent.append(el);
  return {
    root: el,
    start(seconds = 2) {
      el.style.transition = 'none';
      el.style.background = '#fff4e0';
      el.style.opacity = '0.95';
      void el.offsetWidth; // commit the flash before the fade starts
      el.style.transition = `background ${seconds * 0.5}s ease-in, opacity ${seconds * 0.5}s ease-in`;
      el.style.background = '#000';
      el.style.opacity = '1';
    },
    dispose() { el.remove(); },
  };
}
