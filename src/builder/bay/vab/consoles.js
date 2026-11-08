// The curved bank of four consoles on the front-left diagonal (port of sandbox/role1.hangar.consoles-v5.js): Codex's
// engineering_consoles_v4 desk as an instanced chassis, and one live canvas per desk mapped over its five screens
// (three monitors, the big overhead panel, the nameplate). The screens show the game's own numbers (setScreen).
import * as THREE from 'three';
import { drawScreen } from '../util.js';
import { deg } from './load.js';

// [x, y, w, h] of each screen on the 1024 x 1024 canvas: 3 monitors, the overhead panel, the nameplate
const RECTS = [[0, 0, 1 / 3, 0.1875], [1 / 3, 0, 1 / 3, 0.1875], [2 / 3, 0, 1 / 3, 0.1875], [0, 0.25, 1, 0.33], [0, 0.625, 1, 0.1]];
const SIZE = 1024;

function mergeScreens(nodes) {
  const pos = [], norm = [], uv = [];
  nodes.forEach((node, i) => {
    if (!node) return;
    const g = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    g.applyMatrix4(node.matrixWorld);
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    const [x, y, w, h] = RECTS[i];
    for (let j = 0; j < p.count; j++) {
      pos.push(p.getX(j), p.getY(j), p.getZ(j));
      norm.push(n?.getX(j) ?? 0, n?.getY(j) ?? 0, n?.getZ(j) ?? 1);
      uv.push(x + (u?.getX(j) ?? 0) * w, 1 - y - h + (1 - (u?.getY(j) ?? 0)) * h);
    }
    g.dispose();
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// the small monitors: quiet live-looking graphics (no numbers that could be read as hints)
function monitor(ctx, w, h, kind, seed, label) {
  ctx.fillStyle = '#071116'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#142932'; ctx.fillRect(0, 0, w, 26);
  ctx.fillStyle = '#9ac9cc'; ctx.font = '600 15px "IBM Plex Mono", monospace'; ctx.textBaseline = 'alphabetic'; ctx.fillText(label, 10, 19);
  ctx.strokeStyle = '#1c323b'; ctx.lineWidth = 1;
  for (let x = 10; x < w; x += w / 10) { ctx.beginPath(); ctx.moveTo(x, 34); ctx.lineTo(x, h - 8); ctx.stroke(); }
  for (let y = 34; y < h - 6; y += h / 7) { ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(w - 8, y); ctx.stroke(); }
  if (kind === 'radar') {
    for (let i = 0; i < 9; i++) { ctx.strokeStyle = i % 3 ? '#1f5d52' : '#318876'; ctx.beginPath(); ctx.arc(w * 0.5, h * 0.6, 10 + i * 9, -1 - seed * 0.1, 1.1 + seed * 0.1); ctx.stroke(); }
    return;
  }
  const colours = ['#72bbb4', '#d1af67', '#79a5d0'];
  colours.slice(0, kind === 'plot3' ? 3 : 1).forEach((c, k) => {
    ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < 120; i++) {
      const t = i / 119, x = 10 + (w - 20) * t;
      const f = kind === 'ascent' ? t * t * 0.85 : Math.min(1, t * (5 - k)) * Math.min(1, (1 - t) * (7 - k)) * (0.85 - k * 0.12) + Math.sin(t * 40 + seed + k) * 0.015;
      const y = h * 0.9 - f * h * 0.55;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  });
}

const PANES = {
  station_window: [['radar', 'WEATHER RADAR'], ['plot', 'UPPER WINDS'], ['plot3', 'RANGE'], 'WINDOW & WEATHER'],
  station_builder: [['plot3', 'MASS / PERFORMANCE'], ['plot', 'STRUCTURE'], ['plot', 'BUILD STATUS'], 'SPACECRAFT DESIGN'],
  station_testfire: [['plot3', 'THRUST / Pc / RPM'], ['ascent', 'SIMULATED ASCENT'], ['plot', 'STAND LOAD'], 'ENGINE TEST & SIM'],
  station_launch: [['plot', 'COUNT'], ['plot3', 'LOOPS'], ['radar', 'RANGE SAFETY'], 'LAUNCH DIRECTOR'],
};

export function createConsoleBank({ scene, assets, layout, consoles }) {
  const source = assets.get(layout.wrap.consoleModule);
  if (!source) return null;
  source.updateMatrixWorld(true);
  const chassisNodes = source.getObjectByName('station_window')?.children.filter((n) => n.isMesh && !n.name.startsWith('screen_')) ?? [];
  const dummy = new THREE.Object3D();
  const chassis = chassisNodes.map((n) => {
    const m = new THREE.InstancedMesh(n.geometry, n.material, consoles.length);
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    consoles.forEach((st, i) => {
      dummy.position.fromArray(st.position);
      dummy.rotation.set(0, deg(st.rotation[1]), 0);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix.clone().multiply(n.matrixWorld));
    });
    m.instanceMatrix.needsUpdate = true;
    scene.add(m);
    return m;
  });
  const desks = consoles.map((st, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    const mesh = new THREE.Mesh(mergeScreens(st.screens.map((id) => source.getObjectByName(id))), material);
    mesh.name = st.id + '_screens';
    mesh.position.fromArray(st.position);
    mesh.rotation.y = deg(st.rotation[1]);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    scene.add(mesh);
    return { st, i, canvas, ctx: canvas.getContext('2d'), texture, material, mesh, screen: { title: PANES[st.id]?.[3] ?? st.id, lines: [], status: null } };
  });

  function draw(d) {
    const { ctx } = d;
    const panes = PANES[d.st.id] ?? PANES.station_launch;
    ctx.fillStyle = '#071116';
    ctx.fillRect(0, 0, SIZE, SIZE);
    RECTS.forEach(([x, y, rw, rh], pane) => {
      const w = rw * SIZE, h = rh * SIZE;
      ctx.save();
      ctx.translate(x * SIZE, y * SIZE);
      ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      if (pane < 3) monitor(ctx, w, h, panes[pane][0], d.i * 3 + pane, panes[pane][1]);
      else if (pane === 3) drawScreen(ctx, w, h, { title: d.screen.title, lines: d.screen.lines, status: d.screen.status, scale: 1.45 });
      else {
        ctx.fillStyle = '#8f938b'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#1f2a2e'; ctx.font = '600 38px "IBM Plex Mono", monospace'; ctx.textBaseline = 'alphabetic'; ctx.fillText(panes[3], 22, 66);
      }
      ctx.restore();
    });
    d.texture.needsUpdate = true;
  }
  desks.forEach(draw);

  return {
    objects: [...chassis, ...desks.map((d) => d.mesh)],
    /** Redraws one desk's overhead panel: { title?, lines, status }. */
    setScreen(id, { title, lines = [], status = null } = {}) {
      const d = desks.find((x) => x.st.id === id);
      if (!d) return;
      const next = { title: title ?? d.screen.title, lines, status };
      if (JSON.stringify(next) === JSON.stringify(d.screen)) return;
      d.screen = next;
      draw(d);
    },
    dispose() {
      for (const m of chassis) { scene.remove(m); m.dispose(); }
      for (const d of desks) { scene.remove(d.mesh); d.mesh.geometry.dispose(); d.material.dispose(); d.texture.dispose(); }
    },
  };
}
