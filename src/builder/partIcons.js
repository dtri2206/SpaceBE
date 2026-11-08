// Pictures of parts for the cards and the detail panel: each part's own 3D art rendered once to a small image
// (cached), or a baked PNG from public/assets/icons when one exists (data/icons.json lists them), so the cards never
// wait for a model to download. Also renders any Object3D (the internals pieces) the same way, and gives the big
// explanation card its turning 3D view (preview(): one small render target on the same renderer, drawn only while
// the card is open; partModel(): a part and the pieces inside it).
import * as THREE from 'three';
import { assets } from '/src/graphics/index.js';
import { partArt } from './bay/partArt.js';
import { internalsArt } from './bay/internalsArt.js';
import { hasNasaArt, wantsNasaArt } from './bay/nasa.js';
import { SIZE_SCALE, BASE_RADIUS } from './assembly.js';
import baked from './data/icons.json';

const safe = (key) => key.replace(/[^a-z0-9_.-]/gi, '-'); // the same file names the bake tool writes
const BAKED = new Set((baked.icons ?? []).map(safe));
const BAKED_BASE = '/assets/icons/';

export function createIconRenderer({ renderer, size = 512 }) {
  const cache = new Map();
  const rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 100);
  const key = new THREE.DirectionalLight(0xfff4e6, 2.0);
  key.position.set(3, 5, 4);
  const fill = new THREE.DirectionalLight(0x8ea4c8, 0.9);
  fill.position.set(-4, 2, -3);
  const rim = new THREE.DirectionalLight(0x67e8f9, 1.4);
  rim.position.set(0, 3, -5);
  scene.add(key, fill, rim, new THREE.AmbientLight(0x405060, 0.5), new THREE.HemisphereLight(0xdfe9ff, 0x202428, 0.45));
  const pixels = new Uint8Array(size * size * 4);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  function withState(fn) {
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevViewport = renderer.getViewport(new THREE.Vector4());
    const prevScissor = renderer.getScissor(new THREE.Vector4());
    const prevScissorTest = renderer.getScissorTest();
    try {
      return fn();
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.setViewport(prevViewport);
      renderer.setScissor(prevScissor);
      renderer.setScissorTest(prevScissorTest);
      renderer.setClearColor(prevClear, prevAlpha);
    }
  }

  function renderObject(object, { view = new THREE.Vector3(0.9, 0.55, 1.1), yaw = -0.4, pad = 1.15 } = {}) {
    const holder = new THREE.Group();
    holder.add(object);
    holder.rotation.y = yaw;
    scene.add(holder);
    scene.environment = assets.environment?.() ?? null;
    scene.environmentIntensity = 0.3; // untextured white hardware must not blow out
    const box = new THREE.Box3().setFromObject(holder);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dist = sphere.radius / Math.sin((camera.fov * Math.PI) / 360) * pad;
    camera.position.copy(sphere.center).add(view.clone().normalize().multiplyScalar(dist));
    camera.lookAt(sphere.center);
    camera.updateProjectionMatrix();
    withState(() => {
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.setViewport(0, 0, size, size);
      renderer.setScissor(0, 0, size, size);
      renderer.setScissorTest(true);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(rt, 0, 0, size, size, pixels);
    });
    scene.remove(holder);
    disposeGeometry(holder); // a real NASA model keeps its geometry: the studio's copies share it
    holder.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.()); });
    const image = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) { // flip vertically: GL rows start at the bottom
      const src = (size - 1 - y) * size * 4;
      image.data.set(pixels.subarray(src, src + size * 4), y * size * 4);
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  }

  const entryFor = (def) => ({ type: def.id, attach: def.attach, height: def.height, def, radius: BASE_RADIUS * (SIZE_SCALE[def.size] ?? 1) });

  // ---------- the explanation card's turning view ----------
  // Render targets get linear colours from three.js; the card's copies of the materials write screen (sRGB) colours
  // instead, so the picture read back into the 2D canvas looks the same as on screen, with no extra pass.
  const screenColours = (prev) => function onBeforeCompile(shader, r) {
    prev?.call(this, shader, r);
    shader.fragmentShader = shader.fragmentShader.replace('#include <colorspace_fragment>', '#include <colorspace_fragment>\n\tgl_FragColor = sRGBTransferOETF( gl_FragColor );');
  };
  /** Frees the geometry of an object the card or an icon made, but never a real NASA model's: its clones share geometry with the studio. */
  const disposeGeometry = (o) => {
    if (!o.userData?.sharedGeometry) o.geometry?.dispose?.(); // a node of a loaded model's copy shares the cached buffers
    for (const c of o.children) disposeGeometry(c);
  };
  /**
   * A small turning 3D view for the explanation card: one render target on the shared renderer, read back into a 2D
   * canvas without stalling (readRenderTargetPixelsAsync, one read in flight). It draws at most 18 times a second and
   * only while something moves (opening, turning, dragging, a piece lit); a still picture is not redrawn. The shaders
   * are compiled in the background (compileAsync) before the first picture, with a "loading" line meanwhile.
   *   set({ shell, pieces, radius }, { loading }) shows a part (partModel()); its pieces slide out like an exploded drawing
   *   highlight(key) lights one piece and fades the others; rotateBy(px) turns it by hand; clear(); dispose()
   * Numbered markers (1, 2, 3…) sit beside the pieces in the order given, each with a line to its piece.
   */
  function preview({ width = 720, height = 330, background = 0x07171d } = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const c2d = canvas.getContext('2d');
    const target = new THREE.WebGLRenderTarget(width, height, { samples: 4, depthBuffer: true });
    const pscene = new THREE.Scene();
    const pcam = new THREE.PerspectiveCamera(30, width / height, 0.05, 400);
    const keyLight = new THREE.DirectionalLight(0xfff4e6, 2.2);
    keyLight.position.set(3, 5, 4);
    const fillLight = new THREE.DirectionalLight(0x8ea4c8, 0.9);
    fillLight.position.set(-4, 2, -3);
    const rimLight = new THREE.DirectionalLight(0x67e8f9, 1.1);
    rimLight.position.set(0, 3, -5);
    pscene.add(keyLight, fillLight, rimLight, new THREE.AmbientLight(0x405060, 0.55), new THREE.HemisphereLight(0xdfe9ff, 0x202428, 0.5));
    const turn = new THREE.Group();
    pscene.add(turn);
    const bg = new THREE.Color().setHex(background, THREE.LinearSRGBColorSpace); // cleared as is, so stored = shown
    const bgCss = `#${background.toString(16).padStart(6, '0')}`;
    const glowOn = new THREE.Color(0x1d6f7d);
    const pixels = new Uint8Array(width * height * 4);
    const image = c2d.createImageData(width, height);
    const FRAME = 1 / 18; // seconds between pictures
    const SPIN = 0.4; // rad/s: about one slow turn …
    const SPIN_FOR = 15; // … then it rests
    const st = { yaw: -0.5, explode: 0, goal: 0, delay: 0, highlight: null, acc: 1, reach: 1.2, idle: 9, spinLeft: 0, dirty: false, ready: false, reading: false, token: 0, loading: '' };
    let model = null;
    const tmp = new THREE.Vector3();
    const box = new THREE.Box3();
    const sph = new THREE.Sphere();

    function adopt(object, list) { // the card's own copies of the materials: the studio's shared ones never change
      object.traverse((o) => {
        if (!o.material) return;
        const one = (m) => {
          const c = m.clone();
          const key = m.customProgramCacheKey?.() ?? '';
          c.onBeforeCompile = screenColours(m.onBeforeCompile);
          c.customProgramCacheKey = () => `card-srgb|${key}`;
          c.transparent = true; // from the start: three.js compiles opaque materials with alpha fixed at 1
          list.push({ m: c, opacity: c.opacity, depthWrite: c.depthWrite, emissive: c.emissive?.clone() ?? null });
          return c;
        };
        o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
      });
    }
    function place(t) {
      for (const p of model.pieces) p.object.position.copy(p.base).addScaledVector(p.dir, t * st.reach);
    }
    function look() {
      const t = st.explode;
      const ghost = model.pieces.length ? 1 - 0.86 * Math.min(1, t * 1.4) : 1;
      for (const e of model.shellMats) {
        e.m.opacity = e.opacity * ghost;
        e.m.depthWrite = ghost >= 0.999 && e.depthWrite;
      }
      for (const p of model.pieces) {
        p.object.visible = t > 0.02;
        const on = st.highlight === p.key, dim = !!st.highlight && !on;
        for (const e of p.mats) {
          e.m.opacity = e.opacity * (dim ? 0.22 : 1);
          e.m.depthWrite = !dim && e.depthWrite;
          if (e.emissive) e.m.emissive.copy(on ? glowOn : e.emissive);
        }
      }
    }
    function clear() {
      st.token += 1; // a compile or a read still in flight for the old model is ignored
      st.ready = false;
      if (!model) return;
      turn.remove(model.root);
      disposeGeometry(model.root);
      for (const e of [...model.shellMats, ...model.pieces.flatMap((p) => p.mats)]) e.m.dispose();
      model = null;
    }
    function drawLoading() {
      c2d.fillStyle = bgCss;
      c2d.fillRect(0, 0, width, height);
      if (!st.loading) return;
      c2d.font = '500 15px "IBM Plex Mono", monospace';
      c2d.fillStyle = '#86a6ad';
      c2d.textAlign = 'center';
      c2d.textBaseline = 'middle';
      c2d.fillText(st.loading, width / 2, height / 2);
    }
    /** The widest reach around the turning axis, from each mesh's bounding sphere (tighter than the box corners). */
    function reachAround(root, centre) {
      let across = 0;
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh || !o.visible || !o.geometry) return;
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        sph.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
        across = Math.max(across, Math.hypot(sph.center.x - centre.x, sph.center.z - centre.z) + sph.radius);
      });
      return across;
    }
    function set({ shell = null, pieces = [], radius = 1.25 } = {}, { loading = '' } = {}) {
      clear();
      const root = new THREE.Group();
      const shellMats = [];
      if (shell) { adopt(shell, shellMats); root.add(shell); }
      const list = pieces.map((p) => {
        const mats = [];
        adopt(p.object, mats);
        root.add(p.object);
        return { key: p.key, name: p.name, object: p.object, dir: p.dir.clone().normalize(), base: p.object.position.clone(), mats };
      });
      model = { root, shellMats, pieces: list };
      turn.rotation.y = 0;
      turn.add(root);
      // pieces slide out by about half the part's size
      place(0);
      box.setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      st.reach = Math.max(0.35, 0.5 * Math.max(size.y, size.x, size.z), radius * 0.55);
      // frame the model as it looks fully apart, so the camera never moves while it opens
      place(list.length ? 1 : 0);
      for (const p of list) p.object.visible = true;
      root.position.set(0, 0, 0);
      box.setFromObject(root);
      const centre = box.getCenter(new THREE.Vector3());
      const halfY = box.getSize(new THREE.Vector3()).y / 2;
      const across = Math.max(0.1, reachAround(root, centre));
      root.position.copy(centre).multiplyScalar(-1);
      const tanV = Math.tan((pcam.fov * Math.PI) / 360), tanH = tanV * pcam.aspect;
      const dist = Math.max(halfY / tanV, across / tanH, 0.3) * 1.04 + across * 0.55;
      st.radius = Math.max(0.2, Math.hypot(halfY, across));
      pcam.position.set(0, dist * 0.28, dist * 0.96);
      pcam.near = Math.max(0.01, dist / 60);
      pcam.far = dist * 6;
      pcam.lookAt(0, 0, 0);
      pcam.updateProjectionMatrix();
      Object.assign(st, { explode: 0, goal: list.length ? 1 : 0, delay: 0.35, acc: 1, idle: 9, spinLeft: SPIN_FOR, dirty: true, loading });
      place(0);
      look();
      drawLoading();
      // compile every shader before the first picture, with the target bound so the programs match the real render
      const token = st.token;
      pscene.environment = assets.environment?.() ?? null;
      pscene.environmentIntensity = 0.35;
      const prev = renderer.getRenderTarget();
      let job = null;
      try {
        renderer.setRenderTarget(target);
        job = renderer.compileAsync ? renderer.compileAsync(pscene, pcam) : null;
      } catch { job = null; } finally { renderer.setRenderTarget(prev); }
      Promise.resolve(job).catch(() => null).then(() => { if (token === st.token) { st.ready = true; st.dirty = true; } });
    }
    /** Where each marker goes: beside its piece, pushed out from the middle, with a line back to the piece. */
    function markerSpots() {
      if (!model || st.explode < 0.5) return [];
      return model.pieces.map((p, i) => {
        box.setFromObject(p.object);
        if (box.isEmpty()) return null;
        box.getCenter(tmp).project(pcam);
        const x = ((tmp.x + 1) / 2) * width, y = ((1 - tmp.y) / 2) * height;
        const dx = x - width / 2, dy = y - height / 2, d = Math.hypot(dx, dy) || 1;
        const off = 30;
        const mx = Math.min(width - 16, Math.max(16, x + (dx / d) * off + (d < 4 ? off : 0)));
        const my = Math.min(height - 16, Math.max(16, y + (dy / d) * off * 0.7));
        return { n: i + 1, x, y, mx, my, on: st.highlight === p.key };
      }).filter(Boolean);
    }
    function drawMarkers(spots, alpha) {
      if (!spots.length) return;
      c2d.save();
      c2d.globalAlpha = alpha;
      c2d.font = '600 13px "IBM Plex Mono", monospace';
      c2d.textAlign = 'center';
      c2d.textBaseline = 'middle';
      for (const s of spots) {
        const col = s.on ? '#fbbf24' : '#67e8f9';
        c2d.strokeStyle = col;
        c2d.lineWidth = 1.2;
        c2d.beginPath();
        c2d.moveTo(s.x, s.y);
        c2d.lineTo(s.mx, s.my);
        c2d.stroke();
        c2d.beginPath(); // a small ring on the piece itself, so even a tiny one is found
        c2d.arc(s.x, s.y, 3.5, 0, Math.PI * 2);
        c2d.fillStyle = col;
        c2d.fill();
        c2d.beginPath();
        c2d.arc(s.mx, s.my, 12, 0, Math.PI * 2);
        c2d.fillStyle = s.on ? '#fbbf24' : 'rgba(4, 15, 20, 0.9)';
        c2d.fill();
        c2d.lineWidth = 1.5;
        c2d.stroke();
        c2d.fillStyle = s.on ? '#03161b' : '#e6fbff';
        c2d.fillText(String(s.n), s.mx, s.my + 0.5);
      }
      c2d.restore();
    }
    function draw() {
      turn.rotation.y = st.yaw;
      place(st.explode);
      look();
      pscene.environment = assets.environment?.() ?? null;
      pscene.environmentIntensity = 0.35;
      const spots = markerSpots();
      const alpha = Math.min(1, (st.explode - 0.5) * 2.5);
      const prevTarget = renderer.getRenderTarget();
      const prevClear = renderer.getClearColor(new THREE.Color());
      const prevAlpha = renderer.getClearAlpha();
      let read = null;
      try {
        renderer.setRenderTarget(target); // the target's own full-size viewport, no scissor
        renderer.setClearColor(bg, 1);
        renderer.clear();
        renderer.render(pscene, pcam);
        read = renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, pixels);
      } finally {
        renderer.setRenderTarget(prevTarget);
        renderer.setClearColor(prevClear, prevAlpha);
      }
      const token = st.token;
      st.reading = true;
      Promise.resolve(read).then(() => {
        st.reading = false;
        if (token !== st.token) return; // the model changed while the picture was on its way
        const row = width * 4;
        for (let y = 0; y < height; y++) image.data.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
        c2d.putImageData(image, 0, 0);
        drawMarkers(spots, alpha);
      }, () => { st.reading = false; });
    }
    return {
      canvas,
      set,
      clear,
      /** Light one piece (a kit slot key) and fade the others; null shows them all. */
      highlight(key) { if ((key ?? null) !== st.highlight) { st.highlight = key ?? null; st.dirty = true; } },
      /** Turn by hand (pixels dragged); it rests where it is left, then turns slowly again after a while. */
      rotateBy(dx) { st.yaw += dx * 0.012; st.idle = 0; st.spinLeft = Math.max(st.spinLeft, 6); st.dirty = true; },
      /** Put the pieces back (0) or pull them apart (1). */
      explode(t) { st.goal = Math.min(1, Math.max(0, t)); st.delay = 0; },
      get exploded() { return st.goal > 0.5; },
      /** True once the shaders are compiled and pictures are drawn. */
      get ready() { return st.ready; },
      /** Turn, ease the pieces and draw when something moved, at most 18 times a second. Call it only while the view is on screen. */
      update(dt) {
        if (!model || !st.ready) return;
        const step = Number.isFinite(dt) ? Math.min(0.1, Math.max(0, dt)) : 0;
        let moving = false;
        st.idle += step;
        if (st.idle > 2.5 && st.spinLeft > 0) { st.yaw += step * SPIN; st.spinLeft -= step; moving = true; }
        if (st.delay > 0) { st.delay -= step; moving = true; } else if (Math.abs(st.goal - st.explode) > 0.002) { st.explode += (st.goal - st.explode) * (1 - Math.exp(-step * 3.2)); moving = true; } else st.explode = st.goal;
        st.acc += step;
        if ((!moving && !st.dirty) || st.reading || st.acc < FRAME) return;
        st.acc = 0;
        st.dirty = false;
        try { draw(); } catch { st.reading = false; /* a part whose art fails to render keeps the last good picture */ }
      },
      get pieces() { return model ? model.pieces.map((p) => ({ key: p.key, name: p.name })) : []; },
      /** For tests and screenshots: how far apart it is, how see-through the outside is, whether it is still. */
      get state() { return { explode: st.explode, shellOpacity: model?.shellMats[0]?.m.opacity ?? null, shellMaterials: model?.shellMats.length ?? 0, pieces: model?.pieces.length ?? 0, ready: st.ready, spinning: st.spinLeft > 0 }; },
      dispose() { clear(); target.dispose(); },
    };
  }

  return {
    /** URL of the part's picture: a baked PNG when there is one, else rendered on first use and cached. */
    iconFor(def) {
      if (BAKED.has(safe(def.id))) return `${BAKED_BASE}${safe(def.id)}.png`;
      // a part whose real model is still downloading is rendered once it arrives (reset() is called then)
      const k = `${def.id}:${wantsNasaArt(def.id) && !hasNasaArt(def.id) ? 'tmp' : 'real'}`;
      if (!cache.has(k)) {
        try { cache.set(k, renderObject(partArt(entryFor(def)))); } catch { cache.set(k, ''); }
      }
      return cache.get(k);
    },
    /** URL of a picture of any object (internals pieces): `key` caches it, `build()` makes the Object3D. */
    objectIcon(key, build, opts) {
      if (BAKED.has(safe(key))) return `${BAKED_BASE}${safe(key)}.png`;
      if (!cache.has(key)) {
        try { cache.set(key, renderObject(build(), opts)); } catch { cache.set(key, ''); }
      }
      return cache.get(key);
    },
    /** Render straight from a part def (used by the bake tool). */
    renderPart: (def) => renderObject(partArt(entryFor(def))),
    renderObject,
    preview,
    /** A part as the card shows it: { shell (the part as it looks), pieces (internalsArt), radius }. entry: its layout entry when installed (engine, material); options: { slotKey: option }. */
    partModel(def, { entry = null, options = null } = {}) {
      const e = { ...entryFor(def), ...(entry ?? {}), def, cluster: null };
      let shell = null;
      try { shell = partArt(e); } catch { shell = null; }
      let pieces = [];
      try { pieces = def.internals ? internalsArt(def, options, { radius: e.radius, height: def.height }) : []; } catch { pieces = []; }
      return { shell, pieces, radius: e.radius };
    },
    /** The shared renderer (for anything else that renders into a target, as this file does). */
    get renderer() { return renderer; },
    /** Forget rendered pictures (after the real models arrive). */
    reset() { cache.clear(); },
    dispose() { rt.dispose(); cache.clear(); },
  };
}
