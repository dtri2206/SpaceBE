// The pitch's return home (beats 7-8): a scripted, automatic sequence built from the game's own scenes and models.
//   liftoff (Mars) -> "Seven months later" -> Earth flyby (outside) -> atmospheric entry (outside, close-up)
//   -> parachute (cockpit, calm, one press) -> panic (cockpit) -> impact (outside, low camera, 4 s) -> black + the
//   pre-launch warning reminder -> black-box accident analysis (analysis.js) -> hands over to the memorial scroll.
// Nothing here runs unless playReturnHome() is called. The top half (RETURN_SCRIPT and the schedule helpers) is pure
// (no imports, Node tests it: returnHome.test.mjs); the game modules are imported lazily inside the player.
// Driven from the per-frame hook of src/flight/demo/index.js through updateReturnHome(dt). No people are ever shown.

import { cue as audioCue, has as audioHas, segmentCues } from './audio.js'; // the voices and sounds of each segment (audio.js RETURN_CUES)

// ---------- the script: every duration (s) and text lives in this one table ----------
// Durations fit the voice lines (audio.js RETURN_CUES): the lamp and press times below match the lines that call them.
// view: 'outside' = the ship seen from outside, 'cockpit' = through the window, 'text' = text on black, 'card' = title card.
export const RETURN_SCRIPT = Object.freeze({
  segments: Object.freeze([
    Object.freeze({ id: 'liftoff', dur: 12, view: 'outside', caption: 'Leaving Jezero' }),
    Object.freeze({ id: 'skip', dur: 3, view: 'card', text: 'Seven months later' }),
    Object.freeze({ id: 'flyby', dur: 16, view: 'outside', caption: 'Home' }), // hello Earth, welcome home, Lily's drawing
    Object.freeze({ id: 'entry', dur: 15, view: 'outside' }), // flows straight out of the flyby: one continuous shot
    Object.freeze({ id: 'pushin', dur: 1.5, view: 'outside' }), // the camera pushes through the front window into the cockpit
    Object.freeze({ id: 'parachute', dur: 11, view: 'cockpit' }), // deploy, "main chute… now", drogue, no deploy, "huh"
    Object.freeze({ id: 'panic', dur: 14, view: 'cockpit' }), // covers both maydays, the reserve, "please", "we're with you"
    Object.freeze({ id: 'impact', dur: 4, view: 'outside', cut: true }), // hard cut from the cockpit, hard cut to black
    Object.freeze({ id: 'reminder', dur: 22.5, view: 'text', cut: true }), // 2 s of black silence, the radio calling, the echo from home, then the three lines
    Object.freeze({ id: 'analysis', dur: 13, view: 'text' }), // the flight recorder; the scroll takes over at handoffAt
  ]),
  liftoff: { ignite: 1.4, acceleration: 16, fadeIn: 0.8 },
  skip: { fadeIn: 0.45, textAt: 0.5 },
  flyby: {
    altitudeRatio: 0.14, // ship altitude / Earth radius: close enough for Earth to fill the lower half of the frame
    arcDeg: [-30, 30], // the ship's travel around Earth
    sun: [0.55, 0.75, 0.4], // day side toward the camera; the sun grazes by the end
    camera: { back: 2.6, up: 0.55, side: [2.2, 1.4] }, // in rocket heights; the camera drifts from the side toward the back
  },
  entry: {
    shake: [0.06, 0.55],
    plasma: [0, 1],
    rumble: [0.25, 0.9],
    sky: [0, 0.92], // opacity of the deep-blue sky dome: black space turns to blue
    altitudeRatio: [0.14, 0.0006], // ship altitude / Earth radius: from the flyby altitude down to the cloud tops (reached at the end of the push-in)
    endSpeed: 0.03, // Earth radii per second at the end (the flyby speed follows from arcDeg); slowing makes the dive steeper
    camera: { back: 3.4, up: 0.7, side: 0.9 }, // in ship heights, reached at the end of the entry (starts where the flyby camera ends)
    lamps: [
      { at: 0.6, text: 'HEAT SHIELD · NOMINAL', state: 'green' },
      { at: 1.5, text: 'ATTITUDE · NOMINAL', state: 'green' },
      { at: 2.6, text: 'DESCENT RATE · NOMINAL', state: 'green' },
    ],
  },
  pushin: { glare: [0.45, 0.85], eye: 0.38, fov: 65 }, // the white-orange glare covers the pass through the glass; eye = window, in ship heights from the middle
  parachute: {
    glareFade: 0.5, // s for the glare to clear after the cut to the cockpit
    banner: 'DEPLOY PARACHUTE', // calm, green
    plasmaFade: 1, // s for the plasma to die away
    shake: 0.12,
    zoom: [0.3, 2.8], // s: camera goes to the PARA button
    pressAt: 3.3, // one slow press, on "now" (a_main_now)
    lamps: [
      { at: 4.2, text: 'DROGUE · OPEN', state: 'green' }, // pc_drogue
      { at: 5.6, text: 'MAIN CHUTE · NO DEPLOY', state: 'red' }, // pc_nodeploy
    ],
  },
  panic: {
    banner: 'DEPLOY PARACHUTE · DEPLOY PARACHUTE', // red, pulsing, repeated
    bannerRepeat: 3,
    pressInterval: [0.35, 0.15], // s between presses: start -> end of the segment
    shake: [0.65, 1],
    alarmEvery: 0.8,
    blinkEvery: 0.2,
    glare: [0, 0.4], // the ground rushing up: the window brightens
    pullBack: [0, 0.8], // fraction of the segment over which the camera leaves the button
    altitudeKm: [60, 1.5],
    lamps: [
      { at: 0, text: 'MAIN CHUTE · NO DEPLOY', state: 'red' },
      { at: 11.1, key: 'reserve', text: 'RESERVE CHUTE · DEPLOYED', state: 'amber' }, // pc_reserve
      { at: 12.5, key: 'reserve', text: 'RESERVE CHUTE · TANGLED', state: 'red' }, // pc_tangled
    ],
  },
  impact: { hitAt: 1.9, fallFrom: 55 }, // s into the segment when the capsule hits; m it falls from (impact.js)
  reminder: {
    blackSilence: 2,
    lines: [
      { id: 'warning', at: 12.0, style: 'serif', text: 'Before launch, a small problem with the parachute system was reported. It seemed minor.' },
      { id: 'nogo', at: 14.2, style: 'warn', text: 'RECOVERY · NO-GO · parachute not proven' }, // fd_poll_recovery again
      { id: 'said-go', at: 18.0, style: 'serif', text: 'You saw this warning before launch. You said GO.' }, // fd_said_go at 19
    ],
  },
  analysis: { fadeInS: 0.6, handoffAt: 12, fadeOutS: 1 }, // typing schedule: analysis.js; at handoffAt the memorial scroll starts fading in
});

/** [{ id, start, end, dur, seg }] in order, plus total. */
export function buildSchedule(script = RETURN_SCRIPT) {
  let t = 0;
  const segments = script.segments.map((seg) => {
    const item = { id: seg.id, start: t, end: t + seg.dur, dur: seg.dur, seg };
    t += seg.dur;
    return item;
  });
  return { segments, total: t };
}

/** The segment playing at time t: { index, id, start, local, u, seg } (u = 0..1 within it), or null past the end. */
export function segmentAt(schedule, t) {
  if (t < 0) return null;
  for (let index = 0; index < schedule.segments.length; index += 1) {
    const s = schedule.segments[index];
    if (t < s.end) return { index, id: s.id, start: s.start, local: t - s.start, u: (t - s.start) / s.dur, seg: s.seg };
  }
  return null;
}

export const startOf = (schedule, id) => schedule.segments.find((s) => s.id === id)?.start ?? 0;

const lerp = (a, b, u) => a + (b - a) * Math.min(1, Math.max(0, u));
export { lerp as lerpClamped };

/** Local times (s) of every press of the PARA button during the panic: the gap shrinks from interval[0] to interval[1]. */
export function panicPressTimes(script = RETURN_SCRIPT) {
  const dur = script.segments.find((s) => s.id === 'panic').dur;
  const [slow, fast] = script.panic.pressInterval;
  const times = [];
  let t = 0;
  while (t < dur) {
    times.push(Number(t.toFixed(4)));
    t += lerp(slow, fast, t / dur);
  }
  return times;
}

/** The lamps of a segment that have appeared by local time t: one row per key (default: its text), the latest wins. */
export function lampsAt(list, local) {
  const shown = new Map();
  for (const l of list) if (local >= l.at) shown.set(l.key ?? l.text, { text: l.text, state: l.state });
  return [...shown.values()];
}

/** The reminder lines on screen at local time t of the 'reminder' segment, in order. */
export function reminderLinesAt(local, script = RETURN_SCRIPT) {
  return script.reminder.lines.filter((l) => local >= l.at);
}

/** Entry shake / plasma / rumble at progress u of the entry segment. */
export const entryLevels = (u, script = RETURN_SCRIPT) => ({
  shake: lerp(...script.entry.shake, u),
  plasma: lerp(...script.entry.plasma, u),
  rumble: lerp(...script.entry.rumble, u),
});

// ---------- the chase shot (flyby + entry + push-in): pure geometry ----------
// World frame: Earth's centre is the origin, lengths in Earth radii, the ship orbits in the XY plane (angle a from +Y, towards +X).
// The ship flies nose first: its velocity is exactly forward * speed, and the camera trails it (negative along forward).
const DEG = Math.PI / 180;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothStep = (u) => { const x = clamp01(u); return x * x * (3 - 2 * x); };

/** { fly, entry, push, dive (entry + push), total } in seconds. */
export function chaseTimes(script = RETURN_SCRIPT) {
  const d = (id) => script.segments.find((s) => s.id === id).dur;
  const fly = d('flyby');
  const entry = d('entry');
  const push = d('pushin');
  return { fly, entry, push, dive: entry + push, total: fly + entry + push };
}

/** Seconds into the chase shot for local time `local` of segment 'flyby' | 'entry' | 'pushin'. */
export function chaseTime(id, local, script = RETURN_SCRIPT) {
  const T = chaseTimes(script);
  return id === 'flyby' ? local : id === 'entry' ? T.fly + local : T.fly + T.entry + local;
}

function chaseRaw(t, script) {
  const T = chaseTimes(script);
  const F = script.flyby;
  const E = script.entry;
  const rFly = 1 + F.altitudeRatio;
  const vFly = ((F.arcDeg[1] - F.arcDeg[0]) * DEG * rFly) / T.fly;
  if (t <= T.fly) return { r: rFly, rdot: 0, v: vFly };
  const tau = t - T.fly;
  const w = clamp01(tau / T.dive);
  const e = 0.4 * smoothStep(w) + 0.6 * w * w; // zero slope at the start (no kink after the flyby), steeper towards the end
  const de = tau > T.dive ? 0 : (0.4 * 6 * w * (1 - w) + 1.2 * w) / T.dive;
  const [altA, altB] = E.altitudeRatio;
  return { r: 1 + altA + (altB - altA) * e, rdot: (altB - altA) * de, v: vFly + (E.endSpeed - vFly) * smoothStep(w) };
}

const chaseTables = new WeakMap();
const CHASE_DT = 0.02;
function chaseTable(script) {
  let table = chaseTables.get(script);
  if (table) return table;
  const T = chaseTimes(script);
  const n = Math.ceil(T.total / CHASE_DT) + 1;
  const rate = (t) => { const q = chaseRaw(t, script); return (q.v * Math.cos(Math.asin(Math.min(0.95, Math.max(0, -q.rdot / q.v))))) / q.r; };
  table = [script.flyby.arcDeg[0] * DEG];
  for (let k = 1; k < n; k += 1) table.push(table[k - 1] + 0.5 * (rate((k - 1) * CHASE_DT) + rate(k * CHASE_DT)) * CHASE_DT);
  chaseTables.set(script, table);
  return table;
}

/**
 * The ship and its camera t seconds into the chase shot (flyby, then entry, then push-in): { pos, forward, up, velocity, speed,
 * gamma (dive angle, rad), altitude (Earth radii), camOffset (camera minus ship, in ship heights) }.
 */
export function chaseState(t, script = RETURN_SCRIPT) {
  const T = chaseTimes(script);
  const tt = Math.min(T.total, Math.max(0, t));
  const table = chaseTable(script);
  const f = tt / CHASE_DT;
  const k = Math.min(table.length - 2, Math.floor(f));
  const a = table[k] + (table[k + 1] - table[k]) * (f - k);
  const { r, rdot, v } = chaseRaw(tt, script);
  const sinG = Math.min(0.95, Math.max(0, -rdot / v));
  const g = Math.asin(sinG);
  const cosG = Math.cos(g);
  const rad = { x: Math.sin(a), y: Math.cos(a), z: 0 };
  const tan = { x: Math.cos(a), y: -Math.sin(a), z: 0 };
  const forward = { x: tan.x * cosG - rad.x * sinG, y: tan.y * cosG - rad.y * sinG, z: 0 };
  const up = { x: rad.x * cosG + tan.x * sinG, y: rad.y * cosG + tan.y * sinG, z: 0 };
  // camera: behind (-forward), above (+up) and to the side (+Z), in ship heights
  const F = script.flyby;
  const E = script.entry;
  const kf = smoothStep(tt / T.fly);
  const ke = smoothStep((tt - T.fly) / T.entry);
  const back = (1 - kf) * 0.3 + kf * F.camera.back;
  const upV = F.camera.up;
  const side = F.camera.side[0] + (F.camera.side[1] - F.camera.side[0]) * kf;
  const cb = back + (E.camera.back - back) * ke;
  const cu = upV + (E.camera.up - upV) * ke;
  const cs = side + (E.camera.side - side) * ke;
  return {
    pos: { x: rad.x * r, y: rad.y * r, z: 0 },
    forward, up,
    velocity: { x: forward.x * v, y: forward.y * v, z: 0 },
    speed: v, gamma: g, altitude: r - 1,
    camOffset: { x: -forward.x * cb + up.x * cu, y: -forward.y * cb + up.y * cu, z: cs },
  };
}

/** True when the segment after `id` begins with a hard cut (no fade, no transition frame). */
export function cutsAfter(id, script = RETURN_SCRIPT) {
  const i = script.segments.findIndex((s) => s.id === id);
  return i >= 0 && !!script.segments[i + 1]?.cut;
}

// ---------- the player (browser only) ----------
const MARS_SUN = null; // the Mars scene lights itself
let run = null; // the one sequence playing

export const isReturnHomeActive = () => !!run;

/** Per-frame hook (src/flight/demo/index.js calls it every frame; it does nothing when nothing plays). */
export function updateReturnHome(dt) { run?.update(dt); }

/**
 * Starts the sequence. onDone() is called once when it ends by itself (not when stop() is called).
 * onHandoff() is called once, when the analysis starts fading out: the caller shows the memorial scroll then.
 * from: a segment id, to start there (debug). Returns stop().
 */
export function playReturnHome({ onDone = () => {}, onHandoff = () => {}, from = null } = {}) {
  run?.stop();
  const handle = createRun({ onDone, onHandoff, from });
  run = handle;
  return () => handle.stop();
}

export const stopReturnHome = () => run?.stop();

function createRun({ onDone, onHandoff, from }) {
  const schedule = buildSchedule();
  let alive = true;
  let ready = false;
  let finished = false;
  let handedOff = false;
  let clock = from ? startOf(schedule, from) : 0;
  let current = -1;
  let api = null;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  load().then((mods) => {
    if (!alive) return;
    api = mods.build(mods, { reduced, script: RETURN_SCRIPT, schedule });
    ready = true;
  }).catch((error) => {
    console.error('[demo] return home failed to start:', error);
    end(true);
  });
  document.body.classList.add('rh-on');

  function end(byItself) {
    if (finished) return;
    finished = true;
    alive = false;
    try { api?.dispose(); } catch (error) { console.error('[demo] return home cleanup:', error); }
    document.body.classList.remove('rh-on');
    if (run === handle) run = null;
    if (byItself) { try { onDone(); } catch (error) { console.error('[demo] return home onDone:', error); } }
  }

  const handle = {
    stop() { end(false); },
    update(dt) {
      if (!alive || !ready) return;
      clock += dt;
      const at = segmentAt(schedule, clock);
      if (!at) return end(true);
      if (at.index !== current) {
        // enter every skipped segment too when the frame was long, so scene state stays consistent
        current = at.index;
        api.enter(at);
      }
      api.tick(at, dt);
      try { segmentCues(at.id, at.local); } catch (error) { console.error('[demo] return home audio:', error); }
      if (at.id === 'analysis' && !handedOff && at.local >= RETURN_SCRIPT.analysis.handoffAt) {
        handedOff = true; // the memorial scroll starts fading in while the readout fades out
        try { onHandoff(); } catch (error) { console.error('[demo] return home onHandoff:', error); }
      }
    },
  };
  return handle;
}

async function load() {
  const [THREE, graphicsMod, core, audioMod, scenes, stack, impactMod, analysisMod] = await Promise.all([
    import('three'),
    import('/src/graphics/index.js'),
    import('/src/core/index.js'),
    import('/src/audio/index.js'),
    import('/src/surface/scenes.js'),
    import('../rocketStack.js'),
    import('./impact.js'),
    import('./analysis.js'),
    import('./returnHome.css'),
    import('./analysis.css'),
  ]);
  return { THREE, ...graphicsMod, ...core, audio: audioMod.audio, getMars: scenes.getMars, stackParts: stack.stackParts, createImpact: impactMod.createImpact, createAnalysis: analysisMod.createAnalysis, build: buildPlayer };
}

const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls ?? '', ...(text != null ? { textContent: text } : {}) });
const safe = (fn) => { try { return fn(); } catch { return undefined; } };
const smooth = (u) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };

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
  let seed = 23;
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

const LAMP_IDS = ['fire', 'dump', 'rcs-a', 'rcs-b', 'main', 'apu', 'pwr', 'comms', 'hatch', 'cabin', 'o2', 'arm', 'dock', 'para', 'entry'];
const BLINK_IDS = ['fire', 'main', 'dump', 'rcs-a', 'rcs-b', 'apu', 'entry', 'pwr', 'comms', 'dock'];

function buildPlayer(M, { reduced, script, schedule }) {
  const { THREE, assets, createSpaceScene, graphics, audio, getMars, getShip, PLANETS, createImpact, createAnalysis, stackParts } = M;
  const R_EARTH = PLANETS.earth.radius;
  ensureFonts();

  // ----- what to put back at the end -----
  const prev = { scene: graphics.scene, camera: graphics.camera };
  const mars = safe(() => getMars());
  if (mars?.lander) mars.lander.visible = false; // our own rocket takes off from here
  const cleanups = [];

  // ----- overlays (HTML) -----
  const root = el('div', `rh-root${reduced ? ' rh-reduced' : ''}`);
  const black = el('div', 'rh-black');
  const glare = el('div', 'rh-glare');
  const flash = el('div', 'rh-flash');
  const caption = el('div', 'rh-caption');
  const strip = el('div', 'rh-strip');
  const banner = el('div', 'rh-banner');
  const reminder = el('div', 'rh-reminder');
  const card = el('div', 'rh-card');
  const stars = el('canvas');
  const cardText = el('div', 'rh-card-text');
  card.append(stars, cardText);
  root.append(glare, flash, caption, strip, banner, card, reminder, black);
  const analysis = createAnalysis(root); // above the black layer, so it fades out onto black
  analysis.root.style.display = 'none';
  cleanups.push(() => analysis.dispose());
  document.body.append(root);
  cleanups.push(() => root.remove());

  const setBlack = (v, ms = 0) => { black.style.transition = ms ? `opacity ${ms}ms ease` : 'none'; black.style.opacity = String(v); };
  setBlack(1);

  let lampKey = '';
  const showLamps = (list) => {
    const key = JSON.stringify(list);
    if (key === lampKey) return;
    lampKey = key;
    strip.replaceChildren(...list.map((l) => { const row = el('div', `rh-lamp rh-${l.state}`); row.append(el('i'), el('span', '', l.text)); return row; }));
    strip.classList.toggle('on', list.length > 0);
  };
  let capText = '';
  const showCaption = (text) => {
    if (text === capText) return;
    capText = text;
    if (text) caption.textContent = text;
    caption.classList.toggle('on', !!text);
  };
  let bannerKey = '';
  const showBanner = (kind, text, repeat = 1) => {
    const key = `${kind}|${text}|${repeat}`;
    if (key === bannerKey) return;
    bannerKey = key;
    banner.className = `rh-banner${kind ? ` on rh-${kind}` : ''}`;
    banner.replaceChildren(...Array.from({ length: kind ? repeat : 0 }, () => el('div', 'rh-banner-line', text)));
  };

  // ----- cameras and views -----
  const view = (scene, camera) => { if (graphics.scene !== scene || graphics.camera !== camera) graphics.setView(scene, camera); };
  const fx = (o) => graphics.setEffects({ vignette: 0, blackout: 0, shake: 0, ...o });
  const play = (id, o) => safe(() => audio.play(id, o));
  const stopSound = (id) => safe(() => audio.stop(id));
  cleanups.push(() => { safe(() => audio.stop('engine.rumble')); safe(() => fx({})); });

  // The player's own rocket (same stacking as flight/index.js buildRocket; local +Y is the nose, the base is the origin).
  function buildRocket() {
    const spec = getShip();
    const rocket = new THREE.Group();
    const parts = spec?.parts?.length ? spec.parts : ['engine_m', 'tank_l', 'tank_l', 'capsule_m'].map((type, i) => ({ id: `d${i}`, type, x: 0, y: i, z: 0 }));
    const models = new Map(parts.map((p) => [p, assets.get(`rocketPart:${p.type}`)]));
    const { placed, top } = stackParts(parts, (p) => models.get(p).userData.height ?? 2);
    for (const p of parts) {
      const part = models.get(p);
      part.position.set(p.x ?? 0, placed.get(p), p.z ?? 0);
      part.rotation.y = THREE.MathUtils.degToRad(p.rotation ?? 0);
      rocket.add(part);
    }
    const flame = assets.get('vfx:engineFlame');
    const exhaust = assets.get('vfx:exhaust');
    rocket.add(flame, exhaust);
    const root3 = new THREE.Group();
    root3.add(rocket);
    return { root: root3, rocket, flame, exhaust, height: Math.max(top, 4) };
  }

  const earthScene = (sunDir) => {
    const scene = createSpaceScene();
    const sun = new THREE.DirectionalLight(0xfff4e6, 3.2);
    sun.position.copy(sunDir).multiplyScalar(100);
    scene.add(sun, new THREE.AmbientLight(0x30405a, 0.45));
    const planet = assets.get('planet:earth');
    planet.scale.setScalar(R_EARTH);
    scene.add(planet);
    return { scene, planet, sun };
  };

  // ----- 7a: liftoff from Mars -----
  const lift = { cam: new THREE.PerspectiveCamera(55, 1, 0.3, 2e5), built: false };
  function buildLiftoff() {
    if (lift.built) return;
    lift.built = true;
    const ground = M.getTerrainHeight?.(0, 0) ?? 0;
    lift.ground = ground;
    lift.rocket = buildRocket();
    lift.rocket.root.position.set(0, ground + 0.15, 0);
    lift.dust = assets.get('vfx:landingDust');
    lift.dust.position.set(0, ground, 0);
    const scene = mars?.scene ?? createSpaceScene();
    if (!mars) scene.add(new THREE.AmbientLight(0xffffff, 1));
    scene.add(lift.rocket.root, lift.dust);
    lift.scene = scene;
    cleanups.push(() => { scene.remove(lift.rocket.root, lift.dust); if (mars?.lander) mars.lander.visible = true; });
  }
  function tickLiftoff(local) {
    const L = script.liftoff;
    const burn = Math.max(0, local - L.ignite);
    const alt = 0.5 * L.acceleration * burn * burn;
    const throttle = smooth(local / L.ignite);
    const r = lift.rocket;
    r.root.position.y = lift.ground + 0.15 + alt;
    r.root.rotation.z = -0.5 * smooth((burn - 3) / 4); // gravity turn
    r.flame.userData.set({ throttle, airDensity: Math.max(0.1, 0.35 - alt / 600) });
    r.exhaust.userData.set({ throttle, airDensity: Math.max(0.1, 0.35 - alt / 600) });
    lift.dust.userData.set?.({ intensity: Math.min(1, throttle * 1.1) * Math.max(0, 1 - alt / 120) });
    const h = r.height;
    const dist = 34 + h * 1.3 + alt * 0.05;
    lift.cam.position.set(dist * 0.78, lift.ground + 2.2, dist * 0.92);
    const target = new THREE.Vector3(0, lift.ground + h * 0.4 + alt * 0.97, 0);
    lift.cam.lookAt(target);
    lift.cam.rotation.z += Math.sin(local * 0.7) * 0.004;
    fx({ shake: 0.1 + 0.25 * throttle * Math.max(0, 1 - alt / 200) });
  }

  // ----- 7c-7e: one continuous chase shot: flyby -> atmospheric entry -> push-in to the window (chaseState below) -----
  // The ship sits at the origin of the scene, nose along its velocity; Earth is moved by -(ship position), so the surface
  // slides from the nose side toward the tail, under and past the camera that trails the ship.
  const SUN_FLY = new THREE.Vector3(...script.flyby.sun).normalize();
  const ch = { cam: new THREE.PerspectiveCamera(50, 1, 0.05, 1e10), built: false, fwd: new THREE.Vector3(), up: new THREE.Vector3(), pos: new THREE.Vector3(), look: new THREE.Vector3(), basis: new THREE.Matrix4(), tmp: new THREE.Vector3(), tmp2: new THREE.Vector3(), tmp3: new THREE.Vector3(), switched: false };
  const V3 = (o, v) => o.set(v.x, v.y, v.z);
  function glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    cleanups.push(() => tex.dispose());
    return tex;
  }
  function buildChase() {
    if (ch.built) return;
    ch.built = true;
    const { scene, planet, sun } = earthScene(SUN_FLY);
    ch.scene = scene;
    ch.planet = planet;
    ch.sun = sun;
    ch.rocket = buildRocket();
    const h = ch.rocket.height;
    ch.h = h;
    ch.rocket.rocket.position.y = -h / 2; // the ship is centred on the origin
    ch.rocket.flame.userData.set({ throttle: 0, airDensity: 0 });
    ch.rocket.exhaust.userData.set({ throttle: 0, airDensity: 0 });
    scene.add(ch.rocket.root, ch.cam);
    // the sky: a dome around the ship that goes from clear (black space) to deep blue to a lighter blue
    const dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 24, 16), new THREE.MeshBasicMaterial({ color: 0x0c2f78, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    dome.renderOrder = -1;
    dome.frustumCulled = false;
    scene.add(dome);
    ch.dome = dome;
    ch.skyA = new THREE.Color(0x0c2f78);
    ch.skyB = new THREE.Color(0x86b6ee);
    // plasma: the rocket's entry plasma sheet at the nose (turned to face the camera, flowing back) + a glow and a flickering additive trail
    ch.plasma = assets.get('vfx:entryPlasma');
    ch.plasma.position.set(0, -0.3, 1.42); // plane centre on the pivot
    ch.pivot = new THREE.Group();
    ch.pivot.add(ch.plasma);
    ch.pivot.scale.setScalar(h * 0.75);
    ch.plasma.userData.set({ intensity: 0 });
    scene.add(ch.pivot);
    const tex = glowTexture();
    const mk = () => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0 }));
      scene.add(sp);
      return sp;
    };
    ch.nose = mk();
    ch.trail = Array.from({ length: 46 }, (_, i) => ({ sp: mk(), k: i / 45, seed: Math.sin(i * 12.9898) * 43758.5453 % 1 }));
    ch.cYoung = new THREE.Color(0xfff0c0);
    ch.cMid = new THREE.Color(0xff8a2a);
    ch.cOld = new THREE.Color(0xc02a0a);
    ch.cTmp = new THREE.Color();
  }
  // seg: 'flyby' | 'entry' | 'pushin'; local seconds into it; u 0..1 in it
  function tickChase(seg, local, u) {
    const E = script.entry;
    const st = chaseState(chaseTime(seg, local, script), script);
    const h = ch.h;
    V3(ch.fwd, st.forward);
    V3(ch.up, st.up);
    // Earth relative to the ship; the nose points along the velocity (chaseState guarantees it)
    ch.planet.position.set(-st.pos.x * R_EARTH, -st.pos.y * R_EARTH, -st.pos.z * R_EARTH);
    ch.rocket.root.quaternion.setFromUnitVectors(UP, ch.fwd);
    // levels of the entry
    const eu = seg === 'flyby' ? 0 : seg === 'entry' ? u : 1;
    const lv = entryLevels(eu, script);
    const i = lv.plasma;
    ch.dome.material.opacity = lerpC(E.sky[0], E.sky[1], smooth((eu - 0.12) / 0.88));
    ch.dome.material.color.copy(ch.skyA).lerp(ch.skyB, smooth((eu - 0.45) / 0.55));
    // plasma sheet at the nose
    const flick = 0.85 + 0.15 * Math.sin(local * 37) * Math.sin(local * 23);
    const nosePos = ch.tmp.copy(ch.fwd).multiplyScalar(h * 0.5);
    // camera
    const co = st.camOffset;
    ch.pos.set(co.x * h, co.y * h, co.z * h);
    ch.look.copy(ch.fwd).multiplyScalar(h * 1.8).addScaledVector(ch.up, -h * 0.12);
    let fov = 50;
    if (seg === 'pushin') {
      const P = script.pushin;
      const k = smooth(u);
      ch.tmp2.copy(ch.fwd).multiplyScalar(h * P.eye);
      ch.pos.lerp(ch.tmp2, k);
      ch.tmp3.copy(ch.tmp2).addScaledVector(ch.fwd, h);
      ch.look.lerp(ch.tmp3, k);
      fov = lerpC(50, P.fov, k);
      glare.style.opacity = String(smooth((u - P.glare[0]) / (P.glare[1] - P.glare[0])));
      if (u >= P.glare[1] && !ch.switched) ch.switched = true; // the caller switches to the cockpit view
    } else ch.switched = false;
    if (ch.cam.fov !== fov) { ch.cam.fov = fov; ch.cam.updateProjectionMatrix(); }
    ch.cam.position.copy(ch.pos);
    ch.cam.up.copy(ch.up);
    ch.cam.lookAt(ch.look);
    ch.cam.updateMatrixWorld(true);
    // plasma pivot: +Y of the sheet flows back along the ship, its face turns toward the camera
    const zAxis = ch.tmp3.copy(ch.pos).sub(nosePos);
    zAxis.addScaledVector(ch.fwd, -zAxis.dot(ch.fwd));
    if (zAxis.lengthSq() < 1e-6) zAxis.copy(ch.up);
    zAxis.normalize();
    const yAxis = ch.tmp2.copy(ch.fwd).negate();
    const xAxis = ch.look.crossVectors(yAxis, zAxis).normalize(); // reused as scratch (look is rebuilt every frame)
    ch.basis.makeBasis(xAxis, yAxis, zAxis);
    ch.pivot.quaternion.setFromRotationMatrix(ch.basis);
    ch.pivot.position.copy(nosePos).addScaledVector(ch.fwd, -0.675 * h * 0.75); // the sheet's hot zone sits on the nose
    ch.plasma.userData.set({ intensity: i * (0.35 + 0.65 * i) });
    ch.nose.position.copy(nosePos);
    ch.nose.scale.setScalar(h * (0.3 + 1.7 * i) * flick);
    ch.nose.material.color.copy(ch.cTmp.copy(ch.cMid).lerp(ch.cYoung, i));
    ch.nose.material.opacity = Math.min(1, i * 1.6) * 0.9;
    for (const t of ch.trail) {
      const k = t.k;
      const sway = Math.sin(local * 9 + k * 7 + t.seed * 6) * 0.1 * h * k;
      t.sp.position.copy(nosePos).addScaledVector(ch.fwd, -k * 7 * h).addScaledVector(ch.up, k * k * 0.9 * h + sway);
      t.sp.position.z += Math.cos(local * 8 + k * 5 + t.seed * 9) * 0.1 * h * k;
      t.sp.scale.setScalar(h * (0.45 + 1.9 * k) * (0.55 + 0.45 * i) * (0.9 + 0.1 * Math.sin(local * 30 + k * 12)));
      t.sp.material.opacity = i * Math.pow(1 - k, 1.3) * 0.75 * (0.8 + 0.2 * Math.sin(local * 26 + t.seed * 20));
      t.sp.material.color.copy(k < 0.4 ? ch.cYoung.clone().lerp(ch.cMid, k / 0.4) : ch.cMid.clone().lerp(ch.cOld, (k - 0.4) / 0.6));
    }
    fx(seg === 'flyby' ? {} : { shake: lv.shake });
  }

  // ----- 7d-7f: the cockpit -----
  const cock = { cam: new THREE.PerspectiveCamera(65, 1, 0.05, 1e10), built: false, press: 0, alarmT: 0, blinkT: 0, lastBlink: -1, soundT: 0 };
  const UP = new THREE.Vector3(0, 1, 0);
  function buildCockpit() {
    if (cock.built) return;
    cock.built = true;
    const sun = new THREE.Vector3(0.7, 0.45, 0.55).normalize();
    const { scene, planet } = earthScene(sun);
    cock.sun = sun;
    cock.scene = scene;
    cock.planet = planet;
    const rig = new THREE.Group();
    cock.rig = rig;
    cock.cockpit = assets.get('cockpit');
    cock.plasma = assets.get('vfx:entryPlasma');
    cock.cockpit.add(cock.plasma);
    cock.plasma.userData.set({ intensity: 0 });
    rig.add(cock.cockpit, cock.cam);
    scene.add(rig);
    cock.ud = cock.cockpit.userData;
    setAltitude(120, 0.2);
    // where the PARA button is, in rig space; and the close-up pose looking at it
    rig.updateMatrixWorld(true);
    const centre = new THREE.Vector3(0.25, -0.42, -0.7);
    const box = new THREE.Box3();
    cock.cockpit.traverse((o) => { if (/^btn(Cap|Lamp)?[.:]?para$/i.test(o.name)) box.expandByObject(o); });
    if (!box.isEmpty()) box.getCenter(centre);
    rig.worldToLocal(centre);
    const dist = Math.max(centre.length(), 0.01);
    cock.btn = centre;
    cock.zoomPos = centre.clone().addScaledVector(centre.clone().normalize(), -Math.min(0.32, dist * 0.6));
    cock.zoomQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(cock.zoomPos, centre, UP));
  }
  function setAltitude(km, dipDeg) {
    const alt = km * 1000;
    const horizon = Math.asin(R_EARTH / (R_EARTH + alt));
    const a = horizon + THREE.MathUtils.degToRad(dipDeg ?? 12); // planet centre this far below the forward line, so the limb sits just under it
    cock.planet.position.set(0, -Math.sin(a), -Math.cos(a)).multiplyScalar(R_EARTH + alt);
  }
  const lampAll = (state) => { if (cock.ud?.setButton) for (const id of LAMP_IDS) cock.ud.setButton(id, state); };
  const pressPara = () => cock.ud?.press?.('para');
  const cockCamera = (e, pitch = 0) => {
    const base = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, 0, 0));
    const k = smooth(e);
    cock.cam.position.copy(cock.zoomPos).multiplyScalar(k);
    cock.cam.quaternion.copy(base).slerp(cock.zoomQuat, k);
  };

  // ----- 7g: the impact, outside, low camera on the steppe -----
  let impact = null;

  // ----- per-segment state -----
  const mem = { pressed: 0, panicPresses: panicPressTimes(script), panicIdx: 0, rumbling: false, engine: false };

  function enter(at) {
    const { id } = at;
    showBanner('', '');
    showLamps([]);
    showCaption('');
    reminder.replaceChildren();
    card.classList.remove('on');
    glare.classList.toggle('rh-hot', id === 'pushin' || id === 'parachute');
    if (id !== 'parachute' && id !== 'pushin') glare.style.opacity = '0';
    if (id !== 'reminder' && id !== 'analysis') setBlack(0);
    switch (id) {
      case 'liftoff':
        buildLiftoff();
        view(lift.scene, lift.cam);
        setBlack(1);
        later(() => setBlack(0, script.liftoff.fadeIn * 1000), 30);
        showCaption(at.seg.caption);
        play('engine.rumble', { loop: true, volume: 0.9 });
        mem.engine = true;
        break;
      case 'skip':
        stopSound('engine.rumble');
        mem.engine = false;
        drawStars(stars);
        cardText.textContent = at.seg.text;
        cardText.classList.remove('show');
        card.style.transition = 'opacity .45s ease';
        card.classList.add('on');
        setBlack(0);
        later(() => cardText.classList.add('show'), script.skip.textAt * 1000);
        fx({});
        break;
      case 'flyby':
        buildChase();
        view(ch.scene, ch.cam);
        graphics.setSunDirection(SUN_FLY);
        card.classList.remove('on');
        showCaption(at.seg.caption);
        break;
      case 'entry':
      case 'pushin':
        buildChase(); // the same scene and camera as the flyby: no cut
        view(ch.scene, ch.cam);
        graphics.setSunDirection(SUN_FLY);
        if (!mem.rumbling) { mem.rumbling = true; play('engine.rumble', { loop: true, volume: 0.4 }); }
        if (id === 'pushin') glare.style.opacity = '0';
        break;
      case 'parachute':
        buildCockpit();
        view(cock.scene, cock.cam);
        graphics.setSunDirection(cock.sun);
        lampAll('green');
        cock.ud?.setButton?.('para', 'amber');
        mem.pressed = 0;
        cock.ud?.setAlarm?.(false);
        cockCamera(0);
        glare.style.opacity = '1'; // the glare of the push-in clears over the first half second
        setAltitude(70, 12);
        if (!mem.rumbling) { mem.rumbling = true; play('engine.rumble', { loop: true, volume: 0.3 }); }
        showBanner('go', script.parachute.banner);
        break;
      case 'panic':
        buildCockpit();
        view(cock.scene, cock.cam);
        mem.panicIdx = 0;
        cock.alarmT = 0;
        cock.lastBlink = -1;
        cock.ud?.setAlarm?.(true);
        showBanner('panic', script.panic.banner, script.panic.bannerRepeat);
        break;
      case 'impact':
        cleanupCockpitAudio();
        impact ??= createImpact({ hitAt: script.impact.hitAt, fallFrom: script.impact.fallFrom });
        view(impact.scene, impact.camera);
        graphics.setSunDirection?.(impact.sunDirection);
        glare.style.opacity = '0';
        fx({});
        setBlack(0);
        play('engine.rumble', { loop: true, volume: 0.3 }); // wind of the fall; the boom replaces it at the hit
        mem.rumbling = true;
        break;
      case 'reminder':
        cleanupCockpitAudio();
        setBlack(1); // a cut to black, then 2 s of silence
        flash.style.opacity = '0';
        fx({});
        break;
      case 'analysis':
        setBlack(1);
        analysis.root.style.display = '';
        analysis.update(0);
        break;
      default: break;
    }
  }

  function cleanupCockpitAudio() {
    stopSound('engine.rumble');
    mem.rumbling = false;
    cock.ud?.setAlarm?.(false);
  }

  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  cleanups.push(() => timers.forEach(clearTimeout));

  let shownLines = 0;
  function tick(at, dt) {
    const { id, local, u } = at;
    switch (id) {
      case 'liftoff': tickLiftoff(local); break;
      case 'skip': break;
      case 'flyby': tickChase('flyby', local, u); break;
      case 'entry':
        tickChase('entry', local, u);
        showLamps(lampsAt(script.entry.lamps, local));
        break;
      case 'pushin':
        tickChase('pushin', local, u);
        if (ch.switched) { // behind the glare: from here the camera is the pilot's eye (the parachute segment goes on from this view)
          buildCockpit();
          view(cock.scene, cock.cam);
          graphics.setSunDirection(cock.sun);
          cockCamera(0);
          cock.plasma.userData.set({ intensity: 0.7 });
        }
        break;
      case 'parachute': {
        const P = script.parachute;
        glare.style.opacity = String(Math.max(0, 1 - local / P.glareFade));
        const plasma = 0.7 * Math.max(0, 1 - local / P.plasmaFade); // cut in from the outside view with the glow still on the window
        cock.plasma.userData.set({ intensity: plasma });
        fx({ shake: lerpC(script.entry.shake[1], P.shake, local / P.plasmaFade) });
        const zoomU = (local - P.zoom[0]) / (P.zoom[1] - P.zoom[0]);
        cockCamera(zoomU, 0);
        if (mem.pressed === 0 && local >= P.pressAt) { mem.pressed = 1; pressPara(); play('cockpit.switch'); audioCue('press'); cock.ud?.setButton?.('para', 'green'); }
        const lamps = lampsAt(P.lamps, local);
        showLamps(lamps);
        if (lamps.some((l) => l.state === 'red') && mem.pressed === 1) { cock.ud?.setButton?.('para', 'red'); if (mem.pressed === 1) { mem.pressed = 2; play('ui.error'); } }
        setAltitude(lerpC(70, 60, u), 12);
        break;
      }
      case 'panic': {
        const P = script.panic;
        cock.plasma.userData.set({ intensity: 0 });
        fx({ shake: lerpC(P.shake[0], P.shake[1], u), vignette: 0.25 * u });
        while (mem.panicIdx < mem.panicPresses.length && local >= mem.panicPresses[mem.panicIdx]) {
          mem.panicIdx += 1;
          pressPara();
          if (audioHas('sfx_button_click')) audioCue('press'); else play('cockpit.switch', { volume: 0.6 });
        }
        cock.alarmT -= dt;
        if (cock.alarmT <= 0) { cock.alarmT = P.alarmEvery; if (!audioHas('sfx_alarm_rapid')) play('alarm.master'); } // the demo's own alarm loop replaces it when present
        const phase = Math.floor(local / P.blinkEvery);
        if (phase !== cock.lastBlink) {
          cock.lastBlink = phase;
          BLINK_IDS.forEach((id2, i) => cock.ud?.setButton?.(id2, (phase + i) % 3 === 0 ? 'amber' : (phase + i) % 3 === 1 ? 'red' : 'off'));
          cock.ud?.setButton?.('para', phase % 2 ? 'red' : 'off');
        }
        showLamps(lampsAt(P.lamps, local));
        const pull = smooth(u / P.pullBack[1]);
        cockCamera(1 - 0.8 * pull, 0.5 * pull); // back from the button toward the window, nose down: the ground fills it
        setAltitude(lerpC(P.altitudeKm[0], P.altitudeKm[1], u * u), lerpC(12, 28, u));
        glare.style.opacity = String(lerpC(P.glare[0], P.glare[1], u));
        break;
      }
      case 'impact': {
        const r = impact.update(dt);
        fx({ shake: r.shake });
        flash.style.opacity = String(r.flash);
        if (r.impacted) {
          audioCue('impactHit'); // every voice and loop is cut; the explosion
          stopSound('engine.rumble');
          play('impact.small', { volume: 1 });
          play('impact.small', { volume: 1, rate: 0.5 });
          play('engine.rumble', { loop: true, volume: 1 }); // a deep boom: the rumble burst, cut short
          later(() => stopSound('engine.rumble'), 900);
        }
        break;
      }
      case 'reminder': {
        const lines = reminderLinesAt(local, script);
        while (shownLines < lines.length) {
          const spec = lines[shownLines];
          const node = el('div', `rh-line rh-${spec.style}`, spec.text);
          reminder.append(node);
          later(() => node.classList.add('show'), 30);
          shownLines += 1;
        }
        break;
      }
      case 'analysis':
        analysis.update(local);
        if (local >= script.analysis.handoffAt && !mem.analysisOut) { mem.analysisOut = true; analysis.fadeOut(script.analysis.fadeOutS); }
        break;
      default: break;
    }
  }

  const lerpC = (a, b, x) => a + (b - a) * Math.min(1, Math.max(0, x));

  function dispose() {
    cleanups.reverse().forEach((fn) => safe(fn));
    impact?.dispose();
    safe(() => { prev.scene && graphics.setView(prev.scene, prev.camera); });
  }

  return { enter, tick, dispose };
}
