// The big curved wall screen: a live camera feed of the integration stand (render-to-texture, refreshed only when the
// vehicle changes) and a telemetry board next to it (canvas, redrawn on change).
import * as THREE from 'three';
import { HALL } from './room.js';
import { DEG, box, canvasTexture, drawScreen, glow, polar, std } from './util.js';
import { fmtInt, fmtKN, fmtMass, fmtMoney } from '../format.js';

export function createWallScreen(scene, { renderer, getScene, standTop = 0.35 }) {
  const R = HALL.radius - 0.45;
  const angle = HALL.screenAngle;
  const width = 52 * DEG;
  const height = 7.2, bottom = 5.6;
  const rt = new THREE.WebGLRenderTarget(1280, 720);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const feedCamera = new THREE.PerspectiveCamera(34, 16 / 9, 0.5, 120);
  // Cylinder theta runs from +z around; angle 0 (our +x) is theta = 90°.
  const theta0 = (90 - angle) * DEG - width / 2;
  const curved = (w, h, start, len) => new THREE.CylinderGeometry(R, R, h, 48, 1, true, start, len);
  const feed = new THREE.Mesh(curved(0, height, theta0, width), new THREE.MeshBasicMaterial({ map: rt.texture, side: THREE.BackSide, toneMapped: false }));
  feed.position.y = bottom + height / 2;
  scene.add(feed);
  const frameMat = std(0x15191c, { roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide });
  for (const dy of [-0.2, height + 0.2]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.05, 0.4, 48, 1, true, theta0 - 0.02, width + 0.04), frameMat);
    bar.position.y = bottom + dy;
    scene.add(bar);
  }
  const strip = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.06, R + 0.06, 0.06, 48, 1, true, theta0, width), glow(0x67e8f9, 1.8));
  strip.material.side = THREE.DoubleSide;
  strip.position.y = bottom - 0.45;
  scene.add(strip);

  const boardWidth = 16 * DEG;
  const { texture, redraw } = canvasTexture(640, 900);
  const board = new THREE.Mesh(curved(0, height, theta0 - 2 * DEG - boardWidth, boardWidth), new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, toneMapped: false }));
  board.position.y = bottom + height / 2;
  scene.add(board);

  // The feed camera sits on the catwalk opposite the screen and looks at the stand.
  const camPos = polar(angle + 180, HALL.radius - 3.2, HALL.catwalkHeight + 1.2);
  feedCamera.position.copy(camPos);
  feedCamera.lookAt(0, standTop + 5, 0);
  const housing = box(0.35, 0.3, 0.5, frameMat, { x: camPos.x, y: camPos.y, z: camPos.z });
  housing.lookAt(0, standTop + 5, 0);
  scene.add(housing);

  let frame = 0;
  function refresh(stackHeight = 10) {
    feedCamera.lookAt(0, standTop + Math.max(4, stackHeight * 0.5), 0);
    feedCamera.fov = Math.min(50, Math.max(26, stackHeight * 2.6));
    feedCamera.updateProjectionMatrix();
    const prev = renderer.getRenderTarget();
    feed.visible = false; // the screen must not film itself (GPU feedback loop)
    renderer.setRenderTarget(rt);
    renderer.render(getScene(), feedCamera);
    renderer.setRenderTarget(prev);
    feed.visible = true;
    frame += 1;
  }

  function setTelemetry({ spec, breakdown, poll, money }) {
    const s = spec.stats;
    const ok = (v) => ({ text: v, color: '#4ade80' });
    const warn = (v) => ({ text: v, color: '#fbbf24' });
    const bad = (v) => ({ text: v, color: '#f87171' });
    const lines = [
      { text: `VEHICLE  ${spec.name.toUpperCase()}`, color: '#67e8f9' }, '',
      `Cost        ${fmtMoney(s.cost)}`,
      `Funds       ${fmtMoney(money)}`,
      `Mass wet    ${fmtMass(s.wetMass)}`,
      `Mass dry    ${fmtMass(s.dryMass)}`,
      `Propellant  ${fmtMass(s.fuelMass)}`,
      `Thrust SL   ${fmtKN(s.thrust * (s.ispVac ? s.ispSL / s.ispVac : 1))}`,
      `Isp         ${fmtInt(s.ispSL)} / ${fmtInt(s.ispVac)} s`, '',
      (s.deltaV >= breakdown.roundTrip ? ok : s.deltaV >= breakdown.oneWay ? warn : bad)(`Δv          ${fmtInt(s.deltaV)} m/s`),
      `  to Mars   ${fmtInt(breakdown.oneWay)} m/s`,
      `  round     ${fmtInt(breakdown.roundTrip)} m/s`,
      (s.twrEarth >= 1.2 ? ok : s.twrEarth >= 1 ? warn : bad)(`TWR Earth   ${s.twrEarth.toFixed(2)}`),
      (s.reliability >= 0.85 ? ok : s.reliability >= 0.8 ? warn : bad)(`Reliability ${fmtInt(s.reliability * 100)} %`),
      (breakdown.copY < breakdown.comY ? ok : bad)(`Stability   ${breakdown.copY < breakdown.comY ? 'CoP behind CoM' : 'UNSTABLE'}`), '',
      { text: 'READINESS', color: '#67e8f9' },
      ...poll.blocks.map((b) => bad(`✖ ${b.replace(/_/g, ' ')}`)),
      ...spec.warnings.map((w) => warn(`▲ ${w.replace(/_/g, ' ')}`)),
      ...(!poll.blocks.length && !spec.warnings.length ? [ok('All consoles GO')] : []),
    ];
    redraw((ctx, w, h) => drawScreen(ctx, w, h, { title: 'Telemetry', lines, scale: 1.25, status: { text: `CAM 01 · F${frame}`, color: '#86a6ad' } }));
  }

  return { refresh, setTelemetry, feedCamera, dispose: () => rt.dispose() };
}
