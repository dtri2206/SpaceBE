// The impact for the pitch (beat 7g): a low camera on the steppe, a descent capsule plunging almost vertically with its tangled
// reserve/drogue streaming above it, then the hit: white flash, fireball, flung debris on ballistic arcs, a ring of dust, a rising
// black smoke column. No people. Browser only (three.js); used by returnHome.js.
//   const imp = createImpact({ hitAt, fallFrom }); graphics.setView(imp.scene, imp.camera);
//   each frame: const { shake, flash, impacted } = imp.update(dt)  (impacted is true on the one frame of the hit)
import * as THREE from 'three';
import { groundY, noise, blobTexture } from './crashSite.js';

const lerp = (a, b, u) => a + (b - a) * Math.min(1, Math.max(0, u));

export function createImpact({ hitAt = 1.9, fallFrom = 55 } = {}) {
  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const rr = (a, b) => a + (b - a) * rnd();
  const scene = new THREE.Scene();
  scene.name = 'impact';
  scene.fog = new THREE.Fog(0xb7c2b8, 120, 1500);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.2, 6000);
  const disposables = [];
  const keep = (o) => { disposables.push(o); return o; };
  const g0 = groundY(0, 0);

  // ---- sky and light (same palette as the crash site) ----
  {
    const geo = keep(new THREE.SphereGeometry(3000, 24, 16));
    const col = [];
    const pos = geo.attributes.position;
    const top = new THREE.Color(0x5f8ac0), mid = new THREE.Color(0xb6cde0), hor = new THREE.Color(0xdde0d2);
    for (let i = 0; i < pos.count; i += 1) {
      const h = Math.max(0, pos.getY(i) / 3000);
      const c = h < 0.25 ? hor.clone().lerp(mid, h / 0.25) : mid.clone().lerp(top, Math.min(1, (h - 0.25) / 0.6));
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const dome = new THREE.Mesh(geo, keep(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    scene.add(dome);
  }
  const sunDirection = new THREE.Vector3(-0.55, 0.5, 0.6).normalize();
  const sun = new THREE.DirectionalLight(0xffe7c4, 2.6);
  sun.position.copy(sunDirection).multiplyScalar(200);
  const flashLight = new THREE.PointLight(0xffa040, 0, 90, 1.4);
  flashLight.position.set(0, g0 + 3, 0);
  scene.add(sun, new THREE.HemisphereLight(0xcfd9e8, 0x6a6a45, 1.0), flashLight);

  // ---- the steppe: pale green-brown plain with grass tufts ----
  {
    const geo = keep(new THREE.PlaneGeometry(4000, 4000, 120, 120));
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = [];
    const a = new THREE.Color(0x9aa066), b = new THREE.Color(0x8a7d50), c = new THREE.Color(0xb3b078);
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, groundY(x, z));
      const n = noise(x * 0.012, z * 0.012), m = noise(x * 0.09, z * 0.09);
      const k = a.clone().lerp(b, n).lerp(c, m * 0.4);
      col.push(k.r, k.g, k.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }))));
    const count = 2200;
    const tuft = keep(new THREE.ConeGeometry(0.05, 0.55, 3));
    tuft.translate(0, 0.27, 0);
    const mesh = new THREE.InstancedMesh(tuft, keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true })), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    for (let i = 0; i < count; i += 1) {
      const r = 2 + Math.sqrt(rnd()) * 110, ang = rnd() * 7;
      p.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
      p.y = groundY(p.x, p.z);
      e.set(rr(-0.25, 0.25), rnd() * 6, rr(-0.25, 0.25));
      q.setFromEuler(e);
      s.set(rr(0.8, 1.6), rr(0.7, 1.8), rr(0.8, 1.6));
      mesh.setMatrixAt(i, m.compose(p, q, s));
      mesh.setColorAt(i, new THREE.Color().setHSL(rr(0.15, 0.22), rr(0.28, 0.45), rr(0.32, 0.5)));
    }
    scene.add(mesh);
  }

  // ---- the capsule: Soyuz-like bell, heat shield down, a little off the vertical ----
  const capRoot = new THREE.Group();
  const SCALE = 1.9;
  {
    const profile = [[0.0, 2.05], [0.45, 2.0], [0.62, 1.8], [0.9, 1.35], [1.12, 0.85], [1.2, 0.4], [1.08, 0.05], [0.0, -0.02]].map(([x, y]) => new THREE.Vector2(x, y));
    const geo = keep(new THREE.LatheGeometry(profile, 32));
    const pos = geo.attributes.position;
    const col = [];
    const paint = new THREE.Color(0xd8d3c6), soot = new THREE.Color(0x2a2118), shield = new THREE.Color(0x2e231a);
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i);
      const c = y < 0.4 ? shield : paint.clone().lerp(soot, Math.min(1, Math.max(0, (1.1 - y) * 0.55 + noise(pos.getX(i) * 3, pos.getZ(i) * 3) * 0.3)));
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const body = new THREE.Mesh(geo, keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8, metalness: 0.3, side: THREE.DoubleSide })));
    const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(0.4, 0.05, 6, 14)), keep(new THREE.MeshStandardMaterial({ color: 0x4a4540, roughness: 0.7, metalness: 0.5 })));
    ring.position.y = 2.0;
    ring.rotation.x = Math.PI / 2;
    const tilt = new THREE.Group();
    tilt.add(body, ring);
    tilt.scale.setScalar(SCALE);
    tilt.position.y = -SCALE; // pivot about the middle of the capsule
    capRoot.add(tilt);
    capRoot.rotation.set(0.16, 0.4, 0.12);
    scene.add(capRoot);
  }

  // ---- the tangled reserve and drogue streaming above it (two cloth strips + a few lines, rebuilt every frame) ----
  const ROWS = 18, COLS = 6;
  function makeStrip(width, length, phase, colours) {
    const geo = keep(new THREE.BufferGeometry());
    const n = (ROWS + 1) * (COLS + 1);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const col = new Float32Array(n * 3);
    const index = [];
    for (let i = 0; i <= ROWS; i += 1) {
      for (let j = 0; j <= COLS; j += 1) {
        const c = colours[(Math.floor(j / 1.5) + i % 2) % colours.length].clone().lerp(new THREE.Color(0x3b3022), 0.1 + noise(i * 0.7, j * 0.9 + phase) * 0.35);
        col.set([c.r, c.g, c.b], (i * (COLS + 1) + j) * 3);
        if (i < ROWS && j < COLS) { const a = i * (COLS + 1) + j, b = a + 1, c2 = a + COLS + 1, d = c2 + 1; index.push(a, c2, b, b, c2, d); }
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(index);
    const mesh = new THREE.Mesh(geo, keep(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1, flatShading: true })));
    mesh.frustumCulled = false;
    scene.add(mesh);
    return { mesh, geo, width, length, phase };
  }
  const orange = new THREE.Color(0xd9611f), white = new THREE.Color(0xe9e2d0);
  const strips = [makeStrip(6.5, 17, 0, [orange, white]), makeStrip(2.2, 12, 3.1, [white, orange])];
  const lineMat = keep(new THREE.LineBasicMaterial({ color: 0xd8d2c0 }));
  const lines = Array.from({ length: 6 }, () => {
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, lineMat);
    line.frustumCulled = false;
    scene.add(line);
    return line;
  });
  const anchor = new THREE.Vector3();
  function updateStrip(st, time, lenK, groundK) {
    const p = st.geo.attributes.position;
    const length = st.length * lenK;
    for (let i = 0; i <= ROWS; i += 1) {
      const s = i / ROWS;
      const sway = s * Math.min(1.6, 0.4 + length * 0.07);
      const cx = anchor.x + Math.sin(s * 7 - time * 9 + st.phase) * sway;
      const cz = anchor.z + Math.cos(s * 5 - time * 7 + st.phase) * sway * 0.7;
      const w = st.width * (0.08 + s * 0.92) * (1 - 0.45 * Math.sin(s * 9 + st.phase) ** 2) * (1 + groundK * 0.6);
      const tw = s * 5 + time * 2 + st.phase;
      for (let j = 0; j <= COLS; j += 1) {
        const k = j / COLS - 0.5;
        const y = anchor.y + 1.4 + s * length * (1 - 0.55 * groundK) + Math.sin(j * 2.1 + s * 8 + time * 6) * 0.15 * s;
        p.setXYZ(i * (COLS + 1) + j, cx + k * w * Math.cos(tw), Math.max(g0 + 0.05, y), cz + k * w * Math.sin(tw));
      }
    }
    p.needsUpdate = true;
    st.geo.computeVertexNormals();
  }
  function updateLines(time) {
    const tip = strips[0].geo.attributes.position;
    lines.forEach((line, k) => {
      const q = line.geometry.attributes.position;
      const idx = (ROWS * (COLS + 1)) * 0 + (Math.floor(ROWS * 0.55) * (COLS + 1)) + Math.min(COLS, k);
      q.setXYZ(0, anchor.x + Math.sin(k + time) * 0.1, anchor.y + 1.4, anchor.z + Math.cos(k) * 0.1);
      q.setXYZ(1, tip.getX(idx), tip.getY(idx), tip.getZ(idx));
      q.needsUpdate = true;
    });
  }

  // ---- fire, dust, smoke, debris ----
  const fireTex = keep(blobTexture([[0, 'rgba(255,248,210,A)'], [0.3, 'rgba(255,170,50,A)'], [0.65, 'rgba(230,70,10,A)'], [1, 'rgba(120,20,0,0)']]));
  const smokeTex = keep(blobTexture([[0, 'rgba(255,255,255,A)'], [0.55, 'rgba(255,255,255,A)'], [1, 'rgba(255,255,255,0)']], 12));
  const sprite = (tex, additive) => {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: !additive, opacity: 0 });
    disposables.push(mat);
    const s = new THREE.Sprite(mat);
    s.visible = false;
    scene.add(s);
    return s;
  };
  const fireball = Array.from({ length: 24 }, () => ({ s: sprite(fireTex, true), age: 0, life: rr(1.3, 2.3), size: rr(7, 15), pos: new THREE.Vector3(), vel: new THREE.Vector3() }));
  const dustRing = Array.from({ length: 28 }, (_, i) => ({ s: sprite(smokeTex, false), age: 0, life: rr(1.6, 2.4), size: rr(5, 9), ang: (i / 28) * Math.PI * 2 + rr(-0.1, 0.1), speed: rr(16, 26), r: 0 }));
  const smoke = Array.from({ length: 70 }, () => ({ s: sprite(smokeTex, false), age: 0, life: rr(2.6, 3.6), size: rr(3, 5), pos: new THREE.Vector3(), vel: new THREE.Vector3(), shade: rnd(), live: false }));
  const cY = new THREE.Color(0xfff0b0), cO = new THREE.Color(0xff7a1a), cR = new THREE.Color(0xb01808), cD = new THREE.Color(0x1a1210);
  const cSmokeA = new THREE.Color(0x0e0d0c), cSmokeB = new THREE.Color(0x4a4845), cDust = new THREE.Color(0xc9b58a);
  const tmp = new THREE.Color();

  const debris = [];
  {
    const mats = [0x3a2c20, 0x9a9890, 0x1c1814, 0xd8d3c6].map((c) => keep(new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.4, flatShading: true, side: THREE.DoubleSide })));
    for (let i = 0; i < 40; i += 1) {
      const sz = rr(0.15, 0.7);
      const geo = keep(i % 3 === 0 ? new THREE.BoxGeometry(sz * 2.2, 0.05, sz * 1.4) : new THREE.DodecahedronGeometry(sz, 0));
      const mesh = new THREE.Mesh(geo, mats[i % 4]);
      mesh.visible = false;
      scene.add(mesh);
      const ang = rnd() * Math.PI * 2, h = rr(5, 26);
      debris.push({ mesh, sz, vel: new THREE.Vector3(Math.cos(ang) * h, rr(9, 30), Math.sin(ang) * h), spin: new THREE.Vector3(rr(-9, 9), rr(-9, 9), rr(-9, 9)), rest: false, bounced: false });
    }
  }
  // the scorch grows under the fire; a shock ring runs out along the ground
  const scorch = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(12,8,5,.95)');
    grad.addColorStop(0.6, 'rgba(25,18,10,.7)');
    grad.addColorStop(1, 'rgba(25,18,10,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const mesh = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)), keep(new THREE.MeshBasicMaterial({ map: keep(new THREE.CanvasTexture(cv)), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = g0 + 0.06;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  })();
  const shock = new THREE.Mesh(keep(new THREE.RingGeometry(0.85, 1, 48)), keep(new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })));
  shock.rotation.x = -Math.PI / 2;
  shock.position.y = g0 + 0.15;
  shock.visible = false;
  scene.add(shock);

  // ---- state ----
  let t = 0;
  let hit = false;
  let spawnSmoke = 0;
  let smokeIdx = 0;
  const target = new THREE.Vector3();
  const jolt = new THREE.Vector3();

  function capsuleY(time) { return g0 + SCALE + fallFrom * (1 - Math.pow(Math.min(1, time / hitAt), 1.7)); }

  function doHit() {
    hit = true;
    capRoot.visible = false;
    flashLight.intensity = 900;
    scorch.visible = true;
    shock.visible = true;
    fireball.forEach((f) => {
      f.age = 0;
      f.pos.set(rr(-1.5, 1.5), g0 + rr(0.6, 2.2), rr(-1.5, 1.5));
      f.vel.set(rr(-7, 7), rr(3, 12), rr(-7, 7));
      f.s.visible = true;
    });
    dustRing.forEach((d) => { d.age = 0; d.r = 1; d.s.visible = true; });
    debris.forEach((d) => { d.mesh.visible = true; d.mesh.position.set(rr(-1, 1), g0 + 1, rr(-1, 1)); });
  }

  function simulate(dt) {
    const since = t - hitAt;
    // fireball: young white-yellow, then orange, red, dark and gone
    for (const f of fireball) {
      if (!f.s.visible) continue;
      f.age += dt;
      f.pos.addScaledVector(f.vel, dt);
      f.vel.multiplyScalar(1 - 1.8 * dt);
      const u = Math.min(1, f.age / f.life);
      f.s.position.copy(f.pos);
      f.s.scale.setScalar(f.size * (0.35 + 0.9 * Math.sqrt(u)));
      f.s.material.opacity = Math.pow(1 - u, 0.8) * Math.min(1, f.age * 14);
      f.s.material.color.copy(u < 0.3 ? tmp.copy(cY).lerp(cO, u / 0.3) : u < 0.65 ? tmp.copy(cO).lerp(cR, (u - 0.3) / 0.35) : tmp.copy(cR).lerp(cD, (u - 0.65) / 0.35));
    }
    // dust ring
    for (const d of dustRing) {
      if (!d.s.visible) continue;
      d.age += dt;
      d.r += d.speed * Math.exp(-d.age * 1.1) * dt;
      const u = Math.min(1, d.age / d.life);
      d.s.position.set(Math.cos(d.ang) * d.r, g0 + 0.8 + u * 2.2, Math.sin(d.ang) * d.r);
      d.s.scale.setScalar(d.size * (0.6 + 1.6 * u));
      d.s.material.opacity = 0.62 * Math.pow(1 - u, 1.2) * Math.min(1, d.age * 8);
      d.s.material.color.copy(cDust);
    }
    // smoke column: spawned from the crater, rising, darkest while young
    if (hit) {
      spawnSmoke += dt * 34;
      while (spawnSmoke >= 1) {
        spawnSmoke -= 1;
        const p = smoke[smokeIdx % smoke.length];
        smokeIdx += 1;
        p.age = 0; p.live = true; p.s.visible = true;
        p.pos.set(rr(-1.2, 1.2), g0 + rr(0.6, 1.8), rr(-1.2, 1.2));
        p.vel.set(rr(-0.8, 0.8), rr(8, 14), rr(-0.8, 0.8));
      }
    }
    for (const p of smoke) {
      if (!p.live) continue;
      p.age += dt;
      p.pos.addScaledVector(p.vel, dt);
      p.pos.x += dt * 1.6;
      const u = p.age / p.life;
      if (u >= 1) { p.live = false; p.s.visible = false; continue; }
      p.s.position.copy(p.pos);
      p.s.scale.setScalar(p.size + u * 14);
      p.s.material.opacity = 0.85 * Math.min(1, p.age * 5) * Math.pow(1 - u, 0.8);
      p.s.material.color.copy(tmp.copy(cSmokeA).lerp(cSmokeB, Math.min(1, u * 0.9 + p.shade * 0.25)));
    }
    // debris on ballistic arcs
    for (const d of debris) {
      if (!d.mesh.visible || d.rest) continue;
      d.vel.y -= 9.8 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt; d.mesh.rotation.z += d.spin.z * dt;
      const floor = groundY(d.mesh.position.x, d.mesh.position.z) + d.sz * 0.4;
      if (d.mesh.position.y <= floor) {
        d.mesh.position.y = floor;
        if (!d.bounced) { d.bounced = true; d.vel.set(d.vel.x * 0.35, -d.vel.y * 0.3, d.vel.z * 0.35); } else d.rest = true;
      }
    }
    // scorch, shock ring, light
    if (hit) {
      scorch.scale.setScalar(lerp(1, 20, since / 0.5));
      scorch.material.opacity = Math.min(1, since * 3);
      const r = 2 + since * 55;
      shock.scale.setScalar(r);
      shock.material.opacity = Math.max(0, 1 - since / 0.7) * 0.8;
      shock.visible = since < 0.7;
      flashLight.intensity = 900 * Math.exp(-since * 4) + 80 * Math.max(0, 1 - since / 2.2);
    }
  }

  function placeCamera(dt) {
    const dolly = hit ? t - hitAt : 0;
    camera.position.set(14 + dolly * 0.7, g0 + 1.5, 21 + dolly * 0.9);
    if (!hit) {
      const y = capsuleY(t);
      target.set(0, lerp(y, y * 0.9, 0.5), 0);
    } else {
      const since = t - hitAt;
      target.set(0, lerp(3, 14, since / 2), 0);
    }
    camera.lookAt(target);
    if (hit) {
      const k = Math.exp(-(t - hitAt) * 2.2);
      jolt.set(rr(-1, 1) * 0.5 * k, rr(-1, 1) * 0.35 * k, 0);
      camera.position.add(jolt);
    }
  }

  function update(dt) {
    t += dt;
    let impacted = false;
    if (!hit && t >= hitAt) { doHit(); impacted = true; }
    anchor.set(capRoot.position.x, 0, capRoot.position.z);
    if (!hit) {
      capRoot.position.set(Math.sin(t * 1.3) * 0.3, capsuleY(t), 0);
      anchor.copy(capRoot.position).add(new THREE.Vector3(0, SCALE * 0.9, 0));
      anchor.y -= 1.4;
      capRoot.rotation.y = 0.4 + t * 1.5;
    } else {
      anchor.set(0, g0 + 0.2, 0);
    }
    const since = Math.max(0, t - hitAt);
    const settle = hit ? Math.min(1, since / 1.4) : 0; // after the hit the cloth collapses onto the ground
    const lenK = 1 - 0.8 * settle;
    strips.forEach((st) => updateStrip(st, t, lenK, settle));
    updateLines(t);
    lines.forEach((l) => { l.visible = !hit; });
    simulate(dt);
    placeCamera(dt);
    const shake = hit ? Math.max(0.12, 1.15 * Math.exp(-since * 1.4)) : lerp(0.08, 0.22, t / hitAt);
    const flash = hit ? Math.pow(Math.max(0, 1 - since / 0.4), 2) : 0;
    return { t, shake, flash, impacted };
  }
  update(0.0001);

  return {
    scene,
    camera,
    sunDirection,
    update,
    dispose() {
      disposables.forEach((d) => d.dispose?.());
      scene.traverse((o) => { if (o.isInstancedMesh) o.dispose?.(); });
    },
  };
}
