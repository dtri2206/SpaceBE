// The Last Descent: the pitch's climax. A reconstruction of Soyuz 1 (Vladimir Komarov, 24 April 1967), played when the
// return capsule's parachute was never proven. Only verified facts are shown; no altitudes, speeds or dialogue
// (his words were lost in noise). The cut to black happens before any ground contact, and nothing is shown after it.
// The pure schedule below has no imports, so Node can test it. DOM, audio and graphics are loaded inside the player.

export const BLACK_SILENCE_MS = 3000;
export const COINCIDENCE_MS = 4000;
export const CLOSING_GATE_MS = 3000;

/**
 * When each instrument change happens (ms from the start of the fall). `blackAt` is the hard cut to black,
 * `fallMs` the end of the fall, `totalMs` the end of the whole sequence (fall + black silence + the line).
 * With skipSensitive the fall ends right after "MAIN CHUTE · NO DEPLOY".
 */
export function lastDescentSchedule({ skipSensitive = false } = {}) {
  const steps = [
    { id: 'entry', at: 0, lamp: 'ENTRY INTERFACE', state: 'calm', shake: 0.08 },
    { id: 'attitude', at: 8000, lamp: 'ATTITUDE CONTROL · FAILURE-2', state: 'amber', caption: 'Attitude control lost: a steep, ballistic re-entry.', shake: 0.55 },
    { id: 'drogue', at: 14000, lamp: 'DROGUE CHUTE · OPEN', state: 'green', shake: 0.35 },
    { id: 'main', at: 19000, lamp: 'MAIN CHUTE · NO DEPLOY', state: 'red', alarm: true, shake: 0.5 },
  ];
  if (!skipSensitive) {
    steps.push(
      { id: 'reserve', at: 24000, lamp: 'RESERVE CHUTE · DEPLOYED', state: 'amber', shake: 0.5 },
      { id: 'tangled', at: 28000, lamp: 'RESERVE CHUTE · TANGLED', state: 'red', shake: 0.65 },
      { id: 'tilt', at: 31000, tilt: true, shake: 0.3 },
      { id: 'silence', at: 35000, silence: true, shake: 0 },
    );
  }
  const blackAt = skipSensitive ? 21500 : 36000;
  const fallMs = blackAt + 1000;
  return { steps, blackAt, fallMs, silenceMs: BLACK_SILENCE_MS, lineMs: COINCIDENCE_MS, totalMs: blackAt + BLACK_SILENCE_MS + COINCIDENCE_MS };
}

/** True when the unproven-parachute sequence should replace the normal splashdown. Needs every contract name. */
export function useLastDescent({ contract, ship, tributes } = {}) {
  return !!(contract?.WARNINGS?.includes?.('CHUTE_UNTESTED') && contract?.ENDINGS?.lastDescent && contract?.HISTORY_LESSONS?.soyuz1
    && (ship?.warnings ?? []).includes?.('CHUTE_UNTESTED') && (tributes === undefined || !!tributes));
}

// Camera: the capsule looks out over Earth, then tilts until the planet fills the view.
const DESCENT_PATH = [
  { position: [0, 0.08, 0], lookAt: [0.1, -0.3, -1] },
  { position: [0, 0, -0.05], lookAt: [0, -0.5, -1] },
  { position: [0, -0.04, -0.1], lookAt: [0, -0.9, -0.8] },
  { position: [0, -0.06, -0.15], lookAt: [0, -1, -0.15] },
];

/**
 * Plays the reconstruction. Calls onDone() after the black silence and the line. Returns dispose().
 * The caller owns showing the black screen afterwards; dispose() removes the overlay and resets the effects.
 */
export function playLastDescent({ onDone = () => {} } = {}) {
  let alive = true;
  const timers = [];
  let cleanup = () => {};
  (async () => {
    const [{ audio }, { cinematic, graphics }, { save, ui }, { el }, { showView }] = await Promise.all([
      import('/src/audio/index.js'), import('/src/graphics/index.js'), import('/src/core/index.js'), import('./dom.js'), import('./views.js'),
    ]);
    await import('./lastDescent.css');
    const { default: data } = await import('./data.json');
    if (!alive) return;
    const skipSensitive = !!save.load().skipSensitive;
    const sch = lastDescentSchedule({ skipSensitive });
    const at = (ms, fn) => timers.push(setTimeout(() => alive && fn(), ms));

    const root = el('div', 'role4-ld');
    root.dataset.screen = 'RETURN';
    root.dataset.block = 'last-descent';
    const panel = el('div', 'role4-ld-panel');
    const lamps = el('div', 'role4-ld-lamps');
    const gauge = el('div', 'role4-ld-gauge');
    const bar = el('div', 'role4-ld-bar');
    gauge.append(el('div', 'role4-ld-label', 'DESCENT'), bar);
    const caption = el('div', 'role4-ld-caption');
    panel.append(gauge, lamps);
    const black = el('div', 'role4-ld-black');
    const line = el('div', 'role4-ld-line', data.lastDescent.coincidence);
    root.append(panel, caption, black, line);
    ui.mount(root);

    cleanup = () => {
      cinematic.stop();
      try { graphics.setEffects({ shake: 0, blackout: 0 }); } catch { /* optional */ }
      if (root.isConnected) ui.unmount(root);
    };

    const view = showView('earth');
    const total = (sch.blackAt + 400) / 1000;
    cinematic.play({
      camera: view.camera,
      cameraPath: DESCENT_PATH,
      duration: total,
      fades: [{ at: 0, to: 0, duration: 0.8 }],
    });

    const lampEls = {};
    const light = (step) => {
      const key = step.id === 'tangled' ? 'reserve' : step.id;
      let lamp = lampEls[key];
      if (!lamp) { lamp = el('div', 'role4-ld-lamp'); lampEls[key] = lamp; lamps.append(lamp); }
      lamp.className = `role4-ld-lamp role4-ld-${step.state}`;
      lamp.textContent = step.lamp;
    };
    for (const step of sch.steps) {
      at(step.at, () => {
        if (step.lamp) light(step);
        if (step.caption) { caption.textContent = step.caption; caption.style.opacity = '1'; }
        if (step.alarm) { try { audio.play('alarm.master'); } catch { /* optional */ } }
        if (step.shake !== undefined) { try { graphics.setEffects({ shake: step.shake }); } catch { /* optional */ } }
        if (step.tilt) root.classList.add('role4-ld-tilt');
        if (step.silence) { try { audio.stopAll(); } catch { /* optional */ } }
      });
    }
    // A falling bar (relative, no numbers): a linear CSS transition from full to nearly empty.
    bar.style.transition = `height ${sch.blackAt}ms linear`;
    at(50, () => { bar.style.height = '3%'; });

    // The hard cut: black first, nothing after it but silence.
    at(sch.blackAt, () => {
      try { audio.stopAll(); } catch { /* optional */ }
      try { graphics.setEffects({ shake: 0, blackout: 1 }); } catch { /* optional */ }
      root.classList.add('role4-ld-cut');
      panel.remove();
      caption.remove();
    });
    if (window.__demo?.active) {
      // Pitch demo: after the black cut, no coincidence card; the memorial scroll takes over.
      at(sch.blackAt + 1500, onDone);
    } else {
      at(sch.blackAt + sch.silenceMs, () => line.classList.add('role4-ld-show'));
      at(sch.totalMs, onDone);
    }
  })();

  return () => {
    alive = false;
    timers.forEach(clearTimeout);
    cleanup();
  };
}

/**
 * The closing card on black, only for this ending. Continue appears after 3 s and waits for a press (no auto-advance).
 * Returns dispose().
 */
export function showClosingCard({ onDone = () => {} } = {}) {
  let alive = true;
  let timer = null;
  let root = null;
  (async () => {
    const [{ ui }, { el, button }] = await Promise.all([import('/src/core/index.js'), import('./dom.js')]);
    await import('./lastDescent.css');
    const { default: data } = await import('./data.json');
    if (!alive) return;
    root = el('div', 'role4-ld role4-ld-cut role4-ld-closing');
    root.dataset.block = 'last-descent-closing';
    const text = el('div', 'role4-ld-line role4-ld-show', data.lastDescent.closing);
    const actions = el('div', 'role4-ld-actions');
    root.append(text, actions);
    ui.mount(root);
    timer = setTimeout(() => {
      if (!alive) return;
      actions.append(button('Continue', () => { if (alive) { alive = false; root.remove(); onDone(); } }, { key: 'Enter', primary: true }));
    }, CLOSING_GATE_MS);
  })();
  return () => { alive = false; clearTimeout(timer); root?.remove(); };
}
