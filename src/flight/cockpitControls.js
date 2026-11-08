// Cockpit keys → flight input (TEAM_PROMPT §4 "Cockpit"), read through core's input (the only keyboard listener).
//
//   W/S pitch nose down/up · A/D yaw left/right · Q/E throttle up/down · X cut-off
//   hold Space = brake (auto retrograde burn) · F = toggle Flight Assist · E (landed) = stand up
//
// const controls = createCockpitControls({ input, onToggleAssist, onStandUp, isLanded });
// each frame: controls.poll(); fc.update(dt, controls.input); controls.endFrame();
// input.onPress handlers are cleared by core on every state change; call dispose() anyway when leaving early.

export function createCockpitControls({ input, onToggleAssist, onStandUp, isLanded } = {}) {
  if (!input) throw new Error('createCockpitControls: pass core input');
  const state = { pitch: 0, yaw: 0, throttleUp: false, throttleDown: false, cutoff: false, brake: false };
  const offs = [
    input.onPress('KeyX', () => { state.cutoff = true; }), // consumed by the next physics frame
    input.onPress('KeyF', () => onToggleAssist?.()),
    input.onPress('KeyE', () => { if (isLanded?.()) onStandUp?.(); }),
  ];

  return {
    input: state,
    poll() {
      const k = input.isDown;
      state.pitch = (k('KeyS') ? 1 : 0) - (k('KeyW') ? 1 : 0); // W = nose down
      state.yaw = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
      state.throttleUp = k('KeyQ');
      state.throttleDown = k('KeyE') && !(isLanded?.() ?? false);
      state.brake = k('Space');
    },
    endFrame() { state.cutoff = false; },
    dispose() { offs.forEach((off) => off?.()); },
  };
}
