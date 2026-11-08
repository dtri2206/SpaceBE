// Hangar v5 launcher part: pure Node contract checks (no browser, no dependencies).
// node src/builder/tests/hangar-v5-launcher.test.mjs
import assert from 'node:assert/strict';
import {readFileSync, statSync, readdirSync, existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const hangar = path.join(repo, 'public/assets/models/builder/hangar');
const v5 = path.join(hangar, 'v5');
const fragment = JSON.parse(readFileSync(path.join(v5, 'launcher.json'), 'utf8'));
const MODULE = 'launcher_ml_v5';

// 1. The sandbox hook: launcherModule names a module that this fragment defines and ships.
assert.equal(fragment.launcherModule, MODULE, 'launcherModule is launcher_ml_v5');
const mod = fragment.modules?.[MODULE];
assert.ok(mod, 'module defined in the fragment');
assert.equal(mod.file, `v5/${MODULE}.glb`, 'file path relative to the hangar folder, v5/ prefix');
for (const [id, def] of Object.entries(fragment.modules)) {
  assert.ok(id.startsWith('launcher_'), 'module ids are prefixed with the part name: ' + id);
  assert.ok(existsSync(path.join(hangar, def.file)), 'GLB exists: ' + def.file);
}

// 2. Read the GLB container: JSON chunk, nodes, accessor bounds (Draco keeps POSITION min/max).
function glb(file) {
  const b = readFileSync(file);
  assert.equal(b.toString('ascii', 0, 4), 'glTF', 'GLB magic');
  assert.equal(b.readUInt32LE(8), b.length, 'GLB length header');
  const n = b.readUInt32LE(12);
  assert.equal(b.toString('ascii', 16, 20), 'JSON');
  return JSON.parse(b.subarray(20, 20 + n).toString('utf8'));
}
const file = path.join(hangar, mod.file);
const j = glb(file);
const byName = Object.fromEntries(j.nodes.map((node, i) => [node.name, {...node, index: i}]));
assert.ok(byName[MODULE], 'root node named after the module');
const attach = byName.attach_deck;
assert.ok(attach, 'attach_deck marker');
const t = attach.translation ?? [0, 0, 0];
assert.ok(Math.abs(t[0]) < 1e-4 && Math.abs(t[1] - 7) < 1e-4 && Math.abs(t[2]) < 1e-4, 'attach_deck at [0, 7, 0]: ' + t);
assert.ok(!byName[MODULE].translation || byName[MODULE].translation.every(v => Math.abs(v) < 1e-6), 'root at the origin');
for (const name of ['shell', 'base', 'stairs', 'deck', 'lamps']) assert.ok(byName[name]?.mesh !== undefined, 'mesh node ' + name);
for (const node of j.nodes.filter(node => node.mesh !== undefined))
  assert.ok(!node.translation && !node.rotation && !node.scale, 'baked mesh transforms: ' + node.name);
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
let triangles = 0;
for (const m of j.meshes) for (const p of m.primitives) {
  const a = j.accessors[p.attributes.POSITION];
  for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a.min[k]); hi[k] = Math.max(hi[k], a.max[k]); }
  triangles += j.accessors[p.indices].count / 3;
}
assert.ok(Math.max(Math.abs(lo[0]), hi[0], Math.abs(lo[2]), hi[2]) <= 8.1, `footprint within +-8.1 m: ${lo} .. ${hi}`);
assert.ok(lo[1] >= -0.01 && hi[1] <= 9.4, `stands on the floor and stays under the level-01 deck beams: y ${lo[1]}..${hi[1]}`);
assert.ok(Math.abs(mod.bounds.max[1] - hi[1]) < .01 && Math.abs(mod.bounds.min[0] - lo[0]) < .01, 'catalog bounds match the GLB');
assert.ok(triangles <= 25000, 'about 25k triangles near: ' + triangles);
assert.equal(triangles, mod.triangles, 'catalog triangles match the GLB');
// Calm materials: baked colour + ORM per steel mesh, emissive only on the lamp lenses, no glTF lights.
assert.ok(!j.extensions?.KHR_lights_punctual, 'no real lights');
for (const m of j.materials) {
  const emissive = Math.max(...(m.emissiveFactor ?? [0, 0, 0])) * (m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1);
  if (m.name.startsWith('launcher_v5_lamps')) assert.ok(emissive > .5 && emissive <= 2.5, 'restrained lamp lenses: ' + m.name + ' ' + emissive);
  else {
    assert.ok(emissive === 0, 'no glow on steel: ' + m.name);
    assert.ok(m.pbrMetallicRoughness?.baseColorTexture && m.pbrMetallicRoughness?.metallicRoughnessTexture, 'baked atlases: ' + m.name);
  }
}
for (const image of j.images) assert.ok(image.bufferView !== undefined, 'textures embedded: ' + image.name);

// 3. Contract: deck at Y 7, nothing above Y 7.4 within r < 6.5 m (measured on every authored face by v5_launcher.py;
//    v5-launcher-check.mjs measures the same on the drawn triangles in the browser).
const info = fragment.launcher;
assert.equal(info.deckTop, 7);
assert.deepEqual(info.attachDeck, [0, 7, 0]);
assert.equal(info.clearance.radius, 6.5);
assert.ok(info.clearance.measuredMaxY <= 7.4 && info.clearance.measuredMaxY >= 7, 'measured clearance: ' + info.clearance.measuredMaxY);
assert.ok(info.heroChamfer.distance >= 6.5, 'the hero face stays outside the ship clearance');
assert.equal(info.pedestals.length, 6, 'six pedestals');

// 4. Colliders: base ml boxes hidden, ours cover the box and the pedestals, nothing inside the deck top above 7.
const base = JSON.parse(readFileSync(path.join(hangar, 'layout.json'), 'utf8')).colliders.filter(c => c.kind === 'ml');
const hidden = c => fragment.hideColliders.some(h => (!h.kind || h.kind === c.kind) && c.center.every((v, i) => v >= h.region.min[i] && v <= h.region.max[i]));
assert.ok(base.length > 0 && base.every(hidden), 'all original ml colliders hidden');
const ml = fragment.colliders.filter(c => c.kind === 'ml');
assert.ok(ml.length >= 7, 'box and pedestal colliders');
for (const c of fragment.colliders) {
  for (let k = 0; k < 3; k++) assert.ok(c.size[k] > 0, 'positive collider size');
  assert.ok(c.center[1] + c.size[1] / 2 <= 7.001, 'colliders end at the deck top');
  assert.ok(Math.abs(c.center[0]) + c.size[0] / 2 <= 8.1 && Math.abs(c.center[2]) + c.size[2] / 2 <= 8.1, 'colliders inside the footprint');
}
const inside = (p) => ml.some(c => p.every((v, i) => Math.abs(v - c.center[i]) <= c.size[i] / 2 + 1e-6));
assert.ok(inside([0, 5, 0]) && inside([6, 5, 6]) && inside([-6, 5, 6]) && inside([6, 5, -6]), 'box interior is solid');
assert.ok(!inside([-6.5, 5, -6.5]), 'the hero corner in front of the chamfer is open (stairs)');
assert.ok(!inside([0, 1, 0]), 'walkable under the box between pedestals');

// 5. Budget: new public files of this part <= 1.2 MB; no external atlas copies left behind.
const mine = readdirSync(v5).filter(f => f.startsWith('launcher')).map(f => path.join(v5, f));
const bytes = mine.reduce((s, f) => s + statSync(f).size, 0);
assert.ok(bytes <= 1.2 * 1024 * 1024, 'launcher files within 1.2 MB: ' + bytes);
assert.equal(statSync(file).size, mod.bytes, 'catalog bytes match the GLB');
const leftovers = existsSync(path.join(v5, 'textures')) ? readdirSync(path.join(v5, 'textures')).filter(f => f.startsWith('launcher')) : [];
assert.deepEqual(leftovers, [], 'baked atlas copies deleted (the GLB embeds them)');

console.log(`hangar-v5-launcher: ok (${triangles} triangles, ${bytes} bytes, bounds x ${lo[0].toFixed(3)}..${hi[0].toFixed(3)} y ${lo[1].toFixed(3)}..${hi[1].toFixed(3)} z ${lo[2].toFixed(3)}..${hi[2].toFixed(3)}, clearance max Y ${info.clearance.measuredMaxY})`);
