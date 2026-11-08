// The crew access arm and white room (port of the pure helpers of sandbox/role1.hangar.access-v5.js): it hangs on the
// fixed stair tower with its floor ~1.1 m below the capsule hatch, a caged ladder joins it to the tower landings, and
// its tip telescopes out until the white room touches the real hull (axial outline and radial boosters).
const ML_TOP = 7;
const DEFAULT_ARM = { root: [-9.2, -1.1], direction: [1, 0, 0], tipLocal: 2.5, extensionRange: [2.4, 6.6], halfWidth: 0.9, cabinHeight: 2.5 };
const LANDINGS = [0, 5.5, 11, 17, 23, 29, 35, 41, 47, 53, 59, 65, 71];

/** Largest hull radius (axial stack) between ship-local heights h0..h1. */
export function hullRadius(ship, h0, h1) {
  let r = 0;
  for (const s of ship?.hull ?? []) {
    if (s.y1 < h0 || s.y0 > h1) continue;
    for (const h of [Math.max(h0, s.y0), Math.min(h1, s.y1)]) { const t = s.y1 > s.y0 ? (h - s.y0) / (s.y1 - s.y0) : 0; r = Math.max(r, s.r0 + (s.r1 - s.r0) * t); }
  }
  for (const e of ship?.entries ?? []) {
    if (e.attach !== 'axial') continue;
    const profile = e.outline?.profile;
    if (profile) { for (const p of profile) if (p.y >= h0 - 0.05 && p.y <= h1 + 0.05) r = Math.max(r, p.r); }
    else if (e.y <= h1 && e.y + e.height >= h0) r = Math.max(r, e.radius ?? 0);
  }
  return r;
}
function radialBoxes(ship, h0, h1) {
  const out = [];
  for (const e of ship?.entries ?? []) {
    const o = e.outline;
    if (e.attach !== 'radial' || !o || o.y1 < h0 || o.y0 > h1) continue;
    const a = ((e.angle ?? 0) * Math.PI) / 180;
    out.push({ c: Math.cos(a), s: Math.sin(a), x0: o.centerRadius - o.radialHalf, x1: o.centerRadius + o.radialHalf, t: o.tangentHalf });
  }
  return out;
}
/** World x of the white-room seal for an arm floor at world Y. */
export function armTipX(ship, floorY, arm = DEFAULT_ARM, fallbackRadius = 1.25) {
  const h0 = floorY - ML_TOP, h1 = h0 + arm.cabinHeight;
  const R = (ship ? hullRadius(ship, h0, h1) : fallbackRadius) + 0.06, boxes = ship ? radialBoxes(ship, h0, h1) : [];
  const [rootX, zc] = arm.root, hw = arm.halfWidth;
  const blocked = (x, z) => {
    if (x * x + z * z < R * R) return true;
    for (const b of boxes) { const lx = x * b.c - z * b.s, lz = x * b.s + z * b.c; if (lx > b.x0 - 0.06 && lx < b.x1 + 0.06 && Math.abs(lz) < b.t + 0.06) return true; }
    return false;
  };
  const clear = (x) => { for (let dx = 0; dx <= arm.tipLocal; dx += 0.25) for (let z = zc - hw; z <= zc + hw + 1e-6; z += 0.15) if (blocked(x - dx, z)) return false; return true; };
  for (let x = -0.05; x > rootX + arm.extensionRange[0] + arm.tipLocal; x -= 0.04) if (clear(x)) return x;
  return rootX + arm.extensionRange[0] + arm.tipLocal;
}
export function armExtension(tipX, arm = DEFAULT_ARM) {
  const [lo, hi] = arm.extensionRange;
  return Math.min(hi, Math.max(lo, tipX - arm.root[0] - arm.tipLocal));
}
const capsuleOf = (ship) => ship?.entries?.find((e) => e.def?.flags?.capsule);
/** Capsule hatch height (world Y) of the ship, or null. */
export const hatchHeight = (ship) => { const cap = capsuleOf(ship); return cap ? ML_TOP + cap.y + cap.height * 0.45 : null; };
export const capsuleTop = (ship) => { const cap = capsuleOf(ship); return cap ? ML_TOP + cap.y + cap.height : null; };
/** White-room floor for a hatch at world Y (snapped onto a tower landing when that keeps the hatch 0.95..1.25 m above it). */
export function armFloor(hatch, capTop = null, arm = DEFAULT_ARM) {
  const landings = arm.landings ?? LANDINGS;
  let f = hatch - (arm.hatchOffset ?? 1.1);
  const near = landings.reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a));
  if (hatch - near >= 0.95 && hatch - near <= 1.25) f = near;
  if (capTop != null) f = Math.min(f, capTop - 1.5);
  return Math.round(Math.min(68, Math.max(7.6, f)) * 100) / 100;
}
export function ladderSpan(floor, arm = DEFAULT_ARM) {
  const landings = arm.landings ?? LANDINGS;
  const below = [...landings].reverse().find((l) => l <= floor + 1e-6) ?? 0, above = landings.find((l) => l > below + 1e-6) ?? below + 6;
  return { below, above };
}

/** The crew arm pose for a ship: fit(ship) on a ship change, pose(holder, dt) every frame until it settles. */
export function createCrewArm(fragment = {}) {
  const arm = { ...DEFAULT_ARM, ...(fragment.crewArm ?? {}) };
  const state = { floor: 35, extension: arm.extensionRange[0], target: arm.extensionRange[0], fitted: arm.extensionRange[0], retracted: false, settled: false, ladder: null };
  const aim = () => { state.target = state.retracted ? arm.extensionRange[0] : state.fitted; state.settled = false; };
  return {
    state,
    /** Swung back (static fire, launch): the white room pulls away from the hull. */
    get retracted() { return state.retracted; },
    set retracted(on) { if (state.retracted !== Boolean(on)) { state.retracted = Boolean(on); aim(); } },
    fit(ship) {
      const hatch = hatchHeight(ship) ?? 38;
      const floor = armFloor(hatch, capsuleTop(ship), arm);
      if (floor !== state.floor) { state.floor = floor; state.extension = arm.extensionRange[0]; } // a new height: arrives retracted, then telescopes out
      state.fitted = armExtension(armTipX(ship, floor, arm), arm);
      state.ladder = ladderSpan(floor, arm);
      aim();
    },
    /** Poses the holder (root group of the crew-arm module). Returns false once it no longer moves. */
    pose(holder, dt) {
      if (state.settled) return false;
      state.extension += (state.target - state.extension) * (1 - Math.exp(-3 * dt));
      if (Math.abs(state.target - state.extension) < 5e-3) { state.extension = state.target; state.settled = true; }
      holder.position.set(arm.root[0], state.floor, arm.root[1]);
      const ladder = holder.getObjectByName(arm.ladderNode ?? 'ladder');
      if (ladder && state.ladder) { ladder.position.y = state.ladder.below - state.floor; ladder.scale.y = (state.ladder.above - state.ladder.below) / (arm.ladderLength ?? 6); }
      const extend = holder.getObjectByName(arm.extendNode ?? 'extend');
      if (extend) extend.position.x = state.extension;
      return true;
    },
  };
}
