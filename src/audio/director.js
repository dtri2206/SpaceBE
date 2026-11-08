/**
 * Audio director: plays the mission's soundscape from events alone, so no other role has to call audio.
 * Owns only the ambience loops (ambience.*, suit.breath, radio.static), radio.chatter and alarm.o2.
 * Flight keeps engine.rumble, audio.setAir and its own alarms; ENDING stops everything (silence is an emotional beat).
 */
import { audio } from './index.js';
import { events, getState } from '/src/core/index.js';

const FADE = 1.5; // seconds for loops to come in or change level
const MANAGED = ['ambience.ship', 'ambience.mars', 'suit.breath', 'radio.static'];
const QUIET = { 'ambience.ship': 0.45 };
const FLIGHT = { 'ambience.ship': 1 };

// state -> loops that should be playing, with a volume (1 = the file's normal level)
const SCENES = {
  MENU: QUIET, HANGAR: QUIET, GONOGO: QUIET, REPORT: QUIET, PRELAUNCH: QUIET,
  LAUNCH: FLIGHT, ORBIT: FLIGHT, ENTRY: FLIGHT, LANDING: FLIGHT, RETURN: FLIGHT, INTERIOR: FLIGHT,
  CRUISE: { 'ambience.ship': 1, 'radio.static': 0.5 },
  SURFACE: { 'ambience.mars': 1, 'suit.breath': 1 },
  ENDING: {},
};

let started = false;
let state = null;
let breathRate = 1;
let o2Timer = null;
let o2Every = 0;
let o2Percent = 100;

function applyScene() {
  const wanted = SCENES[state] ?? {};
  const playing = audio.playing();
  for (const id of MANAGED) {
    if (!(id in wanted)) {
      audio.stop(id, { fade: FADE }); // also drops loops still queued before the first click
    } else if (playing.includes(id)) {
      audio.fadeTo(id, wanted[id], FADE);
    } else {
      audio.play(id, { loop: true, volume: wanted[id], fadeIn: FADE, rate: id === 'suit.breath' ? breathRate : 1 });
    }
  }
}

function setO2Timer(every) {
  if (every === o2Every) return;
  o2Every = every;
  clearInterval(o2Timer);
  o2Timer = null;
  if (!every) return;
  // no beep now: surface already plays one as O2 crosses 30/15/5 %, so this only repeats it
  o2Timer = setInterval(() => audio.play('alarm.o2'), every * 1000);
}

function setBreathRate(rate) {
  if (rate === breathRate) return;
  breathRate = rate;
  if (audio.playing().includes('suit.breath')) {
    audio.stop('suit.breath', { fade: 0.2 });
    audio.play('suit.breath', { loop: true, volume: SCENES.SURFACE['suit.breath'], fadeIn: 0.3, rate });
  }
}

function updateOxygen() {
  const suited = state === 'SURFACE'; // inside the ship the suit tank is not draining
  const p = o2Percent;
  setO2Timer(suited && p <= 15 ? 2 : suited && p <= 30 ? 6 : 0);
  setBreathRate(p <= 15 ? 1.35 : 1);
}

export function initAudioDirector() {
  if (started) return;
  started = true;

  events.on('state:changed', ({ to }) => {
    const from = state;
    state = to;
    if (to === 'ENDING') {
      setO2Timer(0);
      audio.stopAll({ fade: 0.8 });
      return;
    }
    applyScene();
    if (to === 'LAUNCH' && from !== 'LAUNCH') audio.play('radio.chatter');
    if (to !== 'SURFACE' && to !== 'INTERIOR') o2Percent = 100;
    updateOxygen();
  });

  events.on('eva:oxygen', ({ percent }) => {
    if (!Number.isFinite(percent) || state === 'ENDING') return;
    o2Percent = percent;
    updateOxygen();
  });

  state = getState();
  applyScene(); // the menu's quiet ambience starts at the first click

  // Fetch the sound files while the menu is up; never blocks boot, and a failed file falls back to its synth.
  Promise.resolve().then(() => audio.preload()).catch(() => {});
}
