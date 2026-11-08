// Flight traits, structure: the skin and structure: the dynamic pressure it stands (max-Q), the heat on the climb, what a debris or micrometeoroid hit does to it, how much the heat shield can absorb on entry, how much it wears per flight.
// Pure (Node-testable, no browser or core imports). Owner: the wave-5 structure agent (see src/builder/CLAUDE.md §8).
// Real numbers live in structure.json next to this file (per part id and per kit option id), never in the section folders;
// they arrive as `data` (catalogData.js imports the JSON for the game, the tests read it), so this file stays pure.
// Returns plain JSON (no Infinity: use null for "unlimited"), so it survives save() and the flight scenes.
//
// What it works out (the physics and its sources are in structure.json):
//   maxQ     the q the ship's structure stands: the weakest skin's rating (hull.js strengthKPa) / the crewed factor of
//            safety 1.4. A ship with no skin keeps the flight model's 40 kPa (limitPa null).
//   skin     per section (nose, body, tail): what a debris hit meets there. Every wall (the hull skin, each tank wall, the
//            crew cabin, dry structure) gets its ballistic limits from NASA's equations (Cour-Palais single wall,
//            Christiansen Whipple and stuffed Whipple), as the kinetic energy (J) of the critical particle at 9 km/s,
//            plus the hole size at which a pressurised wall bursts (Griffith-Irwin critical crack). toughness: the pure
//            material factor of the section's skin (1 = an aluminium 2219 skin, notes-contract §4); punctureJ and
//            wallToughness: its main wall as built (a cabin is a double wall). heat: the skin segments the climb heats
//            (hull.js segments: distance from the nose tip, flare or shoulder factor, cork), for the flight's own heating;
//            heatStiffness: how the skin's stiffness (its buckling rating) falls as it warms.
//   armor    one entry per hit an armour part takes (flags.armorHits), in layout order, with its construction.
//   shield   the heat shield: its type, the peak heat flux and the heat load (real units) it stands.
//   climb    the 1976 standard atmosphere and the boundary-layer constants the flight heats the skin with.
import HULL from '../data/hull.json' with { type: 'json' };
import { HULL_SECTIONS, hullMaterial } from '../hull.js';

const PI = Math.PI;
const fin = (x) => Number.isFinite(x);
const r3 = (v) => (fin(v) ? Math.round(v * 1000) / 1000 : v);
const r1 = (v) => (fin(v) ? Math.round(v * 10) / 10 : v);
const KSI = 6.894757; // MPa per ksi

// ---------------------------------------------------------------------------------------------------------------
// Ballistic limits (energies in J, diameters in cm, speeds in km/s, densities in g/cm³)
// ---------------------------------------------------------------------------------------------------------------
/** Kinetic energy (J) of a sphere of diameter d (cm) and density rho (g/cm³) at V (km/s). */
export const energyOf = (d, rho, V) => 0.5 * (PI / 6) * rho * d ** 3 * (V * 1000) ** 2 * 1e-3;
/** The sphere diameter (cm) that carries energy E (J) at V. */
export const diameterOf = (E, rho, V) => Math.cbrt(Math.max(0, E) / (0.5 * (PI / 6) * rho * (V * 1000) ** 2 * 1e-3));

/** A material's physical properties from structure.json (follows "same"). */
export function materialProps(data, id) {
  let m = data?.materials?.[id] ?? null;
  if (m?.same) m = data.materials[m.same] ?? null;
  return m && fin(m.density) ? m : null;
}
const AL = (data) => materialProps(data, 'al2219');
const soundSpeed = (m) => Math.sqrt(m.eGPa / m.density); // km/s
/** A wall as aluminium for the equations made for metals: composites count their areal density × alEquiv. */
function asMetal(data, m, tCm) {
  if (m.kind !== 'composite') return { m, t: tCm };
  const al = AL(data);
  return { m: al, t: tCm * (m.density / al.density) * (m.alEquiv ?? 1) };
}
const sigmaKsi = (m) => (m.kind === 'composite' ? 40 : m.yieldMPa / KSI);

/**
 * Single wall, thickness tCm (Cour-Palais, NASA TP-2003-210788 eq. 3-9a): P∞ = 5.24 d^(19/18) BHN^-¼ (ρp/ρt)^½ (V/C)^⅔;
 * the wall holds while t ≥ k P∞ (k 1.8 perforation, 2.2 detached spall, 3.0 incipient spall). Titanium needs 2.4/2.2 of
 * that thickness (Ratliff et al. 2009). → the energy (J) of the particle at that limit.
 */
export function singleWallJ(data, mat, tCm, k) {
  const D = data.debris;
  const { m, t } = asMetal(data, mat, tCm);
  const kk = mat.tiBle ? k * (2.4 / 2.2) : k;
  const perD = 5.24 * m.bhn ** -0.25 * (D.density / m.density) ** 0.5 * (D.speedKmS / soundSpeed(m)) ** (2 / 3);
  const d = (t / (kk * perD)) ** (18 / 19);
  return energyOf(d, D.density, D.speedKmS);
}

/**
 * Whipple shield (Christiansen 1993): d_c = 3.918 t_w^⅔ ρp^-⅓ ρb^-1/9 V^-⅔ S^⅓ (σ/70 ksi)^⅓, capped where the bumper is
 * too thin to shatter the particle (t_b = 0.25 d ρp/ρb, TP-2003-210788 eq. 4-1). rear: { m, tCm }; bumper: { tCm, rho }.
 */
export function whippleJ(data, rear, bumper, standoffCm) {
  const D = data.debris;
  const { t } = asMetal(data, rear.m, rear.tCm);
  let d = 3.918 * t ** (2 / 3) * D.density ** (-1 / 3) * bumper.rho ** (-1 / 9) * D.speedKmS ** (-2 / 3) * standoffCm ** (1 / 3) * (sigmaKsi(rear.m) / 70) ** (1 / 3);
  const shatter = (bumper.tCm * bumper.rho) / (0.25 * D.density);
  d = Math.min(d, (data.armor?.shatterLimit ?? 1.5) * shatter);
  return energyOf(d, D.density, D.speedKmS);
}

/** Stuffed (Nextel/Kevlar) Whipple, high velocity (TP-2003-210788 sec. 4.3): d_c = 0.6 (t_w ρ_w)^⅓ ρp^-⅓ V^-⅓ S^⅔ (σ/40)^1/6. */
export function stuffedJ(data, rear, standoffCm) {
  const D = data.debris;
  const { m, t } = asMetal(data, rear.m, rear.tCm);
  const d = 0.6 * (t * m.density) ** (1 / 3) * D.density ** (-1 / 3) * D.speedKmS ** (-1 / 3) * standoffCm ** (2 / 3) * (sigmaKsi(rear.m) / 40) ** (1 / 6);
  return energyOf(d, D.density, D.speedKmS);
}

/** The hole (cm across) at which a wall under stress sigmaMPa bursts: twice the critical crack (K_IC/σ)²/π. */
export const criticalHoleCm = (m, sigmaMPa) => (sigmaMPa > 0 ? 200 * ((m.kic / sigmaMPa) ** 2) / PI : null);

// ---------------------------------------------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------------------------------------------
const familyMaterial = (e, materials) => {
  const fam = materials?.families?.[e.def?.materialFamily];
  if (!fam) return null;
  return fam.options.find((o) => o.id === e.material) ?? fam.options.find((o) => o.id === e.def.defaultMaterial) ?? fam.options[0] ?? null;
};
/** The wall material id and the materials.json mass factor of a part (parts without a family: from their id). */
function partMaterial(e, materials) {
  const o = familyMaterial(e, materials);
  if (o) return { id: o.id, mass: fin(o.mass) ? o.mass : 1 };
  const id = String(e.def?.id ?? '');
  if (/steel|balloon/.test(id)) return { id: 'stainless', mass: 1 };
  if (/carbon|composite/.test(id)) return { id: 'carbon', mass: 1 };
  return { id: 'al_li', mass: 1 };
}
/** Wall thickness (cm) of a part made of this material: the reference wall, keeping the game's mass for the material. */
function scaledThicknessCm(data, ref, mat) {
  const refM = materialProps(data, ref.material);
  const m = materialProps(data, mat.id) ?? refM;
  return (ref.tMm / 10) * mat.mass * (refM.density / m.density);
}

/** One wall's limits against a debris hit (energies in J at the reference speed). */
function wallLimits(data, wall, armorList) {
  const D = data.debris;
  const out = {
    id: wall.id, kind: wall.kind, partId: wall.partId ?? null, material: wall.material, area: r3(wall.area), pressurised: !!wall.sigmaMPa,
    tMm: wall.sandwich ? null : r3(wall.tCm * 10),
  };
  const m = wall.m;
  if (wall.sandwich) {
    // faces as bumper and rear wall, the core's gap counted at channelShare (the cells channel the debris cloud)
    const S = wall.sandwich.coreCm * (data.skins.channelShare ?? 0.25);
    const face = { m, tCm: wall.sandwich.faceCm };
    out.perforateJ = whippleJ(data, face, { tCm: wall.sandwich.faceCm, rho: m.density }, S);
    out.incipientJ = out.perforateJ * (D.kPerforate / D.kIncipient) ** 3;
    out.rear = { m, tCm: wall.sandwich.faceCm };
  } else if (wall.bumper) {
    // a crew cabin: its outer shell is a bumper in front of the pressure vessel
    out.perforateJ = whippleJ(data, { m, tCm: wall.tCm }, wall.bumper, wall.bumper.standoffCm);
    out.incipientJ = out.perforateJ * (D.kPerforate / D.kIncipient) ** 3;
    out.rear = { m, tCm: wall.tCm };
  } else {
    out.perforateJ = singleWallJ(data, m, wall.tCm, D.kPerforate);
    out.incipientJ = singleWallJ(data, m, wall.tCm, D.kIncipient);
    out.rear = { m, tCm: wall.tCm };
  }
  out.critHoleCm = wall.sigmaMPa ? r3(criticalHoleCm(m, wall.sigmaMPa)) : null;
  // the same wall behind each armour hit the ship carries (in the order they are used)
  out.armorJ = armorList.map((a) => {
    const bumper = { tCm: a.bumperMm / 10, rho: a.bumperDensity };
    const sys = a.kind === 'stuffed' ? stuffedJ(data, out.rear, a.standoffCm) : whippleJ(data, out.rear, bumper, a.standoffCm);
    return Math.round(Math.max(sys, out.perforateJ));
  });
  out.perforateJ = Math.round(out.perforateJ * 10) / 10;
  out.incipientJ = Math.round(out.incipientJ * 10) / 10;
  delete out.rear;
  return out;
}

/** The skin's sheet or sandwich for a hull material id (structure.json skins). */
function skinBuild(data, matId) {
  const s = data.skins?.[matId] ?? data.skins?.al2219;
  const m = materialProps(data, s.material) ?? AL(data);
  if (fin(s.faceMm)) return { m, material: s.material, sandwich: { faceCm: s.faceMm / 10, coreCm: s.coreMm / 10 } };
  return { m, material: s.material, tCm: s.tMm / 10 };
}

/** A structure material (materials.json) and the hull skin built of the same metal. */
const SKIN_OF = { al_li: 'al2195', stainless: 'steel', al2219: 'al2219', carbon: 'carbon', titanium: 'titanium' };
/** The pure material factor: the energy that holes this material's standard skin over an aluminium 2219 skin's. */
export function materialToughness(data, skinId, refJ = null) {
  const row = data.skins?.[skinId];
  if (!row) return 1;
  const ref = refJ ?? wallLimits(data, { id: 'ref', kind: 'skin', ...skinBuild(data, 'al2219'), area: 1 }, []).perforateJ;
  const own = wallLimits(data, { id: skinId, kind: 'skin', ...skinBuild(data, skinId), area: 1 }, []).perforateJ;
  return ref > 0 ? own / ref : 1;
}

// ---------------------------------------------------------------------------------------------------------------
// The traits
// ---------------------------------------------------------------------------------------------------------------
/**
 * structureTraits(layout, ctx, data) → this group's traits for ShipSpec.stats.traits.structure.
 * layout: assembly.layout() entries; ctx: { catalog, engines, materials, hull, padFx, stats, optionsOf(entry) };
 * data: the parsed structure.json ({ neutral, ... }). Without the physics data it returns the neutral values: the flight
 * behaves exactly as before.
 */
export function structureTraits(layout, ctx, data) {
  if (!data?.materials || !data?.debris || !Array.isArray(layout)) return { ...(data?.neutral ?? {}) };
  const lay = layout.filter((e) => e?.def);
  const hull = ctx?.hull ?? null;
  const stats = ctx?.stats ?? {};
  const materials = ctx?.materials ?? null;
  const by = hull?.bySection ?? {};
  const hullChoice = Object.fromEntries(HULL_SECTIONS.map((s) => [s, by[s]?.material ?? null])); // hull.js material id per section
  const phys = HULL.physics;

  // ---- armour: one entry per hit, in layout order ----
  const armor = [];
  for (const e of lay) {
    const n = Math.max(0, Math.round(Number(e.def.flags?.armorHits) || 0));
    const a = data.armor.parts?.[e.def.id] ?? data.armor.default;
    for (let i = 0; i < n; i++) armor.push({ partId: e.id, type: e.def.id, kind: a.kind, bumperMm: a.bumperMm, bumperDensity: a.bumperDensity, standoffCm: a.standoffCm });
  }

  // ---- walls per section ----
  const covered = new Set(hull?.coveredIds ?? []);
  const axial = lay.filter((e) => e.attach === 'axial');
  const top = axial.reduce((t, e) => Math.max(t, (e.y ?? 0) + (e.height ?? e.def.height ?? 0)), 0);
  const walls = { nose: [], body: [], tail: [] };
  const T = data.tanks, C = data.cabin;
  for (const e of axial) {
    const sec = HULL_SECTIONS.includes(e.def.section) ? e.def.section : 'body';
    if (covered.has(e.id) || e.def.engine) continue; // the skin is the wall there; engines sit behind their own skirt
    const f = e.def.flags ?? {};
    if (f.heatShield && !f.capsule) continue; // a separate heat shield sits between the cabin and the stack
    const R = e.radius ?? 1.25, h = e.height ?? e.def.height ?? 1;
    const area = 2 * R * h; // projected side area
    const mat = partMaterial(e, materials);
    const m = materialProps(data, mat.id) ?? AL(data);
    if (f.capsule) {
      const tCm = scaledThicknessCm(data, { material: T.refMaterial, tMm: C.tMmRef }, mat);
      const sigma = ((C.pressureKPa / 1000) * C.radiusM) / (tCm / 100); // hoop stress of the pressure vessel, MPa
      walls[sec].push({ id: e.id, kind: 'cabin', partId: e.id, material: mat.id, m, tCm, area, sigmaMPa: sigma, bumper: { tCm: C.bumperMm / 10, rho: AL(data).density, standoffCm: C.standoffCm } });
    } else if (e.def.fuel) {
      const fixed = T.parts?.[e.def.id];
      const tm = fixed ? { id: fixed.material, mass: 1 } : mat;
      const tCm = fixed ? fixed.tMm / 10 : scaledThicknessCm(data, { material: T.refMaterial, tMm: T.tMmRef }, mat);
      const mm = materialProps(data, tm.id) ?? m;
      walls[sec].push({ id: e.id, kind: 'tank', partId: e.id, material: tm.id, m: mm, tCm, area, sigmaMPa: T.hoopShare * mm.yieldMPa });
    } else {
      walls[sec].push({ id: e.id, kind: 'dry', partId: e.id, material: mat.id, m, tCm: (data.skins.sheetFor?.tMm ?? 2.5) / 10, area });
    }
  }
  const segs = hull?.segments ?? [];
  for (const sec of HULL_SECTIONS) {
    const mine = segs.filter((s) => s.section === sec);
    if (!mine.length) continue;
    const matId = by[sec]?.material ?? 'al2219';
    const sk = skinBuild(data, matId);
    const area = mine.reduce((t, s) => t + (s.r0 + s.r1) * (s.y1 - s.y0), 0);
    walls[sec].push({ id: `skin:${sec}`, kind: 'skin', partId: null, material: matId, m: sk.m, tCm: sk.tCm, sandwich: sk.sandwich, area });
  }

  // ---- the reference: an aluminium 2219 skin, for toughness ----
  const refWall = wallLimits(data, { id: 'ref', kind: 'skin', ...skinBuild(data, 'al2219'), area: 1 }, []);

  const skin = {};
  let limitPa = null, weakest = null;
  for (const sec of HULL_SECTIONS) {
    const list = walls[sec].filter((w) => w.area > 0).map((w) => wallLimits(data, w, armor));
    const hasSkin = segs.some((s) => s.section === sec);
    if (!list.length && !hasSkin) continue;
    const b = by[sec] ?? {};
    const matId = hasSkin ? (b.material ?? 'al2219') : (list.slice().sort((x, y) => y.area - x.area)[0]?.material ?? 'al2219');
    const skinRow = data.skins?.[matId];
    const hm0 = hasSkin ? hullMaterial(hullChoice, sec) : null;
    const hm = hm0?.id === matId ? hm0 : {}; // a material hull.js does not know falls back to its structure.json skins row
    const strengthKPa = hasSkin ? (fin(b.strengthKPa) ? b.strengthKPa : skinRow?.strengthKPa ?? hm.strengthKPa ?? null) : null;
    const maxTempC = hasSkin ? (fin(b.maxTempC) ? b.maxTempC : skinRow?.maxTempC ?? hm.maxTempC ?? null) : null;
    const qLimitPa = fin(strengthKPa) ? Math.round((strengthKPa * 1000) / data.maxQ.safeFactor) : null;
    if (fin(qLimitPa) && (limitPa === null || qLimitPa < limitPa)) { limitPa = qLimitPa; weakest = sec; }
    const tArea = list.reduce((t, w) => t + w.area, 0);
    const main = list.slice().sort((x, y) => y.area - x.area)[0] ?? null;
    // toughness (notes-contract §4): a pure material factor, 1 = an aluminium 2219 skin. The energy that holes this
    // section's skin material built as a standard skin (hull.json construction), over the same for 2219. Without a skin,
    // the material of its main wall built as that skin (al_li as 2195, stainless as steel).
    const tMat = hasSkin ? matId : SKIN_OF[main?.material] ?? main?.material ?? 'al2219';
    const toughness = materialToughness(data, tMat, refWall.perforateJ);
    // the segments the climb heats, hottest (by hull.js's reference climb) first
    const mine = segs.filter((s) => s.section === sec).sort((x, y) => (y.peakTempC ?? 0) - (x.peakTempC ?? 0)).slice(0, 8);
    const massPerM2 = fin(hm.massPerM2) ? hm.massPerM2 : skinRow?.massPerM2 ?? 9;
    const specificHeat = fin(hm.specificHeat) ? hm.specificHeat : skinRow?.specificHeat ?? 864;
    const heat = mine.map((s) => ({ x: r3(Math.max(0.5, top - s.y1)), factor: r3(s.heatFactor ?? 1), corkR: s.cork ? phys.cork.resistance : 0, heatCap: Math.round(massPerM2 * specificHeat), refPeakC: r1(s.peakTempC) }));
    const props = materialProps(data, matId);
    skin[sec] = {
      material: matId, hasSkin, strengthKPa, qLimitPa, maxTempC: fin(maxTempC) ? maxTempC : null,
      fatiguePerFlight: hasSkin ? (fin(b.fatiguePerFlight) ? b.fatiguePerFlight : skinRow?.fatiguePerFlight ?? null) : null,
      refPeakC: hasSkin && fin(b.peakTempC) ? r1(b.peakTempC) : null,
      // toughness: material factor (2219 skin = 1); punctureJ: the energy (J) that holes this section's main wall as built;
      // wallToughness: that wall against a 2219 skin (it counts thickness and construction: a cabin is a double wall)
      toughness: r3(toughness), toughnessOf: tMat, punctureJ: main?.perforateJ ?? null, mainWall: main?.id ?? null,
      wallToughness: main ? r3(main.perforateJ / refWall.perforateJ) : null,
      heatStiffness: props?.heatStiffness ?? [[20, 1]], heat,
      sideArea: r3(tArea), frontArea: 0,
      walls: list,
      byPart: Object.fromEntries(list.map((w) => [w.id, w.perforateJ])),
    };
  }
  // the faces a head-on or tail-on piece meets: the widest part of the nose and of the tail
  const widest = (sec) => axial.filter((e) => e.def.section === sec).reduce((t, e) => Math.max(t, e.radius ?? 0), 0);
  if (skin.nose) skin.nose.frontArea = r3(PI * widest('nose') ** 2);
  if (skin.tail) skin.tail.frontArea = r3(PI * widest('tail') ** 2);
  else if (skin.body) skin.body.backArea = r3(PI * widest('body') ** 2);

  return {
    version: 1,
    maxQ: { limitPa, section: weakest, safeFactor: data.maxQ.safeFactor, neutralPa: data.maxQ.neutralPa, wrinkledShare: data.maxQ.wrinkledShare, wrinkleDetect: data.maxQ.wrinkleDetect },
    designAscentCdA: fin(stats.ascentCdA) ? r3(stats.ascentCdA) : null,
    skin,
    armor,
    shield: shieldOf(lay, ctx, data),
    debris: { ...pick(data.debris, ['cmPerGameM', 'speedKmS', 'refRelSpeed', 'density', 'holeK', 'cloudHoleK']) },
    leak: { tank: pick(data.tanks, ['pressureKPa', 'liquidDensity', 'leakCd', 'blowdownS', 'refHoleCm2']), cabin: pick(data.cabin, ['pressureKPa', 'airTempK']) },
    climb: {
      atmosphere: phys.atmosphere.map(([h, rho, t]) => [h, rho, t]),
      topScaleM: 6000, recovery: phys.recovery, emissivity: phys.emissivity, launchTempC: phys.launchTempC, transitionRe: phys.transitionRe ?? null,
      aboveTopKm: data.climb.aboveTopKm, overheatC: data.climb.overheatC, overheatS: data.climb.overheatS,
    },
    refPunctureJ: refWall.perforateJ,
  };
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));

/** The heat shield: the first heat-shield part (or a capsule with its own), its material, peak flux and heat load. */
function shieldOf(lay, ctx, data) {
  const S = data.shields;
  if (!S) return null;
  const e = lay.find((x) => x.def.flags?.heatShield && !x.def.flags?.capsule) ?? lay.find((x) => x.def.flags?.heatShield);
  if (!e) return null;
  const opts = (() => { try { return ctx?.optionsOf?.(e) ?? {}; } catch { return {}; } })();
  const own = S.parts?.[e.def.id];
  const ablatorId = opts.ablator?.id ?? (own ? null : S.defaultAblator);
  const base = own ?? S.ablators?.[ablatorId] ?? S.ablators?.[S.defaultAblator];
  if (!base) return null;
  const thick = S.thickness?.[opts.thickness?.id] ?? 1;
  const gaps = S.gaps?.[opts.gaps?.id] ?? 1;
  return {
    partId: e.id, part: e.def.id, type: base.type, ablator: own ? null : ablatorId, name: own?.name ?? opts.ablator?.name ?? ablatorId,
    peakWcm2: Math.round(base.peakWcm2 * gaps), loadJcm2: Math.round(base.loadJcm2 * thick), fragile: !!(own?.fragile || e.def.flags?.fragileShield),
  };
}
