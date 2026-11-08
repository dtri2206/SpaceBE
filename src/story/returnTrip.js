// RETURN (spec §6.3 step 7): an automatic cinematic home. Mars liftoff → cruise → Earth entry → splashdown, with
// captions and Halcyon-1's final log, then the Homecoming ending. Enter skips.
import { cinematic, graphics } from '/src/graphics/index.js';
import { contract, economy, events, requestState, ui } from '/src/core/index.js';
import data from './data.json';
import { button, el, wait } from './dom.js';
import { radio } from './radio.js';
import { showView } from './views.js';

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

export function showReturn() {
  let alive = true;
  const root = el('div', 'role4-screen');
  root.dataset.screen = 'RETURN';
  root.style.pointerEvents = 'none';
  const caption = el('div', 'hud role4-caption');
  const skip = el('div', 'role4-skip');
  root.append(caption, skip);
  ui.mount(root);
  root.style.pointerEvents = 'none';

  const finish = () => {
    if (!alive) return;
    alive = false;
    cinematic.stop();
    economy.reward(economy.balance.homecomingBonus, 'homecoming');
    events.emit('ending:show', { endingId: contract.ENDINGS.homecoming, cause: '', cost: 0, historyLessonId: null });
    requestState('ENDING');
  };
  skip.append(button('Skip', finish, { key: 'Enter' }));

  (async () => {
    for (const shot of data.returnTrip) {
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
      const playing = cinematic.play({
        camera: view.camera,
        cameraPath: path,
        duration: shot.duration,
        fades: [{ at: 0, to: 0, duration: 0.8 }, { at: Math.max(0, shot.duration - 0.8), to: 1, duration: 0.8 }],
      });
      await wait(400);
      if (alive) caption.style.opacity = '1';
      await playing;
    }
    graphics.fade({ to: 0, duration: 0.6 });
    finish();
  })();

  return () => {
    alive = false;
    cinematic.stop();
    graphics.fade({ to: 0, duration: 0.3 });
  };
}
