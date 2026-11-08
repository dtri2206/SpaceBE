// Mars surface height in metres. Pure JS with no Three.js, so gameplay can call it every frame.
// The origin is the landing site on the Jezero crater floor. +Y is up, and the ground mesh is built from this function.
// Craters, a river channel, buttes and dunes are built into this function, and the meshes sample it, so the ground you
// see is the ground you stand on. Features are analytic and binned in 64 m cells, so a call stays a few microseconds.

const PERM = new Uint8Array(512);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  let seed = 1977;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

function perlin(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const X = xi & 255, Y = yi & 255;
  const dot = (ix, iy, dx, dy) => {
    const g = GRAD[PERM[PERM[X + ix] + ((Y + iy) & 255)] & 7];
    return g[0] * dx + g[1] * dy;
  };
  const a = dot(0, 0, fx, fy) + u * (dot(1, 0, fx - 1, fy) - dot(0, 0, fx, fy));
  const b = dot(0, 1, fx, fy - 1) + u * (dot(1, 1, fx - 1, fy - 1) - dot(0, 1, fx, fy - 1));
  return a + v * (b - a); // about -1..1
}

function fbm(x, y, octaves) {
  let a = 1, s = 0, n = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * perlin(x, y);
    n += a;
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.3;
    a *= 0.5;
  }
  return s / n;
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const lcg = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

// The river delta: a raised plateau with layered scarps, north-east of the landing site.
export const DELTA = { x: 1100, z: -900, radius: 800, height: 46 };
const LANDING_FLAT_RADIUS = 60;
// Places the game uses on Mars. Features keep clear of them so each stays flat and walkable.
const KEEP_CLEAR = [[0, 0, 150], [430, -320, 80]];

/* ------------------------------------------------------------------ the dry river channel */

// Control points of the channel centre line, from the south-west highlands down to the delta front.
const CHANNEL_CONTROL = [[-2300, 1250], [-1650, 880], [-1100, 640], [-650, 470], [-230, 400], [180, 330], [460, 150], [650, -80], [760, -330], [820, -560], [930, -760], [1060, -860]];
const SEG_STEP = 20;
const CHANNEL = (() => {
  // Catmull-Rom through the control points, then a gentle meander across the direction of travel.
  const pts = [];
  const C = CHANNEL_CONTROL;
  for (let i = 0; i < C.length - 1; i++) {
    const p0 = C[Math.max(0, i - 1)], p1 = C[i], p2 = C[i + 1], p3 = C[Math.min(C.length - 1, i + 2)];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.ceil(len / SEG_STEP);
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  pts.push(C[C.length - 1].slice());
  let along = 0;
  const out = pts.map((p, i) => {
    if (i) along += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    const m = Math.sin(along / 260 + 0.8) * 70 + Math.sin(along / 95 + 2.1) * 18; // meander
    return { x: p[0] - dz / l * m, z: p[1] + dx / l * m, s: along };
  });
  return { pts: out, length: along };
})();
const CELL = 64;
const GRID_N = 96, GRID_OFF = 48; // cells cover about +-3000 m
const cellIndex = (ix, iz) => (ix >= -GRID_OFF && ix < GRID_N - GRID_OFF && iz >= -GRID_OFF && iz < GRID_N - GRID_OFF) ? (ix + GRID_OFF) * GRID_N + iz + GRID_OFF : -1;
const channelGrid = new Array(GRID_N * GRID_N);
const CHANNEL_REACH = 400;
for (let i = 0; i < CHANNEL.pts.length - 1; i++) {
  const a = CHANNEL.pts[i], b = CHANNEL.pts[i + 1];
  const x0 = Math.min(a.x, b.x) - CHANNEL_REACH, x1 = Math.max(a.x, b.x) + CHANNEL_REACH;
  const z0 = Math.min(a.z, b.z) - CHANNEL_REACH, z1 = Math.max(a.z, b.z) + CHANNEL_REACH;
  for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
    const c = cellIndex(ix, iz);
    if (c >= 0) (channelGrid[c] ??= []).push(i);
  }
}

// Nearest point on the channel centre line: { q: distance, s: distance along it }. q is Infinity when far away.
const near = { q: Infinity, s: 0 };
function channelNear(x, z) {
  near.q = Infinity;
  const list = channelGrid[cellIndex(Math.floor(x / CELL), Math.floor(z / CELL))];
  if (!list) return near;
  const pts = CHANNEL.pts;
  let best = Infinity;
  for (let k = 0; k < list.length; k++) {
    const a = pts[list[k]], b = pts[list[k] + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const ex = x - (a.x + dx * t), ez = z - (a.z + dz * t);
    const d2 = ex * ex + ez * ez;
    if (d2 < best) { best = d2; near.s = a.s + (b.s - a.s) * t; }
  }
  near.q = Math.sqrt(best);
  return near;
}
/** A point on the channel centre line at fraction f (0 to 1) of its length, with the heading: { x, z, dx, dz }. */
export function channelAt(f) {
  const pts = CHANNEL.pts;
  const i = Math.max(0, Math.min(pts.length - 2, Math.floor(f * (pts.length - 1))));
  const a = pts[i], b = pts[i + 1], l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: a.x, z: a.z, dx: (b.x - a.x) / l, dz: (b.z - a.z) / l };
}
/** Distance in metres from (x, z) to the channel centre line (Infinity beyond ~250 m). */
export function channelDistance(x, z) { return channelNear(x, z).q; }

const channelWidth = (s) => 52 + 40 * smoothstep(0.35, 1, s / CHANNEL.length); // half width of the banks
const channelDepth = (s) => 15 + 11 * smoothstep(0.1, 0.9, s / CHANNEL.length);
// Fords: places where the banks ease down, so a rover can cross.
const FORDS = [CHANNEL.length * 0.22, CHANNEL.length * 0.5, CHANNEL.length * 0.7];
const fordFactor = (s) => {
  let f = 0;
  for (const c of FORDS) f = Math.max(f, 1 - smoothstep(30, 120, Math.abs(s - c)));
  return f;
};
const fadeEnd = (s) => 1 - smoothstep(CHANNEL.length - 140, CHANNEL.length - 10, s);
const fadeStart = (s) => smoothstep(0, 220, s);

/* ------------------------------------------------------------------ impact craters */

function generateCraters() {
  const rnd = lcg(90210);
  const list = [];
  const clear = (x, z, reach) => KEEP_CLEAR.every(([cx, cz, r]) => Math.hypot(x - cx, z - cz) > reach + r);
  const add = (x, z, R, fresh, k) => {
    const age = fresh ? rnd() * 0.18 : 0.35 + rnd() * 0.65;
    const depth = R * k * (1 - age * 0.62);
    list.push({ x, z, R, fresh, age, depth, rim: depth * (fresh ? 0.32 : 0.32 * (1 - age) * 0.7), phase: rnd() * 6.28, lobes: 2 + Math.floor(rnd() * 3), reach: 3.2 });
  };
  // A few big craters, 100 to 300 m across, none overlapping another big one.
  const big = [];
  for (let n = 0, guard = 0; n < 6 && guard++ < 400;) {
    const R = 50 + rnd() * 100, a = rnd() * 6.283, r = 420 + rnd() * 1500;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!clear(x, z, R * 2.6)) continue;
    if (big.some((b) => Math.hypot(b.x - x, b.z - z) < (b.R + R) * 2.2)) continue;
    if (channelDistance(x, z) < R * 1.6 + 40) continue;
    add(x, z, R, n % 3 === 1, 0.12 + rnd() * 0.03);
    big.push(list[list.length - 1]);
    n++;
  }
  // Mid-size craters, 40 to 90 m across.
  for (let n = 0, guard = 0; n < 34 && guard++ < 800;) {
    const R = 20 + rnd() * 25, a = rnd() * 6.283, r = 230 + 1400 * Math.pow(rnd(), 1.2);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!clear(x, z, R * 1.8) || channelDistance(x, z) < R + 30) continue;
    if (list.some((c) => c.R > 18 && Math.hypot(c.x - x, c.z - z) < (c.R + R) * 1.3)) continue;
    add(x, z, R, rnd() < 0.4, 0.11 + rnd() * 0.035);
    n++;
  }
  // Small craters: 5 to 40 m across near the lander, none under 18 m across further out (the mesh is coarser there).
  for (let n = 0, guard = 0; n < 440 && guard++ < 9000;) {
    const a = rnd() * 6.283, r = 100 + 1050 * Math.pow(rnd(), 1.45);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const Rmin = 2.5 + 6.5 * smoothstep(190, 260, r);
    const R = Rmin * Math.pow(20 / Rmin, Math.pow(rnd(), 1.5));
    if (!clear(x, z, R * 1.8) || channelDistance(x, z) < R + 8) continue;
    add(x, z, R, rnd() < 0.38, 0.12 + rnd() * 0.04);
    n++;
  }
  return list;
}
export const CRATERS = generateCraters();

const craterGrid = new Array(GRID_N * GRID_N);
for (const c of CRATERS) {
  const reach = c.R * c.reach;
  for (let ix = Math.floor((c.x - reach) / CELL); ix <= Math.floor((c.x + reach) / CELL); ix++) for (let iz = Math.floor((c.z - reach) / CELL); iz <= Math.floor((c.z + reach) / CELL); iz++) {
    const i = cellIndex(ix, iz);
    if (i >= 0) (craterGrid[i] ??= []).push(c);
  }
}

// Bowl, raised rim and an ejecta apron that thins out with distance. Old craters are shallower with low rims.
function craters(x, z) {
  const list = craterGrid[cellIndex(Math.floor(x / CELL), Math.floor(z / CELL))];
  if (!list) return 0;
  let h = 0;
  for (let k = 0; k < list.length; k++) {
    const c = list[k];
    const dx = x - c.x, dz = z - c.z;
    const reach = c.R * c.reach;
    const d2 = dx * dx + dz * dz;
    if (d2 > reach * reach) continue;
    // A slightly lopsided outline, so no crater is a perfect circle.
    let t = Math.sqrt(d2) / c.R;
    t *= 1 + 0.07 * perlin(x / c.R * 0.9 + c.phase, z / c.R * 0.9 - c.phase);
    if (t < 1) {
      const w = 1 - t * t;
      h -= c.depth * w * w;
      if (c.R > 70) h += c.depth * 0.16 * Math.exp(-(t * t) / 0.03); // central peak of the biggest ones
    }
    if (t > 0.7) {
      const lobe = 1 + (c.fresh ? 0.22 : 0.12) * Math.sin(Math.atan2(dz, dx) * c.lobes + c.phase);
      const sigma = c.fresh ? 0.21 : 0.3;
      const u = (t - 1.02) / sigma;
      h += c.rim * lobe * Math.exp(-u * u);
      const tt = Math.max(t, 1);
      h += c.rim * 0.55 * lobe * smoothstep(0.85, 1.1, t) / (tt * tt * tt) * (1 - smoothstep(1.6, 3.2, t));
    }
  }
  return h;
}

/** 0..1: how close (x, z) is to the raised rim of a crater. Fresh rims count fully, old ones less. */
export function craterRimAmount(x, z) {
  const list = craterGrid[cellIndex(Math.floor(x / CELL), Math.floor(z / CELL))];
  if (!list) return 0;
  let best = 0;
  for (let k = 0; k < list.length; k++) {
    const c = list[k];
    const t = Math.hypot(x - c.x, z - c.z) / c.R;
    if (t > 1.7) continue;
    const u = (t - 1.0) / 0.3;
    best = Math.max(best, Math.exp(-u * u) * (c.fresh ? 1 : 0.35 * (1 - c.age * 0.6)));
  }
  return best;
}

/* ------------------------------------------------------------------ buttes, dunes */

// Flat-topped mesas and buttes of layered sediment, in front of the delta and scattered across the plain.
function generateButtes() {
  const rnd = lcg(5150);
  const list = [];
  for (let n = 0, guard = 0; n < 15 && guard++ < 1500;) {
    let x, z;
    if (n < 9) {
      const a = rnd() * 6.283, r = 250 + rnd() * 900;
      x = DELTA.x + Math.cos(a) * r; z = DELTA.z + Math.sin(a) * r;
    } else {
      const a = rnd() * 6.283, r = 600 + rnd() * 1300;
      x = Math.cos(a) * r; z = Math.sin(a) * r;
    }
    const R = 38 + rnd() * rnd() * 110;
    if (Math.hypot(x, z) < 520 + R || Math.hypot(x - 430, z + 320) < 260 + R) continue;
    if (channelDistance(x, z) < R + 90) continue;
    if (CRATERS.some((c) => c.R > 30 && Math.hypot(c.x - x, c.z - z) < (c.R * 2.4 + R))) continue;
    if (list.some((p) => Math.hypot(p.x - x, p.z - z) < (p.R + R) * 1.2)) continue;
    list.push({ x, z, R, height: 12 + rnd() * 26, steps: 2 + Math.floor(rnd() * 3), phase: rnd() * 100 });
    n++;
  }
  return list;
}
export const BUTTES = generateButtes();

function buttes(x, z) {
  let h = 0;
  for (let k = 0; k < BUTTES.length; k++) {
    const b = BUTTES[k];
    const dx = x - b.x, dz = z - b.z;
    if (Math.abs(dx) > b.R * 1.9 || Math.abs(dz) > b.R * 1.9) continue;
    const d = Math.hypot(dx, dz) * (1 + 0.16 * perlin(x / (b.R * 0.8) + b.phase, z / (b.R * 0.8))); // ragged outline
    const body = 1 - smoothstep(0.55, 1.0, d / b.R);
    if (body <= 0) continue;
    const steps = body * b.steps;
    const whole = Math.min(Math.floor(steps), b.steps - 1);
    h += b.height * (whole + smoothstep(0.4, 0.75, steps - whole)) / b.steps + b.height * 0.02 * perlin(x / 9, z / 9) * body;
  }
  return h;
}

const WIND = [Math.cos(0.45), Math.sin(0.45)];
/** 0..1: how much of a dune field covers this spot (low basins). */
export function duneAmount(x, z) {
  const r2 = x * x + z * z;
  if (r2 < 240 * 240) return 0;
  const basin = smoothstep(0.02, 0.26, -fbm(x / 640 + 3.1, z / 640 - 5.2, 2));
  return basin * smoothstep(240, 340, Math.sqrt(r2));
}
function dunes(x, z, amount) {
  const wob = perlin(x / 85 + 7, z / 85 - 2) * 0.55 + perlin(x / 31, z / 31 + 5) * 0.12;
  const f = ((x * WIND[0] + z * WIND[1]) / 36 + wob) % 1;
  const u = f < 0 ? f + 1 : f;
  const g = u < 0.7 ? u / 0.7 * 0.5 : 0.5 + (u - 0.7) / 0.3 * 0.5;
  return Math.sin(Math.PI * g) * 1.5 * amount * (0.65 + 0.35 * perlin(x / 120 - 9, z / 120));
}

/* ------------------------------------------------------------------ the height function */

// The Halcyon wreck sits at the foot of a delta scarp: level a bench under it, so it is walkable.
const WRECK = { x: 430, z: -320, flat: 30, blend: 95, y: 0 };

export function getTerrainHeight(x, z) {
  let h = terrainRaw(x, z);
  const dw = Math.hypot(x - WRECK.x, z - WRECK.z);
  if (dw < WRECK.blend) h += (WRECK.y - h) * (1 - smoothstep(WRECK.flat, WRECK.blend, dw));
  return h;
}

function terrainRaw(x, z) {
  const r = Math.hypot(x, z);

  // Keep the landing pad level, then let the ground roughen with distance.
  const rough = smoothstep(LANDING_FLAT_RADIUS, 175, r);
  let h = fbm(x / 640, z / 640, 3) * 16 * (0.3 + 0.7 * rough);
  h += fbm(x / 95 + 40, z / 95 - 11, 3) * 4.2 * rough;

  // Small hummocks, about 25 m across, and long low ridges like the wrinkle ridges of the Martian plains.
  h += Math.abs(perlin(x / 42 - 3, z / 42 + 8)) * 1.1 * rough;
  const wr = 1 - Math.abs(perlin(x / 300 + 21, z / 380 - 4));
  h += wr * wr * wr * 9 * rough * smoothstep(0.05, 0.5, fbm(x / 900 - 2, z / 900 + 12, 2) + 0.2);

  let delta = 0;
  const dRaw = Math.hypot(x - DELTA.x, z - DELTA.z);
  if (dRaw < 1300) {
    // Delta plateau, cut into terraces like the layered sediment at Jezero.
    const wobble = fbm(x / 210 + 5, z / 210 + 2, 3) * 120;
    const d = dRaw + wobble;
    const rise = smoothstep(DELTA.radius + 110, DELTA.radius - 90, d);
    const bench = fbm(x / 120 - 21, z / 120 + 14, 2) * 0.09; // uneven benches, so no contour looks drawn on
    const steps = Math.max(0, rise + bench * rise * (1 - rise) * 4) * 4;
    const whole = Math.floor(steps);
    const terraced = (whole + smoothstep(0.34, 0.66, steps - whole)) / 4;
    delta = (rise * 0.2 + terraced * 0.8) * DELTA.height;
  }

  // The river channel: ground levels out along it and the banks cut down in layers.
  let inChannel = 0, bank = 0;
  const cn = channelNear(x, z);
  if (cn.q < CHANNEL_REACH) {
    const s = cn.s;
    const ford = fordFactor(s);
    const hw = channelWidth(s) * (1 + ford * 0.8) * (1 + 0.16 * perlin(x / 55 + 2, z / 55 - 7));
    const fw = hw * 0.34;
    const q = cn.q;
    const lifeS = fadeStart(s) * fadeEnd(s);
    const depth = channelDepth(s) * (1 - ford * 0.72) * lifeS;
    inChannel = (1 - smoothstep(fw, hw, q)) * lifeS;
    // Banks fall in steps, a hard riser and a ledge, the way sediment layers erode.
    const g = 1 - Math.min(1, Math.max(0, (q - fw) / (hw - fw)));
    const n = 4;
    const sg = g * n, wg = Math.floor(sg);
    const terrace = (wg + smoothstep(0.5, 0.92, sg - wg)) / n;
    bank = -depth * (1 - (ford > 0.5 ? g : terrace)) * (q < hw ? 1 : 0);
    // A shallow valley around the banks, and ground that flattens towards the floor.
    bank -= 0.3 * channelDepth(s) * (1 - smoothstep(hw, hw * 2.0, q)) * lifeS;
    h *= 1 - 0.65 * inChannel;
    delta *= 1 - 0.9 * inChannel;
  }
  h += delta + bank;

  // Craters, mesas and dunes.
  h += craters(x, z);
  h += buttes(x, z);
  const dune = duneAmount(x, z);
  if (dune > 0) h += dunes(x, z, dune * (1 - inChannel * 0.5));

  if (r > 1700) {
    // Foothill ridges, then the Jezero crater rim closing the horizon, kilometres away, with notches where passes cross it.
    const rimNoise = fbm(x / 1800 + 80, z / 1800 - 30, 2);
    const rr = r + rimNoise * 750;
    const ridge = 1 - Math.abs(perlin(x / 760 + 11, z / 760 + 4));
    h += smoothstep(1800, 3300, rr) * ridge * ridge * 95;
    const ramp = smoothstep(3300, 7000, rr);
    if (ramp > 0) {
      const notch = smoothstep(-0.28, 0.3, fbm(x / 2600 + 7, z / 2600 - 19, 2));
      const jag = 1 - Math.abs(perlin(x / 520 - 5, z / 520 + 9));
      const jag2 = 1 - Math.abs(perlin(x / 190 + 3, z / 190 - 8));
      h += ramp * (150 + notch * 300 + (jag * jag * 330 + jag2 * jag2 * 70) * (0.35 + 0.65 * notch));
    }
  }
  return h;
}

WRECK.y = terrainRaw(WRECK.x, WRECK.z);

// Shared with the Earth launch-site terrain, so both planets use the same noise.
export { perlin, fbm, smoothstep };
