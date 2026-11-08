// Crewed Mars rover (Role 2), modelled on NASA's Apollo Lunar Roving Vehicle, the only crewed rover ever driven on
// another world (Apollo 15–17, 1971–72). Pure JS (no three.js), testable in node. y is up, metres and seconds.
//
// Real LRV numbers (NASA LRV Operations Handbook): 210 kg empty, 2.29 m wheelbase, 1.83 m track, 0.82 m wire-mesh
// wheels, four 0.25 hp (186 W) hub motors, four-wheel steering with a 3.1 m turning radius, two 36 V 121 Ah
// silver-zinc batteries (≈ 8.7 kWh), designed for about 13 km/h (Apollo 17's Gene Cernan clocked about 18 km/h).
// On Mars the same machine weighs 2.3× more than on the Moon: more grip, but more rolling resistance too.
//
// const rover = new RoverController({ gravity: PLANETS.mars.g, getGroundHeight, start: { x, z, heading }, spec? });
// `spec` defaults to ROVER (the Apollo LRV); pass ROVER_MR01 for the SPACEB&E MR-01.
// Power from the ship (Role 1 wave 5, all four roles agreed; see rovers.js): with the ship's landing traits the battery
// runs on the suit's clock (stored Wh ÷ 87, so a full LRV drives about 1.3 km), and a rover parked still within 15 m of
// the lander charges from the ship's power parts. Optional `ship` (a ShipSpec; default: the ship in core, none in Node).
// Without traits: the real battery, no charging, exactly as before.
// each frame: rover.update(dt, { throttle: -1..1, steer: -1..1, brake: bool });   (steer +1 = left)
// heading 0 drives toward −Z (same convention as WalkController's yaw); forward = (−sin h, 0, −cos h).

import { currentShip, landerPowerFor, roverPowerFor, LANDER_AT } from './rovers.js';

export const ROVER = {
  name: 'LRV', // HUD name (also the key of the rover's charger in traits.landing.power.rovers)
  mass: 450, // kg: 210 kg rover + one suited astronaut (~180 kg) + tools and samples
  wheelbase: 2.29, // m
  track: 1.83, // m
  wheelRadius: 0.41, // m
  power: 746, // W, four 186 W hub motors
  stallForce: 900, // N, total drive force at low speed
  efficiency: 0.8, // battery → wheel
  rollingResistance: 0.12, // effective coefficient on loose regolith (fitted to Apollo 15's ≈ 52 Wh/km)
  friction: 0.6, // tyre ↔ regolith grip μ
  topSpeed: 3.6, // m/s ≈ 13 km/h, the LRV's design speed (speed governor)
  reverseSpeed: 1.0, // m/s
  turnRadius: 3.1, // m at full lock (four-wheel steering)
  steerRate: 1.6, // rad/s the steering can turn
  batteryWh: 8700, // ≈ 2 × 36 V × 121 Ah
  chargeW: 870, // W, an estimate: Apollo's LRV ran on primary silver-zinc batteries that could not be recharged; the game's
  // LRV takes a charge from the ship, at about a tenth of its capacity per hour as rechargeable silver-zinc would
  brakeDecel: 2.5, // m/s² from the brakes (still limited by grip)
  rolloverRollDeg: 40, // the LRV's static stability limit is about 45°
  rolloverPitchDeg: 45,
  hardLanding: 4, // m/s vertical impact: suspension bottoms out
  crashLanding: 8, // m/s: the rover is wrecked/overturned
};


// MR-01: the futuristic SPACEB&E rover, a CONCEPT vehicle (not a real machine). Unlocked at 50 % Mars Exploration.
// Same wheelbase and track as the LRV (Role 3 built both at 2.29 m x 1.83 m). Top speed ≈ 5.5 m/s (≈ 20 km/h), in line
// with the ~15 km/h goal NASA has talked about for its Lunar Terrain Vehicle; a bigger battery and more motor power
// let it hold that speed on loose regolith, and wide balloon tyres give slightly better grip.
export const ROVER_MR01 = {
  ...ROVER,
  name: 'MR-01',
  mass: 620, // kg: heavier chassis, 30 kWh battery pack, one suited astronaut (~180 kg) and tools
  power: 2400, // W (concept in-wheel motors; ≈ 1.5 kW is needed to hold 5.5 m/s on regolith)
  stallForce: 1400, // N
  friction: 0.65, // wide balloon tyres
  topSpeed: 5.5, // m/s ≈ 20 km/h (concept; speed governor)
  reverseSpeed: 1.5,
  turnRadius: 3.4, // m at full lock
  batteryWh: 30000, // ≈ 30 kWh concept pack (3.4× the LRV's 8.7 kWh)
  chargeW: 10000, // W: a lithium-ion pack charged at about a third of its capacity per hour (concept)
};

const deg = (r) => (r * 180) / Math.PI;
const UNSET = Symbol('ship from core');

export class RoverController {
  constructor({ gravity, getGroundHeight = () => 0, start = {}, colliders = [], onNotice, spec = ROVER, ship = UNSET } = {}) {
    if (!(gravity > 0)) throw new Error('RoverController: pass gravity (PLANETS.<planet>.g from core)');
    this.spec = spec; // ROVER (Apollo LRV, default) or ROVER_MR01
    this.g = gravity;
    this.getGroundHeight = getGroundHeight;
    this.colliders = colliders; // [{ x, z, r }] things the rover can't drive through (the lander)
    this.onNotice = onNotice ?? (() => {});
    this.x = start.x ?? 0;
    this.z = start.z ?? 0;
    this.heading = start.heading ?? 0;
    this.speed = 0; // m/s along the heading (negative = reverse)
    this.steer = 0; // −1..1 current steering position
    this.vy = 0;
    this.y = this._groundCentre().y;
    this.onGround = true;
    this.airTime = 0;
    this.pitch = 0; // rad, + nose up
    this.roll = 0; // rad, + right side down
    this._shipOpt = ship; // UNSET: follow the ship in core (a new mission's ship gives the rover a new charge)
    this._setupEnergy();
    this.odometer = 0;
    this.overturned = false;
    this.slip = 0; // 0..1 how much the turn is sliding (grip exceeded)
  }

  get forward() { return { x: -Math.sin(this.heading), z: -Math.cos(this.heading) }; }
  get right() { return { x: Math.cos(this.heading), z: -Math.sin(this.heading) }; }
  get batteryFrac() { return this.batteryWh / this.capacityWh; }

  // ---- energy: the rover's own battery, and the ship's power when the ship has landing traits (rovers.js) ----
  _setupEnergy() {
    const ship = this._shipOpt === UNSET ? currentShip() : this._shipOpt;
    this._ship = ship;
    const model = roverPowerFor(ship);
    if (!model) { this.capacityWh = this.spec.batteryWh; this._wh = this.capacityWh; this.power = null; return; }
    this.capacityWh = this.spec.batteryWh / model.scale; // the surface clock (see rovers.js)
    this._wh = this.capacityWh * model.arrivalFrac;
    this.chargeW = model.chargeW[this.spec.name] || this.spec.chargeW || 1000;
    this.reachM = model.reachM;
    this.power = landerPowerFor(ship, model);
    this.power.add(this);
  }
  _sync() {
    if (this._shipOpt === UNSET && currentShip() !== this._ship) this._setupEnergy(); // a new mission's ship
    this.power?.accrue();
  }
  get batteryWh() { this._sync(); return this._wh; }
  set batteryWh(v) { this._wh = v; }
  /** Plugged into the ship: standing still on its wheels within the cable's reach of the lander. */
  get pluggedIn() {
    if (!this.power || this.overturned || !this.onGround || Math.abs(this.speed) > 0.05) return false;
    return Math.hypot(this.x - LANDER_AT.x, this.z - LANDER_AT.z) <= this.reachM;
  }

  // Ground heights under the four wheels → centre height, pitch (front up +) and roll (right down +).
  _wheels() {
    const f = this.forward, r = this.right;
    const hb = this.spec.wheelbase / 2, ht = this.spec.track / 2;
    const at = (a, b) => this.getGroundHeight(this.x + f.x * a + r.x * b, this.z + f.z * a + r.z * b);
    return { FL: at(hb, -ht), FR: at(hb, ht), RL: at(-hb, -ht), RR: at(-hb, ht) };
  }

  _groundCentre() {
    const w = this._wheels();
    const front = (w.FL + w.FR) / 2, rear = (w.RL + w.RR) / 2;
    const left = (w.FL + w.RL) / 2, right = (w.FR + w.RR) / 2;
    return {
      y: (front + rear) / 2,
      pitch: Math.atan2(front - rear, this.spec.wheelbase),
      roll: Math.atan2(left - right, this.spec.track),
      wheels: w,
    };
  }

  update(dt, input = {}) {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.05);
    const R = this.spec;
    const g = this.g;
    const ground = this._groundCentre();
    const throttle = this.overturned || this.batteryWh <= 0 ? 0 : Math.max(-1, Math.min(1, input.throttle ?? 0));

    // steering moves at a finite rate (no instant wheel snap)
    const want = this.overturned ? 0 : Math.max(-1, Math.min(1, input.steer ?? 0));
    this.steer += Math.max(-R.steerRate * dt, Math.min(R.steerRate * dt, want - this.steer));

    // longitudinal forces (only with wheels on the ground)
    const grip = R.friction * R.mass * g * Math.cos(ground.pitch);
    let power = 0;
    if (this.onGround && !this.overturned) {
      const v = Math.abs(this.speed);
      // motors: force limited by stall torque, by power (F = P / v) and by grip (μ·m·g); a speed governor cuts them
      const governed = (throttle > 0 && this.speed >= R.topSpeed) || (throttle < 0 && this.speed <= -R.reverseSpeed);
      const motor = throttle === 0 || governed ? 0 : Math.min(R.stallForce, R.power / Math.max(v, 0.3), grip) * Math.abs(throttle);
      const drive = motor * Math.sign(throttle);
      const a = -g * Math.sin(ground.pitch) + drive / R.mass; // gravity along the slope + drive
      // rolling resistance and brakes oppose motion; they can stop the rover but never push it backwards
      const resist = R.rollingResistance * g * Math.cos(ground.pitch) + (input.brake ? Math.min(R.brakeDecel, grip / R.mass) : 0);
      if (Math.abs(this.speed) <= resist * dt) {
        this.speed = Math.abs(a) <= resist ? 0 : this.speed + (a - Math.sign(a) * resist) * dt;
      } else {
        this.speed += (a - Math.sign(this.speed) * resist) * dt;
      }
      power = (motor * v) / R.efficiency;
    } else if (this.onGround) {
      this.speed *= Math.max(0, 1 - 2 * dt); // overturned: grinding to a stop
    }

    // turning: four-wheel steering, radius ∝ 1/tan(steer angle); grip limits the lateral acceleration v²/r ≤ μg
    const maxAngle = Math.atan(R.wheelbase / (2 * R.turnRadius));
    const angle = this.steer * maxAngle;
    let yawRate = 0;
    if (this.onGround && Math.abs(angle) > 1e-4 && this.speed !== 0) {
      const radius = R.wheelbase / (2 * Math.tan(Math.abs(angle)));
      const gripRadius = (this.speed * this.speed) / (R.friction * g); // tightest turn the tyres can hold
      const r = Math.max(radius, gripRadius);
      this.slip = gripRadius > radius ? Math.min(1, 1 - radius / gripRadius) : 0;
      yawRate = (this.speed / r) * Math.sign(angle);
    } else {
      this.slip = 0;
    }
    this.heading += yawRate * dt;

    // move
    const f = this.forward;
    this.x += f.x * this.speed * dt;
    this.z += f.z * this.speed * dt;
    this.odometer += Math.abs(this.speed) * dt;
    const usedWh = Math.min(this.batteryWh, (power * dt) / 3600);
    this.batteryWh -= usedWh;
    this.power?.used(usedWh);
    if (this.batteryWh <= 0) { this.batteryWh = 0; this._notice('battery_empty'); } else if (this._flags?.battery && this.batteryFrac > 0.05) this._flags.battery = false; // charged again: say it again next time

    // obstacles: push out and stop
    for (const c of this.colliders) {
      const dx = this.x - c.x, dz = this.z - c.z, d = Math.hypot(dx, dz), min = c.r + R.track / 2 + 0.3;
      if (d < min && d > 1e-6) {
        this.x = c.x + (dx / d) * min;
        this.z = c.z + (dz / d) * min;
        if (Math.abs(this.speed) > 1.5) this._notice('bump', { speed: this.speed });
        this.speed = 0;
      }
    }

    // vertical: follow the ground, but the rover can't fall faster than gravity, so crests launch it (low g = long hops)
    const g2 = this._groundCentre();
    if (this.onGround) {
      const followVy = (g2.y - this.y) / dt;
      if (followVy < this.vy - g * dt - 0.5) {
        this.onGround = false; // the ground drops away faster than gravity can pull us down
        this.airTime = 0;
        this.vy -= g * dt;
        this.y += this.vy * dt;
      } else {
        this.vy = followVy;
        this.y = g2.y;
      }
    } else {
      this.vy -= g * dt;
      this.y += this.vy * dt;
      this.airTime += dt;
      if (this.y <= g2.y) {
        const impact = -this.vy;
        this.y = g2.y;
        this.vy = 0;
        this.onGround = true;
        if (impact > R.crashLanding) this._overturn('crash', { impact });
        else if (impact > R.hardLanding) this._notice('hard_landing', { impact });
      }
    }

    // attitude follows the four wheels on the ground (kept while airborne)
    if (this.onGround) {
      this.pitch = g2.pitch;
      this.roll = g2.roll;
      if (!this.overturned && (Math.abs(deg(this.roll)) > R.rolloverRollDeg || Math.abs(deg(this.pitch)) > R.rolloverPitchDeg)) {
        this._overturn('slope', { rollDeg: deg(this.roll), pitchDeg: deg(this.pitch) });
      }
    }
  }

  _overturn(reason, data) {
    if (this.overturned) return;
    this.overturned = true;
    this.speed = 0;
    this._notice('rollover', { reason, ...data });
  }

  _notice(type, data = {}) {
    this._flags ??= {};
    if (type === 'battery_empty') {
      if (this._flags.battery) return;
      this._flags.battery = true;
    }
    this.onNotice(type, data);
  }

  get telemetry() {
    return {
      name: this.spec.name,
      pos: { x: this.x, y: this.y, z: this.z },
      speed: Math.abs(this.speed),
      speedKmh: Math.abs(this.speed) * 3.6,
      heading: this.heading,
      pitchDeg: deg(this.pitch),
      rollDeg: deg(this.roll),
      onGround: this.onGround,
      batteryFrac: this.batteryFrac,
      charging: this.pluggedIn && this.batteryFrac < 1,
      odometerKm: this.odometer / 1000,
      overturned: this.overturned,
      slip: this.slip,
    };
  }
}
