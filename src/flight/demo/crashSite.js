// The crash site for the pitch (beat 7g): a wrecked, scorched descent capsule on a flat grass steppe, the tangled parachute
// beside it, a large fire with heavy dark smoke. No people, no bodies. Browser only (three.js); used by returnHome.js.
//   const site = createCrashSite(); graphics.setView(site.scene, site.camera); each frame: site.update(dt, u) (u 0..1 = orbit progress)
import * as THREE from 'three';

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const rr = (a, b) => a + (b - a) * rnd();
export const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
export function noise(x, y) { // smooth value noise
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - v) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * v;
}
export const groundY = (x, z) => (noise(x * 0.05, z * 0.05) - 0.5) * 1.2 + (noise(x * 0.4, z * 0.4) - 0.5) * 0.12;

export function blobTexture(stops, billow = 0) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const paint = (cx, cy, r, a) => {
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    for (const [at, col] of stops) grad.addColorStop(at, col.replace('A', String(a)));
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  };
  paint(64, 64, 64, 1);
  for (let k = 0; k < billow; k += 1) paint(64 + rr(-26, 26), 64 + rr(-26, 26), rr(22, 38), 0.45);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCrashSite() {
  seed = 7;
  const scene = new THREE.Scene();
  scene.name = 'crashSite';
  scene.fog = new THREE.Fog(0xb7c2b8, 120, 1500);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.2, 6000);
  const disposables = [];
  const keep = (o) => { disposables.push(o); return o; };

  // ---- sky: a big dome, pale and hazy at the horizon ----
  {
    const geo = keep(new THREE.SphereGeometry(3000, 24, 16));
    const col = [];
    const pos = geo.attributes.position;
    const top = new THREE.Color(0x6f95c4), mid = new THREE.Color(0xb6cde0), hor = new THREE.Color(0xdde0d2);
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

  // ---- lights ----
  const sunDirection = new THREE.Vector3(-0.55, 0.38, 0.6).normalize();
  const sun = new THREE.DirectionalLight(0xffe7c4, 2.4);
  sun.position.copy(sunDirection).multiplyScalar(200);
  const fireLight = new THREE.PointLight(0xff7a22, 90, 40, 1.6);
  fireLight.position.set(0.8, 2.2, 0.2);
  scene.add(sun, new THREE.HemisphereLight(0xcfd9e8, 0x6a6a45, 0.95), fireLight);

  // ---- the steppe: pale green-brown, gently uneven, speckled ----
  {
    const geo = keep(new THREE.PlaneGeometry(6000, 6000, 150, 150));
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
    const tex = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const g = cv.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, 256, 256);
      for (let k = 0; k < 2600; k += 1) { const v = 150 + Math.floor(rnd() * 105); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 3); }
      const t = new THREE.CanvasTexture(cv);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(900, 900);
      t.colorSpace = THREE.SRGBColorSpace;
      return keep(t);
    })();
    scene.add(new THREE.Mesh(geo, keep(new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 1, metalness: 0 }))));
  }

  // grass tufts around the site
  {
    const count = 2600;
    const geo = keep(new THREE.ConeGeometry(0.05, 0.55, 3));
    geo.translate(0, 0.27, 0);
    const mesh = new THREE.InstancedMesh(geo, keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true })), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    for (let i = 0; i < count; i += 1) {
      const r = 3 + Math.sqrt(rnd()) * 90, ang = rnd() * 7;
      p.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
      p.y = groundY(p.x, p.z);
      e.set(rr(-0.25, 0.25), rnd() * 6, rr(-0.25, 0.25));
      q.setFromEuler(e);
      const h = rr(0.7, 1.8);
      s.set(rr(0.8, 1.6), h, rr(0.8, 1.6));
      mesh.setMatrixAt(i, m.compose(p, q, s));
      mesh.setColorAt(i, new THREE.Color().setHSL(rr(0.15, 0.22), rr(0.28, 0.45), rr(0.32, 0.5)));
    }
    scene.add(mesh);
  }

  // scorch on the ground, and the gouge the capsule ploughed
  {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(12,8,5,.95)');
    grad.addColorStop(0.55, 'rgba(25,18,10,.7)');
    grad.addColorStop(1, 'rgba(25,18,10,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = keep(new THREE.CanvasTexture(cv));
    const mat = keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: true }));
    const burn = new THREE.Mesh(keep(new THREE.PlaneGeometry(18, 18)), mat);
    burn.rotation.x = -Math.PI / 2;
    burn.position.y = groundY(0, 0) + 0.06;
    const gouge = new THREE.Mesh(keep(new THREE.PlaneGeometry(34, 5)), mat);
    gouge.rotation.x = -Math.PI / 2;
    gouge.rotation.z = 0.35;
    gouge.position.set(-15, groundY(-15, 5) + 0.06, 5);
    scene.add(burn, gouge);
  }

  // ---- the wrecked capsule (Soyuz-like bell, crumpled and scorched) ----
  const wreck = new THREE.Group();
  {
    const profile = [[0.0, 2.05], [0.45, 2.0], [0.62, 1.8], [0.9, 1.35], [1.12, 0.85], [1.2, 0.4], [1.08, 0.05], [0.0, -0.02]].map(([x, y]) => new THREE.Vector2(x, y));
    const geo = keep(new THREE.LatheGeometry(profile, 36));
    const pos = geo.attributes.position;
    const col = [];
    const paint = new THREE.Color(0xcfcabd), soot = new THREE.Color(0x181410), shield = new THREE.Color(0x2e231a);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i);
      const n = noise(v.x * 2.3 + 5, v.z * 2.3 + v.y * 1.7) - 0.5;
      v.multiplyScalar(1 + n * 0.22); // crumpled skin
      if (v.x > 0.45 && v.y < 1.3) { v.x *= 0.78; v.z *= 1 + 0.12 * n; v.y -= 0.18 * (v.x - 0.4); } // the big dent on the impact side
      if (v.y > 1.5) { v.x += 0.18; v.y -= 0.12; } // top bent over
      v.y += n * 0.14;
      pos.setXYZ(i, v.x, v.y, v.z);
      const burnt = Math.min(1, Math.max(0, 0.35 + n * 1.3 + (1.3 - v.y) * 0.35));
      const c = v.y < 0.35 ? shield.clone() : paint.clone().lerp(soot, burnt);
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const body = new THREE.Mesh(geo, keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.25, side: THREE.DoubleSide })));
    wreck.add(body);
    const portMat = keep(new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.3, metalness: 0.6 }));
    const port = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 12)), portMat);
    port.position.set(0.74, 1.05, 0.5);
    port.rotation.set(0.5, 0, -1.0);
    const port2 = port.clone();
    port2.position.set(-0.3, 1.1, 0.95);
    port2.rotation.set(1.3, 0, 0.3);
    const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(0.4, 0.05, 6, 14)), keep(new THREE.MeshStandardMaterial({ color: 0x4a4540, roughness: 0.7, metalness: 0.5 })));
    ring.position.set(0.18, 1.98, 0);
    ring.rotation.set(Math.PI / 2 + 0.25, 0, 0.1);
    wreck.add(port, port2, ring);
    wreck.rotation.set(0.1, 0.9, 1.12); // lying over on its side, nose to the ground
    wreck.position.set(0, groundY(0, 0) + 0.85, 0);
    scene.add(wreck);
  }

  // ---- scattered debris: broken heat-shield shells, plates, chunks, struts ----
  {
    const shellMat = keep(new THREE.MeshStandardMaterial({ color: 0x3a2c20, roughness: 0.95, metalness: 0.15, side: THREE.DoubleSide, flatShading: true }));
    const plateMat = keep(new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.5, metalness: 0.75, side: THREE.DoubleSide, flatShading: true }));
    const darkMat = keep(new THREE.MeshStandardMaterial({ color: 0x1c1814, roughness: 0.9, metalness: 0.3, flatShading: true }));
    const place = (mesh, rMin, rMax) => {
      const r = rr(rMin, rMax), a = rnd() * 6.283;
      mesh.position.set(Math.cos(a) * r, groundY(Math.cos(a) * r, Math.sin(a) * r) + 0.1, Math.sin(a) * r);
      mesh.rotation.set(rr(-0.5, 0.5), rnd() * 6.283, rr(-0.5, 0.5));
      scene.add(mesh);
    };
    for (let i = 0; i < 6; i += 1) { // heat-shield shards: pieces of a sphere shell
      const geo = keep(new THREE.SphereGeometry(rr(1.3, 2.1), 10, 5, rnd() * 6, rr(0.7, 1.4), 0.2, rr(0.35, 0.7)));
      place(new THREE.Mesh(geo, shellMat), 3, 11);
    }
    for (let i = 0; i < 14; i += 1) { // bent plates
      const geo = keep(new THREE.BoxGeometry(rr(0.4, 1.7), 0.04, rr(0.3, 1.1)));
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k += 1) pos.setY(k, pos.getY(k) + (pos.getX(k) * 0.35) * rr(0.5, 1.2));
      place(new THREE.Mesh(geo, i % 3 ? plateMat : darkMat), 2.5, 22);
    }
    for (let i = 0; i < 26; i += 1) { // chunks
      const geo = keep(new THREE.DodecahedronGeometry(rr(0.08, 0.35), 0));
      place(new THREE.Mesh(geo, i % 2 ? darkMat : plateMat), 2, 30);
    }
    for (let i = 0; i < 7; i += 1) { // twisted struts
      const geo = keep(new THREE.CylinderGeometry(0.035, 0.035, rr(0.8, 2.4), 5));
      place(new THREE.Mesh(geo, plateMat), 3, 16);
    }
    const lid = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.55, 0.6, 0.12, 14)), darkMat); // the detached hatch cover
    place(lid, 5, 6);
  }

  // ---- the tangled parachute, lying beside the wreck ----
  {
    const SEG = 44;
    const geo = keep(new THREE.PlaneGeometry(15, 15, SEG, SEG));
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const col = [];
    const orange = new THREE.Color(0xd9611f), white = new THREE.Color(0xe9e2d0), dirt = new THREE.Color(0x3b3022);
    const knots = [[2, -1], [-3, 2.5], [0.5, 4]].map(([x, z]) => new THREE.Vector2(x, z));
    const cx = 4.5, cz = -5.5; // beside the capsule
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i);
      const ang = Math.atan2(v.z, v.x);
      for (const k of knots) { // pinch toward the knots: the lines are tangled
        const d = Math.hypot(v.x - k.x, v.z - k.y);
        const w = Math.exp(-(d * d) / 14);
        v.x += (k.x - v.x) * w * 0.55;
        v.z += (k.y - v.z) * w * 0.55;
      }
      const fold = Math.abs(noise(v.x * 0.5 + 9, v.z * 0.5)) * 1.1 + Math.sin(v.x * 1.7 + v.z * 1.3) * 0.18 + Math.max(0, 1.6 - Math.hypot(v.x - 1, v.z)) * 0.5;
      const wx = cx + v.x, wz = cz + v.z;
      pos.setXYZ(i, wx, Math.max(groundY(wx, wz) + 0.04, groundY(wx, wz) + fold * 0.45), wz);
      const stripe = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 16) % 2 === 0 ? orange : white;
      const c = stripe.clone().lerp(dirt, Math.min(0.75, 0.15 + noise(wx * 0.6, wz * 0.6) * 0.6));
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, keep(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1, flatShading: true }))));
    // lines from the cloth to the capsule, sagging on the ground
    const lineMat = keep(new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.9 }));
    for (let i = 0; i < 9; i += 1) {
      const a = new THREE.Vector3(cx + rr(-5, 5), 0, cz + rr(-5, 5));
      const b = new THREE.Vector3(rr(-0.8, 0.8), 0, rr(-0.8, 0.8));
      const pts = [0, 0.25, 0.5, 0.75, 1].map((t) => {
        const p = a.clone().lerp(b, t);
        p.x += Math.sin(t * 9 + i) * 0.5;
        p.z += Math.cos(t * 7 + i) * 0.5;
        p.y = groundY(p.x, p.z) + 0.05 + (t > 0.85 ? (t - 0.85) * 8 : 0);
        return p;
      });
      scene.add(new THREE.Mesh(keep(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.02, 4)), lineMat));
    }
  }

  // ---- fire and smoke: sprite pools, all with random starting ages so the blaze is full from the first frame ----
  const fireTex = keep(blobTexture([[0, 'rgba(255,248,210,A)'], [0.3, 'rgba(255,170,50,A)'], [0.65, 'rgba(230,70,10,A)'], [1, 'rgba(120,20,0,0)']]));
  const smokeTex = keep(blobTexture([[0, 'rgba(255,255,255,A)'], [0.55, 'rgba(255,255,255,A)'], [1, 'rgba(255,255,255,0)']], 12));
  const wind = new THREE.Vector3(2.4, 0, -0.6);
  const fire = [];
  const smoke = [];
  const embers = [];
  const mk = (tex, additive) => {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: !additive });
    disposables.push(mat);
    const s = new THREE.Sprite(mat);
    scene.add(s);
    return s;
  };
  const origin = new THREE.Vector3(0.6, groundY(0, 0) + 0.9, 0.3);
  const respawnFire = (p, age) => {
    p.age = age; p.life = rr(0.7, 1.6); p.size = rr(1.6, 3.4);
    p.pos = origin.clone().add(new THREE.Vector3(rr(-1.4, 1.4), rr(-0.3, 0.8), rr(-1.4, 1.4)));
    p.vel = new THREE.Vector3(rr(-0.5, 0.5), rr(2, 4.5), rr(-0.5, 0.5));
    p.spin = rr(-1, 1);
  };
  const respawnSmoke = (p, age) => {
    p.age = age; p.life = rr(7, 12); p.size = rr(2.5, 4.5);
    p.pos = origin.clone().add(new THREE.Vector3(rr(-1.2, 1.2), rr(1.2, 2.4), rr(-1.2, 1.2)));
    p.vel = new THREE.Vector3(rr(-0.4, 0.4), rr(3.2, 5.5), rr(-0.4, 0.4));
    p.spin = rr(-0.3, 0.3);
    p.shade = rr(0, 1);
  };
  const respawnEmber = (p, age) => {
    p.age = age; p.life = rr(1.2, 3); p.size = rr(0.12, 0.3);
    p.pos = origin.clone().add(new THREE.Vector3(rr(-1, 1), rr(0.5, 2), rr(-1, 1)));
    p.vel = new THREE.Vector3(rr(-1.5, 2.5), rr(3, 8), rr(-1.5, 1.5));
    p.spin = 0;
  };
  for (let i = 0; i < 46; i += 1) { const p = { s: mk(fireTex, true) }; respawnFire(p, rnd() * 1.5); fire.push(p); }
  for (let i = 0; i < 110; i += 1) { const p = { s: mk(smokeTex, false) }; respawnSmoke(p, rnd() * 11); smoke.push(p); }
  for (let i = 0; i < 40; i += 1) { const p = { s: mk(fireTex, true) }; respawnEmber(p, rnd() * 2.5); embers.push(p); }
  const cFireYoung = new THREE.Color(0xffe39a), cFireOld = new THREE.Color(0xd8330a);
  const cSmokeA = new THREE.Color(0x0e0d0c), cSmokeB = new THREE.Color(0x70706c);
  const tmp = new THREE.Color();
  let time = 0;

  function step(list, dt, respawn, draw) {
    for (const p of list) {
      p.age += dt;
      if (p.age >= p.life) respawn(p, p.age - p.life);
      p.pos.addScaledVector(p.vel, dt);
      p.pos.addScaledVector(wind, dt * (list === smoke ? 0.9 : 0.25));
      p.vel.y *= 1 - 0.1 * dt;
      draw(p, p.age / p.life);
      p.s.position.copy(p.pos);
      p.s.material.rotation += p.spin * dt;
    }
  }
  const fadeNear = (p, lo, hi) => Math.min(1, Math.max(0, (p.pos.distanceTo(camera.position) - lo) / (hi - lo)));

  function simulate(dt) {
    time += dt;
    step(fire, dt, respawnFire, (p, u) => {
      p.s.scale.setScalar(p.size * (0.5 + 0.9 * Math.sin(Math.min(1, u * 1.2) * Math.PI * 0.8)) * (1 - 0.35 * u));
      p.s.material.opacity = Math.pow(1 - u, 1.1) * Math.min(1, u * 9) * 0.85 * fadeNear(p, 1.5, 5);
      p.s.material.color.copy(tmp.copy(cFireYoung).lerp(cFireOld, u));
    });
    step(smoke, dt, respawnSmoke, (p, u) => {
      p.s.scale.setScalar(p.size + u * 17);
      p.s.material.opacity = 0.78 * Math.min(1, u * 5) * Math.pow(1 - u, 0.9) * fadeNear(p, 4, 14);
      p.s.material.color.copy(tmp.copy(cSmokeA).lerp(cSmokeB, Math.min(1, u * 0.9 + p.shade * 0.25)));
    });
    step(embers, dt, respawnEmber, (p, u) => {
      p.s.scale.setScalar(p.size);
      p.s.material.opacity = (1 - u) * 0.95;
      p.s.material.color.setHex(0xffb040);
    });
    fireLight.intensity = 85 + 30 * Math.sin(time * 13) * Math.sin(time * 7.3) + 12 * Math.sin(time * 31);
  }
  simulate(0.001);

  // slow orbit around the wreck, a little higher and closer as it goes
  function placeCamera(u) {
    const ang = THREE.MathUtils.degToRad(-40 + 110 * u);
    const r = 17 - 3.5 * u;
    camera.position.set(Math.sin(ang) * r, groundY(0, r) + 2.4 + 2 * u, Math.cos(ang) * r);
    camera.lookAt(0.6, 4.2, 0);
  }
  placeCamera(0);

  return {
    scene,
    camera,
    sunDirection,
    /** dt seconds, u 0..1 through the shot (camera orbit). */
    update(dt, u) {
      if (dt > 0) simulate(dt);
      placeCamera(u);
    },
    dispose() {
      disposables.forEach((d) => d.dispose?.());
      scene.traverse((o) => { if (o.isInstancedMesh) o.dispose?.(); });
    },
  };
}
