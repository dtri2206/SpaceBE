// Checks every Blender part model against the contract (src/builder/tools/blender/README.md):
// the file exists, size and triangle budget, height and joint radius of axial parts, slot_<key> names.
// Run from the repo root: node src/builder/tests/models.test.mjs
import { readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const j = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));
const { mergeSectionData } = await import(pathToFileURL(path.join(ROOT, 'src/builder/sections.js')).href);
const files = {};
for (const id of ['nose', 'body', 'tail', 'pad']) files[id] = { parts: j(`src/builder/sections/${id}/parts.json`), internals: j(`src/builder/sections/${id}/internals.json`), section: j(`src/builder/sections/${id}/section.json`) };
const { partsJson, internalsJson } = mergeSectionData(j('src/builder/data/families.json'), files);
const parts = partsJson.parts ?? partsJson;
const kits = internalsJson.kits ?? {};
const RADIUS = { s: 0.9375, m: 1.25, l: 1.6875 };
const hullData = j('src/builder/data/hull.json');
const MAX_BYTES = 400 * 1024, MAX_TRIS = 20000, SECTION_BYTES = 12 * 1024 * 1024;

let failures = 0;
const ok = (cond, msg) => { if (cond) console.log(`ok    ${msg}`); else { failures += 1; console.log(`FAIL  ${msg}`); } };

/** The JSON chunk of a GLB. */
function glbJson(file) {
  const b = readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString('utf8'));
}
// 4x4 column-major matrices for node transforms
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
function trs(n) {
  if (n.matrix) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0], [x, y, z, w] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}
const apply = (m, [x, y, z]) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

/** { tris, min, max, names } of a GLB (bounds from the accessors' min/max through the node transforms). */
function measure(file) {
  const g = glbJson(file);
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  let tris = 0; const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; const names = [];
  const visit = (ni, parent) => {
    const n = g.nodes[ni];
    if (n.name) names.push(n.name);
    const m = mul(parent, trs(n));
    if (n.mesh != null) for (const p of g.meshes[n.mesh].primitives) {
      const pos = g.accessors[p.attributes.POSITION];
      tris += (p.indices != null ? g.accessors[p.indices].count : pos.count) / 3;
      if (pos.min && pos.max) for (const cx of [pos.min[0], pos.max[0]]) for (const cy of [pos.min[1], pos.max[1]]) for (const cz of [pos.min[2], pos.max[2]]) {
        const v = apply(m, [cx, cy, cz]);
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[k]); max[k] = Math.max(max[k], v[k]); }
      }
    }
    for (const c of n.children ?? []) visit(c, m);
  };
  const scene = g.scenes[g.scene ?? 0];
  for (const ni of scene.nodes) visit(ni, I);
  return { tris: Math.round(tris), min, max, names };
}

const modelled = parts.filter((p) => p.model?.builder);
console.log(`${modelled.length} parts use Blender models`);
const perSection = {};
for (const def of modelled) {
  const file = path.join(ROOT, 'public/assets/models/builder', `${def.model.builder}.glb`);
  if (!existsSync(file)) { ok(false, `${def.id}: ${def.model.builder}.glb exists`); continue; }
  const bytes = statSync(file).size;
  perSection[def.section] = (perSection[def.section] ?? 0) + bytes;
  ok(bytes <= MAX_BYTES, `${def.id}: ${Math.round(bytes / 1024)} KB (≤ 400 KB)`);
  const m = measure(file);
  ok(m.tris <= MAX_TRIS, `${def.id}: ${m.tris} triangles (≤ ${MAX_TRIS})`);
  if (def.attach === 'axial') {
    // model.below: a cover that really hangs down over the part under it (Orion's abort-system fairing over the crew module)
    ok(m.min[1] >= -0.02 * def.height - 0.02 - (Number(def.model.below) || 0) || def.engine, `${def.id}: nothing below its base${def.model.below ? ` beyond its declared ${def.model.below} m` : ''} (min y ${m.min[1].toFixed(3)})`);
    ok(Math.abs(m.max[1] - def.height) <= 0.02 * def.height + 0.02, `${def.id}: top at ${m.max[1].toFixed(3)} m for a ${def.height} m part`);
    const r = Math.max(m.max[0], -m.min[0], m.max[2], -m.min[2]);
    const R = RADIUS[def.size] ?? 1.25;
    // only parts whose wall IS the vehicle's outer skin must sit at the joint radius (the hull's 'shell' kind); towers,
    // covers, capsules, engines, adapters and parts riding inside a skirt or fairing keep their own width
    const prof = def.hullProfile ?? hullData.profiles?.[def.id] ?? null;
    const shell = !def.engine && !def.adapter && !def.flags?.capsule && def.family !== 'abort' && (!prof || prof.kind === 'shell');
    // model.proud (m): fittings that really stand out of the wall, e.g. the Dragon trunk's fins
    if (shell) ok(r - R <= 0.06 * R + (Number(def.model.proud) || 0) && R - r <= 0.06 * R, `${def.id}: widest ${r.toFixed(3)} m at the ${def.size.toUpperCase()} joint radius ${R}`);
  }
  const slots = kits[def.internals]?.slots ?? [];
  const named = m.names.filter((n) => /^slot_/.test(n));
  for (const n of named) {
    const key = n.slice(5).split('__')[0];
    ok(slots.some((s) => s.key === key), `${def.id}: ${n} names a slot of its kit (${def.internals ?? 'none'})`);
    ok(/^[a-z0-9]+(_[a-z0-9]+)*(__[a-z0-9_]+)?$/i.test(n), `${def.id}: ${n} is a clean node name`);
  }
}
// ground models of the launch pad (not catalogue parts): budget only
const padDir = path.join(ROOT, 'public/assets/models/builder/pad');
if (existsSync(padDir)) {
  const { readdirSync } = await import('node:fs');
  for (const name of readdirSync(padDir).filter((n) => n.endsWith('.glb'))) {
    const file = path.join(padDir, name);
    const bytes = statSync(file).size;
    perSection.pad = (perSection.pad ?? 0) + bytes;
    ok(bytes <= MAX_BYTES, `pad/${name}: ${Math.round(bytes / 1024)} KB (≤ 400 KB)`);
    const m = measure(file);
    ok(m.tris <= MAX_TRIS, `pad/${name}: ${m.tris} triangles (≤ ${MAX_TRIS})`);
    ok(m.min[1] >= -0.05 || /trench|pit/.test(name), `pad/${name}: stands on the ground (min y ${m.min[1].toFixed(2)})`);
  }
}
for (const [sec, bytes] of Object.entries(perSection)) ok(bytes <= SECTION_BYTES, `${sec}: ${(bytes / 1048576).toFixed(1)} MB of models (≤ 12 MB)`);
console.log(failures ? `\n${failures} model check(s) failed.` : '\nAll model checks passed.');
process.exit(failures ? 1 : 0);
