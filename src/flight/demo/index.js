// The pitch demo: hold C + R + 7 for a second on any screen and the game plays the 3-minute pitch (see director.js for
// the beats). Imported by src/flight/index.js. Nothing here runs unless the trigger is held, so the game behaves as before:
// no window.__demo, no key handlers, no per-frame work (driver.js only checks the three keys on a 50 ms timer).
//   window.__demo = { active, beat, onFirstHumansDone, cue, showMemorialScroll }   read by src/story, src/surface and
//   src/flight (cue: audio.js; showMemorialScroll: src/story/returnTrip.js)
import './demo.css';
import { events, getState, getShip, requestState, economy, input, save, setShip } from '/src/core/index.js';
import { graphics } from '/src/graphics/index.js';
import builder from '/src/builder/index.js';
import { BEAT, BEATS, HOLD_CODES, HOLD_MS, createDirector, createHoldTrigger, landingExit } from './director.js';
import { createFrameDriver, startPolling, withDemoWarnings } from './driver.js';
import { isReturnHomeActive, playReturnHome, stopReturnHome, updateReturnHome } from './returnHome.js';
import { showMemorialScroll } from './scroll.js';
import { cue as audioCue, resumeDemoAudio, startDemoAudio, stopAll } from './audio.js'; // voices, sfx and music (ElevenLabs); flight/surface reach cue() through window.__demo.cue
import apolloPreset from './apolloPreset.json'; // copy of src/builder/data/presets/apollo.json, only used when the builder has no demoLoadPreset

const debugJump = (to, data) => window.__game.debugJump(to, data); // core's state jump, without the demo-only deep import
const AUTOSTART_KEY = 'sbe-demo-autostart';
const FLIGHT_STATES = ['ENTRY', 'LANDING'];

let used = false; // the demo has run in this page
let pendingStart = false;
let firstHumansDone = false;
let state = 'MENU';
let stateTime = 0;
let landedFor = 0;
let probeT = 0;
let nStateFor = null;
let returnPhase = null;
let timers = [];
const hold = createHoldTrigger({ holdMs: HOLD_MS });

let flightStatus = () => null; // set by src/flight/index.js (setFlightStatus)

/** src/flight/index.js hands the demo a read-only view of the flight (state, phase0, landed, chute, ...). */
export function setFlightStatus(fn) { if (typeof fn === 'function') flightStatus = fn; }

const later = (ms, fn) => timers.push(setTimeout(fn, ms));
const safe = (label, fn) => { try { return fn(); } catch (error) { console.error(`[demo] ${label}:`, error); return undefined; } };
const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls ?? '', ...(text != null ? { textContent: text } : {}) });

// The game's cues (flight/index.js, surface/firstHumans.js) only count in their own beats: after N the old scene may still
// tick for a moment and must not talk over the next one.
const CUE_BEATS = [['fh:', [BEAT.firstHumans]], ['', [BEAT.hangar, BEAT.launch, BEAT.debris, BEAT.cruise, BEAT.entry]]];
function cue(name) {
  if (typeof name !== 'string') return;
  if (!name.startsWith('beat:') && !['gonogo', 'pollGo', 'pollNoGo', 'override', 'marsAtmosphere', 'chute', 'landingBurn', 'landed'].includes(name)) {
    const beats = CUE_BEATS.find(([prefix]) => name.startsWith(prefix))[1];
    if (!beats.includes(director.beat)) return;
  }
  audioCue(name);
}

// ---------- overlays ----------
let ring = null;
let ringBar = null;
let hint = null;
let card = null;

function ensureUi() {
  if (ring) return;
  const r = 20;
  ring = el('div', 'demo-ring');
  ring.innerHTML = `<svg viewBox="0 0 48 48"><circle class="track" cx="24" cy="24" r="${r}"/><circle class="bar" cx="24" cy="24" r="${r}" stroke-dasharray="${2 * Math.PI * r}" stroke-dashoffset="${2 * Math.PI * r}"/></svg>`;
  ringBar = ring.querySelector('.bar');
  hint = el('div', 'demo-hint', 'N · next');
  hint.hidden = true;
  document.body.append(ring, hint);
}

function setRing(progress) {
  if (!ring && progress <= 0) return; // never build the overlay unless the trigger is really held
  ensureUi();
  ring.classList.toggle('on', progress > 0.08);
  const len = 2 * Math.PI * 20;
  ringBar.setAttribute('stroke-dashoffset', String(len * (1 - progress)));
}

function ensureFonts() {
  if (document.querySelector('link[data-bm-fonts]')) return;
  const link = el('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&display=swap';
  link.dataset.bmFonts = '1';
  document.head.append(link);
}

function drawStars(canvas) {
  const w = (canvas.width = innerWidth);
  const h = (canvas.height = innerHeight);
  const g = canvas.getContext('2d');
  if (!g) return;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#e9e4d6';
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 220; k += 1) {
    const q = rnd();
    g.globalAlpha = 0.25 + q * 0.65;
    g.beginPath();
    g.arc(rnd() * w, rnd() * h, 0.4 + q * 1.4, 0, 7);
    g.fill();
  }
  g.globalAlpha = 1;
}

function removeCard() { card?.remove(); card = null; }

function fadeCard(done) {
  const old = card;
  if (!old) return;
  card = null;
  old.classList.add('fading');
  setTimeout(() => { old.remove(); done?.(); }, 950);
}

/** Beat 0: black, the title, the line under it. Stays up until beat 1 fades it. */
function showTitle() {
  removeCard();
  ensureFonts();
  card = el('div', 'demo-card');
  const big = el('div', 'big', 'SpaceB-E');
  const sub = el('div', 'sub', '2041 · A mission to Jezero');
  card.append(big, sub);
  document.body.append(card);
  later(700, () => big.classList.add('show'));
  later(2300, () => sub.classList.add('show'));
}

/** Beat 4: black with stars. */
function showCruiseCard() {
  removeCard();
  ensureFonts();
  card = el('div', 'demo-card');
  card.style.transition = 'opacity .45s ease';
  card.classList.add('fading');
  const canvas = el('canvas');
  drawStars(canvas);
  const cap = el('div', 'cap', '259 days later');
  card.append(canvas, cap);
  document.body.append(card);
  later(40, () => card?.classList.remove('fading'));
  later(500, () => cap.classList.add('show'));
}

// ---------- the beats ----------
const director = createDirector({ onEnter: enterBeat });

function publish() {
  window.__demo = window.__demo ?? {};
  Object.assign(window.__demo, { active: director.active || pendingStart, beat: director.beat, onFirstHumansDone, cue, showMemorialScroll });
}

function onFirstHumansDone() { firstHumansDone = true; }

// The Apollo ship goes in the bay (and its spec is made now, when the builder can). With builder.demoLoadPreset (Role 1)
// the bay is swapped at once. Without it the preset becomes the saved draft, which the builder reads when it first opens
// the hangar in a fresh page; startDemo() reloads the page in that case so the builder has not opened one yet.
const canLoadPreset = () => typeof builder.demoLoadPreset === 'function';
function loadDemoShip() {
  if (canLoadPreset()) return withDemoWarnings(safe('load preset', () => builder.demoLoadPreset('apollo')) ?? null);
  safe('preset draft', () => save.update({ builder: { ...(save.load().builder ?? {}), draft: structuredClone(apolloPreset) } }));
  return null;
}

// The demo ship carries CHUTE_UNTESTED (once), whoever built its spec: the flight, the GO/NO-GO poll of the launch
// ritual (phase0.js: "Recovery… NO-GO: parachute not proven") and the endings read it from core's ship.
function ensureDemoWarnings() {
  const ship = getShip();
  const next = withDemoWarnings(ship);
  if (next !== ship) setShip(next);
}

function skipToLaunch() {
  const spec = loadDemoShip();
  if (spec) { setShip(spec); events.emit('ship:built', { shipSpec: spec }); }
  ensureDemoWarnings();
  debugJump('LAUNCH', { quickStart: true });
}

function ensureEntry() {
  if (!['ENTRY', 'LANDING', 'INTERIOR', 'SURFACE', 'RETURN', 'ENDING'].includes(getState())) debugJump('ENTRY');
}

function goOutside() {
  if (getState() === 'SURFACE') return;
  if (getState() !== 'INTERIOR') debugJump('INTERIOR');
  later(800, () => { if (director.beat <= BEAT.firstHumans && getState() === 'INTERIOR') debugJump('SURFACE'); });
}

function enterBeat(beat, via) {
  publish();
  safe('beat audio', () => cue(`beat:${BEATS[beat]}`));
  resetAudioWatch();
  if (hint) hint.hidden = beat >= BEAT.scroll;
  safe(`beat ${BEATS[beat]}`, () => {
    switch (beat) {
      case BEAT.title: {
        firstHumansDone = false;
        landedFor = 0;
        showTitle();
        economy.debugSet(Math.max(economy.getMoney(), 5e9)); // the demo ship is always affordable
        loadDemoShip();
        if (getState() !== 'HANGAR') debugJump('HANGAR'); // the hangar warms up under the black title card
        break;
      }
      case BEAT.hangar: fadeCard(); break;
      case BEAT.launch: if (via === 'skip' && getState() !== 'LAUNCH') skipToLaunch(); break;
      case BEAT.debris: if (via === 'skip' && getState() !== 'ORBIT') debugJump('ORBIT'); break; // the flight places the debris 1.5 s after
      case BEAT.cruise:
        showCruiseCard();
        later(550, () => { if (director.beat <= BEAT.entry) ensureEntry(); }); // jump under the black card, CRUISE is skipped
        later(3200, () => fadeCard());
        break;
      case BEAT.entry: ensureEntry(); break;
      case BEAT.firstHumans: if (via === 'skip') goOutside(); break;
      case BEAT.return: playReturnHome({ onDone: finishReturnHome, onHandoff: handoffToScroll }); break; // our own scripted return (returnHome.js), not Role 4's RETURN
      default: break;
    }
  });
  if (beat === BEAT.entry && via === 'skip') removeCard();
}

// The accident analysis starts fading out: the memorial scroll fades in over it from the dark starfield, then unrolls.
function handoffToScroll() {
  if (!director.active || document.querySelector('.bm-scroll')) return;
  while (director.beat < BEAT.scroll) director.next();
  showMemorialScroll({ fadeIn: 1000 });
}

// The scripted return is over (or N skipped it): on to the memorial scroll (already there after the handoff).
function finishReturnHome() {
  stopReturnHome();
  if (!director.active || document.querySelector('.bm-scroll')) return;
  while (director.beat < BEAT.scroll) director.next();
  showMemorialScroll();
}

function nextBeatByKey() {
  if (!director.active) return;
  safe('audio resume', resumeDemoAudio); // a key press: the browser lets the demo's audio start now
  const onScroll = !!document.querySelector('.bm-scroll');
  if (isReturnHomeActive()) { if (!onScroll) safe('audio stop', () => stopAll(250)); finishReturnHome(); return; } // N skips the whole return to the scroll
  // The story owns the last beats (return, Soyuz 1, scroll): N must not cut them into the wrong ending.
  if (director.beat >= BEAT.return && ['RETURN', 'ENDING'].includes(getState())) return;
  if (director.beat >= BEATS.length - 1) return;
  safe('audio stop', () => stopAll(250)); // N: every voice, loop and queued line goes; the next beat starts its own
  director.next();
}

// ---------- audio cues read from the game (audio.js EVENT_CUES); the flight and surface call cue() themselves ----------
let watch = {};
function resetAudioWatch() { watch = { poll: watch.poll, atmo: false, chute: false, burn: false, landed: false }; }
function audioWatch(current, flight) {
  // GO/NO-GO poll (beat 1): the calls follow the lines as they are answered on screen
  if (director.beat === BEAT.hangar) {
    if (current === 'GONOGO') {
      if (!watch.poll) { watch.poll = { go: false, nogo: false }; cue('gonogo'); }
      if (!watch.poll.nogo) {
        const answered = [...document.querySelectorAll('.gng-line:not(.gng-line--calling)')].map((n) => n.dataset.status);
        if (!watch.poll.go && answered.includes('GO')) { watch.poll.go = true; cue('pollGo'); }
        if (answered.some((st) => st === 'NO-GO' || st === 'BLOCK')) { watch.poll.nogo = true; cue('pollNoGo'); }
      }
    } else if (watch.poll && !watch.poll.left && (current === 'PRELAUNCH' || current === 'LAUNCH')) { watch.poll.left = true; cue('override'); }
    else if (watch.poll && current === 'HANGAR') watch.poll = null; // back to the bay: the poll runs again
  }
  if (!flight || flight.planetId !== 'mars') return;
  // Mars (beat 5): the roar in the air, the chute, the landing engine, touchdown
  if (!watch.atmo && current === 'ENTRY' && flight.inAtmosphere && !flight.chuteOpen) { watch.atmo = true; cue('marsAtmosphere'); }
  if (!watch.chute && flight.chuteOpen) { watch.chute = true; cue('chute'); }
  if (!watch.burn && watch.chute && flight.throttle > 0 && !flight.landed) { watch.burn = true; cue('landingBurn'); }
  if (!watch.landed && flight.landed) { watch.landed = true; cue('landed'); }
}

function startDemo() {
  if (used || getState() !== 'MENU' || !canLoadPreset()) {
    if (!canLoadPreset()) loadDemoShip(); // the Apollo draft is saved before the reload
    // not a clean start: a reload is the only way to forget every scene, flag and overlay
    try { sessionStorage.setItem(AUTOSTART_KEY, '1'); location.reload(); return; } catch { /* blocked: restart in place below */ }
  }
  beginDemo();
}

function beginDemo() {
  timers.forEach(clearTimeout);
  timers = [];
  stopReturnHome();
  document.querySelectorAll('.bm-scroll').forEach((node) => node.remove());
  removeCard();
  pendingStart = false;
  used = true;
  if (getState() !== 'MENU') debugJump('MENU');
  window.__demo = { active: true, beat: 0, onFirstHumansDone, cue, showMemorialScroll };
  nStateFor = null; // register N in this state
  safe('audio stop', () => stopAll(0));
  watch = {};
  safe('audio start', () => startDemoAudio({ volume: save.load()?.volume }));
  ensureUi();
  hint.hidden = false;
  director.start();
}

// ---------- per frame, while the demo needs frames (driver.js wraps core's graphics.render) ----------
export function update(dt, current) {
  if (current !== state) { state = current; stateTime = 0; landedFor = 0; } else stateTime += dt;
  if (director.active && current !== nStateFor) { nStateFor = current; input.onPress('KeyN', nextBeatByKey); } // core clears key handlers on every state change: register again (input.js ignores typing in text fields)
  const held = hold.update((code) => input.isDown(code), performance.now());
  setRing(held.progress);
  if (held.fired) { startDemo(); return; }
  if (pendingStart) { beginDemo(); return; }
  updateReturnHome(dt); // also runs for the debug preview (window.__demoReturnHome)
  if (!director.active) return;
  safe('audio resume', resumeDemoAudio);
  safe('demo warnings', ensureDemoWarnings);

  probeT += dt;
  if (probeT > 0.4) {
    probeT = 0;
    returnPhase = document.querySelector('.bm-scroll') ? 'scroll' : document.querySelector('.role4-ld, [data-block^="last-descent"]') ? 'descent' : null;
  }
  const flight = FLIGHT_STATES.includes(current) || current === 'LAUNCH' || current === 'ORBIT' ? safe('flight status', () => flightStatus()) ?? null : null;
  if (current === 'LANDING' && flight?.landed) landedFor += dt;

  if (director.beat === BEAT.hangar && current === 'PRELAUNCH' && stateTime > 0.4) { // the ritual is skipped: straight to the countdown
    requestState('LAUNCH', { quickStart: true });
    return;
  }
  if (director.beat === BEAT.entry) {
    const next = landingExit({ state: current, stateTime, landedFor });
    if (next) { requestState(next); return; }
  }
  safe('audio watch', () => audioWatch(current, flight));
  director.update(dt, { state: current, flight, firstHumansDone, returnPhase });
  if (window.__demo && window.__demo.beat !== director.beat) window.__demo.beat = director.beat;
}

// A restart reloads the page (so no scene keeps old state); the title card is up before the game has booted.
try {
  if (sessionStorage.getItem(AUTOSTART_KEY)) {
    sessionStorage.removeItem(AUTOSTART_KEY);
    pendingStart = true;
    window.__demo = { active: true, beat: -1, onFirstHumansDone, cue, showMemorialScroll };
    const cover = el('div', 'demo-card');
    cover.dataset.cover = '1';
    card = cover;
    (document.body ?? document.documentElement).append(cover);
  }
} catch { /* storage blocked */ }

// Preview: /?debug=1 then window.__demoReturnHome() (whole sequence) or window.__demoReturnHome('panic') (ids: liftoff skip flyby entry pushin parachute panic impact reminder analysis) (from a segment).
try {
  if (new URLSearchParams(location.search).get('debug') === '1') {
    window.__demoReturnHome = (from = null) => { startDemoAudio({ volume: save.load()?.volume }); stopAll(0); return playReturnHome({ from, onDone: () => console.log('[demo] return home done'), onHandoff: () => { showMemorialScroll({ fadeIn: 1000 }); } }); };
    window.__demoReturnHomeStop = () => { stopReturnHome(); stopAll(300); document.querySelectorAll('.bm-scroll').forEach((node) => node.remove()); };
  }
} catch { /* no location */ }

// ---------- frames ----------
// Wanted while the trigger is fully held, while the demo runs or waits to start, and while the return preview plays.
const triggerHeld = () => HOLD_CODES.every((code) => input.isDown(code));
const frames = createFrameDriver({
  target: () => graphics, // read late: builder -> flight -> demo -> graphics may still be mid-import at boot
  method: 'render',
  tick: (dt) => update(dt, getState()),
  wanted: () => triggerHeld() || director.active || pendingStart || isReturnHomeActive() || !!ring?.classList.contains('on'),
});
startPolling(frames);

export default { update, setFlightStatus };

export { showMemorialScroll } from './scroll.js'; // other modules reach the memorial scroll through this index
