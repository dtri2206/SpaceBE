// The rocket as a tree of parts hanging on attachment nodes (README-ARCH.md "Assembly JSON").
// Pure JS: no imports, no browser APIs, so Node tests and the other builder files can use it freely.

export const NODES = Object.freeze(['top', 'bottom', 'radial']);
export const SYMMETRIES = Object.freeze([1, 2, 3, 4, 6]);
export const SIZE_SCALE = Object.freeze({ s: 0.75, m: 1, l: 1.35 }); // the same scales as Role 3's rocketPart art
export const BASE_RADIUS = 1.25; // m at scale 1, the same as Role 3's tanks and capsules
const SHARE_PREFIX = 'SBE1.';
const HISTORY_LIMIT = 60;

/** Normalises data/parts.json into { byId, parts, families } with every optional field filled in. */
export function createCatalog(json) {
  const parts = (json.parts ?? []).map((raw) => ({
    attach: 'axial',
    nodes: [],
    flags: {},
    aero: { sideArea: 0 },
    attachFrac: 0.5,
    engine: false,
    fuel: null,
    reliability: 1,
    mass: 0,
    cost: 0,
    height: 1,
    size: 'm',
    desc: '',
    guidebook: null,
    ...raw,
    flags: { ...(raw.flags ?? {}) },
    aero: { sideArea: 0, ...(raw.aero ?? {}) },
  }));
  const byId = Object.fromEntries(parts.map((p) => [p.id, p]));
  const families = [...(json.families ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return { byId, parts, families, get: (id) => byId[id] ?? null };
}

export const partRadius = (def) => BASE_RADIUS * (SIZE_SCALE[def.size] ?? 1);

function clonePart(p) {
  return { ...p, engine: p.engine ? { ...p.engine } : undefined };
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64(code) {
  const padded = code.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (code.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class Assembly {
  #before = null; // snapshot taken before an edit, pushed to history on commit

  constructor(json, catalog) {
    this.catalog = catalog;
    this.name = json?.name ?? 'Untitled';
    this.symmetry = SYMMETRIES.includes(json?.symmetry) ? json.symmetry : 1;
    this.launch = { slot: json?.launch?.slot ?? 'mild' };
    this.parts = (json?.parts ?? []).map((p) => ({
      id: p.id, type: p.type, parent: p.parent ?? null, node: p.node ?? null,
      angle: Number(p.angle) || 0, yFrac: p.yFrac == null ? 0.5 : Number(p.yFrac), variant: p.variant ?? null, group: p.group ?? null,
      material: p.material ?? null,
      ...(p.engine ? { engine: { fuel: p.engine.fuel, nozzle: p.engine.nozzle, pump: p.engine.pump } } : {}),
    }));
    this.#dropInvalid();
    this.history = [];
    this.future = [];
    this.version = 0; // bumps on every change, so views know when to refresh
  }

  // ---------- queries ----------
  get root() {
    return this.parts.find((p) => p.parent === null) ?? null;
  }

  part(id) {
    return this.parts.find((p) => p.id === id) ?? null;
  }

  def(id) {
    const p = this.part(id);
    return p ? this.catalog.get(p.type) : null;
  }

  children(id, node = null) {
    return this.parts.filter((p) => p.parent === id && (node === null || p.node === node));
  }

  /** The node of `p` that its own parent connection uses (a part hanging under its parent is joined at its top). */
  #usedByParent(p) {
    return p.parent === null ? null : p.node === 'bottom' ? 'top' : p.node === 'top' ? 'bottom' : null;
  }

  /** Nodes a new part could hang on: [{ partId, node }]. top/bottom hold one part, radial holds many. */
  freeNodes() {
    const out = [];
    for (const p of this.parts) {
      const def = this.catalog.get(p.type);
      if (!def || def.attach !== 'axial') continue;
      const taken = this.#usedByParent(p);
      for (const node of def.nodes) {
        if (node === 'radial' || (node !== taken && this.children(p.id, node).length === 0)) out.push({ partId: p.id, node });
      }
    }
    return out;
  }

  /** Can a part of this type go on that node? Returns { ok, reason }. */
  canAttach(typeId, parentId, node) {
    const def = this.catalog.get(typeId);
    if (!def) return { ok: false, reason: 'Unknown part' };
    if (!this.parts.length) return { ok: def.attach === 'axial', reason: def.attach === 'axial' ? '' : 'Start with a capsule' };
    const parent = this.part(parentId);
    const parentDef = parent && this.catalog.get(parent.type);
    if (!parent || !parentDef) return { ok: false, reason: 'No such parent' };
    if (!parentDef.nodes.includes(node)) return { ok: false, reason: `No ${node} node there` };
    if (node === 'radial') return def.attach === 'radial' ? { ok: true, reason: '' } : { ok: false, reason: 'Only side-mounted parts fit a radial node' };
    if (def.attach !== 'axial') return { ok: false, reason: 'Side-mounted parts need a radial node' };
    if (this.children(parentId, node).length || this.#usedByParent(parent) === node) return { ok: false, reason: 'Node already used' };
    const needs = node === 'top' ? 'bottom' : 'top';
    if (!def.nodes.includes(needs)) return { ok: false, reason: `That part has no ${needs} connector` };
    return { ok: true, reason: '' };
  }

  // ---------- history ----------
  #snapshot() {
    return { name: this.name, symmetry: this.symmetry, launch: { ...this.launch }, parts: this.parts.map(clonePart) };
  }

  #restore(s) {
    this.name = s.name;
    this.symmetry = s.symmetry;
    this.launch = { ...s.launch };
    this.parts = s.parts.map(clonePart);
    this.version += 1;
  }

  #commit() {
    this.history.push(this.#before);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future = [];
    this.version += 1;
  }

  #begin() {
    this.#before = this.#snapshot();
  }

  get canUndo() { return this.history.length > 0; }
  get canRedo() { return this.future.length > 0; }

  undo() {
    if (!this.canUndo) return false;
    this.future.push(this.#snapshot());
    this.#restore(this.history.pop());
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this.history.push(this.#snapshot());
    this.#restore(this.future.pop());
    return true;
  }

  // ---------- edits ----------
  #nextId() {
    let max = 0;
    for (const p of this.parts) {
      const n = Number(/^p(\d+)$/.exec(p.id)?.[1]);
      if (n > max) max = n;
    }
    return `p${max + 1}`;
  }

  #nextGroup() {
    let max = 0;
    for (const p of this.parts) {
      const n = Number(/^g(\d+)$/.exec(p.group ?? '')?.[1]);
      if (n > max) max = n;
    }
    return `g${max + 1}`;
  }

  /** Attach a part. Radial parts get `symmetry` copies around the axis. Returns the new ids, or [] if refused. */
  attach(typeId, parentId = null, node = null, { angle = 0, yFrac = null, engine = null, symmetry = null } = {}) {
    const def = this.catalog.get(typeId);
    if (!def) return [];
    if (!this.parts.length) {
      if (def.attach !== 'axial') return [];
      this.#begin();
      this.parts.push({ id: this.#nextId(), type: typeId, parent: null, node: null, angle: 0, yFrac: 0.5, variant: null, group: null, ...(def.engine ? { engine: engine ?? defaultEngine(def) } : {}) });
      this.#commit();
      return [this.parts[0].id];
    }
    if (!this.canAttach(typeId, parentId, node).ok) return [];
    this.#begin();
    const ids = [];
    const frac = yFrac ?? def.attachFrac;
    if (node === 'radial') {
      const n = symmetry ?? this.symmetry;
      const group = n > 1 ? this.#nextGroup() : null;
      for (let k = 0; k < n; k++) {
        const id = this.#nextId();
        this.parts.push({ id, type: typeId, parent: parentId, node, angle: (angle + (360 / n) * k) % 360, yFrac: frac, variant: null, group });
        ids.push(id);
      }
    } else {
      const id = this.#nextId();
      this.parts.push({ id, type: typeId, parent: parentId, node, angle: 0, yFrac: 0.5, variant: null, group: null, ...(def.engine ? { engine: engine ?? defaultEngine(def) } : {}) });
      ids.push(id);
    }
    this.#commit();
    return ids;
  }

  /** Insert an axial part between `belowId` and its parent (e.g. a tank above the engine). Returns the new ids. */
  insertAbove(belowId, typeId) {
    const below = this.part(belowId);
    const def = this.catalog.get(typeId);
    if (!below || !def || def.attach !== 'axial' || !def.nodes.includes('top') || !def.nodes.includes('bottom')) return [];
    if (below.parent === null || below.node !== 'bottom') return [];
    this.#begin();
    const id = this.#nextId();
    this.parts.push({ id, type: typeId, parent: below.parent, node: 'bottom', angle: 0, yFrac: 0.5, variant: null, group: null, ...(def.engine ? { engine: defaultEngine(def) } : {}) });
    below.parent = id;
    this.#commit();
    return [id];
  }

  /** Remove a part with everything hanging on it, and its symmetry twins. Returns the removed ids. */
  remove(id) {
    const target = this.part(id);
    if (!target) return [];
    this.#begin();
    const doomed = new Set();
    const seeds = target.group ? this.parts.filter((p) => p.group === target.group).map((p) => p.id) : [id];
    const visit = (pid) => {
      if (doomed.has(pid)) return;
      doomed.add(pid);
      for (const c of this.children(pid)) visit(c.id);
    };
    seeds.forEach(visit);
    this.parts = this.parts.filter((p) => !doomed.has(p.id));
    this.#commit();
    return [...doomed];
  }

  clear() {
    this.#begin();
    this.parts = [];
    this.#commit();
  }

  /** Change an engine's chamber, nozzle and pump. The pump must match the part size; if not, the part type is swapped. */
  setEngine(id, engineDef) {
    const p = this.part(id);
    const def = p && this.catalog.get(p.type);
    if (!def?.engine) return false;
    this.#begin();
    const wanted = `engine_${String(engineDef.pump).toLowerCase()}`;
    if (p.type !== wanted && this.catalog.get(wanted)) p.type = wanted;
    p.engine = { fuel: engineDef.fuel, nozzle: engineDef.nozzle, pump: engineDef.pump };
    this.#commit();
    return true;
  }

  /** Choose the material of one part (an id from data/materials.json). Symmetry twins change together. */
  setMaterial(id, materialId) {
    const p = this.part(id);
    if (!p) return false;
    this.#begin();
    const twins = p.group ? this.parts.filter((q) => q.group === p.group) : [p];
    for (const q of twins) q.material = materialId;
    this.#commit();
    return true;
  }

  /** Swap a part for another type in the same place (same parent, node, angle). Children stay. Returns true if swapped. */
  replace(id, typeId) {
    const p = this.part(id);
    const from = p && this.catalog.get(p.type);
    const to = this.catalog.get(typeId);
    if (!p || !from || !to || from.attach !== to.attach) return false;
    if (to.attach === 'axial') {
      // the new part must offer the nodes the neighbours use
      if (p.parent !== null && !to.nodes.includes(p.node === 'top' ? 'bottom' : 'top')) return false;
      for (const c of this.children(id)) if (!to.nodes.includes(c.node)) return false;
    }
    this.#begin();
    const twins = p.group ? this.parts.filter((q) => q.group === p.group) : [p];
    for (const q of twins) {
      q.type = typeId;
      q.material = null;
      if (to.engine) q.engine = q.engine ?? defaultEngine(to);
      else delete q.engine;
      if (to.engine && q.engine) q.engine.pump = String(to.size ?? 'm').toUpperCase();
    }
    this.#commit();
    return true;
  }

  rotate(id, degrees) {
    const p = this.part(id);
    if (!p || p.node !== 'radial') return false;
    this.#begin();
    const twins = p.group ? this.parts.filter((q) => q.group === p.group) : [p];
    for (const q of twins) q.angle = ((q.angle + degrees) % 360 + 360) % 360;
    this.#commit();
    return true;
  }

  slide(id, deltaFrac) {
    const p = this.part(id);
    if (!p || p.node !== 'radial') return false;
    this.#begin();
    const twins = p.group ? this.parts.filter((q) => q.group === p.group) : [p];
    for (const q of twins) q.yFrac = Math.min(0.95, Math.max(0.05, q.yFrac + deltaFrac));
    this.#commit();
    return true;
  }

  setSymmetry(n) {
    if (!SYMMETRIES.includes(n)) return false;
    this.symmetry = n;
    this.version += 1;
    return true;
  }

  setLaunchSlot(slot) {
    this.#begin();
    this.launch.slot = slot;
    this.#commit();
  }

  rename(name) {
    this.name = String(name || 'Untitled').slice(0, 40);
    this.version += 1;
  }

  // ---------- layout ----------
  /** Positions in metres (README-ARCH.md "Layout"). Root base at 0, then shifted so the lowest axial base is 0. */
  layout() {
    const root = this.root;
    const out = [];
    if (!root) return out;
    const byId = new Map();
    const place = (p, base) => {
      const def = this.catalog.get(p.type);
      if (!def) return;
      const entry = {
        id: p.id, type: p.type, def, attach: def.attach, parentId: p.parent, node: p.node, angle: p.angle, yFrac: p.yFrac,
        y: base, height: def.height, radius: partRadius(def), x: 0, z: 0, centerY: base + def.height / 2, engine: p.engine ?? null, group: p.group, material: p.material ?? null,
      };
      byId.set(p.id, entry);
      out.push(entry);
      for (const c of this.children(p.id)) {
        const cdef = this.catalog.get(c.type);
        if (!cdef) continue;
        if (c.node === 'top') place(c, base + def.height);
        else if (c.node === 'bottom') place(c, base - cdef.height);
        else if (c.node === 'radial') {
          const y = base + def.height * c.yFrac;
          const r = partRadius(def);
          const a = (c.angle * Math.PI) / 180;
          const e = {
            id: c.id, type: c.type, def: cdef, attach: 'radial', parentId: p.id, node: 'radial', angle: c.angle, yFrac: c.yFrac,
            y, height: cdef.height, radius: r, x: r * Math.cos(a), z: -r * Math.sin(a), centerY: y, engine: null, group: c.group, material: c.material ?? null,
          };
          byId.set(c.id, e);
          out.push(e);
        }
      }
    };
    place(root, 0);
    let min = Infinity;
    for (const e of out) if (e.attach === 'axial') min = Math.min(min, e.y);
    if (!Number.isFinite(min)) min = 0;
    for (const e of out) {
      e.y -= min;
      e.centerY -= min;
    }
    return out;
  }

  get stackHeight() {
    let top = 0;
    for (const e of this.layout()) if (e.attach === 'axial') top = Math.max(top, e.y + e.height);
    return top;
  }

  // ---------- validation and serialisation ----------
  /** Problems a loaded blueprint can have: unknown parts, orphans, loops, two roots. */
  validate() {
    const errors = [];
    const roots = this.parts.filter((p) => p.parent === null);
    if (this.parts.length && roots.length !== 1) errors.push(`Expected one root part, found ${roots.length}`);
    const ids = new Set(this.parts.map((p) => p.id));
    for (const p of this.parts) {
      if (!this.catalog.get(p.type)) errors.push(`${p.id}: unknown part type "${p.type}"`);
      if (p.parent !== null && !ids.has(p.parent)) errors.push(`${p.id}: parent "${p.parent}" does not exist`);
      if (p.parent !== null && !NODES.includes(p.node)) errors.push(`${p.id}: bad node "${p.node}"`);
    }
    const reachable = new Set();
    const walk = (id) => {
      if (reachable.has(id)) return;
      reachable.add(id);
      for (const c of this.children(id)) walk(c.id);
    };
    if (roots[0]) walk(roots[0].id);
    for (const p of this.parts) if (!reachable.has(p.id)) errors.push(`${p.id}: not connected to the stack`);
    return errors;
  }

  #dropInvalid() {
    // Keep only parts that are known and connected, so a bad share code degrades instead of breaking the screen.
    this.parts = this.parts.filter((p) => this.catalog.get(p.type));
    const ids = new Set(this.parts.map((p) => p.id));
    this.parts = this.parts.filter((p) => p.parent === null || (ids.has(p.parent) && NODES.includes(p.node)));
    const roots = this.parts.filter((p) => p.parent === null);
    if (roots.length > 1) {
      const keep = roots[0].id;
      this.parts = this.parts.filter((p) => p.parent !== null || p.id === keep); // the reachability walk below drops the rest
    }
    const reachable = new Set();
    const walk = (id) => {
      if (reachable.has(id)) return;
      reachable.add(id);
      for (const c of this.children(id)) walk(c.id);
    };
    if (roots[0]) walk(roots[0].id);
    this.parts = this.parts.filter((p) => reachable.has(p.id));
  }

  toJSON() {
    return { name: this.name, symmetry: this.symmetry, launch: { ...this.launch }, parts: this.parts.map(clonePart) };
  }

  clone() {
    return new Assembly(this.toJSON(), this.catalog);
  }

  toShareCode() {
    return SHARE_PREFIX + toBase64(JSON.stringify(this.toJSON()));
  }

  /** Returns an Assembly, or null when the code is not ours or not JSON. */
  static fromShareCode(code, catalog) {
    const text = String(code ?? '').trim();
    if (!text.startsWith(SHARE_PREFIX)) return null;
    try {
      const json = JSON.parse(fromBase64(text.slice(SHARE_PREFIX.length)));
      return new Assembly(json, catalog);
    } catch {
      return null;
    }
  }
}

function defaultEngine(def) {
  return { fuel: 'methalox', nozzle: 'vac', pump: String(def.size ?? 'm').toUpperCase() };
}
