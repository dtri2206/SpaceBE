/**
 * audio.play(id, { volume, loop, rate, fadeIn })  plays a sound, and audio.stop(id) stops a loop.
 * audio.setAir(0..1)  thins engine and world sound as the air thins (1 at sea level, 0 in vacuum). UI sounds ignore it.
 * audio.register(id, url, { bus, loop, gain, loopTrim })  swaps a synthesised placeholder for a real file, with nobody else's code changing.
 * audio.preload(ids) fetches (and decodes, once unlocked) files ahead of time; audio.isLoaded(id); audio.playing() lists active ids.
 * Real recordings are in public/assets/audio (see CREDITS.md). If one fails to load, its synth plays instead, with one warning.
 *
 * Browsers only allow sound after a click or key press. Loops requested earlier start at that moment; one-shots are dropped.
 */

function noiseBuffer(ctx, seconds = 2) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function tone(ctx, out, { frequency = 880, type = 'sine', time = 0, length = 0.1, volume = 0.2, slide }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const t = ctx.currentTime + time;
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + length);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + length + 0.02);
  return t + length + 0.02;
}

function noiseLoop(ctx, out, { type = 'lowpass', frequency = 400, q = 0.7, volume = 0.3, wobble = 0, wobbleRate = 0.3 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  src.connect(filter).connect(gain).connect(out);
  src.start();
  const parts = [src];
  if (wobble) {
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = wobbleRate;
    depth.gain.value = wobble;
    lfo.connect(depth).connect(gain.gain);
    lfo.start();
    parts.push(lfo);
  }
  return { nodes: parts, gain };
}

// Placeholder sounds, so every id works from the first hour. `bus` is 'ui' or 'world'.
const SYNTHS = {
  'ui.hover': { bus: 'ui', play: (c, o) => tone(c, o, { frequency: 1500, length: 0.035, volume: 0.035 }) },
  'ui.click': { bus: 'ui', play: (c, o) => tone(c, o, { frequency: 900, type: 'square', length: 0.05, volume: 0.05 }) },
  'ui.snap': { bus: 'ui', play: (c, o) => { tone(c, o, { frequency: 240, type: 'triangle', length: 0.08, volume: 0.3, slide: 90 }); tone(c, o, { frequency: 1800, type: 'square', length: 0.018, volume: 0.05 }); } },
  'ui.error': { bus: 'ui', play: (c, o) => { tone(c, o, { frequency: 220, type: 'sawtooth', length: 0.13, volume: 0.09 }); tone(c, o, { frequency: 165, type: 'sawtooth', length: 0.18, time: 0.13, volume: 0.09 }); } },
  'gonogo.tick': { bus: 'ui', play: (c, o) => tone(c, o, { frequency: 1200, length: 0.09, volume: 0.1 }) },
  'alarm.master': { bus: 'ui', play: (c, o) => { for (let i = 0; i < 4; i++) tone(c, o, { frequency: i % 2 ? 660 : 880, type: 'square', length: 0.16, time: i * 0.18, volume: 0.08 }); } },
  'alarm.o2': { bus: 'ui', play: (c, o) => { tone(c, o, { frequency: 980, length: 0.12, volume: 0.13 }); tone(c, o, { frequency: 980, length: 0.12, time: 0.22, volume: 0.13 }); } },
  'radio.blip': { bus: 'ui', play: (c, o) => { tone(c, o, { frequency: 1400, length: 0.06, volume: 0.06 }); tone(c, o, { frequency: 1000, length: 0.06, time: 0.07, volume: 0.06 }); } },
  'impact.small': { bus: 'world', play: (c, o) => tone(c, o, { frequency: 150, type: 'triangle', length: 0.3, volume: 0.5, slide: 40 }) },
  'engine.rumble': { bus: 'world', loop: (c, o) => noiseLoop(c, o, { frequency: 150, volume: 0.9, wobble: 0.14, wobbleRate: 7 }) },
  'ambience.ship': { bus: 'ui', loop: (c, o) => noiseLoop(c, o, { frequency: 240, volume: 0.09, wobble: 0.015, wobbleRate: 0.2 }) },
  'ambience.mars': { bus: 'ui', loop: (c, o) => noiseLoop(c, o, { type: 'bandpass', frequency: 420, q: 0.5, volume: 0.05, wobble: 0.025, wobbleRate: 0.13 }) },
  'suit.breath': { bus: 'ui', loop: (c, o) => noiseLoop(c, o, { type: 'bandpass', frequency: 1300, q: 0.8, volume: 0.05, wobble: 0.05, wobbleRate: 0.28 }) },
  'radio.static': { bus: 'ui', loop: (c, o) => noiseLoop(c, o, { type: 'highpass', frequency: 2600, volume: 0.016 }) },
};

const FILE_BASE = `${import.meta.env?.BASE_URL ?? '/'}assets/audio/`;

// Real recordings (see CREDITS.md). Loops are built to repeat seamlessly; loopTrim skips the MP3 padding at both ends.
const FILES = [
  ['engine.rumble', 'engine_rumble.mp3', { bus: 'world', loop: true, gain: 0.9, loopTrim: 0.05 }],
  ['ambience.ship', 'ambience_ship.mp3', { bus: 'ui', loop: true, gain: 0.25, loopTrim: 0.05 }],
  ['ambience.mars', 'ambience_mars.mp3', { bus: 'ui', loop: true, gain: 0.5, loopTrim: 0.05 }],
  ['suit.breath', 'suit_breath.mp3', { bus: 'ui', loop: true, gain: 0.3, loopTrim: 0.05 }],
  ['radio.static', 'radio_static.mp3', { bus: 'ui', loop: true, gain: 0.06, loopTrim: 0.05 }],
  ['radio.chatter', 'radio_chatter.mp3', { bus: 'ui', loop: false, gain: 0.4 }],
];

class AudioManager {
  #ctx = null;
  #buses = {};
  #air = null;
  #active = new Map(); // id -> Set of { out, nodes, pending, cancelled, loop }
  #queuedLoops = new Map();
  #files = new Map();
  #warned = new Set();
  #unlockBound = false;
  #volume = 1;

  constructor() {
    if (typeof window !== 'undefined') this.#bindUnlock();
    FILES.forEach(([id, name, options]) => this.register(id, FILE_BASE + name, options));
  }

  #bindUnlock() {
    if (this.#unlockBound) return;
    this.#unlockBound = true;
    const unlock = () => {
      this.#start();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  #start() {
    if (this.#ctx) return;
    const ctx = new AudioContext();
    this.#ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.#volume;
    master.connect(ctx.destination);
    const ui = ctx.createGain();
    const world = ctx.createGain();
    this.#air = ctx.createBiquadFilter();
    this.#air.type = 'lowpass';
    this.#air.frequency.value = 18000;
    ui.connect(master);
    world.connect(this.#air).connect(master);
    this.#buses = { ui, world, master };
    this.#files.forEach((file) => { if (file.bytes) this.#ensureBuffer(file); }); // decode what was fetched before the click
    this.#queuedLoops.forEach((options, id) => this.play(id, options));
    this.#queuedLoops.clear();
  }

  get unlocked() {
    return this.#ctx !== null;
  }

  register(id, url, { bus = 'ui', loop = false, gain = 1, loopTrim = 0 } = {}) {
    this.#files.set(id, { id, url, bus, loop, gain, loopTrim, bytes: null, buffer: null, failed: false, fetching: null, decoding: null });
  }

  #warnOnce(key, message) {
    if (this.#warned.has(key)) return;
    this.#warned.add(key);
    console.warn(message);
  }

  #fail(file, reason) {
    file.failed = true;
    file.bytes = null;
    this.#warnOnce(`fail:${file.id}`, `[audio] could not load "${file.id}" (${reason}); ${SYNTHS[file.id] ? 'using the synthesised sound' : 'it stays silent'}`);
  }

  /** Fetches the bytes once; every caller shares the same promise. */
  #fetchBytes(file) {
    if (file.failed || file.bytes || file.buffer) return Promise.resolve();
    file.fetching ??= fetch(file.url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((bytes) => { file.bytes = bytes; })
      .catch((e) => this.#fail(file, e?.message || 'fetch failed'))
      .finally(() => { file.fetching = null; });
    return file.fetching;
  }

  /** Fetches, and decodes once the audio context exists. Resolves when done; never rejects. */
  async #ensureBuffer(file) {
    await this.#fetchBytes(file);
    if (file.failed || file.buffer || !this.#ctx) return;
    file.decoding ??= this.#ctx.decodeAudioData(file.bytes)
      .then((buffer) => { file.buffer = buffer; file.bytes = null; })
      .catch((e) => this.#fail(file, `decode failed: ${e?.message || e}`))
      .finally(() => { file.decoding = null; });
    await file.decoding;
  }

  /** Resolves when those files' bytes are fetched, and decoded if the audio context exists. Before the first click the bytes wait and are decoded at unlock. */
  preload(ids = [...this.#files.keys()]) {
    const list = (Array.isArray(ids) ? ids : [ids]).map((id) => this.#files.get(id)).filter(Boolean);
    return Promise.all(list.map((file) => this.#ensureBuffer(file))).then(() => undefined);
  }

  isLoaded(id) {
    return Boolean(this.#files.get(id)?.buffer);
  }

  /** Ids of loops and one-shot files that are playing or still loading. */
  playing() {
    return [...this.#active.keys()];
  }

  #track(id, entry) {
    let set = this.#active.get(id);
    if (!set) this.#active.set(id, (set = new Set()));
    set.add(entry);
  }

  #untrack(id, entry) {
    const set = this.#active.get(id);
    if (!set) return;
    set.delete(entry);
    if (!set.size) this.#active.delete(id);
  }

  play(id, options = {}) {
    const { volume = 1, loop, rate = 1, fadeIn = 0 } = options;
    const synth = SYNTHS[id];
    const file = this.#files.get(id);
    if (!synth && !file) {
      this.#warnOnce(id, `[audio] no sound for "${id}" yet`);
      return;
    }
    const useFile = file && !file.failed;
    const looping = loop ?? (file ? file.loop : Boolean(synth.loop));
    if (!this.#ctx) {
      if (looping) {
        this.#queuedLoops.set(id, options);
        if (useFile) this.#fetchBytes(file);
      }
      return;
    }
    if (this.#ctx.state === 'suspended') this.#ctx.resume();
    if (!useFile && !synth) return; // a file that failed and has no synth stays silent
    if (looping && this.#active.has(id)) return;
    const bus = this.#buses[file?.bus ?? synth.bus];
    const out = this.#ctx.createGain();
    const level = useFile ? volume * file.gain : volume;
    out.gain.value = fadeIn > 0 ? 0 : level;
    if (fadeIn > 0) out.gain.linearRampToValueAtTime(level, this.#ctx.currentTime + fadeIn);
    out.connect(bus);
    const entry = { out, nodes: [], pending: useFile && !file.buffer, cancelled: false, loop: looping, base: useFile ? file.gain : 1 };
    if (useFile) {
      this.#track(id, entry);
      this.#playFile(id, file, entry, { volume, looping, rate });
    } else {
      this.#playSynth(id, synth, entry, looping);
    }
  }

  #playSynth(id, synth, entry, looping) {
    if (looping && synth.loop) {
      this.#track(id, entry);
      Object.assign(entry, synth.loop(this.#ctx, entry.out));
    } else if (synth.play) {
      synth.play(this.#ctx, entry.out);
    }
  }

  async #playFile(id, file, entry, { volume, looping, rate }) {
    if (!file.buffer) await this.#ensureBuffer(file);
    if (entry.cancelled) return; // stop() came in while loading
    if (!file.buffer) { // failed: the warning is out already, so fall back
      this.#untrack(id, entry);
      const synth = SYNTHS[id];
      if (!synth) { entry.out.disconnect(); return; }
      entry.out.gain.value = volume;
      entry.pending = false;
      this.#playSynth(id, synth, entry, looping);
      return;
    }
    entry.pending = false;
    const src = this.#ctx.createBufferSource();
    src.buffer = file.buffer;
    src.loop = looping;
    const trim = file.loopTrim;
    if (looping && trim > 0 && file.buffer.duration > trim * 4) {
      src.loopStart = trim;
      src.loopEnd = file.buffer.duration - trim;
    }
    src.playbackRate.value = rate;
    src.connect(entry.out);
    src.onended = () => {
      src.disconnect();
      entry.out.disconnect();
      this.#untrack(id, entry);
    };
    entry.nodes = [src];
    src.start(0, looping && trim > 0 && src.loopEnd ? trim : 0);
  }

  stop(id, { fade = 0.4 } = {}) {
    this.#queuedLoops.delete(id);
    const set = this.#active.get(id);
    if (!set || !this.#ctx) return;
    this.#active.delete(id);
    const now = this.#ctx.currentTime;
    set.forEach((entry) => {
      if (entry.pending) { // still loading: make sure it never starts
        entry.cancelled = true;
        entry.out.disconnect();
        return;
      }
      entry.out.gain.setTargetAtTime(0, now, Math.max(fade / 3, 0.001));
      entry.nodes.forEach((node) => node.stop(now + fade + 0.05));
    });
  }

  /** Moves a playing loop to a new volume (0..1 of its normal level) over `seconds`, without restarting it. */
  fadeTo(id, volume, seconds = 1) {
    const set = this.#active.get(id);
    if (!set || !this.#ctx) return;
    const now = this.#ctx.currentTime;
    set.forEach((entry) => {
      if (entry.cancelled) return;
      entry.out.gain.cancelScheduledValues(now);
      entry.out.gain.setValueAtTime(entry.out.gain.value, now);
      entry.out.gain.linearRampToValueAtTime(volume * (entry.base ?? 1), now + Math.max(seconds, 0.01));
    });
  }

  stopAll(options) {
    [...this.#active.keys(), ...this.#queuedLoops.keys()].forEach((id) => this.stop(id, options));
  }

  /** Air density from 0 (vacuum) to 1 (sea level). */
  setAir(density) {
    if (!this.#ctx) return;
    const d = Math.min(1, Math.max(0, density));
    const now = this.#ctx.currentTime;
    this.#air.frequency.setTargetAtTime(90 + Math.pow(d, 0.5) * 17000, now, 0.1);
    this.#buses.world.gain.setTargetAtTime(0.14 + 0.86 * Math.pow(d, 0.4), now, 0.1); // hull rumble remains in vacuum
  }

  setVolume(volume) {
    this.#volume = volume;
    if (this.#ctx) this.#buses.master.gain.setTargetAtTime(volume, this.#ctx.currentTime, 0.02);
  }

  ids() {
    return [...new Set([...Object.keys(SYNTHS), ...this.#files.keys()])];
  }
}

export const audio = new AudioManager();
