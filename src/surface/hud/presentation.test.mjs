import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSuitHUD } from './createSuitHUD.js';
import { createFlightHUD } from '../../flight/hud/createFlightHUD.js';
import { createOxygen } from '../oxygen.js';
import { FlightController } from '../../flight/FlightController.js';
import { assistReadout } from '../../flight/flightAssist.js';
import { MOCK_SHIPS } from '../../flight/presets.js';
import { PLANETS as MOCK_PLANETS, G0 } from '../../core/planets.js';

// Minimal DOM fixture tests state decisions and teardown. Browser layout/WebGL is separate.
class Element {
  constructor() {
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.selectors = new Map();
    this.textContent = '';
  }
  set innerHTML(html) {
    this.html = html;
    this.fields = [...html.matchAll(/data-id="([^"]+)"/g)].map(match => {
      const element = new Element();
      element.dataset.id = match[1];
      this.selectors.set(`[data-id="${match[1]}"]`, element);
      return element;
    });
  }
  querySelectorAll() { return this.fields; }
  querySelector(selector) {
    if (!this.selectors.has(selector)) this.selectors.set(selector, new Element());
    return this.selectors.get(selector);
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  remove() { this.removed = true; }
}
const previousDocument = globalThis.document;
globalThis.document = { createElement: () => new Element(), body: new Element() };
const field = (hud, name) => hud.root.querySelector(`[data-id="${name}"]`);
const suitState = oxygen => ({
  telemetry: { pos: { x: 0, z: 8 }, speed: 0, heartRate: 72, gravity: 3.71, onGround: true },
  oxygen,
  suited: true,
  inside: false,
  focused: null,
  yaw: 0,
  shipPosition: { x: 0, z: 0 },
});

try {
  await test('orbit card remains orbital during a slight descent; collision warning survives assist off', () => {
    const fc = new FlightController({ g0: G0, planets: MOCK_PLANETS, shipSpec: MOCK_SHIPS.reliable });
    const telemetry = { ...fc.telemetry, phase: 'orbit', verticalSpeed: -0.01, ignitionsLeft: 2, armorLeft: 1 };
    const assist = assistReadout(fc);
    const hud = createFlightHUD();
    hud.update(telemetry, assist, true);
    assert.equal(hud.root.querySelector('.formula').children[0].textContent, assist.cards.orbit.formula);
    hud.update({ ...telemetry, collisionWarning: { timeToClosest: 4.25 } }, assist, false);
    assert.equal(hud.root.querySelector('.formula').children.length, 0);
    assert.match(hud.root.querySelector('.warnings').children.at(-1).textContent, /COLLISION 4.3 s/);
    assert.match(field(hud, 'engineState').textContent, /ARMOR 1 · IGNITIONS 2/);
    hud.dispose();
    assert.equal(hud.root.removed, true);
  });

  await test('real O₂ thresholds show caution/warning/critical and cabin clears the danger vignette', () => {
    const oxygen = createOxygen();
    const hud = createSuitHUD({ reducedMotion: true });
    const state = suitState(oxygen);
    for (const [percent, level] of [[25, 'caution'], [10, 'warning'], [3, 'critical']]) {
      oxygen.refill();
      oxygen.update(300 * (1 - percent / 100));
      hud.update(0.05, state);
      assert.equal(hud.root.dataset.level, level);
      assert.match(field(hud, 'oxygen').textContent, new RegExp(`${percent}%`));
      assert.match(hud.root.querySelector('.warning').textContent, /OXYGEN/);
    }
    hud.update(0.05, { ...state, inside: true, suited: false });
    assert.equal(hud.root.dataset.level, 'ok');
    assert.equal(hud.root.querySelector('.shade').style.opacity, '0');
    assert.equal(hud.root.querySelector('.helmet').hidden, true);
    assert.match(hud.root.querySelector('.warning').textContent, /CABIN SUPPLY ACTIVE/);
    oxygen.update(1000);
    hud.update(0.05, state);
    assert.match(hud.root.querySelector('.warning').textContent, /MISSION ENDED/);
    hud.dispose();
    assert.equal(hud.root.removed, true);
  });

  await test('beacon is ship-relative; hold progress resets on lost focus; body readouts use supplied stats', () => {
    const hud = createSuitHUD();
    const state = suitState(createOxygen());
    state.shipPosition = { x: 10, z: 8 };
    state.focused = { prompt: 'Scan', holdProgress: 0.5 };
    state.bodyStats = { doseMSv: 2.125, peakG: 4.2 };
    hud.update(0.05, state);
    assert.match(hud.root.querySelector('.beacon').style.transform, /1.570796/);
    assert.equal(field(hud, 'distance').textContent, '10 m');
    assert.equal(hud.root.querySelector('progress').value, 0.5);
    assert.equal(field(hud, 'body').textContent, '2.125 mSv / 4.2 g');
    hud.update(0.05, { ...state, focused: null, yaw: -Math.PI / 2 });
    assert.equal(hud.root.querySelector('.beacon').style.transform, 'rotate(0rad)');
    assert.equal(hud.root.querySelector('progress').hidden, true);
    assert.equal(field(hud, 'prompt').textContent, '');
    hud.dispose();
  });
} finally {
  globalThis.document = previousDocument;
}
