// The pitch demo's voice, music and sound-effect layer (ElevenLabs files in public/assets/audio/demo, listed in its
// manifest.json). Only ids present in the manifest at runtime are played; anything missing is skipped in silence.
// Its own Web Audio context (Role 3's engine in src/audio keeps its context private); resumed on the first key or click.
//   playLine(id, { radio, delay, volume, overlap, subtitle, card }) -> Promise (resolves when the line ends)
//   playSfx(id, { loop, volume }) / playMusic(id, { volume, fadeIn }) -> handle { stop(fadeMs) }
//   cue(name) runs a named row of the cue sheet (EVENT_CUES); segmentCues(id, local) the return-home rows (RETURN_CUES)
//   stopAll(fadeMs) for N-skip and restart.
// The top half is pure (no browser APIs; Node tests it: audio.test.mjs).
import { clearSubtitles, hideCard, hideSubtitle, setSubtitleMode, showCard, showSubtitle } from './subtitles.js';

export const RADIO_VOICES = Object.freeze(['capcom', 'flight_director']);
export const DUCK_LEVEL = 0.35; // music and loops while a line plays
export const DUCK_RAMP_S = 0.2;
export const SQUELCH_S = 0.16; // radio static before (and after) a radio line
export const QUEUE_GAP_S = 0.3; // between two lines that had to wait for each other

const SPEAKERS = { narrator: 'NARRATOR', flight_director: 'FLIGHT', capcom: 'CAPCOM', astronaut: 'ASTRONAUT', computer: 'COMPUTER' };
/** The subtitle label for a manifest voice. Lily's mom (the wife) is "HOME". */
export function speakerLabel(voice = '') {
  if (SPEAKERS[voice]) return SPEAKERS[voice];
  if (/wife|mom|mother|home|lily/i.test(voice)) return 'HOME';
  return String(voice).replace(/_/g, ' ').toUpperCase();
}
export const isRadioVoice = (voice) => RADIO_VOICES.includes(voice);
/** The radio filter goes on only when asked for AND the voice is a radio voice (CAPCOM, FLIGHT). */
export const wantsRadio = (entry, radio) => !!radio && isRadioVoice(entry?.voice);
/** Gain of a duckable bus: `base`, dipped to DUCK_LEVEL while at least one line plays. */
export const duckGain = (base, activeLines, duck = DUCK_LEVEL) => (activeLines > 0 ? base * duck : base);
export const hasId = (manifest, id) => !!manifest && Object.prototype.hasOwnProperty.call(manifest, id) && !!manifest[id]?.file;
/** Seconds a line keeps the voice channel busy (radio adds the squelch before and after). */
export const lineSeconds = (manifest, id, radio = false) => {
  const e = manifest?.[id];
  if (!e) return 0;
  return (e.durationSec ?? 0) + (wantsRadio(e, radio) ? 2 * SQUELCH_S : 0);
};
/** The actions whose ids are in the manifest (stop/fade actions are always kept). */
export const availableActions = (actions, manifest) => actions.filter((a) => {
  const id = a.line ?? a.sfx ?? a.music;
  return id === undefined || hasId(manifest, id);
});
/** Rows of a timed list due in (prev, now]; prev < 0 includes the rows at 0. Sorted by time. */
export const dueCues = (list, prev, now) => list.filter((c) => (c.at ?? 0) > prev && (c.at ?? 0) <= now).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
/** The line ids of a list in the order they start. */
export const lineOrder = (list) => [...list].map((c, i) => [c, i]).sort((a, b) => ((a[0].at ?? a[0].delay ?? 0) - (b[0].at ?? b[0].delay ?? 0)) || a[1] - b[1]).map(([c]) => c.line).filter(Boolean);

// ---------- the cue sheet ----------
// Event rows: { line | sfx | music | stop | fade, ...options, delay (s) }. `key` names a sound so a later row can stop it.
export const EVENT_CUES = Object.freeze({
  // beat 0: title
  'beat:title': [{ music: 'mus_opening', volume: 0.5, fadeIn: 2.5 }, { line: 'n_open', delay: 1.0 }],
  // beat 1: hangar and the GO/NO-GO poll (the poll lines are timed by the poll on screen: index.js watches it)
  'beat:hangar': [{ sfx: 'sfx_control_room', loop: true, volume: 0.35, key: 'controlRoom' }, { line: 'w_message', delay: 1.2, card: 'MESSAGE FROM HOME', volume: 0.9 }],
  gonogo: [{ line: 'fd_poll_open', radio: true }],
  pollGo: [{ line: 'fd_poll_go', radio: true }],
  pollNoGo: [{ line: 'fd_poll_recovery', radio: true }],
  override: [{ line: 'fd_override', radio: true }, { fade: 'mus_opening', to: 0, ms: 3000 }],
  // beat 2: launch. The countdown is 10 s (flight/index.js COUNTDOWN); the file ends on "Liftoff!", so it starts
  // 10 - duration - squelch after T-10 and bypasses the queue so nothing can push it late.
  'beat:launch': [{ fade: 'mus_opening', to: 0, ms: 2500 }],
  countdown: [{ line: 'c_countdown', radio: true, overlap: true, syncEnd: 10 }],
  ignition: [{ sfx: 'sfx_launch_rumble', volume: 0.9, key: 'launchRumble' }],
  liftoff: [{ sfx: 'sfx_liftoff_roar', volume: 1 }, { line: 'a_herewego', delay: 1.0 }, { stop: 'controlRoom', ms: 2500 }],
  'notice:maxq_warning': [{ sfx: 'sfx_maxq_buffet', volume: 0.8 }, { line: 'c_maxq', radio: true }],
  manualOffer: [{ line: 'c_gravity', radio: true }],
  // beat 3: debris (the game already plays its own RCS puffs on every push, so sfx_rcs_puff is not layered on top)
  debris: [{ sfx: 'sfx_master_alarm', volume: 0.7 }, { line: 'c_debris', radio: true, delay: 0.3 }],
  whoosh: [{ sfx: 'sfx_debris_whoosh', volume: 0.8 }],
  debrisClear: [{ line: 'c_clear', radio: true }],
  // beat 4 / 5: cruise card, Mars entry and landing
  'beat:cruise': [{ stop: 'controlRoom', ms: 800 }, { line: 'n_days', delay: 0.7 }],
  'beat:entry': [{ line: 'n_delay', delay: 1.0 }],
  marsAtmosphere: [{ sfx: 'sfx_mars_entry_roar', volume: 0.8, key: 'marsRoar' }],
  chute: [{ stop: 'marsRoar', ms: 1500 }, { sfx: 'sfx_chute_deploy', volume: 0.9 }, { line: 'a_touchdown', delay: 0.4 }],
  landingBurn: [{ sfx: 'sfx_landing_engine', volume: 0.7, key: 'landingEngine' }],
  landed: [{ stop: 'landingEngine', ms: 900 }, { stop: 'marsRoar', ms: 500 }],
  // beat 6: first humans (firstHumans.js events)
  'beat:firstHumans': [{ stop: 'landingEngine', ms: 500 }],
  'fh:start': [{ sfx: 'sfx_suit_breath', loop: true, volume: 0.6, key: 'breath' }],
  'fh:touch': [{ sfx: 'sfx_footsteps_gravel', volume: 0.8 }, { line: 'a_jezero', delay: 0.5 }],
  'fh:land': [{ sfx: 'sfx_footsteps_gravel', volume: 0.7 }],
  'fh:unfurl': [{ sfx: 'sfx_flag_fabric', volume: 0.8 }],
  'fh:gohome': [{ line: 'a_gohome', subtitle: false, overlap: true }], // the caption "Time to go home." is on screen with it
  'fh:done': [{ stop: 'breath', ms: 1500 }],
  'beat:return': [{ stop: 'breath', ms: 800 }],
  // return home: the PARA button (slow press and every frantic press), the hit
  press: [{ sfx: 'sfx_button_click', volume: 0.7 }],
  impactHit: [{ stopAll: 0 }, { sfx: 'sfx_explosion', volume: 1, key: 'explosion' }],
  // memorial scroll (scroll.js times the narrator to the paper)
  scroll: [{ music: 'mus_memorial', volume: 0.45, fadeIn: 3 }],
});

// Return-home rows, by segment: `at` = seconds into the segment (returnHome.js ticks them with the picture).
// The lamp and press times in returnHome.js RETURN_SCRIPT are matched to these (audio.test.mjs checks).
export const RETURN_CUES = Object.freeze({
  liftoff: [{ at: 0, stop: 'breath', ms: 600 }, { at: 1.4, sfx: 'sfx_liftoff_roar', volume: 0.9 }],
  flyby: [
    { at: 0, music: 'mus_earth', volume: 0.45, fadeIn: 3 },
    { at: 1.5, line: 'a_hello_earth' },
    { at: 6.3, line: 'c_welcome', radio: true },
    { at: 10.4, line: 'a_lily' },
  ],
  entry: [
    { at: 0.4, line: 'c_entry', radio: true },
    { at: 2.5, sfx: 'sfx_earth_entry_roar', volume: 0.9, key: 'earthRoar' },
    { at: 3.0, fade: 'mus_earth', to: 0, ms: 4500 },
    { at: 5.0, line: 'a_rollercoaster' },
    { at: 9.0, line: 'a_coffee' },
  ],
  parachute: [
    { at: 0, stop: 'earthRoar', ms: 1500 },
    { at: 0.2, line: 'pc_deploy', overlap: true },
    { at: 1.2, line: 'a_main_now' },
    { at: 4.2, line: 'pc_drogue', overlap: true },
    { at: 5.6, line: 'pc_nodeploy', overlap: true },
    { at: 7.6, line: 'a_huh' },
  ],
  panic: [
    { at: 0, sfx: 'sfx_alarm_rapid', loop: true, volume: 0.45, key: 'alarmRapid' },
    { at: 0, sfx: 'sfx_master_alarm', volume: 0.7 },
    { at: 0.3, line: 'pc_failure', overlap: true },
    { at: 1.0, line: 'a_mayday1' },
    { at: 4.3, line: 'c_breaking', radio: true },
    { at: 7.7, line: 'a_mayday2' },
    { at: 11.1, line: 'pc_reserve', overlap: true }, // on "Deploying reserve!"
    { at: 11.45, line: 'a_please' },
    { at: 12.5, line: 'pc_tangled', overlap: true },
    { at: 13.3, line: 'c_withyou', radio: true, overlap: true }, // steps on "please…"; the impact cuts it mid-word
  ],
  impact: [],
  reminder: [ // starts 2 s after the black cut: total silence first
    { at: 0, stop: 'explosion', ms: 250 },
    { at: 2.0, line: 'c_doyoucopy', radio: true, volume: 0.55 },
    { at: 5.2, line: 'c_capsule', radio: true, volume: 0.35 },
    { at: 8.0, line: 'w_echo', volume: 0.3 },
    { at: 14.2, line: 'fd_poll_recovery', radio: true, subtitle: false }, // with the amber "RECOVERY · NO-GO" line
    { at: 19.0, line: 'fd_said_go', subtitle: false }, // with "You said GO."
  ],
  analysis: [],
});

// ---------- the engine (browser only) ----------
const BASE = `${import.meta.env?.BASE_URL ?? '/'}assets/audio/demo/`;
let ctx = null;
let bus = null; // { master, voice, sfx, music, loops }
let manifest = null;
let manifestP = null;
let started = false;
let gen = 0; // bumped by stopAll: anything scheduled before is dropped
let queueTail = Promise.resolve();
let activeLines = 0;
let volume = 1;
let resuming = false; // a resume() is in flight
const buffers = new Map(); // id -> Promise<AudioBuffer|null>
const handles = new Set(); // playing sfx / music handles
const keyed = new Map(); // key -> handle
const voices = new Set(); // playing line sources
const timers = new Set();
let segState = { id: null, last: -1 };

const safe = (fn) => { try { return fn(); } catch (error) { console.warn('[demo audio]', error); return undefined; } };
const sleep = (ms, g) => new Promise((resolve) => {
  if (ms <= 0) { resolve(g === gen); return; }
  const t = setTimeout(() => { timers.delete(t); resolve(g === gen); }, ms);
  timers.add(t);
});

function ensureContext() {
  if (ctx || typeof window === 'undefined') return ctx;
  const AC = window.AudioContext ?? window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  const mk = () => { const g = ctx.createGain(); g.connect(master); return g; };
  bus = { master, voice: mk(), sfx: mk(), music: mk(), loops: mk() };
  return ctx;
}

/**
 * Wakes a suspended context. index.js calls it every frame while the demo runs (and on N): browsers let a page that has
 * had a key press or click resume audio, so this stands in for the old global key/pointer listeners (only
 * src/core/input.js may listen to keys and pointers).
 */
export function resumeDemoAudio() {
  if (!ctx || ctx.state !== 'suspended' || resuming) return;
  resuming = true;
  ctx.resume().catch(() => {}).finally(() => { resuming = false; });
}

/** Called when the demo starts (C+R+7): makes the context, fetches the manifest once and preloads every file in it. */
export function startDemoAudio({ volume: v } = {}) {
  started = true;
  if (typeof v === 'number') setDemoVolume(v);
  if (!ensureContext()) return Promise.resolve(null);
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  manifestP ??= fetch(`${BASE}manifest.json`, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
    .then((m) => {
      manifest = m && typeof m === 'object' ? m : {};
      // the title's music and line first, then everything else (decoding 60+ files at once would delay n_open)
      const first = ['mus_opening', 'n_open', 'sfx_radio_static'];
      Promise.all(first.map((id) => loadBuffer(id))).then(() => Object.keys(manifest).forEach((id) => loadBuffer(id)));
      return manifest;
    });
  return manifestP;
}

export function setDemoVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (ctx) bus.master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
}

/** True when the id is in the manifest (false before it has loaded). */
export const has = (id) => hasId(manifest, id);

function loadBuffer(id) {
  if (!hasId(manifest, id) || !ctx) return Promise.resolve(null);
  if (!buffers.has(id)) {
    buffers.set(id, fetch(BASE + manifest[id].file)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((bytes) => ctx.decodeAudioData(bytes))
      .catch((error) => { console.warn(`[demo audio] ${id}: ${error?.message ?? error}`); return null; }));
  }
  return buffers.get(id);
}

function applyDuck() {
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const g of [bus.music.gain, bus.loops.gain]) {
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(duckGain(1, activeLines), now + DUCK_RAMP_S);
  }
}

function distortionCurve(amount = 6) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(amount * x) / Math.tanh(amount); }
  return curve;
}
let curve = null;

/** The radio chain: band-pass 300-3400 Hz, light saturation, compression. Returns { input, output }. */
function radioChain() {
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300; hp.Q.value = 0.7;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400; lp.Q.value = 0.7;
  const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1800; mid.gain.value = 4; mid.Q.value = 1;
  const shaper = ctx.createWaveShaper(); shaper.curve = (curve ??= distortionCurve(3)); shaper.oversample = '2x';
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.12; comp.knee.value = 6;
  const out = ctx.createGain(); out.gain.value = 1.15;
  hp.connect(lp).connect(mid).connect(shaper).connect(comp).connect(out);
  return { input: hp, output: out };
}

/** A short burst of sfx_radio_static (the squelch), if the file exists. */
function squelch(when, level = 0.5) {
  const p = loadBuffer('sfx_radio_static');
  p.then((buf) => {
    if (!buf || !ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    const t = Math.max(ctx.currentTime, when);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.02);
    g.gain.setValueAtTime(level, t + SQUELCH_S - 0.05);
    g.gain.linearRampToValueAtTime(0, t + SQUELCH_S);
    src.connect(g).connect(bus.voice);
    const offset = Math.max(0, Math.random() * Math.max(0, buf.duration - SQUELCH_S - 0.05));
    src.start(t, offset, SQUELCH_S + 0.02);
  });
}

async function voice(id, entry, { radio, volume: v = 1, subtitle = true, card = null, g }) {
  const buf = await loadBuffer(id);
  if (!buf || g !== gen || !ctx) return;
  const isRadio = wantsRadio(entry, radio);
  const t0 = ctx.currentTime + 0.02;
  if (isRadio) squelch(t0);
  const start = t0 + (isRadio ? SQUELCH_S - 0.04 : 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = v;
  if (isRadio) { const chain = radioChain(); src.connect(chain.input); chain.output.connect(gain); } else src.connect(gain);
  gain.connect(bus.voice);
  const item = { src, gain };
  voices.add(item);
  activeLines += 1;
  applyDuck();
  const delayMs = Math.max(0, (start - ctx.currentTime) * 1000);
  const label = speakerLabel(entry.voice);
  const subTimer = setTimeout(() => {
    if (g !== gen) return;
    if (card) showCard(card);
    if (subtitle && entry.subtitle) showSubtitle({ id, speaker: label, voice: entry.voice, text: entry.subtitle });
  }, delayMs);
  await new Promise((resolve) => {
    src.onended = resolve;
    src.start(start);
  });
  clearTimeout(subTimer);
  voices.delete(item);
  activeLines = Math.max(0, activeLines - 1);
  applyDuck();
  safe(() => { src.disconnect(); gain.disconnect(); });
  if (g !== gen) return;
  hideSubtitle(id);
  if (card) hideCard();
  if (isRadio) squelch(ctx.currentTime, 0.35);
}

/**
 * Plays one manifest line (skipped if missing). Lines queue so they never overlap, unless overlap is true.
 * syncEnd (s): start so the line (with its squelch) ends that many seconds after the call (the countdown).
 */
export function playLine(id, { radio = false, delay = 0, volume: v = 1, overlap = false, subtitle = true, card = null, syncEnd = null } = {}) {
  if (!started) return Promise.resolve();
  const g = gen;
  const ready = manifestP ?? Promise.resolve(null);
  return ready.then(async () => {
    const entry = manifest?.[id];
    if (!hasId(manifest, id)) return; // missing: skip in silence
    let wait = delay;
    if (syncEnd != null) wait += Math.max(0, syncEnd - lineSeconds(manifest, id, radio) + SQUELCH_S * 0.5);
    if (!(await sleep(wait * 1000, g))) return;
    const run = () => (g === gen ? voice(id, entry, { radio, volume: v, subtitle, card, g }) : undefined);
    if (overlap) return run();
    const p = queueTail.then(run);
    queueTail = p.catch(() => {}).then(() => (g === gen ? sleep(QUEUE_GAP_S * 1000, g) : undefined));
    return p;
  });
}

const NOOP_HANDLE = Object.freeze({ stop() {}, fade() {} });

function playBuffer(id, { loop = false, volume: v = 1, fadeIn = 0, target }) {
  if (!started || !ensureContext()) return NOOP_HANDLE;
  const g = gen;
  const out = ctx.createGain();
  out.gain.value = fadeIn > 0 ? 0 : v;
  out.connect(target);
  let src = null;
  let stopped = false;
  const handle = {
    stop(fadeMs = 300) {
      if (stopped) return;
      stopped = true;
      handles.delete(handle);
      for (const [k, h] of keyed) if (h === handle) keyed.delete(k);
      const now = ctx.currentTime;
      const f = Math.max(0.005, fadeMs / 1000);
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(out.gain.value, now);
      out.gain.linearRampToValueAtTime(0, now + f);
      safe(() => src?.stop(now + f + 0.05));
      setTimeout(() => safe(() => out.disconnect()), fadeMs + 200);
    },
    fade(to, ms = 1000) {
      if (stopped) return;
      if (to <= 0) { handle.stop(ms); return; }
      const now = ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(out.gain.value, now);
      out.gain.linearRampToValueAtTime(to * v, now + ms / 1000);
    },
  };
  handles.add(handle);
  (manifestP ?? Promise.resolve()).then(() => loadBuffer(id)).then((buf) => {
    if (stopped || g !== gen) { handle.stop(0); return; }
    if (!buf) { handles.delete(handle); return; }
    src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.connect(out);
    const now = ctx.currentTime;
    if (fadeIn > 0) { out.gain.setValueAtTime(0, now); out.gain.linearRampToValueAtTime(v, now + fadeIn); }
    src.onended = () => { if (!loop) { handles.delete(handle); for (const [k, h] of keyed) if (h === handle) keyed.delete(k); safe(() => out.disconnect()); } };
    src.start(now);
  });
  return handle;
}

/** A sound effect; loops go through the ducked bus. Missing ids return a handle that does nothing. */
export function playSfx(id, { loop = false, volume: v = 1 } = {}) {
  if (started && manifest && !hasId(manifest, id)) return NOOP_HANDLE;
  return playBuffer(id, { loop, volume: v, target: loop ? bus?.loops : bus?.sfx });
}

/** Music (looped, ducked under lines). fadeIn in seconds. */
export function playMusic(id, { volume: v = 0.5, fadeIn = 0 } = {}) {
  if (started && manifest && !hasId(manifest, id)) return NOOP_HANDLE;
  return playBuffer(id, { loop: true, volume: v, fadeIn, target: bus?.music });
}

/** Everything stops (fade in ms), every scheduled or queued line is dropped, subtitles go. */
export function stopAll(fadeMs = 300) {
  gen += 1;
  timers.forEach(clearTimeout);
  timers.clear();
  queueTail = Promise.resolve();
  [...handles].forEach((h) => h.stop(fadeMs));
  keyed.clear();
  if (ctx) {
    const now = ctx.currentTime;
    for (const v of voices) {
      safe(() => {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(v.gain.gain.value, now);
        v.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.005, fadeMs / 1000));
        v.src.stop(now + Math.max(0.005, fadeMs / 1000) + 0.02);
      });
    }
  }
  segState = { id: null, last: -1 };
  safe(() => clearSubtitles());
  safe(() => setSubtitleMode('normal'));
}

function runAction(a) {
  if (a.stopAll !== undefined) { stopAll(a.stopAll); return; }
  if (a.stop) { keyed.get(a.stop)?.stop(a.ms ?? 300); return; }
  if (a.fade) { const h = keyed.get(a.fade); if (h) h.fade(a.to ?? 0, a.ms ?? 1000); return; }
  if (a.line) { playLine(a.line, a); return; }
  const g = gen;
  const go = () => {
    if (g !== gen) return;
    const h = a.music ? playMusic(a.music, a) : playSfx(a.sfx, a);
    const key = a.key ?? a.music;
    if (key && h !== NOOP_HANDLE) { keyed.get(key)?.stop(200); keyed.set(key, h); }
  };
  if (a.delay > 0) sleep(a.delay * 1000, g).then((ok) => ok && go()); else go();
}

/** Runs one row of EVENT_CUES (a no-op until the demo audio has started). */
export function cue(name) {
  if (!started) return;
  const list = EVENT_CUES[name];
  if (!list) return;
  if (name === 'scroll') setSubtitleMode('scroll');
  for (const a of list) safe(() => runAction(a));
}

/** returnHome.js calls this every frame with its segment id and local time: fires the RETURN_CUES rows now due. */
export function segmentCues(id, local) {
  if (!started) return;
  if (segState.id !== id) segState = { id, last: -1 };
  const list = RETURN_CUES[id];
  if (list?.length) for (const a of dueCues(list, segState.last, local)) safe(() => runAction(a));
  segState.last = local;
}

// for the console while tuning: window.__demoAudio
if (typeof window !== 'undefined') window.__demoAudio = { cue, playLine, playSfx, playMusic, stopAll, get manifest() { return manifest; } };
