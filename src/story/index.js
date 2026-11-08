// Role 4 story: owns PRELAUNCH, RETURN and ENDING (contract STATE_OWNERS), turns flight:failed into an ending,
// and tells the story on the radio: HQ, family messages, Halcyon-1's logs and the Pale Blue Dot moment.
// All text lives in data.json.
import { economy, events, getShip, getState, requestState, save } from '/src/core/index.js';
import data from './data.json';
import { fill } from './dom.js';
import { showEnding } from './ending.js';
import { showPrelaunch } from './prelaunch.js';
import { clearRadio, radio } from './radio.js';
import { showReturn } from './returnTrip.js';
import { showView } from './views.js';
import './story.css';

// Ending -> lesson from real history (spec §10.2). Flight also sends historyHint for the two MVP lessons.
const LESSONS = {
  coldMorning: 'challenger', theFoam: 'columbia', pureOxygen: 'apollo1', successfulFailure: 'apollo13',
  silentReturn: 'soyuz11', unitError: 'marsClimateOrbiter', falseTouchdown: 'marsPolarLander', spin: 'gemini8', beagle: 'beagle2',
};

let ending = { endingId: 'homecoming', cause: '', cost: 0, historyLessonId: null };
let dispose = null;
const once = new Set(); // radio lines already played this mission

const family = () => (data.photos.find((p) => p.id === save.load().familyPhoto) ?? data.photos[0]).from;

/** Play a radio line from data.json once per mission. */
function say(id) {
  if (once.has(id)) return;
  once.add(id);
  const line = data.radio[id];
  radio({ ...line, from: fill(line.from, { family: family() }) });
}

function listen() {
  events.on('ending:show', (payload) => {
    ending = payload;
  });

  // Any module may emit flight:failed. Story charges the penalty and shows the ending.
  events.on('flight:failed', ({ endingId, cause, historyHint }) => {
    if (getState() === 'ENDING') return;
    const cost = economy.chargeFailure(getShip().stats.cost);
    events.emit('ending:show', { endingId, cause, cost, historyLessonId: LESSONS[endingId] ?? historyHint ?? null });
    requestState('ENDING');
  });

  events.on('ship:built', () => once.clear());
  events.on('flight:landed', () => say('landed'));
  events.on('state:changed', ({ to }) => {
    if (to === 'PRELAUNCH') once.clear();
    if (to === 'SURFACE') {
      say('firstEva');
    }
    if (to === 'CRUISE') setTimeout(() => getState() === 'CRUISE' && say('family1'), 4000);
  });

  // Halcyon-1 logs: shown when recovered (missions emits story:log), uploaded at the comms console later.
  events.on('story:log', ({ logId }) => {
    const log = data.logs[logId];
    if (log) radio({ kind: 'log', ...log });
    say('logPickup');
  });

  events.on('task:completed', ({ taskId, category }) => {
    if (category === 'log') say('log');
    else if (category === 'discovery') say('discovery');
    else if (data.radio[category]) say(category);
    void taskId;
  });

  events.on('progress:changed', ({ percent }) => {
    if (percent >= 40) say('family2');
    // The Pale Blue Dot moment itself is Role 2's (dusk, Earth as the evening star, helmet zoom, caption).
  });
  events.on('mission:complete', () => say('complete'));
}

export default {
  init() {
    listen();
  },

  enter(state) {
    if (state === 'PRELAUNCH') {
      showView('earth');
      showPrelaunch();
    } else if (state === 'RETURN') {
      clearRadio();
      dispose = showReturn();
    } else {
      clearRadio(); // endings are quiet
      dispose = showEnding(ending);
    }
  },

  exit() {
    dispose?.();
    dispose = null;
  },
};
