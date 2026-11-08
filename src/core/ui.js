// All screens go into #ui through here. Layer order (z-index): HUD 10, menus 20.
// Role 3's own overlays sit above: blackout 29, fade 30. Do not use 29 or higher.
const mounted = new Set();
const persistent = new Set();

function place(element, layer) {
  // Clickable by default, but keep an explicit inline pointer-events (a full-screen HUD layer sets 'none' so it
  // never blocks buttons underneath).
  if (!element.style.pointerEvents) element.style.pointerEvents = 'auto';
  element.style.zIndex = layer === 'hud' ? '10' : '20';
  (document.getElementById('ui') ?? document.body).append(element);
  return element;
}

export const ui = {
  /** Add an element to #ui. It is removed automatically on the next state change. layer: 'menu' (20, default) or 'hud' (10). */
  mount(element, { layer = 'menu' } = {}) {
    mounted.add(element);
    return place(element, layer);
  },
  /** Like mount, but stays across state changes (guidebook, settings). Remove it yourself with ui.unmount. */
  mountPersistent(element, { layer = 'menu' } = {}) {
    persistent.add(element);
    return place(element, layer);
  },
  unmount(element) {
    mounted.delete(element);
    persistent.delete(element);
    element.remove();
  },
  /** Used by main.js on every state change. Persistent elements stay. */
  clear() {
    for (const element of mounted) element.remove();
    mounted.clear();
  },
};
