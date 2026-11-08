// The design studio: the vehicle alone on its launch pad in a dark studio, turned by hand, zoomed with the wheel.
// The page tells it which section is open (the others fade back) and which part is selected (it glows; when the page
// asks, its internals slide out). No DOM labels: the side panel carries all the text. No listeners: the page feeds it.
// The outer skin (hull.js, drawn by bay/hullArt.js) wraps the stack into one body. While a section's card is open its
// skin turns see-through (so do its tank and cabin walls that have equipment riding inside them), and that equipment
// and the parts the skin covers show; while the card is closed they are hidden. pick() on the skin returns
// { hull: sectionId, section, material, under } (under: the covered part at that spot), unless that skin's card is open,
// when the click goes through to what is inside.
import * as THREE from 'three';
import { assets } from '/src/graphics/index.js';
import { partArt } from './bay/partArt.js';
import { internalsArt } from './bay/internalsArt.js';
import { wantsNasaArt } from './bay/nasa.js';
import { DEG, disposeObject, createDisposalQueue } from './bay/util.js';
import { mountRadial, skinFor } from './bay/hullArt.js';

const SELECTED = new THREE.Color(0xfbbf24);
const SECTION_GLOW = new THREE.Color(0x67e8f9);
const UP = new THREE.Vector3(0, 1, 0);
const SKIN_OPEN = 0.25; // opacity of the open section's skin
const WALL_OPEN = 0.3; // opacity of an open section's tank or cabin wall that has equipment riding inside it

export function createDesignScene() {
  const scene = new THREE.Scene();
  scene.name = 'design-studio';
  scene.background = new THREE.Color(0x070d12);
  scene.fog = new THREE.Fog(0x070d12, 70, 160);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 400);

  // ----- studio: lights, a soft floor disc and a fine grid -----
  const key = new THREE.DirectionalLight(0xfff1e0, 2.2);
  key.position.set(8, 18, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -16;
  key.shadow.camera.right = key.shadow.camera.top = 16;
  key.shadow.camera.far = 70;
  const fill = new THREE.DirectionalLight(0x9fb4d8, 0.8);
  fill.position.set(-10, 6, -6);
  const rim = new THREE.DirectionalLight(0x67e8f9, 1.1);
  rim.position.set(0, 9, -14);
  scene.add(key, fill, rim, new THREE.HemisphereLight(0xdfe9ff, 0x0b1016, 0.5), new THREE.AmbientLight(0x2a3340, 0.6));
  const grid = new THREE.GridHelper(80, 80, 0x14303a, 0x0d1f27);
  grid.position.y = -0.01;
  scene.add(grid);
  const discCanvas = document.createElement('canvas');
  discCanvas.width = discCanvas.height = 256;
  const dctx = discCanvas.getContext('2d');
  const grad = dctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(103,232,249,0.22)');
  grad.addColorStop(0.5, 'rgba(103,232,249,0.06)');
  grad.addColorStop(1, 'rgba(103,232,249,0)');
  dctx.fillStyle = grad;
  dctx.fillRect(0, 0, 256, 256);
  const discTex = new THREE.CanvasTexture(discCanvas);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(12, 64), new THREE.MeshBasicMaterial({ map: discTex, transparent: true, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2;
  scene.add(disc);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(50, 48), new THREE.ShadowMaterial({ opacity: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const padHolder = new THREE.Group(); // the launch pad, on the floor
  scene.add(padHolder);
  let padTop = 0;
  let padObject = null;
  const vehicle = new THREE.Group(); // stands on the pad
  vehicle.name = 'vehicle';
  scene.add(vehicle);
  const pieces = new THREE.Group(); // exploded internals of the selected part (same frame as the vehicle)
  vehicle.add(pieces);

  const parts = new Map(); // id -> { holder, entry, art }
  let layoutCache = [];
  let layoutKey = '';
  let selected = null;
  let activeSection = null;
  let padActive = false;
  let explode = 0, explodeTarget = 0;
  let explodedFor = null;
  let pieceList = [];
  let hotPiece = null;
  let missingArt = [];
  let optionsResolver = () => ({});
  // the outer skin: its art, what hull.js said about it, and the parts that show only while their card is open
  let skin = null;
  let hullInfo = null;
  let hiddenClosed = new Set();
  let holders = new Map(); // part id → sections of the equipment riding inside its own walls (a tank's skirt, an intertank, the cabin)

  // ----- orbit camera -----
  const orbit = { yaw: 0.6, pitch: 0.2, dist: 20, targetY: 6, fitDist: 20, fitY: 6, minDist: 3, auto: true, idle: 0 };
  const smooth = { yaw: 0.6, pitch: 0.2, dist: 20, targetY: 6 };
  const halfTan = Math.tan((camera.fov * Math.PI) / 360);
  let stackHeight = 0, stackRadius = 1.25;
  function fitTo(h0, r0) {
    const h = Math.max(h0 > 0 ? 4 : 16, h0 + padTop), r = Math.max(1.25, r0);
    orbit.fitY = h * 0.5;
    orbit.fitDist = Math.max((h * 1.25) / (2 * halfTan), r * 5) + 2;
  }
  function fit() {
    orbit.targetY = orbit.fitY;
    orbit.dist = orbit.fitDist;
    orbit.pitch = 0.2;
    orbit.minDist = orbit.fitDist * 0.12;
    orbit.idle = 0;
  }
  const spanToDist = (span) => (span * 1.15) / (2 * halfTan);
  /** Frame a vertical slice [y0, y1] of the vehicle (metres above its base). */
  function frame(y0, y1, width = stackRadius * 2) {
    const span = Math.max(y1 - y0, width * 1.3, 2.5);
    orbit.targetY = padTop + (y0 + y1) / 2;
    orbit.dist = Math.min(orbit.fitDist * 1.05, Math.max(orbit.fitDist * 0.18, spanToDist(span)));
    orbit.minDist = orbit.fitDist * 0.12;
    orbit.idle = 0;
  }
  /** Frame one part: close enough to read it, far enough that its exploded internals stay in view. */
  function focusOn(id, { exploded = false } = {}) {
    const p = parts.get(id);
    if (!p) return;
    const e = p.entry;
    const reach = Math.max(1.2, e.radius * 1.6 + 0.4);
    const span = exploded ? e.height + 2 * reach : Math.max(e.height, e.radius * 2.4) + 1;
    const mid = e.attach === 'radial' ? e.y + Math.min(e.height, 1.2) * 0.5 : e.centerY;
    orbit.targetY = padTop + mid;
    orbit.dist = Math.min(orbit.fitDist, Math.max(orbit.fitDist * 0.15, spanToDist(span)));
    orbit.minDist = Math.max(orbit.fitDist * 0.12, spanToDist(e.def.internals ? e.height + 2 * reach : span) * 0.9);
    orbit.pitch = Math.max(orbit.pitch, 0.12);
    orbit.idle = 0;
  }
  /** Frame a whole section (nose, body, tail) or the pad. */
  function focusSection(id) {
    if (id === 'pad') { frame(-padTop, Math.min(stackHeight, 8), Math.max(10, stackRadius * 8)); orbit.pitch = 0.32; return; }
    const list = layoutCache.filter((e) => e.def.section === id);
    if (!list.length) { fit(); return; }
    let y0 = Infinity, y1 = -Infinity, w = stackRadius * 2;
    for (const e of list) {
      const base = e.attach === 'radial' ? e.y - 0.3 : e.y;
      y0 = Math.min(y0, base);
      y1 = Math.max(y1, base + e.height);
      if (e.attach === 'radial') w = Math.max(w, (e.radius + 1) * 2);
    }
    frame(y0, y1, w);
  }
  function relax() { orbit.dist = Math.max(orbit.dist, orbit.fitDist * 0.6); orbit.idle = 0; }
  function rotateBy(dxPx, dyPx) {
    orbit.yaw -= dxPx * 0.008;
    orbit.pitch = Math.min(1.35, Math.max(-0.5, orbit.pitch + dyPx * 0.006));
    orbit.idle = 0;
  }
  function zoomBy(factor) {
    orbit.dist = Math.min(orbit.fitDist * 2.2, Math.max(orbit.minDist, orbit.dist * factor));
    orbit.idle = 0;
  }
  /** 0 at the framing distance of the selected part, 1 when zoomed right into it (the page explodes it by this). */
  const zoomFraction = () => {
    const p = selected && parts.get(selected);
    if (!p) return 0;
    const far = Math.max(orbit.minDist * 1.6, orbit.minDist + 2);
    return Math.min(1, Math.max(0, (far - orbit.dist) / (far - orbit.minDist)));
  };
  // The DOM covers part of the window (side panel, top bar): keep the vehicle centred in what is left of the view.
  let viewCentre = null;
  function setViewCentre(cx, cy, fullW, fullH) {
    const k = `${Math.round(cx)}:${Math.round(cy)}:${fullW}:${fullH}`;
    if (viewCentre === k) return;
    viewCentre = k;
    camera.setViewOffset(fullW, fullH, fullW / 2 - cx, fullH / 2 - cy, fullW, fullH);
  }
  function clearViewCentre() { viewCentre = null; camera.clearViewOffset(); }

  // ----- the pad -----
  const trash = createDisposalQueue();
  function setPad(made) {
    if (padObject) { padHolder.remove(padObject); trash.add(padObject); }
    padObject = made?.object ?? null;
    padTop = made?.top ?? 0;
    if (padObject) {
      padObject.traverse((o) => { o.userData.pad = true; });
      padHolder.add(padObject);
    }
    vehicle.position.y = padTop;
    fitTo(stackHeight, stackRadius);
    applyLook();
  }

  // ----- vehicle -----
  function setLayout(layout) {
    const keyNow = layout.map((e) => `${e.id}:${e.type}:${e.angle}:${e.yFrac}:${e.y.toFixed(2)}:${e.material ?? ''}:${JSON.stringify(e.options ?? null)}:${e.cluster?.count ?? 1}:${e.engine ? `${e.engine.fuel}-${e.engine.nozzle}` : ''}:${e.above ?? ''}:${e.below ?? ''}`).join('|') + `|skin:${JSON.stringify(layout.hullMaterials ?? {})}`;
    layoutCache = layout;
    stackHeight = 0; stackRadius = 1.25;
    for (const e of layout) if (e.attach === 'axial') { stackHeight = Math.max(stackHeight, e.y + e.height); stackRadius = Math.max(stackRadius, e.radius); }
    fitTo(stackHeight, stackRadius);
    if (keyNow === layoutKey) return false;
    layoutKey = keyNow;
    for (const child of [...vehicle.children]) { if (child === pieces) continue; vehicle.remove(child); trash.add(child); } // disposed after the new parts are drawn
    parts.clear();
    missingArt = [];
    for (const e of layout) {
      const art = partArt(e);
      art.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      if (wantsNasaArt(e.type) && !art.userData.nasa) missingArt.push(e.type); // clustered engines too (wantsNasaArt is false once loaded)
      let holder = art;
      if (e.attach === 'radial') holder = mountRadial(art, e, layout);
      else art.position.y = e.y;
      holder.userData.partId = e.id;
      holder.traverse((o) => { o.userData.partId = e.id; });
      vehicle.add(holder);
      parts.set(e.id, { holder, entry: e, art });
    }
    // the outer skin, rebuilt only with the layout or the skin materials (this function returns early otherwise)
    const made = skinFor(layout);
    hullInfo = made.hull;
    skin = made.object;
    skin.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    vehicle.add(skin);
    hiddenClosed = new Set([...hullInfo.insideIds, ...hullInfo.coveredIds]);
    holders = new Map();
    for (const e of layout) if (e.inside && e.bayPart && ['part', 'dry', 'cabin', 'skirt'].includes(e.bay)) holders.set(e.bayPart, new Set([...(holders.get(e.bayPart) ?? []), e.def.section]));
    // a cover that hangs over the part below it (model.encloses: Orion's abort-system fairing over the crew module) turns
    // see-through with that part's card open, like a wall with equipment inside
    for (const e of layout) {
      const enc = e.def.model?.encloses;
      const below = enc && layout.find((x) => x.id === e.parentId && x.type === enc) || (enc && layout.find((x) => x.parentId === e.id && x.type === enc));
      if (below) holders.set(e.id, new Set([...(holders.get(e.id) ?? []), below.def.section]));
    }
    if (selected && !parts.has(selected)) selected = null;
    explodedFor = null;
    rebuildPieces();
    applyLook();
    return true;
  }

  // ----- looks: section fade, selection glow -----
  function cloneMaterials(root) {
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      if ((Array.isArray(o.material) ? o.material[0] : o.material)?.userData?.vdCloned) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const cloned = mats.map((m) => {
        const c = m.clone();
        c.userData = { ...m.userData, vdCloned: true, baseOpacity: m.opacity, baseTransparent: m.transparent, baseEmissive: m.emissive ? m.emissive.clone() : null, baseEmissiveIntensity: m.emissiveIntensity ?? 1 };
        // transparent from the start (fully opaque at opacity 1 with depth writes on): a fade then changes only the
        // opacity and never the shader, which three.js would recompile on every switch between opaque and see-through
        c.transparent = true;
        return c;
      });
      o.material = Array.isArray(o.material) ? cloned : cloned[0];
    });
  }
  function setLook(root, { opacity = 1, emissive = null, emissiveIntensity = 0 } = {}) {
    root.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        const u = m.userData;
        if (!u?.vdCloned) continue;
        m.opacity = Math.min(u.baseOpacity, opacity);
        m.depthWrite = opacity >= 0.99;
        if (m.emissive && u.baseEmissive) {
          if (emissive) { m.emissive.copy(emissive); m.emissiveIntensity = emissiveIntensity; } else { m.emissive.copy(u.baseEmissive); m.emissiveIntensity = u.baseEmissiveIntensity; }
        }
      }
    });
  }
  function applyLook() {
    const exploded = explode > 0.02 && selected && parts.has(selected);
    for (const [id, p] of parts) {
      // equipment inside the skin and parts the skin covers show only while their own card is open
      const shown = !hiddenClosed.has(id) || (activeSection && p.entry.def.section === activeSection) || id === selected;
      p.holder.visible = !!shown;
      if (!shown) continue;
      cloneMaterials(p.holder);
      const inSection = !activeSection || p.entry.def.section === activeSection;
      // a wall that is also the skin (a tank, the cabin) with equipment inside it turns see-through with its card open
      const seeThrough = activeSection && inSection && !!holders.get(id)?.has(activeSection);
      if (id === selected) setLook(p.holder, { opacity: exploded ? Math.max(0.08, 1 - explode * 1.15) : 1, emissive: exploded ? null : SELECTED, emissiveIntensity: 0.5 });
      else if (exploded) setLook(p.holder, { opacity: 0.15 });
      else if (padActive) setLook(p.holder, { opacity: 0.55 });
      else setLook(p.holder, { opacity: !inSection ? 0.22 : seeThrough ? WALL_OPEN : 1 });
    }
    if (skin) {
      cloneMaterials(skin);
      for (const seg of skin.children) {
        const sec = seg.userData.hullSection;
        const open = activeSection && sec === activeSection;
        setLook(seg, { opacity: exploded ? 0.12 : padActive ? 0.55 : open ? SKIN_OPEN : activeSection ? 0.22 : 1 });
      }
    }
    if (padObject) {
      cloneMaterials(padObject);
      setLook(padObject, { opacity: padActive || (!activeSection && !selected) ? 1 : 0.45, emissive: padActive ? SECTION_GLOW : null, emissiveIntensity: 0.05 });
    }
    for (const piece of pieceList) {
      cloneMaterials(piece.object);
      setLook(piece.object, { emissive: hotPiece === piece.key ? SELECTED : null, emissiveIntensity: 0.6 });
    }
  }
  function setActiveSection(id) {
    activeSection = id && id !== 'pad' ? id : null;
    padActive = id === 'pad';
    applyLook();
  }
  function select(id) {
    selected = id && parts.has(id) ? id : null;
    if (selected !== explodedFor) rebuildPieces();
    applyLook();
  }
  function highlightPiece(k) { hotPiece = k; applyLook(); }
  function rebuildPieces() {
    for (const child of [...pieces.children]) { pieces.remove(child); disposeObject(child); }
    pieceList = [];
    explodedFor = selected;
    const p = selected && parts.get(selected);
    if (!p || !p.entry.def.internals) return;
    const e = p.entry;
    const kit = internalsArt(e.def, optionsResolver(e.id) ?? {}, { radius: e.radius, height: e.height });
    const base = new THREE.Group();
    if (e.attach === 'radial') { base.position.set(0, e.y, 0); base.rotation.y = e.angle * DEG; }
    const inner = new THREE.Group();
    if (e.attach === 'radial') inner.position.x = p.art.position.x; else inner.position.y = e.y;
    base.add(inner);
    for (const piece of kit) {
      piece.object.traverse((o) => { o.userData.internalKey = piece.key; });
      piece.base = piece.object.position.clone();
      inner.add(piece.object);
      pieceList.push(piece);
    }
    pieces.add(base);
  }
  function setExplode(t) { explodeTarget = Math.min(1, Math.max(0, t)); }

  // ----- picking -----
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(clientX, clientY, rect) {
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (explode > 0.3 && pieceList.length) {
      const hit = raycaster.intersectObjects(pieces.children, true)[0];
      if (hit?.object.userData.internalKey) return { internal: hit.object.userData.internalKey, partId: selected };
    }
    const hits = raycaster.intersectObjects([...vehicle.children.filter((c) => c !== pieces), padHolder], true);
    for (const hit of hits) {
      if (!shownInScene(hit.object)) continue; // hidden equipment and covered parts cannot be clicked
      if (hit.object.userData.pad) return { pad: true };
      const u = hit.object.userData;
      if (u.hull) {
        // the skin: while its card is open it is see-through, so a click goes to what is inside it
        if (activeSection && u.hullSection === activeSection) continue;
        if (explode > 0.3) continue;
        // { hull: sectionId, section, material }: the page opens the skin's explanation card; under = the covered part there
        const seg = hullInfo?.segments[u.hullIndex];
        const y = vehicle.worldToLocal(hit.point.clone()).y;
        const under = (seg?.covers ?? []).map((cid) => parts.get(cid)?.entry).filter(Boolean).sort((a, b) => Math.abs(a.centerY - y) - Math.abs(b.centerY - y))[0];
        return { hull: u.hullSection, section: u.hullSection, material: u.hullMaterial, under: under?.id ?? null };
      }
      const id = u.partId;
      if (!id || !parts.has(id)) continue;
      if (explode > 0.3 && selected && id !== selected) continue; // faded parts behind an exploded one do not steal the click
      return { partId: id, section: parts.get(id).entry.def.section };
    }
    return null;
  }
  function shownInScene(o) {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  // ----- frame -----
  function update(rawDt) {
    const dt = Number.isFinite(rawDt) ? Math.min(0.1, Math.max(0, rawDt)) : 0; // the first frames after a load can report odd steps
    trash.tick();
    if (![smooth.yaw, smooth.pitch, smooth.dist, smooth.targetY].every(Number.isFinite)) Object.assign(smooth, { yaw: orbit.yaw, pitch: orbit.pitch, dist: orbit.dist, targetY: orbit.targetY });
    orbit.idle += dt;
    if (orbit.auto && orbit.idle > 6 && explode < 0.05 && !selected) orbit.yaw += dt * 0.12;
    const k = 1 - Math.exp(-dt * 8);
    smooth.yaw += (orbit.yaw - smooth.yaw) * k;
    smooth.pitch += (orbit.pitch - smooth.pitch) * k;
    smooth.dist += (orbit.dist - smooth.dist) * k;
    smooth.targetY += (orbit.targetY - smooth.targetY) * k;
    const cp = Math.cos(smooth.pitch);
    camera.position.set(Math.sin(smooth.yaw) * cp * smooth.dist, smooth.targetY + Math.sin(smooth.pitch) * smooth.dist, Math.cos(smooth.yaw) * cp * smooth.dist);
    camera.up.copy(UP);
    camera.lookAt(0, smooth.targetY, 0);
    const before = explode;
    explode += (explodeTarget - explode) * (1 - Math.exp(-dt * 7));
    if (Math.abs(explode - before) > 0.002) applyLook();
    if (pieceList.length) {
      const p = parts.get(selected);
      const reach = p ? Math.max(1.2, p.entry.radius * 1.6 + 0.4) : 1.6;
      for (const piece of pieceList) piece.object.position.copy(piece.base).addScaledVector(piece.dir, explode * reach);
      pieces.visible = explode > 0.02;
    } else pieces.visible = false;
  }

  function dispose() {
    for (const child of [...vehicle.children]) disposeObject(child);
    if (padObject) disposeObject(padObject);
    trash.flush();
    discTex.dispose();
  }

  return {
    scene, camera, orbit,
    setLayout, setPad, select, setActiveSection, highlightPiece, setExplode, pick, update, dispose,
    fit, frame, focusOn, focusSection, relax, rotateBy, zoomBy, zoomFraction, setViewCentre, clearViewCentre,
    setOptionsResolver: (fn) => { optionsResolver = fn; },
    setEnvironment: () => { scene.environment = assets.environment?.() ?? null; scene.environmentIntensity = 0.35; },
    get selected() { return selected; },
    get explode() { return explode; },
    get missingArt() { return missingArt; },
    get layout() { return layoutCache; },
    /** What hull.js said about the skin now drawn (segments, insideIds, coveredIds, risk…). */
    get hull() { return hullInfo; },
    get padTop() { return padTop; },
    get pieces() { return pieceList.map((p) => ({ key: p.key, name: p.name })); },
    /** Forget the built vehicle so the next setLayout rebuilds it (after real models arrive). */
    invalidate() { layoutKey = ''; explodedFor = null; },
  };
}
