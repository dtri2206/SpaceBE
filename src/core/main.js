// Boot and THE single game loop. Nobody else calls requestAnimationFrame or graphics.render.
import { graphics, assets } from '/src/graphics/index.js';
import { audio } from '/src/audio/index.js';
import { initAudioDirector } from '/src/audio/director.js';
import builder from '/src/builder/index.js';
import flight from '/src/flight/index.js';
import surface from '/src/surface/index.js';
import cruise from '/src/cruise/index.js';
import story from '/src/story/index.js';
import missions from '/src/missions/index.js';
import guidebook from '/src/guidebook/index.js';
import report from '/src/report/index.js';
import { STATES, STATE_OWNERS } from './contract.js';
import * as events from './events.js';
import { getState, requestState, debugJump } from './state.js';
import { input } from './input.js';
import { ui } from './ui.js';
import { save } from './save.js';

const modules = { builder, flight, surface, cruise, story, missions, guidebook, report };

// Called through the module, so `this` works inside a role's enter, update and exit.
function call(label, module, method, ...args) {
  try {
    return module?.[method]?.(...args);
  } catch (error) {
    console.error(`[main] ${label} threw:`, error);
  }
}

function ownerOf(state) {
  return modules[STATE_OWNERS[state]];
}

window.__game = { events, getState, requestState, debugJump, frames: 0 };

events.on('state:changed', ({ from, to, data }) => {
  call(`${STATE_OWNERS[from]}.exit(${from})`, ownerOf(from), 'exit', from);
  input.clear();
  ui.clear();
  call(`${STATE_OWNERS[to]}.enter(${to})`, ownerOf(to), 'enter', to, data);
});

function loop() {
  let last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const state = getState();
    call(`${STATE_OWNERS[state]}.update`, ownerOf(state), 'update', dt, state);
    call('graphics.render', graphics, 'render', dt);
    window.__game.frames += 1;
  };
  requestAnimationFrame(frame);
}

async function boot() {
  const params = new URLSearchParams(location.search);
  graphics.init({ container: document.getElementById('stage'), quality: save.load().quality ?? 'high' });
  try {
    await assets.preload?.(['planet:earth', 'planet:mars']);
  } catch (error) {
    console.error('[main] asset preload failed:', error);
  }
  for (const [name, module] of Object.entries(modules)) call(`${name}.init`, module, 'init');
  initAudioDirector();

  call(`${STATE_OWNERS.MENU}.enter(MENU)`, ownerOf(STATES.MENU), 'enter', STATES.MENU);
  if (params.get('debug') === '1') {
    const { startDebug } = await import('./debug.js');
    window.__game.audio = audio; // lets tests read audio.playing()
    window.__game.graphics = graphics; // and graphics.pixelRatioNow
    startDebug();
    const wanted = params.get('state');
    if (wanted && wanted !== STATES.MENU) debugJump(wanted);
  }
  loop();
}

boot().catch((error) => console.error('[main] boot failed:', error));
