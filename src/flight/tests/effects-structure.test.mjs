// Node tests for the structure group's part effects in flight (src/flight/effects/structure.js).
// Run: node src/flight/tests/effects-structure.test.mjs
// The traits are written out here (numbers from src/builder/traits/structure.js for the Reliable preset), so this test
// needs nothing from the builder: max-Q by skin, climb heating, debris hits, the entry heat load, the Columbia path,
// neutral behaviour without traits, pure value hooks and determinism with a seeded rng.
import assert from 'node:assert/strict';
import { FlightController as RawFC, FIXED_DT, TUNING } from '../FlightController.js';
import { PLANETS, G0 } from '../../core/planets.js';
import * as contract from '../../core/contract.js';
import { MOCK_SHIPS, STARTS } from '../presets.js';
import { resetPartEffects, setPartEffectsRecorder } from '../effects/index.js';
import * as structure from '../effects/structure.js';
import { mulberry32 } from '../debris.js';
import { add, scale, norm } from '../vec.js';
import { HEAT_REAL_SCALE } from '../atmosphere.js';
import { simulateAscent } from './paceSim.mjs';

class FlightController extends RawFC { constructor(o) { super({ g0: G0, planets: PLANETS, ...o }); } }
const results = [];
function test(name, fn) { try { fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e]); } }
const run = (fc, seconds, input = {}) => { for (let t = 0; t < seconds && !fc.failed; t += FIXED_DT) fc.update(FIXED_DT, input); };
let record = null;
setPartEffectsRecorder((rec) => { record = rec; });
const notes = (what) => (record?.notes ?? []).filter((n) => n.group === 'structure' && n.what === what);

// ---------- the traits (plain JSON, as ShipSpec.stats.traits.structure carries them) ----------
const ATM = [[0, 1.225, 288.15], [5000, 0.7364, 255.68], [10000, 0.4135, 223.25], [12000, 0.3119, 216.65], [15000, 0.1948, 216.65], [20000, 0.08891, 216.65], [25000, 0.04008, 221.55], [30000, 0.01841, 226.51], [35000, 0.008463, 236.51], [40000, 0.003996, 250.35], [45000, 0.001966, 264.16], [50000, 0.001027, 270.65], [55000, 0.0005681, 260.77], [60000, 0.0003097, 247.02], [65000, 0.0001632, 233.29], [70000, 0.00008283, 219.59], [80000, 0.00001846, 198.64], [85000, 0.000008219, 188.89], [90000, 0.000003416, 186.87], [95000, 0.000001393, 188.42], [100000, 0.0000005604, 195.08]];
const AL2219 = [[20, 1], [100, 0.96], [150, 0.94], [200, 0.9], [250, 0.85], [300, 0.78]]; // stiffness E(T)/E
const tankWall = (id, o = {}) => ({ id, kind: 'tank', partId: id, material: 'al_li', area: 14, pressurised: true, tMm: 3, incipientJ: 10.1, perforateJ: 43.3, critHoleCm: 0.995, armorJ: [], ...o });
const SKINS = { al2219: { qLimitPa: 41429, maxTempC: 200 }, steel: { qLimitPa: 36429, maxTempC: 650 }, carbon: { qLimitPa: 44286, maxTempC: 170 } };
function traits({ skin = 'al2219', tank = {}, armor = [], shield = {}, noseMaxTempC = null } = {}) {
  const s = SKINS[skin];
  const armorJ = armor.map((a) => a.j);
  return {
    version: 1,
    maxQ: { limitPa: s.qLimitPa, section: 'nose', safeFactor: 1.4, neutralPa: 40000, wrinkledShare: 0.8, wrinkleDetect: 1.1 },
    designAscentCdA: 5.7,
    skin: {
      nose: {
        material: skin, hasSkin: true, qLimitPa: s.qLimitPa, maxTempC: noseMaxTempC ?? s.maxTempC, toughness: 1, heatStiffness: AL2219,
        heat: [{ x: 1.68, factor: 2.268, corkR: 0.12, heatCap: 7776 }], sideArea: 6.8, frontArea: 4.9,
        walls: [
          { id: 'p1', kind: 'cabin', partId: 'p1', material: 'al_li', area: 4.95, pressurised: true, tMm: 3, incipientJ: 2006, perforateJ: 9289, critHoleCm: 30.4, armorJ: armorJ.map((j) => Math.max(j, 11808)) },
          { id: 'skin:nose', kind: 'skin', partId: null, material: skin, area: 1.83, pressurised: false, tMm: 2.5, incipientJ: 5, perforateJ: 21.5, critHoleCm: null, armorJ: armorJ.map(() => 5755) },
        ],
        byPart: { p1: 9289, 'skin:nose': 21.5 },
      },
      body: {
        material: skin, hasSkin: true, qLimitPa: s.qLimitPa, maxTempC: s.maxTempC, toughness: 1, heatStiffness: AL2219,
        heat: [{ x: 7.72, factor: 1, corkR: 0, heatCap: 7776 }, { x: 9.32, factor: 1, corkR: 0, heatCap: 7776 }], sideArea: 35.9, frontArea: 0, backArea: 4.9,
        walls: [tankWall('p3', { ...tank, armorJ }), tankWall('p21', { ...tank, armorJ })],
        byPart: { p3: tank.perforateJ ?? 43.3, p21: tank.perforateJ ?? 43.3 },
      },
    },
    armor: armor.map((a, i) => ({ partId: `a${i}`, type: a.type, kind: a.kind })),
    shield: { partId: 'p2', part: 'heat_shield_m', type: 'ablator', ablator: 'avcoat', name: 'Avcoat', peakWcm2: 500, loadJcm2: 5000, fragile: false, ...shield },
    debris: { cmPerGameM: 0.3, speedKmS: 9, refRelSpeed: 120, density: 2.8, holeK: 2.5, cloudHoleK: 1 },
    leak: { tank: { pressureKPa: 300, liquidDensity: 1000, leakCd: 0.6, blowdownS: 1500 }, cabin: { pressureKPa: 101.3, airTempK: 293 } },
    climb: { atmosphere: ATM, topScaleM: 6000, recovery: 0.89, emissivity: 0.8, launchTempC: 15, transitionRe: 500000, aboveTopKm: 85, overheatC: 50, overheatS: 2 },
  };
}
const withTraits = (base, t, stats = {}) => ({ ...base, stats: { ...base.stats, ...stats, traits: { version: 1, structure: t } } });
const reliable = (t, stats) => withTraits(MOCK_SHIPS.reliable, t, { ascentCdA: 5.7, armorHits: t.armor.length, ...stats });
const fresh = () => { resetPartEffects(); record = null; };

// ---------- neutral ----------
test('no traits: the flight is exactly as before (40 kPa, the old heat limits, any unarmoured hit destroys)', () => {
  fresh();
  const fc = new FlightController({ shipSpec: MOCK_SHIPS.reliable });
  assert.equal(fc.fx.value('maxQ', TUNING.maxQ, { fc }), TUNING.maxQ);
  assert.equal(fc._heatLimit(), TUNING.heatLimit.shield);
  const r = fc.fx.value('debrisHit', { absorbed: false, armorUsed: 0, damage: 0 }, { fc, obstacle: { id: 'x', radius: 1, pos: fc.pos, vel: fc.vel } });
  assert.deepEqual(r, { absorbed: false, armorUsed: 0, damage: 0 });
  run(fc, 2, { throttleUp: true });
  assert.equal(record?.state?.structure, undefined, 'no state without traits');
});

// ---------- max-Q ----------
const fastLow = (shipSpec) => new FlightController({ shipSpec, start: { altitude: 8000, speed: 400, flightPathDeg: 45, facing: 'prograde' } }); // q ≈ 38 kPa
test('max-Q: 400 m/s at 8 km (38 kPa) breaks a steel skin (36 kPa) but not 2219 (41 kPa) or carbon (44 kPa)', () => {
  for (const [skin, breaks] of [['steel', true], ['al2219', false], ['carbon', false]]) {
    fresh();
    const fc = fastLow(reliable(traits({ skin })));
    run(fc, 1);
    assert.equal(fc.failed?.causeId === 'max_q_exceeded', breaks, `${skin}: ${JSON.stringify(fc.failed)}`);
    if (breaks) assert.equal(fc.failed.endingId, 'rud');
    assert.ok(Math.abs(fc.telemetry.maxQ - SKINS[skin].qLimitPa) < 1, `telemetry maxQ ${fc.telemetry.maxQ}`);
  }
  fresh();
  const neutral = fastLow(MOCK_SHIPS.reliable);
  run(neutral, 1);
  assert.equal(neutral.failed, null, 'the neutral 40 kPa holds at 38 kPa');
});

test('max-Q: a panel wrinkled at confirm (ascentCdA × 1.25) keeps 80 % of its rating; a hot skin is weaker', () => {
  fresh();
  const fc = fastLow(reliable(traits(), { ascentCdA: 5.7 * 1.25 }));
  assert.ok(Math.abs(fc.fx.value('maxQ', TUNING.maxQ, { fc }) - 41429 * 0.8) < 1);
  run(fc, 0.5);
  assert.equal(fc.failed?.causeId, 'max_q_exceeded', '33 kPa < 38 kPa');
  fresh();
  const hot = fastLow(reliable(traits()));
  hot.fx.flight.state.structure.skinK = { nose: [250 + 273.15], body: [20 + 273.15] };
  assert.ok(Math.abs(hot.fx.value('maxQ', TUNING.maxQ, { fc: hot }) - 41429 * 0.85) < 1, '2219 at 250 °C keeps 85 % of its stiffness, so of its buckling rating');
  const mars = new FlightController({ planetId: 'mars', shipSpec: hot.fx.flight.spec, start: STARTS.marsEntry });
  assert.ok(Math.abs(mars.fx.value('maxQ', TUNING.maxQ, { fc: mars }) - 41429) < 1, 'the climb\'s temperatures do not weaken the ship at Mars');
});

// ---------- the climb ----------
test('the climb heats the skins (real air) and writes peakQ and skinTemp notes; a nose skin far past its limit sheds onto the shield', () => {
  fresh();
  const up = simulateAscent({ ship: reliable(traits()), warp: false }); // the guided gravity turn the HUD shows
  assert.ok(up.ok, JSON.stringify(up.failed));
  const st = record.state.structure;
  assert.ok(st.peakQ > 15000 && st.peakQ < 41429, `peak q ${st.peakQ}`);
  assert.ok(st.peakC.body > 60 && st.peakC.body < 200, `body skin ${st.peakC.body} °C`);
  assert.ok(st.peakC.nose > 60 && st.peakC.nose < 200, `nose skin ${st.peakC.nose} °C`);
  const q = notes('peakQ')[0];
  assert.ok(q && q.value > 0 && q.limit === 41429 && q.trait === 'maxQ.limitPa', JSON.stringify(q));
  assert.ok(notes('skinTemp').some((n) => n.section === 'body' && n.trait === 'skin.body.maxTempC' && n.limit === 200));
  assert.equal(st.shieldDamaged, false);
  // the same climb with a nose skin that weakens at 50 °C: it sheds, the shield is damaged, Mars entry ends The Foam way
  fresh();
  const weak = simulateAscent({ ship: reliable(traits({ noseMaxTempC: 50 })), warp: false }).fc;
  assert.equal(record.state.structure.shieldDamaged, true);
  assert.ok(notes('skinShed').some((n) => n.section === 'nose'));
  const mars = new FlightController({ planetId: 'mars', shipSpec: weak.fx.flight.spec, start: STARTS.marsEntry });
  assert.equal(mars.ship.heatShieldDamaged, true, 'the next scene enters with the damaged shield (params)');
  for (let t = 0; t < 400 && !mars.failed && mars.altitude > 3000; t += FIXED_DT) mars.update(FIXED_DT, {});
  assert.equal(mars.failed?.endingId, 'theFoam');
  assert.equal(mars.failed?.historyHint, 'columbia');
});

// ---------- debris ----------
const R = PLANETS.earth.radius, ALT = 200000, VC = Math.sqrt((PLANETS.earth.g * R * R) / (R + ALT));
const orbit = (shipSpec, rng) => new FlightController({ shipSpec, rng, start: { altitude: ALT, speed: VC, flightPathDeg: 0, facing: 'prograde' } });
const piece = (fc, id, radius, d = 300) => { const dir = norm(fc.vel); return { id, pos: add(fc.pos, scale(dir, d)), vel: add(fc.vel, scale(dir, -120)), radius }; };
const S0 = traits();
const S_TANK = S0;
const assess = (t, id, radius, { armorLeft = 0, side = false } = {}) => structure.assessHit(t, 12345, { rel: side ? { x: 0, y: 0, z: -120 } : { x: 0, y: -120, z: 0 }, forward: { x: 0, y: 1, z: 0 }, armorLeft }, { id, radius });
// a piece id that this seed places on a tank wall, side-on (placement is by area, from the seed and the piece's id)
const TANK_ID = Array.from({ length: 60 }, (_, i) => `t${i}`).find((id) => assess(S_TANK, id, 1, { side: true }).kind === 'tank');

test('ballistic outcomes: a small piece holes an Al-Li tank (leak), a big one bursts it; titanium and steel tanks hold it', () => {
  // side-on hits land on the body's tanks
  const small = assess(S0, TANK_ID, 0.4, { side: true }), big = assess(S0, TANK_ID, 2.2, { side: true });
  assert.equal(small.kind, 'tank');
  assert.equal(small.outcome, 'puncture', JSON.stringify(small));
  assert.equal(big.outcome, 'fatal', JSON.stringify(big));
  assert.ok(big.energyJ > small.energyJ && big.damage === 1 && small.damage < 1);
  const ti = traits({ tank: { material: 'titanium', tMm: 1.65, incipientJ: 4.4, perforateJ: 19, critHoleCm: 1.85 } });
  const steel = traits({ tank: { material: 'stainless', tMm: 1.34, incipientJ: 5.5, perforateJ: 23.5, critHoleCm: 8.95 } });
  assert.equal(assess(ti, TANK_ID, 2.2, { side: true }).outcome, 'puncture', 'titanium: leak before break');
  assert.equal(assess(steel, TANK_ID, 2.5, { side: true }).outcome, 'puncture', 'stainless: leak before break even for the biggest piece');
  // head-on, a crew cabin is a double wall: a small piece only dents it
  const cab = assess(S0, 'c', 0.6);
  const tiny = assess(S0, 'c', 0.35);
  assert.ok(tiny.kind === 'cabin' && tiny.outcome === 'survive' && tiny.damage === 0, `a small piece bounces off the cabin's double wall with no damage: ${JSON.stringify(tiny)}`);
  assert.equal(cab.section, 'nose');
  assert.ok(['survive', 'dent', 'puncture'].includes(cab.outcome) && cab.outcome !== 'fatal');
  // armour: a Whipple shield stops a piece the bare tank could not, and is used up doing it
  const whip = traits({ armor: [{ type: 'whipple_shield', kind: 'whipple', j: 11808 }] });
  const a = assess(whip, TANK_ID, 1.5, { side: true, armorLeft: 1 });
  assert.equal(a.outcome, 'absorbed');
  assert.equal(a.armorUsed, 1);
  assert.equal(assess(S0, TANK_ID, 1.5, { side: true }).outcome, 'fatal', 'the same piece bursts the bare tank');
  // determinism: the same seed and piece land on the same wall with the same result
  assert.deepEqual(assess(S0, 'q', 1.1, { side: true }), assess(S0, 'q', 1.1, { side: true }));
});

test('in orbit: an unarmoured tank hit is a leak the ship survives (fuel drains), a cabin hole is a cabin leak for the life group', () => {
  // a small piece on the path, side-on: rotate the ship so the body faces the stream
  fresh();
  const fc = orbit(reliable(traits()), mulberry32(7));
  fc.orient = { x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) }; // nose 90° off the velocity
  const fuel0 = fc.fuel;
  fc.setObstacles([piece(fc, 'small', 0.4)]);
  run(fc, 6);
  assert.equal(fc.failed, null, JSON.stringify(fc.failed));
  const hit = record.state.structure.hits[0];
  assert.ok(hit && hit.kind === 'tank' && hit.outcome === 'puncture', JSON.stringify(record.state.structure.hits));
  const leak = record.state.structure.tankLeak;
  assert.ok(leak?.kgPerS > 0 && fc.fuel < fuel0, 'the holed tank drains');
  assert.ok(Math.abs(leak.kgPerS * leak.blowdownS - 1729) < 60, `whatever the hole, a tank loses about 1.7 t over its blowdown: ${(leak.kgPerS * leak.blowdownS).toFixed(0)} kg`);
  assert.ok(notes('hit').length === 1 && notes('hit')[0].value > 0 && notes('hit')[0].section === 'body');
  assert.ok(notes('impact')[0].trait?.startsWith('skin.body.byPart.'), JSON.stringify(notes('impact')[0]));
  // head-on: the piece meets the cabin
  fresh();
  const nose = orbit(reliable(traits()), mulberry32(7));
  nose.setObstacles([piece(nose, 'cab', 2.5)]);
  run(nose, 6);
  const h = record.state.structure.hits[0];
  assert.equal(h?.kind, 'cabin', JSON.stringify(record.state.structure.hits));
  if (h.outcome === 'puncture') {
    const L = record.state.structure.cabinLeak;
    assert.ok(L.holeMm2 > 0 && L.kgPerDay > 0 && L.partId === 'p1' && Number.isFinite(L.t), JSON.stringify(L));
  }
});

test('in orbit: a big piece bursts a bare tank (rud, debris_impact) and the fatal hit is recorded', () => {
  fresh();
  const fc = orbit(reliable(traits()), mulberry32(3));
  fc.orient = { x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) };
  fc.setObstacles([piece(fc, 'big', 2.5)]);
  run(fc, 6);
  assert.equal(fc.failed?.causeId, 'debris_impact');
  assert.equal(fc.failed?.endingId, 'rud');
  assert.equal(record.state.structure.hits.at(-1)?.outcome, 'fatal');
});

test('armour still takes a hit as before: the Reliable mock (armorHits 1) with a stuffed shield loses its armour, not the ship', () => {
  fresh();
  const t = traits({ armor: [{ type: 'armor_plate', kind: 'stuffed', j: 76625 }] });
  const fc = orbit(reliable(t, { armorHits: 1 }), mulberry32(5));
  fc.orient = { x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) };
  fc.setObstacles([piece(fc, 'big', 2.5)]);
  run(fc, 6);
  assert.equal(fc.failed, null);
  assert.equal(fc.armorLeft, 0);
  assert.equal(record.state.structure.hits[0]?.outcome, 'absorbed');
  const imp = notes('impact')[0];
  assert.ok(/^armour and the /.test(imp.wallText) && !imp.trait && imp.limit === 76625, JSON.stringify(imp));
  assert.equal(notes('hit')[0].value, 0.02);
});

test('no phantom hits: a near miss, a field replaced and a new scene record nothing', () => {
  fresh();
  const fc = orbit(reliable(traits()), mulberry32(11));
  const dir = norm(fc.vel);
  const side = { x: 0, y: 0, z: 1 };
  // a piece passing 12 m to the side: never within touching distance
  fc.setObstacles([{ id: 'miss', pos: add(add(fc.pos, scale(dir, 240)), scale(side, 12)), vel: add(fc.vel, scale(dir, -120)), radius: 0.5 }]);
  run(fc, 2.05); // about 6 m before it passes
  fc.setObstacles([]); // the field is replaced (or gone) while the piece is close
  run(fc, 0.5);
  assert.equal(fc.fx.flight.state.structure.hits.length, 0, 'replacing the field is not a hit');
  // a piece about to touch when the scene changes: the next controller (another planet, its clock at 0) starts clean
  fc.setObstacles([piece(fc, 'late', 1, 4)]);
  fc.fx.flight.state.structure.near = { late: { radius: 1, rel: { x: 0, y: 0, z: -120 }, forward: fc.forward, armorLeft: 0 } };
  const mars = new FlightController({ planetId: 'mars', shipSpec: fc.fx.flight.spec, start: STARTS.marsEntry });
  run(mars, 0.5);
  assert.equal(mars.fx.flight.state.structure.hits.length, 0, 'a new scene inherits no pieces');
  assert.equal(mars.failed, null);
});

// ---------- entry ----------
const entry = (shield, fpa) => {
  fresh();
  const fc = new FlightController({ planetId: 'mars', shipSpec: withTraits(MOCK_SHIPS.marsArrival, traits({ shield })), start: { ...STARTS.marsEntry, flightPathDeg: fpa } });
  for (let t = 0; t < 1200 && !fc.failed && fc.altitude > 2500; t += FIXED_DT) fc.update(FIXED_DT, {});
  return fc;
};
test('entry: the shield material sets the heat limit; a shield short of heat load burns through on a shallow entry, not a steep one', () => {
  fresh();
  const a = new FlightController({ planetId: 'mars', shipSpec: withTraits(MOCK_SHIPS.marsArrival, traits()), start: STARTS.marsEntry });
  assert.ok(Math.abs(a._heatLimit() - (500 * 1e4) / HEAT_REAL_SCALE) < 1, 'Avcoat 500 W/cm²');
  const p = new FlightController({ planetId: 'mars', shipSpec: withTraits(MOCK_SHIPS.marsArrival, traits({ shield: { peakWcm2: 1100 } })), start: STARTS.marsEntry });
  assert.ok(p._heatLimit() > a._heatLimit(), 'PICA stands a higher peak');
  const ok = entry({}, -24);
  assert.equal(ok.failed, null, JSON.stringify(ok.failed));
  const use = notes('shieldUse')[0];
  assert.ok(use && use.value > 0 && use.value < 1 && use.partId === 'p2', JSON.stringify(use));
  assert.ok(notes('heatLoad')[0]?.trait === 'shield.loadJcm2');
  const thinShallow = entry({ type: 'heatSink', loadJcm2: 1500 }, -21); // the mock's -21° entry delivers about 1,900 J/cm²
  assert.equal(thinShallow.failed?.endingId, 'burnup', JSON.stringify(thinShallow.failed));
  assert.equal(thinShallow.failed?.causeId, 'heat_overload');
  assert.ok(thinShallow.failed.cause.endsWith('.'));
  const thinSteep = entry({ type: 'heatSink', loadJcm2: 1500 }, -26); // about 1,300 J/cm²
  assert.equal(thinSteep.failed, null, JSON.stringify(thinSteep.failed));
});

test('entry: a damaged shield (Shuttle tiles) still ends The Foam way with traits; no shield still burns up', () => {
  for (const [stats, ending] of [[{ heatShieldDamaged: true }, 'theFoam'], [{ hasHeatShield: false }, 'burnup']]) {
    fresh();
    const ship = withTraits(MOCK_SHIPS.marsArrival, traits({ shield: { type: 'tiles', peakWcm2: 27, loadJcm2: 6000, fragile: true } }), stats);
    const fc = new FlightController({ planetId: 'mars', shipSpec: ship, start: STARTS.marsEntry });
    for (let t = 0; t < 400 && !fc.failed && fc.altitude > 3000; t += FIXED_DT) fc.update(FIXED_DT, {});
    assert.equal(fc.failed?.endingId, ending, JSON.stringify(fc.failed));
  }
});

// ---------- rules ----------
test('value hooks are pure (no state change) and only contract names reach the bus', () => {
  fresh();
  const log = [];
  const fc = new FlightController({ bus: { emit: (n, p) => log.push([n, p]) }, shipSpec: reliable(traits({ skin: 'steel' })), start: { altitude: 8000, speed: 400, flightPathDeg: 45 } });
  const before = JSON.stringify(fc.fx.flight.state);
  for (let i = 0; i < 50; i++) {
    structure.maxQ(40000, { fc }, fc.fx.flight);
    structure.heatLimit(2e5, { fc }, fc.fx.flight);
    structure.params(fc.ship, { fc }, fc.fx.flight);
    structure.debrisHit({ absorbed: false, armorUsed: 0, damage: 0 }, { fc, obstacle: piece(fc, `p${i}`, 1) }, fc.fx.flight);
  }
  assert.equal(JSON.stringify(fc.fx.flight.state), before);
  run(fc, 2);
  for (const [n, p] of log) {
    assert.ok(n in contract.EVENTS, n);
    if (n === 'flight:failed') assert.ok(p.endingId in contract.ENDINGS && typeof p.cause === 'string');
  }
});

test('determinism: the same seeded rng gives the same hits, outcomes and record', () => {
  const once = () => {
    fresh();
    const fc = orbit(reliable(traits()), mulberry32(99));
    fc.orient = { x: 0, y: 0, z: Math.sin(Math.PI / 5), w: Math.cos(Math.PI / 5) };
    fc.setObstacles([piece(fc, 'a', 0.5, 200), piece(fc, 'b', 0.9, 500), piece(fc, 'c', 0.3, 800)]);
    run(fc, 10);
    return JSON.stringify({ hits: record?.state?.structure?.hits, failed: fc.failed?.causeId ?? null, fuel: Math.round(fc.fuel) });
  };
  assert.equal(once(), once());
});

let failed = 0;
for (const [s, name, e] of results) { console.log(`${s === 'ok' ? 'ok  ' : 'FAIL'} ${name}`); if (e) { failed++; console.log('     ', e.message); } }
console.log(`${results.length - failed}/${results.length} structure effect tests passed`);
if (failed) process.exit(1);
