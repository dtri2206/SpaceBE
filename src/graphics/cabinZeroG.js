// Zero-g dressing of the crew cabin (Role 3), in the style of the ISS and Shuttle middeck: grey-blue handrails on stand-offs,
// foot loops, Velcro, bungee cords, soft CTB stowage bags strapped to the walls and rails, a sleeping bag clipped to the wall of the crew
// corner, a laptop on an arm, checklists on bungees and a few loose items that drift when zeroG(true).
// createCabin() calls addZeroGDressing() once, before the static meshes are merged. Everything here is cabin-local (+Y up, floor y = 0).
import * as THREE from 'three';
import { pbr } from './interiors.js';
import { box, cyl, rod, place, sphere, torus, seeded, makeCanvas, canvasTexture, screen, MONO, drawSystems } from './cabinParts.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const FAR = 1.45; // loose items stay over the aisle

let cache = null;
function mats(m) {
  if (cache) return cache;
  const paper = (title, lines, seed) => {
    const c = makeCanvas(150, 210), g = c.getContext('2d');
    g.fillStyle = '#f2efe4'; g.fillRect(0, 0, 150, 210);
    g.fillStyle = '#26364d'; g.font = `700 14px ${MONO}`; g.textAlign = 'left'; g.fillText(title, 10, 22);
    g.fillRect(10, 28, 130, 2);
    const rnd = seeded(seed);
    g.font = `500 9px ${MONO}`;
    for (let i = 0; i < lines; i++) { g.fillStyle = '#3b3b3b'; g.fillRect(14, 42 + i * 14, 7, 7); g.fillStyle = '#7a7a7a'; g.fillRect(28, 44 + i * 14, 40 + rnd() * 80, 3); }
    return new THREE.MeshStandardMaterial({ map: canvasTexture(c), roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  };
  cache = {
    rail: pbr(0x5d7794, 0.42, 0.75),
    bungee: pbr(0x16181b, 0.9, 0),
    bungeeRed: pbr(0xb23a2c, 0.8, 0),
    hook: pbr(0xc9ccd0, 0.3, 0.95),
    bagWhite: pbr(0xe9e6dc, 0.95, 0),
    bagBeige: pbr(0xd9ceb4, 0.95, 0),
    pen: pbr(0x20406e, 0.5, 0.2),
    foil: pbr(0xc4622c, 0.45, 0.4),
    laptop: pbr(0x2b2f35, 0.5, 0.6),
    paperA: paper('PRE-SLEEP', 7, 1),
    paperB: paper('GALLEY', 6, 2),
    paperC: paper('EVA PREP', 8, 3),
    paperD: paper('SAMPLE LOG', 5, 4),
  };
  return cache;
}

/**
 * @param group the cabin group (static children still unmerged)
 * @param ctx { m, bag, label, anchors: [{name, box}], dims: { hw, hl, H, HX, HZ, HH, SHAFT, WALL_H } }
 * @returns { handrails, floatColliders, loose, zeroG, update }
 */
export function addZeroGDressing(group, ctx) {
  const { m, bag, label, anchors, dims } = ctx;
  const z = mats(m);
  const { hw, hl, H, HX, HZ, HH, SHAFT, WALL_H } = dims;
  const handrails = [];
  const add = (...o) => group.add(...o);

  // ---- handrails: 17 mm tube, stand-offs 70 mm to the surface (off = vector from the rail toward the surface)
  const rail = (a, b, off, { standoffs = 2, r = 0.017 } = {}) => {
    const A = V(...a), B = V(...b), O = V(...off);
    add(rod(a, b, r, z.rail, 10));
    const caps = [A, B];
    for (const p of caps) add(box(0.02, 0.02, 0.02, z.rail, p.x, p.y, p.z, 0.004));
    for (let i = 0; i < standoffs; i++) {
      const t = standoffs === 1 ? 0.5 : 0.06 + (0.88 * i) / (standoffs - 1);
      const p = A.clone().lerp(B, t), q = p.clone().add(O);
      add(rod(p.toArray(), q.toArray(), 0.0105, m.metal, 8));
      const plate = box(Math.abs(O.x) > 0.01 ? 0.012 : 0.06, Math.abs(O.y) > 0.01 ? 0.012 : 0.06, Math.abs(O.z) > 0.01 ? 0.012 : 0.06, m.dark, q.x, q.y, q.z, 0.002);
      add(plate);
    }
    handrails.push({ a: A.clone(), b: B.clone() });
  };

  // ceiling: a pair under every cross rib, off the light strip
  for (const zr of [-3.2, -1.6, 0, 1.6, 3.2]) {
    for (const [x0, x1] of [[0.4, 1.15], [-1.15, -0.4]]) {
      if (zr === 1.6 && x1 < 0 && x0 < -0.3 && false) continue;
      rail([x0, 2.42, zr], [x1, 2.42, zr], [0, 0.085, 0], { standoffs: 3 });
    }
  }
  // around the ceiling hatch: left side, front and back of the opening
  rail([HX - 0.58, 2.42, HZ - 0.4], [HX - 0.58, 2.42, HZ + 0.4], [0, 0.085, 0]);
  rail([HX - 0.3, 2.42, HZ - 0.62], [HX + 0.3, 2.42, HZ - 0.62], [0, 0.085, 0]);
  rail([HX - 0.3, 2.42, HZ + 0.62], [HX + 0.3, 2.42, HZ + 0.62], [0, 0.085, 0]);
  // wall rails in front of every wall station and rack (the face of its bounding box)
  const sideAnchors = anchors.filter((a) => !/suitLocker|bunk/.test(a.name)).filter((a) => Math.abs((a.box.min.x + a.box.max.x) / 2) > 1.3 && a.box.max.y - a.box.min.y > 0.5);
  sideAnchors.forEach((a, i) => {
    const left = (a.box.min.x + a.box.max.x) / 2 < 0;
    const face = left ? a.box.max.x : a.box.min.x;
    const zc = (a.box.min.z + a.box.max.z) / 2, half = Math.min(0.42, (a.box.max.z - a.box.min.z) / 2 - 0.08);
    if (half < 0.12) return;
    const y = i % 2 ? 1.62 : 1.9;
    const sx = left ? face + 0.1 : face - 0.1;
    rail([sx, y, zc - half], [sx, y, zc + half], [left ? -0.085 : 0.085, 0, 0]);
  });
  // airlock: a grab rail over the hatch
  rail([-0.55, 2.3, hl - 0.2], [0.55, 2.3, hl - 0.2], [0, 0, 0.085]);

  // ---- foot loops on the floor: plate + half ring, at the aisle edge opposite the stations and at the console and airlock
  const loop = (x, zz, rot = 0) => {
    add(box(0.12, 0.012, 0.07, m.dark, x, 0.006, zz, 0.003));
    const t = torus(0.045, 0.007, z.rail, x, 0.012, zz); t.rotation.set(0, rot, 0); t.scale.set(1, 1, 1);
    const ring = place(new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.007, 6, 14, Math.PI), z.rail), 0, rot, 0);
    ring.position.set(x, 0.012, zz);
    add(ring);
    add(box(0.018, 0.018, 0.018, m.metal, x - 0.045, 0.014, zz, 0.003), box(0.018, 0.018, 0.018, m.metal, x + 0.045, 0.014, zz, 0.003));
  };
  [[-1.05, -0.5], [-1.05, 0.8], [-1.05, 2.0], [1.05, -0.4], [1.05, 1.0], [1.05, 2.6], [-0.35, 3.0], [0.35, 3.0], [-0.55, -2.3], [0.55, -2.3], [-1.05, -1.6], [1.05, -2.0]].forEach(([x, zz]) => loop(x, zz));

  // ---- bungees: two crossing cords with hooks over a flat of width w x h at (x, y, z) facing the room (nx = +1 / -1 / 0, nz)
  const bungees = (c, w, h, face, color = z.bungee) => {
    // face: unit vector out of the surface; cords lie 8 mm in front
    const u = face.x ? V(0, 0, 1) : V(1, 0, 0), v = V(0, 1, 0);   // face along x: cords span z; along z: cords span x
    const C = V(...c).addScaledVector(face, 0.012);
    const pts = (a, b) => [C.clone().addScaledVector(u, a * w / 2).addScaledVector(v, b * h / 2), C.clone().addScaledVector(u, -a * w / 2).addScaledVector(v, -b * h / 2)];
    for (const [a, b] of [[1, 1], [1, -1]]) {
      const [p, q] = pts(a, b);
      add(rod(p.toArray(), q.toArray(), 0.0035, color, 5));
      for (const e of [p, q]) add(sphere(0.008, z.hook, e.x, e.y, e.z));
    }
  };

  // ---- CTB bags: strapped to the wall where it is free, hung from ceiling rails everywhere else
  const free = (left) => {
    const occ = anchors.filter((a) => ((a.box.min.x + a.box.max.x) / 2 < 0) === left && Math.abs((a.box.min.x + a.box.max.x) / 2) > 1.2).map((a) => [a.box.min.z - 0.05, a.box.max.z + 0.05]).sort((p, q) => p[0] - q[0]);
    const gaps = [];
    let cur = -hl + 0.3;
    for (const [a, b] of occ) { if (a - cur > 0.5) gaps.push([cur, a]); cur = Math.max(cur, b); }
    if (hl - 0.3 - cur > 0.5) gaps.push([cur, hl - 0.3]);
    return gaps;
  };
  const wallBag = (xwall, dirx, zc, y, w, hgt, d, mat, idx, tilt = 0) => {
    // bag back on the wall (x = xwall), thickness d into the room
    const x = xwall + dirx * (d / 2 + 0.01);
    const g = new THREE.Group();
    bag(g, m, mat, w, hgt, d, 0, 0, 0, idx);
    g.rotation.y = dirx > 0 ? Math.PI / 2 : -Math.PI / 2;
    g.rotation.z = tilt;
    g.position.set(x, y, zc);
    add(g);
    bungees([xwall + dirx * (d + 0.02), y, zc], w * 1.1, hgt * 1.1, V(dirx, 0, 0));
    add(box(0.025, 0.07, 0.025, z.hook, xwall + dirx * 0.03, y + hgt * 0.45, zc - w * 0.5 - 0.02, 0.003));
  };
  for (const left of [true, false]) {
    free(left).slice(0, 2).forEach(([a, b], k) => {
      const zc = (a + b) / 2, w = Math.min(0.62, b - a - 0.12);
      const xwall = left ? -hw + 0.1 : hw - 0.1, dirx = left ? 1 : -1;
      [0.42, 0.82, 1.22].forEach((y, i) => wallBag(xwall, dirx, zc + (i % 2 ? 0.04 : -0.03), y, w, 0.34, 0.3, i % 2 ? z.bagWhite : z.bagBeige, (k * 5 + i * 3 + (left ? 1 : 4)) % 24));
    });
  }
  // stowage bags strapped to the aft wall either side of the airlock
  const aftBag = (x, y, w, hgt, d, mat, idx) => {
    const g = new THREE.Group();
    bag(g, m, mat, w, hgt, d, 0, 0, 0, idx);
    g.rotation.y = Math.PI;
    g.position.set(x, y, hl - d / 2 - 0.01);
    add(g);
    bungees([x, y, hl - d - 0.02], w * 1.1, hgt * 1.1, V(0, 0, -1));
    patchAft(x + w * 0.36, y + hgt * 0.6);
  };
  const patchAft = (x, y) => add(box(0.075, 0.075, 0.008, m.velcro, x, y, hl - 0.006, 0.001));
  [0.35, 0.75, 1.15].forEach((y, i) => aftBag(-1.45, y, 0.62, 0.34, 0.3, i % 2 ? z.bagWhite : z.bagBeige, (i * 7 + 3) % 24));
  [0.3, 0.62].forEach((y, i) => aftBag(1.45, y, 0.55, 0.28, 0.26, i % 2 ? z.bagBeige : z.bagWhite, (i * 5 + 9) % 24));
  // bags clipped under four ceiling rails (strap loops round the tube, two carabiners)
  [[0.78, -3.2], [-0.78, -1.6], [0.78, 0], [-0.78, 3.2]].forEach(([x, zr], i) => {
    const g = new THREE.Group();
    bag(g, m, i % 2 ? z.bagWhite : z.bagBeige, 0.5, 0.2, 0.3, 0, 0, 0, (i * 5 + 2) % 24);
    g.rotation.x = Math.PI / 2; g.rotation.y = 0;
    g.position.set(x, 2.42 - 0.14, zr);
    add(g);
    for (const dx of [-0.17, 0.17]) { add(box(0.035, 0.1, 0.012, m.strap, x + dx, 2.42 - 0.04, zr, 0.003), box(0.02, 0.03, 0.02, z.hook, x + dx, 2.42 - 0.005, zr, 0.004)); }
  });

  // ---- Velcro patches next to the rails and on the bags' wall mounts
  const patch = (x, y, zz, face) => {
    const p = box(face.x ? 0.008 : 0.075, 0.075, face.x ? 0.075 : 0.008, m.velcro, x, y, zz, 0.001);
    add(p);
  };
  for (const left of [true, false]) {
    const xs = left ? -hw + 0.012 : hw - 0.012, fx = V(left ? 1 : -1, 0, 0);
    [-3.65, -2.9, 3.78].forEach((zz) => patch(xs, 1.0, zz, fx));
  }
  for (let i = 0; i < 6; i++) patch(-0.9 + i * 0.36, 2.58, 3.0 + (i % 2) * 0.5, V(0, 1, 0)), 0;

  // ---- sleeping bag clipped vertically to the front wall beside the bunk (crew corner)
  {
    const x = -1.58, zw = -hl + 0.17;
    const sb = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 1.34, 6, 16), m.sleepBag);
    sb.position.set(x, 1.22, zw); sb.scale.set(1, 1, 0.75);
    add(sb);
    for (const y of [0.78, 1.22, 1.66]) {
      add(box(0.34, 0.045, 0.2, m.strap, x, y, zw + 0.01, 0.006), box(0.04, 0.06, 0.03, m.metal, x, y, zw + 0.12, 0.004), box(0.05, 0.03, 0.04, z.hook, x + 0.2, y, -hl + 0.05, 0.004));
      add(rod([x - 0.2, y, -hl + 0.03], [x + 0.2, y, -hl + 0.03], 0.012, m.metal, 6));
    }
    add(box(0.12, 0.08, 0.05, m.strap, x, 1.92, zw - 0.02, 0.01), box(0.28, 0.01, 0.01, m.metal, x, 1.9, zw + 0.1, 0));
    add(box(0.075, 0.075, 0.008, m.velcro, x - 0.22, 1.5, -hl + 0.006, 0.001));
  }

  // ---- laptop on an articulated arm hung from the ceiling over the aisle at the comms console
  {
    const base = V(0.98, 2.56, -1.3);
    add(box(0.14, 0.02, 0.14, m.dark, base.x, base.y, base.z, 0.004), cyl(0.03, 0.05, m.metal, base.x, base.y - 0.03, base.z));
    const elbow = V(0.98, 2.05, -1.3), wrist = V(0.72, 1.95, -1.3);
    add(rod(base.toArray(), elbow.toArray(), 0.016, m.paintGrey, 8), sphere(0.03, m.metal, elbow.x, elbow.y, elbow.z));
    add(rod(elbow.toArray(), wrist.toArray(), 0.014, m.paintGrey, 8), sphere(0.025, m.metal, wrist.x, wrist.y, wrist.z));
    const lap = new THREE.Group();
    lap.position.set(0.62, 1.93, -1.3);
    lap.rotation.set(0, Math.PI / 2, 0.0);
    lap.add(box(0.32, 0.016, 0.23, z.laptop, 0, 0, 0, 0.004), box(0.3, 0.003, 0.2, m.dark, 0, 0.009, 0, 0));
    const lid = new THREE.Group();
    lid.position.set(0, 0.008, -0.115); lid.rotation.x = -1.95;
    lid.add(box(0.32, 0.01, 0.22, z.laptop, 0, 0, 0.11, 0.004));
    const scr = screen(0.29, 0.19, drawSystems, 1.1);
    scr.rotation.x = Math.PI / 2; scr.position.set(0, -0.006, 0.11); scr.rotation.y = Math.PI; scr.rotation.z = 0;
    lid.add(scr);
    lap.add(lid);
    // the arm clamps the laptop's back edge
    add(lap, box(0.1, 0.04, 0.04, m.paintGrey, wrist.x - 0.02, wrist.y - 0.0, wrist.z, 0.006));
    add(rod(wrist.toArray(), [0.62, 1.93, -1.3], 0.012, m.paintGrey, 6));
  }

  // ---- checklists on bungees, beside four stations
  const cards = [z.paperA, z.paperB, z.paperC, z.paperD];
  sideAnchors.slice(0, 4).forEach((a, i) => {
    const left = (a.box.min.x + a.box.max.x) / 2 < 0;
    const face = left ? a.box.max.x : a.box.min.x;
    const zc = (a.box.min.z + a.box.max.z) / 2 + 0.38 * (i % 2 ? -1 : 1);
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.21), cards[i % 4]);
    card.rotation.y = left ? Math.PI / 2 : -Math.PI / 2;
    card.position.set(left ? face + 0.045 : face - 0.045, 1.4, zc);
    card.rotation.z = (i - 1.5) * 0.03;
    add(card);
    const nx = left ? 1 : -1;
    bungees([face + nx * 0.02, 1.4, zc], 0.2, 0.26, V(nx, 0, 0));
  });

  // ---- loose items (separate meshes: they move). Homes are on the consoles; zeroG(true) lets them drift over the aisle.
  const loose = [];
  const item = (name, mesh, home, rot = [0, 0, 0], spin = 1) => {
    mesh.name = `loose:${name}`;
    mesh.userData.dynamic = true;
    mesh.position.set(...home);
    mesh.rotation.set(...rot);
    mesh.userData.home = { p: V(...home), q: mesh.quaternion.clone() };
    mesh.userData.spin = spin;
    group.add(mesh);
    loose.push(mesh);
  };
  const penGeo = new THREE.CylinderGeometry(0.0065, 0.0065, 0.15, 8);
  const pen = new THREE.Mesh(penGeo, z.pen);
  pen.add(box(0.004, 0.05, 0.012, m.metal, 0.008, 0.04, 0, 0.001));
  item('pen', pen, [1.6, 0.797, -1.0], [Math.PI / 2, 0, 0.3], 1.4);
  const cardMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.21), z.paperA);
  item('checklistCard', cardMesh, [1.52, 0.789, -1.45], [-Math.PI / 2, 0, 0.5], 1.0);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.19), m.foilB);
  pack.add(box(0.1, 0.004, 0.1, m.labels, 0, 0.0165, 0, 0));
  item('foodPacket', pack, [1.66, 0.815, 0.62], [0, 0.4, 0], 0.8);
  const smallBag = new THREE.Group();
  smallBag.add(box(0.2, 0.09, 0.14, z.bagBeige, 0, 0, 0, 0.03), box(0.2, 0.012, 0.01, m.strap, 0, 0.02, 0.071, 0.002), box(0.05, 0.015, 0.012, m.velcro, 0, 0.0, 0.074, 0.001));
  item('smallBag', smallBag, [-1.38, 0.605, -2.2], [0, -0.3, 0], 0.7);

  // ---- zero-g state: float (drift, tumble, bounce softly in the aisle) <-> settle (fall back to the home pose)
  let mode = 'rest';
  const rnd = seeded(77);
  const st = loose.map(() => ({ v: new THREE.Vector3(), w: new THREE.Vector3(), t: 0 }));
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _d = new THREE.Vector3();
  let last = 0;
  const zeroG = (on = true) => {
    if (on === (mode === 'float')) return mode === 'float';
    mode = on ? 'float' : 'settle';
    loose.forEach((o, i) => {
      const s = st[i];
      s.t = 0;
      if (on) {
        const dir = Math.sign(-o.position.x) || 1;
        s.v.set(dir * (0.04 + rnd() * 0.05), 0.05 + rnd() * 0.04, (rnd() - 0.5) * 0.1);
        s.w.set((rnd() - 0.5) * 0.9, (rnd() - 0.5) * 0.9, (rnd() - 0.5) * 0.9).multiplyScalar(o.userData.spin);
      } else {
        s.v.set(0, 0, 0); s.w.set(0, 0, 0);
      }
    });
    return on;
  };
  const update = (dt) => {
    if (mode === 'rest') return;
    dt = Math.min(0.1, dt);
    loose.forEach((o, i) => {
      const s = st[i], h = o.userData.home;
      if (mode === 'float') {
        // a small push away from the console at the start, then constant drift; soft bounces off the aisle limits
        o.position.addScaledVector(s.v, dt);
        _e.set(s.w.x * dt, s.w.y * dt, s.w.z * dt);
        o.quaternion.premultiply(_q.setFromEuler(_e));
        const lim = [[-FAR, FAR], [0.3, 2.25], [-3.4, 3.4]];
        ['x', 'y', 'z'].forEach((ax, k) => {
          if (o.position[ax] < lim[k][0]) { o.position[ax] = lim[k][0]; s.v[ax] = Math.abs(s.v[ax]) * 0.6; }
          if (o.position[ax] > lim[k][1]) { o.position[ax] = lim[k][1]; s.v[ax] = -Math.abs(s.v[ax]) * 0.6; }
        });
      } else {
        // gravity pulls it back to where it lives, spinning down onto the home orientation
        s.t += dt;
        s.v.y -= 3.7 * dt;
        _d.copy(h.p).sub(o.position);
        o.position.x += _d.x * Math.min(1, dt * 2.2);
        o.position.z += _d.z * Math.min(1, dt * 2.2);
        o.position.y += s.v.y * dt;
        if (o.position.y <= h.p.y) { o.position.y = h.p.y; s.v.y = 0; }
        o.quaternion.slerp(h.q, Math.min(1, dt * 3));
        if (s.t > 2.5) { o.position.copy(h.p); o.quaternion.copy(h.q); }
      }
    });
    if (mode === 'settle' && loose.every((o, i) => st[i].t > 2.5)) mode = 'rest';
  };

  // ---- float colliders (cabin-local boxes): shell, ceiling around the hatch, hatch shaft + passage, and every station / rack / prop
  const bx = (a, b, c, d, e, f) => ({ min: V(a, b, c), max: V(d, e, f) });
  const x0 = HX - HH, x1 = HX + HH, z0 = HZ - HH, z1 = HZ + HH;
  const colliders = [
    bx(-hw - 0.5, -0.5, -hl - 0.5, hw + 0.5, 0, hl + 0.5),                    // floor
    bx(-hw - 0.5, 0, -hl - 0.5, -hw, 3.1, hl + 0.5), bx(hw, 0, -hl - 0.5, hw + 0.5, 3.1, hl + 0.5),         // side walls
    bx(-hw, 0, -hl - 0.5, hw, 3.1, -hl), bx(-hw, 0, hl, hw, 3.1, hl + 0.5),                                  // end walls
    bx(-hw, H, -hl, x0, H + 0.5, hl), bx(x1, H, -hl, hw, H + 0.5, hl), bx(x0, H, -hl, x1, H + 0.5, z0), bx(x0, H, z1, x1, H + 0.5, hl), // ceiling with the hatch opening
    bx(-hw, WALL_H, -hl, -1.55, H, hl), bx(1.55, WALL_H, -hl, hw, H, hl),                                     // chamfers
    bx(x0 - 0.03, H, z0 - 0.03, x1 + 0.03, H + SHAFT + 1.4, z0), bx(x0 - 0.03, H, z1, x1 + 0.03, H + SHAFT + 1.4, z1 + 0.03),   // hatch shaft and passage (square envelope)
    bx(x0 - 0.03, H, z0, x0, H + SHAFT + 1.4, z1), bx(x1, H, z0, x1 + 0.03, H + SHAFT + 1.4, z1),
  ];
  for (const a of anchors) {
    const b = a.box;
    if (b.max.y - b.min.y < 0.3) continue;
    colliders.push({ min: b.min.clone().addScalar(0.02), max: b.max.clone().addScalar(-0.02) });
  }

  return { handrails, floatColliders: colliders, loose, zeroG, update, isFloating: () => mode === 'float' };
}
