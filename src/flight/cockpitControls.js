// Cockpit keys (TEAM_PROMPT §4 "Cockpit"), read through core's input (the only keyboard listener).
//
// The flight computer flies by default (autopilot.js). The player only has these keys:
//   F = toggle manual control any time (take / give back the stick) · Space / left mouse = lock (ascent window) or give back (free manual)
//   E (landed) = stand up. Esc (give the stick back) is registered by index.js with input.onEscape.
// No pitch / yaw / throttle / brake / cut-off keys any more: the stick values below are for the cockpit's
// animation only (cockpit.userData.setControls) and never feed the physics.
//
// const controls = createCockpitControls({ input, onManual, onLock, onStandUp, isLanded });
// input.onPress handlers are cleared by core on every state change; call dispose() anyway when leaving early.

export function createCockpitControls({ input, onManual, onLock, onStandUp, isLanded } = {}) {
  if (!input) throw new Error('createCockpitControls: pass core input');
  const offs = [
    input.onPress('KeyF', () => onManual?.()),
    input.onPress('Space', () => onLock?.()),
    input.onPress('Mouse0', () => onLock?.()), // core does not send it yet; harmless until it does
    input.onPress('KeyE', () => { if (isLanded?.()) onStandUp?.(); }),
  ];
  return { dispose() { offs.forEach((off) => off?.()); } };
}

// Cockpit stick/lever values for Role 3's cockpit.userData.setControls: pitch/yaw -1..1, throttle 0..1.
// `assist: true` now means MANUAL (the player holds the stick); brake is the button press-in visual only.
export function cockpitStickValues(input, throttle, { assist = false, cutoff = input?.cutoff } = {}) {
  const n = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
  const th = Number.isFinite(throttle) ? Math.max(0, Math.min(1, throttle)) : 0;
  return { pitch: n(input?.pitch), yaw: n(input?.yaw), throttle: th, cutoff: !!cutoff, brake: !!input?.brake, assist: !!assist };
}

// The guarded CUT-OFF animation needs a stable request, not a single physics-frame pulse.
// This is presentation state only; it never changes throttle or controller inputs.
export function createCockpitIndicators() {
  let cutoff = false;
  return {
    update(input, throttle, { assist = false, brakeBurn = false } = {}) {
      if (input?.cutoff) cutoff = true;
      else if (throttle > 0 || brakeBurn) cutoff = false;
      return cockpitStickValues(input, throttle, { assist, cutoff });
    },
  };
}
