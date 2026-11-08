// Main menu (state MENU): title, funds, the content warning on first launch, settings and the Guidebook.
// Earth from Role 3 turns slowly behind the card.
import * as THREE from 'three';
import { assets, createSpaceScene, graphics } from '/src/graphics/index.js';
import { audio } from '/src/audio/index.js';
import { PLANETS, contract, economy, events, input, requestState, save, ui } from '/src/core/index.js';
import { openSettings } from './settings.js';
import { fmtMoney } from './format.js';

const ENDING_NAMES = {
  adrift: 'Adrift: the last message', rud: 'Rapid unscheduled disassembly', burnup: 'Burn-up', outOfBreath: 'Out of breath', bankrupt: 'Bankrupt',
  homecoming: 'Homecoming', coldMorning: 'Cold Morning', theFoam: 'The Foam', pureOxygen: 'Pure Oxygen', successfulFailure: 'Successful Failure',
  silentReturn: 'Silent Return', unitError: 'Unit Error', falseTouchdown: 'False Touchdown', spin: 'Spin', beagle: 'Beagle',
};

let scene = null;
let earth = null;
let ready = false;

const h = (tag, className, textContent) => Object.assign(document.createElement(tag), { className: className ?? '', textContent: textContent ?? '' });
const button = (label, onClick, extra = '') => {
  const b = h('button', `hud-button menu-button ${extra}`, label);
  b.type = 'button';
  b.addEventListener('click', () => { audio.play('ui.click'); onClick(); });
  return b;
};

function buildScene() {
  scene = createSpaceScene();
  earth = assets.get('planet:earth');
  earth.scale.setScalar(PLANETS.earth.radius);
  earth.position.set(0.35, -0.72, -0.9).normalize().multiplyScalar(PLANETS.earth.radius + 560e3);
  scene.add(earth);
  graphics.setSunDirection(new THREE.Vector3(0.86, 0.36, -0.36));
}

function start() {
  if (!ready) return;
  ready = false;
  requestState(contract.STATES.HANGAR);
}

function showWarning(root, onDone) {
  const backdrop = h('div', 'menu-warning-backdrop');
  const box = h('div', 'menu-warning hud-panel hud-caution');
  const skip = h('input');
  skip.type = 'checkbox';
  skip.checked = !!save.load().skipSensitive;
  skip.addEventListener('change', () => save.update({ skipSensitive: skip.checked }));
  const skipRow = h('label', 'menu-warning-row');
  skipRow.append(skip, h('span', '', 'Skip sensitive scenes (the ending then simply runs out of air)'));
  const ok = button('I UNDERSTAND', () => {
    save.update({ warningSeen: true });
    backdrop.remove();
    onDone();
  });
  box.append(
    h('div', 'hud-label', 'Content warning'),
    h('p', 'menu-warning-text', 'This game shows spaceflight accidents, including real ones in which real astronauts died. One ending implies that a stranded astronaut chooses to end their life; nothing is shown and it is never framed as relief.'),
    skipRow,
    h('p', 'menu-warning-help', 'If you or someone you know is struggling, help is available: findahelpline.com'),
    ok,
  );
  backdrop.append(box);
  root.append(backdrop);
  return backdrop;
}

export const menu = {
  enter() {
    if (!scene) buildScene();
    graphics.camera.position.set(0, 0, 0);
    graphics.camera.lookAt(0.12, -0.3, -1);
    graphics.setView(scene, graphics.camera);

    const s = save.load();
    const root = h('div', 'menu-root hud');
    root.dataset.screen = 'menu';
    const card = h('div', 'menu-card');
    const title = h('h1', 'menu-title hud-flicker', contract.GAME_TITLE);
    const tagline = h('div', 'menu-tagline', `A ${fmtMoney(economy.balance.startMoney)} agency. One rookie. Mars.`);
    const stats = h('div', 'menu-stats');
    const funds = h('div', 'menu-stat');
    funds.append(h('span', 'hud-label', 'Funds'), h('span', 'hud-value', fmtMoney(economy.getMoney())));
    stats.append(funds);
    if (s.lastEnding) {
      const last = h('div', 'menu-stat');
      last.append(h('span', 'hud-label', 'Last mission'), h('span', 'menu-stat-text', ENDING_NAMES[s.lastEnding] ?? s.lastEnding));
      stats.append(last);
    }
    const esc = () => openSettings({ onClose: () => input.onEscape(esc) });
    const buttons = h('div', 'menu-buttons');
    buttons.append(
      button('START  [Enter]', start, 'menu-button--primary'),
      button('SETTINGS', () => openSettings({ onClose: () => input.onEscape(esc) })),
      button('GUIDEBOOK', () => events.emit('guidebook:open', { entryId: 'newtons-laws' })),
    );
    const credits = h('div', 'menu-credits', 'Built in 48 hours by four people. Earth and Mars imagery: NASA, Solar System Scope. Science checked against NASA and ESA.');
    card.append(h('div', 'menu-kicker', 'Mission control · 2041'), title, tagline, stats, buttons, credits);
    root.append(card, h('div', 'menu-scanlines'));
    ui.mount(root);

    ready = !!s.warningSeen;
    let warning = null;
    if (!ready) warning = showWarning(root, () => { ready = true; });
    input.onPress('Enter', () => {
      if (warning && warning.isConnected) { warning.querySelector('button')?.click(); return; }
      start();
    });
    input.onEscape(esc);
  },

  update(dt) {
    if (earth?.userData.surface) earth.userData.surface.rotation.y += dt * 0.012;
  },

  exit() {
    ready = false;
  },
};
