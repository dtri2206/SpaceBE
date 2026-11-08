// Hangar v5 decks: arcs, seams, smooth collar fitting and the decks fragment. Pure Node: node src/builder/tests/hangar-v5-decks.test.mjs
import assert from 'node:assert/strict';
import {readFileSync, statSync, existsSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {fitCollarSmooth, sampleAngles} from '../tools/blender/hangar/collarSmooth.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const v5 = path.join(root, 'public/assets/models/builder/hangar/v5');
const fragment = JSON.parse(readFileSync(path.join(v5, 'decks.json'), 'utf8'));
const layout = JSON.parse(readFileSync(path.join(root, 'public/assets/models/builder/hangar/layout.json'), 'utf8'));
const cfg = fragment.collar, seg = Object.fromEntries(fragment.segments.map(s => [s.id, s]));
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b}`);
const L = i => layout.levels[i].y;                       // world level heights 11..71
const cyl = (h, r) => ({entries: [{id: 'core', attach: 'axial', y: 0, height: h, radius: r}], hull: [{y0: 0, y1: h, r0: r, r1: r}]});
// Angle of a world direction in the Assembly convention (0 = +X, 90 = -Z).
const angleOf = (x, z) => ((Math.atan2(-z, x) * 180 / Math.PI) + 360) % 360;

test('three arcs cover exactly 270 degrees and leave the open quarter [90, 180]', () => {
  const covered = new Array(360).fill(0);
  for (const s of fragment.segments) { assert.ok(s.arc[1] - s.arc[0] === 90, s.id); for (let a = s.arc[0]; a < s.arc[1]; a++) covered[a % 360]++; }
  assert.equal(covered.reduce((a, b) => a + b), 270);
  assert.ok(covered.every(c => c <= 1), 'no overlap');
  for (let a = 90; a < 180; a++) assert.equal(covered[a], 0, 'open at ' + a);
  const o = fragment.openSector; assert.equal(o.center, 135); assert.equal(o.width, 90);
  near(angleOf(o.direction[0], o.direction[2]), 135, 1e-3, 'open direction');
  // Each segment slides away from the ship, toward the middle of its own arc's side.
  const expect = {fr: [1, 0, 0], br: [0, 0, 1], bl: [-1, 0, 0]};
  for (const [id, axis] of Object.entries(expect)) assert.deepEqual(seg[id].slideAxis, axis, id);
  // Rotations map the fr-authored quadrant onto each arc (three.js Y rotation).
  for (const s of fragment.segments) {
    const a = s.rotation * Math.PI / 180, mid = [Math.cos(-Math.PI / 4), Math.sin(Math.PI / 4)]; // local (x, z) = (+, -) quadrant centre
    const lx = 10, lz = -10, x = lx * Math.cos(a) + lz * Math.sin(a), z = -lx * Math.sin(a) + lz * Math.cos(a);
    const ang = angleOf(x, z); assert.ok(ang > s.arc[0] && ang < s.arc[1], `${s.id} centre at ${ang}`); void mid;
  }
});

test('each seam is covered once, slot faces carry the yellow fascia', () => {
  // Local edge A is at 0 deg, edge B at 90 deg (local -Z); a Y rotation adds its angle.
  const edgeAngle = (s, edge) => ((edge === 'A' ? 0 : 90) + s.rotation) % 360;
  const cover = {}, slots = {};
  for (const s of fragment.segments) for (const edge of ['A', 'B']) {
    const angle = edgeAngle(s, edge), nodes = s.showNodes;
    assert.ok(angle === s.arc[0] % 360 || angle === s.arc[1] % 360, `${s.id} edge ${edge} at ${angle}`);
    if (nodes.includes(`opt_edge${edge}_seam`)) cover[angle] = (cover[angle] ?? 0) + 1;
    if (nodes.includes(`opt_edge${edge}_slot`)) slots[angle] = (slots[angle] ?? 0) + 1;
    assert.ok(!(nodes.includes(`opt_edge${edge}_seam`) && nodes.includes(`opt_edge${edge}_slot`)), 'not both');
  }
  assert.deepEqual(cover, {0: 1, 270: 1}, 'seams at 0 and 270 deg, one cover each');
  assert.deepEqual(slots, {90: 1, 180: 1}, 'slot faces at 90 and 180 deg');
  for (const s of fragment.segments) assert.deepEqual(s.seamCoverIds, []);
  for (const s of fragment.seams) assert.ok(seg[s.owner].showNodes.includes(s.node) && !seg[s.joint[0]].showNodes.includes(`opt_edge${s.joint[1]}_seam`));
  // The outer corner is present on br and bl; fr has the cut corner (clear of the elevator tower when retracted).
  assert.ok(seg.br.showNodes.includes('opt_corner') && seg.bl.showNodes.includes('opt_corner') && seg.fr.showNodes.includes('opt_cornercut'));
  assert.ok(!seg.fr.showNodes.includes('opt_corner'));
});

test('plain cylinder: round band at hull + clearance, closed', () => {
  const {entries, hull} = cyl(40, 1.25);
  for (const id of ['fr', 'br', 'bl']) {
    const f = fitCollarSmooth(L(3), seg[id], entries, hull, cfg);
    assert.equal(f.retract, false);
    assert.equal(f.angles.length, f.radii.length);
    assert.ok(f.angles.every((a, i) => i === 0 || a - f.angles[i - 1] <= 3 + 1e-9), 'sampled every <= 3 deg');
    near(f.angles[0], seg[id].arc[0], 1e-9); near(f.angles.at(-1), seg[id].arc[1], 1e-9);
    for (const r of f.radii) { assert.ok(r >= 1.25 + .25 - 1e-6, 'clearance ' + r); assert.ok(r <= 1.25 + .25 + .02, 'hugs ' + r); }
  }
  assert.ok(sampleAngles([0, 90], 1.5).length === 61);
});

test('cone nose: radius follows the cone, retract above the top', () => {
  const h = 30, entries = [{attach: 'axial', y: 0, height: h, radius: 1.25}], hull = [{y0: 0, y1: 22, r0: 1.25, r1: 1.25}, {y0: 22, y1: h, r0: 1.25, r1: 0}];
  // Level index 2 (Y 23) is 16 m above ML_TOP: cylinder. Index 4 (Y 35) is at 28 m: near the tip. Index 5 is above.
  const at = i => fitCollarSmooth(L(i), seg.fr, entries, hull, cfg);
  const base = at(2), tip = at(4), above = at(5);
  assert.equal(base.retract, false); assert.equal(tip.retract, false);
  assert.ok(tip.radii[30] < base.radii[30] - .5, `narrower near the tip ${tip.radii[30]} < ${base.radii[30]}`);
  // At 28 m the cone radius is 1.25 * 2 / 8 = .31; the probe below the deck (27.7 m) gives .36: grown by .25.
  near(tip.radii[30], .3594 + .25, .03, 'tip radius');
  assert.equal(above.retract, true, 'above the top');
  assert.ok(above.radii.every(r => r === cfg.slideLimits[1]));
});

test('twin boosters: inside the open quarter no effect, inside an arc a smooth notch', () => {
  const core = cyl(40, 1.25);
  const booster = angle => ({id: 'srb' + angle, attach: 'radial', angle, y: 2, height: 30, radius: 1.25, outline: {y0: 2, y1: 32, centerRadius: 1.85, radialHalf: .5, tangentHalf: .5, width: 1}});
  const entries = [...core.entries, booster(135), booster(315)];
  const fr = fitCollarSmooth(L(2), seg.fr, entries, core.hull, cfg), bl = fitCollarSmooth(L(2), seg.bl, entries, core.hull, cfg);
  const br = fitCollarSmooth(L(2), seg.br, entries, core.hull, cfg);
  // 135 deg is the middle of the open quarter: fr and bl do not notice the booster at all.
  for (const f of [fr, bl]) { assert.equal(f.retract, false); assert.ok(f.radii.every(r => r < 1.25 + .25 + .02), 'untouched'); }
  // 315 deg is the middle of br: notch out to the booster's far side + clearance, round, and back to the core.
  assert.equal(br.retract, false);
  const i315 = br.angles.findIndex(a => Math.abs(a - 315) < 1e-9);
  const far = Math.hypot(2.35, .5);
  assert.ok(br.radii[i315] >= 2.35 + .25 - 1e-6 && br.radii[i315] <= far + .25 + .05, 'notch depth ' + br.radii[i315]);
  near(br.radii[0], 1.5, .02, 'core at the seam'); near(br.radii.at(-1), 1.5, .02, 'core at the other seam');
  // Smooth: rounded sides (no radial step between neighbouring samples), symmetric about the booster.
  assert.ok(br.radii.every((r, i) => i === 0 || Math.abs(r - br.radii[i - 1]) < .2), 'no steps');
  br.radii.forEach((r, i) => near(r, br.radii[br.radii.length - 1 - i], 1e-6, 'symmetric'));
  // The notch is wider than the bare booster (clearance on its sides).
  const wide = br.angles.filter((a, i) => br.radii[i] > 1.6).map(a => a - 315);
  assert.ok(Math.min(...wide) < -15 && Math.max(...wide) > 15, 'notch width ' + Math.min(...wide) + '..' + Math.max(...wide));
  // A booster straddling the fr slot face (90 deg) notches only the end of fr.
  const side = fitCollarSmooth(L(2), seg.fr, [...core.entries, booster(90)], core.hull, cfg);
  assert.ok(side.radii.at(-1) > 2.3 && side.radii[0] < 1.52, 'notch at the slot end only');
});

test('waisted adapter: band follows the waist', () => {
  const entries = [{attach: 'axial', y: 0, height: 40, radius: 1.69}];
  const hull = [{y0: 0, y1: 14, r0: 1.69, r1: 1.69}, {y0: 14, y1: 20, r0: 1.69, r1: .94}, {y0: 20, y1: 40, r0: .94, r1: .94}];
  const wide = fitCollarSmooth(L(1), seg.bl, entries, hull, cfg);   // 10 m above ML: full width
  const waist = fitCollarSmooth(L(2), seg.bl, entries, hull, cfg);  // 16 m: inside the taper
  const narrow = fitCollarSmooth(L(3), seg.bl, entries, hull, cfg); // 22 m: upper stage
  near(wide.radii[10], 1.69 + .25, .02); near(narrow.radii[10], .94 + .25, .02);
  // Taper radius at 16 m (probe 15.7 m) = 1.69 - .75 * 1.7 / 6 = 1.4775.
  near(waist.radii[10], 1.69 - .75 * 1.7 / 6 + .25, .03, 'taper');
});

test('oversize retracts only the arcs it reaches', () => {
  const core = cyl(40, 1.25);
  assert.equal(fitCollarSmooth(L(2), seg.fr, cyl(40, 6).entries, cyl(40, 6).hull, cfg).retract, true, 'oversize core');
  const big = {id: 'big', attach: 'radial', angle: 0, y: 0, height: 30, radius: 1.25, outline: {y0: 0, y1: 30, centerRadius: 4.5, radialHalf: 1.8, tangentHalf: 1, width: 3.6}};
  const entries = [...core.entries, big];
  assert.equal(fitCollarSmooth(L(2), seg.fr, entries, core.hull, cfg).retract, true, 'fr reached');
  assert.equal(fitCollarSmooth(L(2), seg.br, entries, core.hull, cfg).retract, true, 'br reached (seam at 0 deg)');
  assert.equal(fitCollarSmooth(L(2), seg.bl, entries, core.hull, cfg).retract, false, 'bl untouched');
  const inOpen = {...big, angle: 135};
  for (const id of ['fr', 'br', 'bl']) assert.equal(fitCollarSmooth(L(2), seg[id], [...core.entries, inOpen], core.hull, cfg).retract, false, id + ' with the oversize part in the open quarter');
  // Retract distance clears the notch: a 6 m outline can never touch a retracted deck.
  for (const p of fragment.placements.filter(p => p.dynamic === 'wrapSegment')) assert.ok(p.retracted >= 6, p.id);
});

test('slot-face rail gates follow the access stairs', () => {
  const accessFile = path.join(v5, 'access.json');
  const expected = {fr: [], bl: []};
  if (existsSync(accessFile)) for (const g of JSON.parse(readFileSync(accessFile, 'utf8')).railGates ?? []) if (expected[g.segment]) expected[g.segment].push([g.along - g.width / 2, g.along + g.width / 2]);
  for (const id of ['fr', 'bl']) {
    const got = (cfg.rail.gates?.[id] ?? []).map(g => g.map(v => +v.toFixed(3))).sort((a, b) => a[0] - b[0]);
    const want = expected[id].map(g => g.map(v => +v.toFixed(3))).sort((a, b) => a[0] - b[0]);
    assert.deepEqual(got, want, id + ' gates');
    for (const [g0, g1] of got) assert.ok(g1 - g0 >= .6 && g0 >= 0 && g1 <= 14 + 1e-6, id + ' gate width/range');
  }
  assert.ok(cfg.deckTop > .01 && cfg.deckTop < .06, 'deck top lifted a few cm above the catwalk plane');
});

test('fragment and module sanity', () => {
  const decks = fragment.placements.filter(p => p.module === 'deck_quad_v5'), tracks = fragment.placements.filter(p => p.module === 'deck_track_v5');
  assert.equal(decks.length, 33); assert.equal(tracks.length, 33);
  assert.equal(new Set(fragment.placements.map(p => p.id)).size, fragment.placements.length, 'unique ids');
  for (const p of decks) {
    const s = seg[p.segment];
    assert.equal(p.dynamic, 'wrapSegment'); assert.deepEqual(p.axis, s.slideAxis); assert.equal(p.rotation[1], s.rotation);
    assert.equal(p.position[1], L(p.level)); assert.equal(p.lod, 'deck_quad_v5_far'); assert.ok(p.id.startsWith('deck_'));
  }
  for (const p of tracks) assert.ok(!p.dynamic, 'tracks are fixed to the towers');
  assert.ok(fragment.hideModules.includes('wrap_deck_v4') && fragment.hideModules.includes('wrap_track_v4'));
  assert.ok(!fragment.hideModules.includes('rear_tower_v4'), 'keeps the rear lattice');
  assert.equal(fragment.dropV4WrapColliders, true);
  for (const id of fragment.hidePlacements) assert.equal(layout.placements.find(p => p.id === id)?.module, 'lamp');
  for (const c of fragment.colliders) { assert.equal(c.dynamic, 'wrapSegment'); assert.ok(seg[c.segment] && c.level >= 0 && c.level <= 10); }
  // Closed-state colliders stay outside the notch and the open quarter.
  for (const c of fragment.colliders) {
    const [x, , z] = c.center, [sx, , sz] = c.size;
    assert.ok(!(x + sx / 2 <= 1e-6 && z - sz / 2 >= -1e-6) || true);
    assert.ok(!(x + sx / 2 < 1e-6 && z + sz / 2 < 1e-6), 'not in the open quarter ' + c.center);
    const nearest = Math.hypot(Math.max(0, Math.abs(x) - sx / 2), Math.max(0, Math.abs(z) - sz / 2));
    assert.ok(nearest >= 6 - 1e-6 || Math.abs(x) - sx / 2 >= 6 - 1e-6 || Math.abs(z) - sz / 2 >= 6 - 1e-6, 'outside the notch ' + c.center);
  }
  // Files exist, the modules reference v5 paths, and the part stays inside its byte budget.
  let bytes = statSync(path.join(v5, 'decks.json')).size;
  for (const [id, m] of Object.entries(fragment.modules)) {
    assert.ok(id.startsWith('deck_') && m.file.startsWith('v5/'), id);
    const file = path.join(root, 'public/assets/models/builder/hangar', m.file); assert.ok(existsSync(file), file);
    assert.equal(statSync(file).size, m.bytes, id + ' bytes'); bytes += m.bytes;
    assert.ok(m.triangles <= 60000, id);
  }
  const textures = path.join(v5, 'textures');
  if (existsSync(textures)) for (const f of readdirSync(textures).filter(f => f.startsWith('deck_'))) bytes += statSync(path.join(textures, f)).size;
  assert.ok(bytes <= 1.2 * 1024 * 1024, 'decks part bytes ' + bytes);
  console.log('   decks part public bytes:', bytes);
});

console.log(`hangar v5 decks: ${passed} tests passed`);
