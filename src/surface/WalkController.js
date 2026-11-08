// First-person walking (Role 2) for the ship interior AND the Mars EVA. TEAM_PROMPT §4, §7.
// Pure JS (no three.js). y is up. Units: m, s.
//
// Real physics that the player should FEEL on Mars:
//  - Same legs, weaker gravity: the same jump speed goes h = v²/2g → ~2.6× higher, ~2.6× longer airtime.
//  - Same MASS, smaller WEIGHT: grip is friction μ·m·g, so the max ground acceleration is μ·g.
//    On Mars (g = 3.71) you can't start/stop/turn as fast → slightly "slidey" movement.
//  - Fall damage depends on impact speed (v = √(2gh)), so you can drop ~2.6× higher on Mars.
//
// const walker = new WalkController({ gravity: PLANETS.mars.g, getGroundHeight: (x, z) => h, bounds, onNotice });
// onNotice(type, data): 'landed' { impactSpeed, airTime, height }, 'fall' { impactSpeed, severity } (local, not on the bus).
// each frame: walker.update(dt, { forward, right, run, jump }); walker.look(dx, dy) from mouse movement.

export const WALK_TUNING = {
  eyeHeight: 1.65,
  radius: 0.3,
  walkSpeed: { suit: 1.5, cabin: 1.4 }, // m/s (spacesuits are slow, ~1–1.5 m/s on Apollo EVAs)
  runSpeed: { suit: 2.8, cabin: 2.6 },
  legAccel: 8, // m/s² the legs can deliver with perfect grip
  friction: 0.6, // μ boot ↔ ground
  jumpSpeed: 2.97, // m/s, the same legs everywhere: a 45 cm jump on Earth (v = √(2·g·h))
  cabinJumpSpeed: 1.72, // m/s, small hop indoors (15 cm on Earth; low ceiling)
  airControl: 0.4, // m/s² while airborne
  hurtImpact: 6, // m/s ≈ falling 1.8 m on Earth, 4.9 m on Mars
  severeImpact: 10, // m/s ≈ 5.1 m on Earth, 13.5 m on Mars
  lookSensitivity: 0.0022,
};

export class WalkController {
  constructor({ onNotice, gravity, getGroundHeight = () => 0, bounds = null, colliders = [], boxes = [], mode = 'suit', start = { x: 0, z: 0 }, yaw = 0 } = {}) {
    if (!(gravity > 0)) throw new Error('WalkController: pass gravity (PLANETS.<planet>.g from core)');
    this.onNotice = onNotice ?? (() => {});
    this.gravity = gravity;
    this.getGroundHeight = getGroundHeight;
    this.bounds = bounds; // { minX, maxX, minZ, maxZ, ceiling? } for the cabin
    this.colliders = colliders; // [{ x, z, r }] vertical cylinders you can't walk through (lander legs, big rocks)
    this.boxes = boxes; // [{ x, z, hx, hz }] upright boxes (half sizes) you can't walk through
    this.mode = mode; // 'suit' | 'cabin'
    const g = getGroundHeight(start.x, start.z);
    this.pos = { x: start.x, y: g, z: start.z }; // feet position
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = yaw; // radians, 0 = looking toward -z
    this.pitch = 0;
    this.onGround = true;
    this.airTime = 0;
    this.lastJumpApex = 0;
    this._jumpStartY = g;
    this.heartRate = 72;
    this.running = false;
    this.invertY = false;
  }

  look(dx, dy) {
    const s = WALK_TUNING.lookSensitivity;
    this.yaw -= dx * s;
    this.pitch -= (this.invertY ? -dy : dy) * s;
    const lim = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  get eye() { return { x: this.pos.x, y: this.pos.y + WALK_TUNING.eyeHeight, z: this.pos.z }; }

  get lookDir() {
    const cp = Math.cos(this.pitch);
    return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
  }

  // Max horizontal acceleration on the ground: min(leg power, friction μ·g).
  get groundAccel() { return Math.min(WALK_TUNING.legAccel, WALK_TUNING.friction * this.gravity); }

  update(dt, input = {}) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    const T = WALK_TUNING;
    const mode = this.mode;

    // desired horizontal velocity from input (camera-relative)
    const f = (input.forward ?? 0), r = (input.right ?? 0);
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    let dx = -sinY * f + cosY * r;
    let dz = -cosY * f - sinY * r;
    const dl = Math.hypot(dx, dz);
    if (dl > 1) { dx /= dl; dz /= dl; }
    this.running = !!input.run && dl > 0.1;
    const speed = this.running ? T.runSpeed[mode] : T.walkSpeed[mode];
    const tx = dx * speed, tz = dz * speed;

    // accelerate toward the desired velocity, limited by grip (ground) or air control
    const maxA = (this.onGround ? this.groundAccel : T.airControl) * dt;
    const ex = tx - this.vel.x, ez = tz - this.vel.z;
    const el = Math.hypot(ex, ez);
    if (this.onGround || dl > 0.1) {
      const k = el > maxA ? maxA / el : 1;
      this.vel.x += ex * k;
      this.vel.z += ez * k;
    }

    // jump
    if (input.jump && this.onGround) {
      this.vel.y = mode === 'cabin' ? T.cabinJumpSpeed : T.jumpSpeed;
      this.onGround = false;
      this.airTime = 0;
      this._jumpStartY = this.pos.y;
      this.lastJumpApex = this.pos.y;
    }

    // gravity + integrate
    if (!this.onGround) {
      this.vel.y -= this.gravity * dt;
      this.airTime += dt;
    }
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;
    if (!this.onGround) this.lastJumpApex = Math.max(this.lastJumpApex, this.pos.y);

    // walls (cabin)
    if (this.bounds) {
      const b = this.bounds, rr = T.radius;
      if (this.pos.x < b.minX + rr) { this.pos.x = b.minX + rr; this.vel.x = 0; }
      if (this.pos.x > b.maxX - rr) { this.pos.x = b.maxX - rr; this.vel.x = 0; }
      if (this.pos.z < b.minZ + rr) { this.pos.z = b.minZ + rr; this.vel.z = 0; }
      if (this.pos.z > b.maxZ - rr) { this.pos.z = b.maxZ - rr; this.vel.z = 0; }
      if (b.ceiling && this.pos.y + T.eyeHeight + 0.15 > b.ceiling) {
        this.pos.y = b.ceiling - T.eyeHeight - 0.15;
        if (this.vel.y > 0) this.vel.y = 0;
      }
    }

    // round obstacles: push out to the surface and drop the velocity going into them
    for (const c of this.colliders) {
      const ox = this.pos.x - c.x, oz = this.pos.z - c.z;
      const d = Math.hypot(ox, oz), min = c.r + T.radius;
      if (d < min && d > 1e-6) {
        const nx = ox / d, nz = oz / d;
        this.pos.x = c.x + nx * min;
        this.pos.z = c.z + nz * min;
        const into = this.vel.x * nx + this.vel.z * nz;
        if (into < 0) { this.vel.x -= into * nx; this.vel.z -= into * nz; }
      }
    }

    // boxes (cabin ladder etc.): { x, z, hx, hz } half sizes, floor to ceiling; push out along the shallowest axis
    for (const c of this.boxes) {
      const px = c.hx + T.radius - Math.abs(this.pos.x - c.x), pz = c.hz + T.radius - Math.abs(this.pos.z - c.z);
      if (px <= 0 || pz <= 0) continue;
      if (px < pz) { const sx = this.pos.x >= c.x ? 1 : -1; this.pos.x += sx * px; if (this.vel.x * sx < 0) this.vel.x = 0; }
      else { const sz = this.pos.z >= c.z ? 1 : -1; this.pos.z += sz * pz; if (this.vel.z * sz < 0) this.vel.z = 0; }
    }

    // ground
    const ground = this.getGroundHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= ground) {
      if (!this.onGround) this._land(-this.vel.y);
      this.pos.y = ground;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.onGround && this.pos.y - ground > 0.3) {
      this.onGround = false; // walked off a ledge
      this.airTime = 0;
      this.lastJumpApex = this.pos.y;
    } else if (this.onGround) {
      this.pos.y = ground; // follow gentle slopes
    }

    this._updateHeartRate(dt, dl);
  }

  _land(impactSpeed) {
    const T = WALK_TUNING;
    this.onNotice('landed', { impactSpeed, airTime: this.airTime, height: this.lastJumpApex - this.pos.y });
    if (impactSpeed > T.hurtImpact) {
      this.onNotice('fall', { impactSpeed, severity: impactSpeed > T.severeImpact ? 'severe' : 'hurt' });
      this.heartRate = Math.min(170, this.heartRate + 25);
    }
  }

  _updateHeartRate(dt, moving) {
    const target = this.running ? 135 : moving > 0.1 ? 92 : 72;
    this.heartRate += (target - this.heartRate) * Math.min(1, dt * 0.25);
  }

  get telemetry() {
    return {
      pos: { ...this.pos },
      speed: Math.hypot(this.vel.x, this.vel.z),
      onGround: this.onGround,
      running: this.running,
      heartRate: Math.round(this.heartRate),
      gravity: this.gravity,
    };
  }
}
