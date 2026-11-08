// Role 2: full-screen black fade + bottom-centre caption, shared by both parts of the egress cinematic.
import { ui } from '/src/core/index.js';

export function createEgressOverlay({ fade = 0 } = {}) {
  const root = document.createElement('div');
  root.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:50';
  const black = document.createElement('div');
  black.style.cssText = `position:absolute;inset:0;background:#000;pointer-events:none;opacity:${fade}`;
  const cap = document.createElement('div');
  cap.style.cssText = 'position:absolute;left:50%;bottom:12%;transform:translateX(-50%);max-width:80%;text-align:center;color:#fff;'
    + 'font:18px/1.5 system-ui,sans-serif;text-shadow:0 1px 6px rgba(0,0,0,.9);opacity:0;transition:opacity .4s ease;pointer-events:none';
  root.append(black, cap);
  ui.mount(root, { layer: 'hud' });
  root.style.pointerEvents = 'none'; // ui.mount enables clicks
  let text = '';
  return {
    root,
    setFade(v) { black.style.opacity = String(Math.max(0, Math.min(1, v))); },
    setCaption(t) {
      const next = t || '';
      if (next === text) return;
      text = next;
      if (next) cap.textContent = next;
      cap.style.opacity = next ? '1' : '0';
    },
    dispose() { ui.unmount(root); root.remove(); },
  };
}
