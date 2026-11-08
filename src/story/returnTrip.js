// RETURN (spec §6.3 step 7): an automatic cinematic home. Mars liftoff → cruise → Earth entry → splashdown, with
// captions and Halcyon-1's final log, then the Homecoming ending. Enter skips.
import { cinematic, graphics } from '/src/graphics/index.js';
import { contract, economy, events, getShip, input, requestState, ui } from '/src/core/index.js';
import data from './data.json';
import { button, el, wait } from './dom.js';
import { SILENT_RETURN_CAPTION, choiceFromKey, failureForChoice, tributeFor } from './tributeFlow.js';
import { playLastDescent, showClosingCard, useLastDescent } from './lastDescent.js';
import { radio } from './radio.js';
import { showTribute } from './tribute.js';
import tributes from './tributes.json';
import { showView } from './views.js';

const inDemo = () => !!window.__demo?.active;

// Camera moves per backdrop, in the view's own coordinates (the planet sits below and ahead).
const PATHS = {
  mars: [
    { position: [0, -0.02, 0.2], lookAt: [0, -0.35, -1] },
    { position: [0, 0.05, 0], lookAt: [0.2, -0.15, -1] },
    { position: [0.1, 0.12, -0.1], lookAt: [0.5, 0.05, -1] },
  ],
  none: [
    { position: [3.5, 1.2, 5.5], lookAt: [0, 0.9, 0] },
    { position: [-2.5, 1.8, 6], lookAt: [0, 0.9, 0] },
    { position: [-5, 1.0, 3], lookAt: [0, 0.9, 0] },
  ],
  earth: [
    { position: [0, 0.08, 0], lookAt: [0.1, -0.3, -1] },
    { position: [0, -0.02, -0.1], lookAt: [0, -0.5, -1] },
    { position: [0, -0.06, -0.15], lookAt: [-0.1, -0.7, -1] },
  ],
};

export const LAST_DESCENT_CAUSE = 'The main parachute never left its container and the reserve tangled with the drogue; the parachute had never been proven.';

/**
 * Reconstruction, then the memorial for soyuz1 (when tributes.json has it), then the closing card, then onDone().
 * The memorial is shown here, so the ending flow must not repeat it (the lastDescent failure carries no history lesson).
 */
export function playLastDescentFlow({ onDone = () => {}, withTribute = true } = {}) {
  const stops = [];
  stops.push(playLastDescent({
    onDone: () => {
      const showScroll = inDemo() ? window.__demo?.showMemorialScroll : null; // set by the pitch demo (src/flight/demo)
      if (typeof showScroll === 'function') { // pitch demo: the memorial scroll replaces the tribute page and closing card; no ending
        stops.push(showScroll());
        return;
      }
      if (!withTribute) return onDone();
      const tribute = tributeFor(tributes, 'soyuz1');
      const closing = () => stops.push(showClosingCard({ onDone }));
      if (tribute) stops.push(showTribute(tribute, { onDone: closing }));
      else closing();
    },
  }));
  return () => stops.forEach((f) => f());
}

export function showReturn() {
  let alive = true;
  // Decided once: the player overrode the unproven-parachute warning (needs the contract names; otherwise the normal return).
  const unproven = useLastDescent({ contract, ship: getShip() });
  let stopDescent = null;
  const root = el('div', 'role4-screen');
  root.dataset.screen = 'RETURN';
  root.style.pointerEvents = 'none';
  const caption = el('div', 'hud role4-caption');
  const skip = el('div', 'role4-skip');
  root.append(caption, skip);
  ui.mount(root);
  root.style.pointerEvents = 'none';

  let choosing = false; // the Silent Return choice cannot be skipped with Enter
  let doomed = false; // the player skipped the suits: the entry segment ends in the Silent Return ending
  const finish = () => {
    if (!alive || choosing) return;
    if (doomed) return fail();
    alive = false;
    cinematic.stop();
    economy.reward(economy.balance.homecomingBonus, 'homecoming');
    events.emit('ending:show', { endingId: contract.ENDINGS.homecoming, cause: '', cost: 0, historyLessonId: null });
    requestState('ENDING');
  };
  // Through the same path as any other failure: story's flight:failed handler charges the cost and shows the ending.
  const fail = () => {
    if (!alive) return;
    alive = false;
    cinematic.stop();
    events.emit('flight:failed', failureForChoice('skip'));
  };
  const choose = () => {
    choosing = true;
    return new Promise((resolve) => {
      const done = showSilentReturnChoice((c) => { choosing = false; resolve(c); });
      const stop = setInterval(() => { if (!alive) { clearInterval(stop); done(); } }, 500);
    });
  };
  skip.append(button('Skip', finish, { key: 'Enter' }));

  (async () => {
    for (let shot of data.returnTrip) {
      if (!alive) return;
      if (shot.choice === 'suitUp' && !inDemo() && (await choose()) === 'skip') { doomed = true; shot = { ...shot, caption: SILENT_RETURN_CAPTION }; }
      if (!alive) return;
      const view = showView(shot.planet === 'none' ? 'space' : shot.planet);
      if (shot.planet === 'none') {
        view.capsule.rotation.set(0, 0, 0);
        view.capsule.position.set(0, 0, 0);
      }
      caption.style.opacity = '0';
      caption.textContent = shot.caption;
      if (shot.showFinalLog) radio({ kind: 'log', ...data.logs.final });
      const path = PATHS[shot.planet];
      const duration = inDemo() && shot.planet !== 'earth' ? Math.min(shot.duration, 3.5) : shot.duration;
      const playing = cinematic.play({
        camera: view.camera,
        cameraPath: path,
        duration,
        fades: [{ at: 0, to: 0, duration: 0.8 }, { at: Math.max(0, duration - 0.8), to: 1, duration: 0.8 }],
      });
      await wait(400);
      if (alive) caption.style.opacity = '1';
      await playing;
      if (doomed) return fail();
      if (unproven && shot.choice === 'suitUp') {
        choosing = true; // Enter must not skip the reconstruction
        stopDescent = playLastDescentFlow({
          onDone: () => {
            if (!alive) return;
            alive = false;
            events.emit('flight:failed', { endingId: contract.ENDINGS.lastDescent, cause: LAST_DESCENT_CAUSE });
          },
        });
        return;
      }
    }
    graphics.fade({ to: 0, duration: 0.6 });
    finish();
  })();

  return () => {
    alive = false;
    stopDescent?.();
    cinematic.stop();
    graphics.fade({ to: 0, duration: 0.3 });
  };
}

/**
 * The choice card before Earth entry. Needs a click on a button, or key 1 / 2 (Enter and Space do nothing).
 * onChoose('suitUp' | 'skip') is called once. Returns dispose().
 */
export function showSilentReturnChoice(onChoose = () => {}) {
  const C = data.returnChoice;
  const root = el('div', 'role4-screen');
  root.dataset.screen = 'RETURN';
  root.style.pointerEvents = 'none';
  const card = el('div', 'hud hud-panel role4-card role4-choice');
  card.dataset.block = 'silent-return-choice';
  card.append(el('div', 'hud-label', 'Entry preparation'), el('div', 'role4-text', C.prompt));
  const row = el('div', 'role4-row');
  let done = false;
  const pick = (c) => {
    if (done) return;
    done = true;
    off.forEach((f) => f?.());
    ui.unmount(root);
    onChoose(c);
  };
  const off = [];
  row.append(button(C.suitUp, () => pick('suitUp'), { primary: true }), button(C.skip, () => pick('skip')));
  for (const code of ['Digit1', 'Numpad1', 'Digit2', 'Numpad2']) off.push(input.onPress(code, () => pick(choiceFromKey(code))));
  row.firstChild.textContent = `${C.suitUp} [1]`;
  row.lastChild.textContent = `${C.skip} [2]`;
  card.append(row);
  root.append(card);
  ui.mount(root);
  return () => { done = true; off.forEach((f) => f?.()); if (root.isConnected) ui.unmount(root); };
}
