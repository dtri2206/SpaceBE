// Static fire and hold-down liftoff test on the integration stand. Uses Role 3's engine VFX and sounds.
// Phases: countdown → ignition → hold → release (the vehicle rises if TWR > 1) → cutoff → done.
import * as THREE from 'three';
import { assets, graphics } from '/src/graphics/index.js';
import { audio } from '/src/audio/index.js';

const PHASES = [
  ['countdown', 3.0],
  ['ignition', 1.6],
  ['hold', 2.2],
  ['release', 2.2],
  ['cutoff', 1.0],
  ['settle', 1.6],
];

export function createTestStand({ scene, rocket, standTop, planets, g0 }) {
  let run = null; // { spec, breakdown, phaseIndex, t, throttle, lift, onPhase, onDone, flame, exhaust, engineY, scale }

  function attachVfx(layout) {
    const engine = layout.find((e) => e.def?.engine);
    const group = new THREE.Group();
    const scale = engine ? Math.max(0.8, engine.radius / 1.25) : 1;
    const flame = assets.get('vfx:engineFlame');
    const exhaust = assets.get('vfx:exhaust');
    flame.scale.setScalar(scale);
    exhaust.scale.setScalar(scale);
    group.add(flame, exhaust);
    group.position.y = engine ? engine.y : 0;
    rocket.add(group);
    return { group, flame, exhaust, engineY: engine?.y ?? 0, fuel: engine?.engine?.fuel ?? 'methalox' };
  }

  function start({ spec, breakdown, layout, onPhase, onDone }) {
    cancel();
    const vfx = attachVfx(layout);
    run = { spec, breakdown, phaseIndex: 0, t: 0, throttle: 0, lift: 0, onPhase, onDone, ...vfx, rocketBaseY: rocket.position.y, trembling: 0 };
    vfx.flame.userData.set?.({ throttle: 0, airDensity: 1, fuel: vfx.fuel });
    vfx.exhaust.userData.set?.({ throttle: 0, airDensity: 1 });
    onPhase?.('countdown', 0);
    audio.play('gonogo.tick');
  }

  function cancel() {
    if (!run) return;
    rocket.remove(run.group);
    rocket.position.y = run.rocketBaseY;
    graphics.setEffects({ shake: 0 });
    audio.stop('engine.rumble');
    run = null;
  }

  function update(dt) {
    if (!run) return;
    run.t += dt;
    const [phase, length] = PHASES[run.phaseIndex];
    const s = run.spec.stats;
    const thrustSL = s.thrust * (s.ispVac ? s.ispSL / s.ispVac : 1);
    const a = s.wetMass ? thrustSL / s.wetMass - planets.earth.g : 0; // net acceleration off the pad, m/s²
    const twr = s.twrEarth;
    switch (phase) {
      case 'countdown':
        if (Math.floor(run.t) !== Math.floor(run.t - dt)) audio.play('gonogo.tick');
        break;
      case 'ignition':
        run.throttle = Math.min(1, run.t / length);
        if (run.t - dt <= 0) audio.play('engine.rumble', { loop: true });
        break;
      case 'hold':
        run.throttle = 1;
        break;
      case 'release':
        run.throttle = 1;
        if (twr > 1) run.lift = Math.min(3.2, 0.5 * Math.max(0.3, a) * run.t * run.t);
        else run.trembling = 1;
        break;
      case 'cutoff':
        run.throttle = Math.max(0, 1 - run.t / length);
        break;
      case 'settle':
        run.throttle = 0;
        run.lift = Math.max(0, run.lift - dt * 2.6);
        run.trembling = 0;
        break;
      default:
        break;
    }
    const air = 1;
    run.flame.userData.set?.({ throttle: run.throttle, airDensity: air, fuel: run.fuel });
    run.exhaust.userData.set?.({ throttle: run.throttle, airDensity: air });
    audio.setAir?.(1);
    const shake = Math.min(1, run.throttle * 0.55 + run.trembling * 0.35);
    graphics.setEffects({ shake });
    const wobble = run.trembling ? Math.sin(run.t * 40) * 0.015 : 0;
    rocket.position.y = run.rocketBaseY + run.lift;
    rocket.rotation.z = wobble;
    if (run.t >= length) {
      run.t = 0;
      run.phaseIndex += 1;
      if (run.phaseIndex >= PHASES.length) {
        const result = summarize(run.spec, run.breakdown, twr, a, thrustSL);
        const done = run.onDone;
        cancel();
        rocket.rotation.z = 0;
        done?.(result);
        return;
      }
      const next = PHASES[run.phaseIndex][0];
      if (next === 'cutoff') audio.stop('engine.rumble', { fade: 0.8 });
      run.onPhase?.(next, run.phaseIndex);
    }
  }

  function summarize(spec, breakdown, twr, a, thrustSL) {
    const s = spec.stats;
    const mdot = s.thrust > 0 ? s.thrust / ((s.ispVac || 1) * g0) : 0; // kg/s at full throttle
    const burnTime = mdot > 0 ? s.fuelMass / mdot : 0;
    return {
      lifted: twr > 1,
      twr, netAccel: a, thrustSL, weight: s.wetMass * planets.earth.g, mdot,
      burnTime,
      deltaV: s.deltaV, oneWay: breakdown.oneWay, roundTrip: breakdown.roundTrip,
      reachesMars: s.deltaV >= breakdown.oneWay,
      comesHome: s.deltaV >= breakdown.roundTrip,
      stable: breakdown.copY < breakdown.comY,
    };
  }

  return { start, cancel, update, get active() { return !!run; }, get phase() { return run ? PHASES[run.phaseIndex][0] : null; } };
}
