// Debug panel, loaded with a dynamic import only when the URL has ?debug=1.
// ?debug=1&state=LANDING starts in that state (with the Reliable mock ship).
import GUI from 'lil-gui';
import { ENDINGS, EVENTS, STATES } from './contract.js';
import * as events from './events.js';
import { debugJump } from './state.js';
import { save } from './save.js';
import { setShip, getShip } from './ship.js';
import { economy } from './economy.js';
import reliable from './mocks/ship.reliable.json';
import coldMorning from './mocks/ship.coldMorning.json';
import thinSkin from './mocks/ship.thinSkin.json';

const PRESETS = { reliable, coldMorning, thinSkin };

// Example value for each payload key, so every event can be fired from the panel.
function examplePayload(name) {
  const examples = {
    to: 'HANGAR', from: 'MENU', shipSpec: getShip(), phase: 'launch', type: 'maxq', t: 10, touchdownSpeed: 2.5,
    endingId: 'burnup', cause: 'Debug event', stationId: 'airlock', percent: 50, taskId: 'scan1', category: 'scan',
    reward: 200000, logId: 'log1', money: economy.getMoney(), cost: 100000, historyLessonId: 'columbia',
    entryId: 'rocket-equation', partId: 'p1',
  };
  return Object.fromEntries(EVENTS[name].map((key) => [key, examples[key]]));
}

export function startDebug() {
  const gui = new GUI({ title: 'Debug (?debug=1)' });
  gui.domElement.style.zIndex = '40';
  // Starts collapsed (click the title to open) and sits in the bottom-right corner: the top-right holds game
  // buttons (e.g. the hangar's READINESS POLL) and the HUD text lines run along the bottom-left and centre.
  gui.close();
  gui.domElement.style.setProperty('width', '150px');
  Object.assign(gui.domElement.style, { position: 'fixed', top: 'auto', right: '0', bottom: '0', left: 'auto' });
  const model = {
    state: 'MENU',
    preset: 'reliable',
    money: economy.getMoney(),
    event: 'flight:event',
    ending: 'burnup',
  };

  gui.add(model, 'state', Object.keys(STATES)).name('state');
  gui.add({ jump: () => debugJump(model.state) }, 'jump').name('Jump to state');

  gui.add(model, 'preset', Object.keys(PRESETS));
  gui.add({ spawn: () => setShip(PRESETS[model.preset]) }, 'spawn').name('Use preset ship');

  gui.add(model, 'money');
  gui.add({ set: () => economy.debugSet(Number(model.money)) }, 'set').name('Set money');

  gui.add(model, 'event', Object.keys(EVENTS));
  gui.add({ fire: () => events.emit(model.event, examplePayload(model.event)) }, 'fire').name('Fire event');

  gui.add(model, 'ending', Object.keys(ENDINGS));
  gui.add({ trigger: () => events.emit('flight:failed', { endingId: model.ending, cause: 'Triggered from the debug panel' }) }, 'trigger').name('Trigger ending');

  // Graphics quality is read at boot, so a change takes effect after a reload.
  model.quality = save.load().quality ?? 'high';
  gui.add(model, 'quality', { 'Low': 'low', 'High': 'high' }).name('quality (reload)').onChange((quality) => save.update({ quality }));

  events.on('economy:changed', ({ money }) => {
    model.money = money;
    gui.controllers.forEach((controller) => controller.updateDisplay());
  });
  window.__game.debug = gui;
}
