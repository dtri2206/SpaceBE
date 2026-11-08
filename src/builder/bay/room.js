// The round integration hall: floor, walls, trusses, catwalk, lights, hangar door, service tower and props.
// Geometry is procedural; surfaces use the Poly Haven PBR sets when present (bay/loader.js), plain colours otherwise.
import * as THREE from 'three';
import { loadEnvironment, loadProp, pbrMaterial } from './loader.js';
import { nasaProp } from './nasa.js';
import { DEG, box, canvasTexture, cylinder, glow, polar, shadowed, std, tube } from './util.js';

export const HALL = Object.freeze({
  radius: 17, // inner wall radius (m)
  height: 15, // wall height (m)
  pitRadius: 6, // raised integration platform
  platformHeight: 0.35,
  doorAngle: 180, // hangar door
  screenAngle: 0, // the big wall screen
  catwalkHeight: 6.5,
});

const STEEL = std(0x8d939a, { roughness: 0.45, metalness: 0.85 });
const DARK_STEEL = std(0x2b3137, { roughness: 0.55, metalness: 0.7 });
const YELLOW = std(0xf2b53a, { roughness: 0.6, metalness: 0.2 });
const CYAN_GLOW = glow(0x67e8f9, 2.2);
const WHITE_GLOW = glow(0xf4f9ff, 1.8);

function hazardStripeTexture() {
  const { texture, redraw } = canvasTexture(256, 64);
  redraw((ctx, w, h) => {
    ctx.fillStyle = '#f2b53a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#111';
    for (let x = -h; x < w + h; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 32 - h, h); ctx.lineTo(x - h, h); ctx.closePath();
      ctx.fill();
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(6, 1);
  return texture;
}

function wallDecal(text, sub) {
  const { texture, redraw } = canvasTexture(1024, 256);
  redraw((ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = '700 120px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, w / 2, 130);
    ctx.font = '500 44px "IBM Plex Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(sub, w / 2, 200);
  });
  return texture;
}

/** Builds the hall into `scene`. Returns { group, ready (promise of props), props, platformHeight, hall }. */
export function createRoom(scene) {
  const { radius: R, height: H, pitRadius, platformHeight } = HALL;
  const group = new THREE.Group();
  group.name = 'hall';
  scene.add(group);

  // ----- floor and platform -----
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R + 0.5, 96), std(0x6b6d6b, { roughness: 0.9, metalness: 0.05 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(pitRadius, pitRadius + 0.25, platformHeight, 96), std(0x25292d, { roughness: 0.85, metalness: 0.1 }));
  platform.position.y = platformHeight / 2;
  platform.receiveShadow = true;
  platform.castShadow = true;
  group.add(platform);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(pitRadius + 0.26, pitRadius + 0.26, 0.12, 96, 1, true), new THREE.MeshStandardMaterial({ map: hazardStripeTexture(), roughness: 0.7 }));
  band.position.y = platformHeight - 0.06;
  group.add(band);
  const ringLine = new THREE.Mesh(new THREE.RingGeometry(pitRadius + 0.6, pitRadius + 0.72, 96), std(0xf2b53a, { roughness: 0.8 }));
  ringLine.rotation.x = -Math.PI / 2;
  ringLine.position.y = 0.005;
  group.add(ringLine);
  for (const r of [12.6, 12.75]) {
    const lane = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.06, 128), std(0xdedede, { roughness: 0.8 }));
    lane.rotation.x = -Math.PI / 2;
    lane.position.y = 0.004;
    group.add(lane);
  }
  const trench = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 1.6, 2.2, 48, 1, true), std(0x15181b, { roughness: 0.95, side: THREE.DoubleSide }));
  trench.position.y = platformHeight - 1.1;
  group.add(trench);
  const grate = new THREE.Mesh(new THREE.RingGeometry(2.4, 3.1, 48), std(0x3a4046, { roughness: 0.6, metalness: 0.8 }));
  grate.rotation.x = -Math.PI / 2;
  grate.position.y = platformHeight + 0.01;
  group.add(grate);

  // railing around the platform, with gaps for the two stairs
  const gap = (a) => (a > 80 && a < 100) || (a > 260 && a < 280);
  for (let a = 0; a < 360; a += 10) {
    if (gap(a)) continue;
    const p = polar(a, pitRadius + 0.1, platformHeight);
    group.add(cylinder(0.03, 0.03, 1.05, STEEL, { x: p.x, y: platformHeight + 0.52, z: p.z }));
    if (gap(a + 10)) continue;
    const q = polar(a + 10, pitRadius + 0.1, platformHeight);
    for (const y of [0.5, 1.02]) group.add(tube([p.x, platformHeight + y, p.z], [q.x, platformHeight + y, q.z], 0.022, STEEL, 6));
  }
  for (const a of [90, 270]) {
    const stair = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const step = box(2.2, 0.12, 0.42, DARK_STEEL, { y: (i + 1) * (platformHeight / 3) - 0.06, z: 0.42 * (2 - i) });
      step.castShadow = step.receiveShadow = true;
      stair.add(step);
    }
    stair.position.copy(polar(a, pitRadius + 0.9, 0));
    stair.rotation.y = -a * DEG + Math.PI / 2;
    group.add(stair);
  }

  // ----- walls -----
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 96, 1, true), std(0x7c838a, { roughness: 0.55, metalness: 0.6, side: THREE.BackSide }));
  wall.position.y = H / 2;
  wall.receiveShadow = true;
  group.add(wall);
  for (let a = 0; a < 360; a += 15) {
    const p = polar(a, R - 0.18, H / 2);
    const rib = box(0.36, H, 0.36, DARK_STEEL, { x: p.x, y: H / 2, z: p.z });
    rib.rotation.y = -a * DEG;
    rib.castShadow = rib.receiveShadow = true;
    group.add(rib);
  }
  const bandMesh = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.05, R - 0.05, 1.1, 96, 1, true), std(0x2d5fa8, { roughness: 0.5, metalness: 0.4, side: THREE.BackSide }));
  bandMesh.position.y = 3.2;
  group.add(bandMesh);
  const skirting = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.03, R - 0.03, 0.5, 96, 1, true), std(0x1e2327, { roughness: 0.7, side: THREE.BackSide }));
  skirting.position.y = 0.25;
  group.add(skirting);
  for (const a of [97.5, 277.5]) { // between two ribs, so no column cuts the letters
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: wallDecal('INTEGRATION HALL 1', 'VEHICLE ASSEMBLY · PAD 39A'), transparent: true }));
    decal.position.copy(polar(a, R - 0.3, 3.2));
    decal.lookAt(0, 3.2, 0);
    group.add(decal);
  }

  // ----- hangar door -----
  {
    const door = new THREE.Group();
    const leaf = std(0x5b6269, { roughness: 0.5, metalness: 0.75 });
    for (const dx of [-3.1, 3.1]) {
      const panel = box(6, 11.5, 0.3, leaf, { x: dx, y: 5.75 });
      panel.castShadow = panel.receiveShadow = true;
      door.add(panel);
      for (let i = 1; i < 6; i++) door.add(box(5.8, 0.06, 0.34, DARK_STEEL, { x: dx, y: i * 1.9 }));
    }
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(12.4, 0.5), new THREE.MeshStandardMaterial({ map: hazardStripeTexture(), roughness: 0.7 }));
    stripe.position.set(0, 0.3, 0.17);
    door.add(stripe);
    const lintel = box(13, 0.8, 0.9, DARK_STEEL, { y: 11.9 });
    lintel.castShadow = true;
    door.add(lintel);
    door.add(cylinder(0.25, 0.25, 0.3, new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2200, emissiveIntensity: 1.5 }), { y: 12.5, z: 0.3 }));
    door.position.copy(polar(HALL.doorAngle, R - 0.55, 0));
    door.lookAt(0, 0, 0);
    group.add(door);
  }

  // ----- catwalk ring -----
  let catwalk = null;
  {
    const y = HALL.catwalkHeight;
    const walk = new THREE.Mesh(new THREE.RingGeometry(R - 2.2, R - 0.4, 96), std(0x3a4046, { roughness: 0.6, metalness: 0.8, side: THREE.DoubleSide }));
    walk.rotation.x = -Math.PI / 2;
    walk.position.y = y;
    walk.receiveShadow = true;
    group.add(walk);
    catwalk = walk;
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(R - 2.2, R - 2.2, 0.25, 96, 1, true), YELLOW);
    lip.material.side = THREE.DoubleSide;
    lip.position.y = y - 0.12;
    group.add(lip);
    for (let a = 0; a < 360; a += 7.5) {
      const p = polar(a, R - 2.15, y);
      group.add(cylinder(0.025, 0.025, 1.1, STEEL, { x: p.x, y: y + 0.55, z: p.z }));
      const q = polar(a + 7.5, R - 2.15, y);
      group.add(tube([p.x, y + 1.08, p.z], [q.x, y + 1.08, q.z], 0.02, STEEL, 6));
      group.add(tube([p.x, y + 0.6, p.z], [q.x, y + 0.6, q.z], 0.015, STEEL, 6));
    }
    for (let a = 0; a < 360; a += 30) {
      const p = polar(a, R - 1.3, y - 0.6);
      const br = box(0.2, 1.2, 1.8, DARK_STEEL, { x: p.x, y: y - 0.6, z: p.z });
      br.rotation.y = -a * DEG;
      group.add(br);
    }
  }

  // ----- ceiling -----
  {
    const y = H - 0.6;
    for (let a = 0; a < 360; a += 30) {
      const p = polar(a, R / 2, y);
      const beam = box(R - 0.5, 0.9, 0.5, DARK_STEEL, { x: p.x, y, z: p.z });
      beam.rotation.y = -a * DEG;
      beam.castShadow = true;
      group.add(beam);
    }
    const hub = new THREE.Mesh(new THREE.TorusGeometry(3.5, 0.3, 8, 48), DARK_STEEL);
    hub.rotation.x = Math.PI / 2;
    hub.position.y = y;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R - 2.5, 0.35, 8, 96), DARK_STEEL);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    const ceiling = new THREE.Mesh(new THREE.CircleGeometry(R + 0.5, 96), std(0x1b1f23, { roughness: 0.95, side: THREE.BackSide }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = H;
    group.add(hub, ring, ceiling);
    for (let a = 15; a < 360; a += 30) {
      const p = polar(a, R - 4.5, y - 0.6);
      group.add(cylinder(0.55, 0.65, 0.35, DARK_STEEL, { x: p.x, y: p.y, z: p.z }), cylinder(0.5, 0.5, 0.04, WHITE_GLOW, { x: p.x, y: p.y - 0.19, z: p.z }));
    }
    for (let a = 0; a < 360; a += 60) {
      const p = polar(a, 5.5, y - 0.6);
      group.add(cylinder(0.45, 0.55, 0.3, DARK_STEEL, { x: p.x, y: p.y, z: p.z }), cylinder(0.4, 0.4, 0.04, WHITE_GLOW, { x: p.x, y: p.y - 0.17, z: p.z }));
    }
  }

  // ----- pipes and cable trays -----
  {
    const pipeMat = std(0x9aa3ab, { roughness: 0.35, metalness: 0.9 });
    const trayMat = std(0x4a5157, { roughness: 0.6, metalness: 0.6 });
    for (const [r, y, rad] of [[R - 0.6, 9.5, 0.12], [R - 0.9, 9.9, 0.16], [R - 0.6, 10.3, 0.08]]) {
      const pipe = new THREE.Mesh(new THREE.TorusGeometry(r, rad, 8, 128, Math.PI * 1.55), pipeMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.rotation.z = 0.35;
      pipe.position.y = y;
      group.add(pipe);
    }
    const tray = new THREE.Mesh(new THREE.TorusGeometry(R - 0.7, 0.22, 4, 128, Math.PI * 1.9), trayMat);
    tray.rotation.x = Math.PI / 2;
    tray.position.y = 4.4;
    group.add(tray);
    for (let a = 10; a < 360; a += 40) {
      const p = polar(a, R - 0.5, 0);
      group.add(tube([p.x, 0.5, p.z], [p.x, 4.3, p.z], 0.05, pipeMat, 8));
    }
  }

  // ----- lighting -----
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x1a1a1a, 0.55);
  const key = new THREE.SpotLight(0xf4f9ff, 2200, 60, Math.PI / 4.5, 0.6, 2);
  key.position.set(6, H - 1.5, 8);
  key.target.position.set(0, 4, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const key2 = new THREE.SpotLight(0xdbe8ff, 1400, 60, Math.PI / 4, 0.7, 2);
  key2.position.set(-8, H - 1.5, -5);
  key2.target.position.set(0, 3, 0);
  key2.castShadow = true;
  key2.shadow.mapSize.set(1024, 1024);
  key2.shadow.bias = -0.0004;
  group.add(hemi, key, key.target, key2, key2.target);
  for (let a = 15; a < 360; a += 60) {
    const pl = new THREE.PointLight(0xf4f9ff, 260, 30, 2);
    pl.position.copy(polar(a, R - 4.5, H - 2));
    group.add(pl);
  }
  scene.fog = new THREE.Fog(0x0b0f14, 45, 110);
  scene.background = new THREE.Color(0x0b0f14);

  // ----- async: PBR materials, environment, props -----
  const props = { shelves: [], desk: null, toolChest: null, extinguisher: null, crates: [] };
  const obstacles = []; // { x, z, r } the player walks around (read live by bay/player.js)
  const ready = (async () => {
    const [floorMat, platMat, wallMat, walkMat, env] = await Promise.all([
      pbrMaterial('hangar_concrete_floor', { repeat: [9, 9], fallbackColor: 0x6b6d6b, roughness: 0.9 }),
      pbrMaterial('rubber_tiles', { repeat: [7, 7], fallbackColor: 0x25292d, roughness: 0.85 }),
      pbrMaterial('blue_metal_plate', { repeat: [40, 6], fallbackColor: 0x7c838a, roughness: 0.55, metalness: 0.6 }),
      pbrMaterial('metal_plate', { repeat: [48, 2], fallbackColor: 0x3a4046, roughness: 0.5, metalness: 0.8 }),
      loadEnvironment('small_hangar_01'),
    ]);
    floor.material = floorMat;
    platform.material = platMat;
    wallMat.side = THREE.BackSide;
    wallMat.color.set(0xb9bec4); // painted panels, greyed: the blue stays on the band
    wall.material = wallMat;
    walkMat.side = THREE.DoubleSide;
    catwalk.material = walkMat;
    if (env) {
      scene.environment = env;
      scene.environmentIntensity = 0.55;
    }
    const place = async (name, deg, r, { yaw = 0, scale = 1, y = 0 } = {}) => {
      const obj = await loadProp(name);
      if (!obj) return null;
      obj.position.copy(polar(deg, r, y));
      obj.rotation.y = -deg * DEG + Math.PI / 2 + yaw;
      obj.scale.setScalar(scale);
      group.add(obj);
      return obj;
    };
    for (const deg of [212, 222, 232, 242]) {
      const s = await place('steel_frame_shelves_01', deg, R - 1.6, { yaw: Math.PI });
      if (s) props.shelves.push(s);
    }
    for (const [deg, r, yaw] of [[218, R - 3.2, 0.4], [236, R - 3.4, -0.3], [228, R - 2.6, 1.2], [205, R - 2.9, 0.2]]) {
      const c = await place('old_military_crate', deg, r, { yaw });
      if (c) props.crates.push(c);
    }
    props.desk = await place('metal_office_desk', 150, R - 2.3, { yaw: Math.PI });
    props.toolChest = await place('metal_tool_chest', 66, R - 2.2, { yaw: Math.PI });
    props.extinguisher = await place('korean_fire_extinguisher_01', 165, R - 0.75);
    // the trades' real equipment: welding and tool carts by propulsion, a vice bench and ladder by structures,
    // a generator and gas bottles by the test console, storage carts and barrels by the warehouse
    await place('portable_welding_cart', 46, R - 3.0, { yaw: 0.6 });
    await place('tool_cart', 58, R - 3.6, { yaw: -0.4 });
    await place('bench_vice_01', 110, R - 2.4, { yaw: Math.PI });
    await place('ladder_sectioned_01', 98, R - 1.2, { yaw: 0.2 });
    await place('portable_generator', 296, R - 3.2, { yaw: 0.9 });
    await place('propane_tank', 312, R - 2.4, { yaw: 0 });
    await place('industrial_storage_cart', 250, R - 3.0, { yaw: 0.3 });
    await place('barrel_03', 204, R - 2.2, { yaw: 0 });
    await place('plastic_crate_01', 238, R - 4.4, { yaw: 0.8 });
    await place('drawer_cabinet', 160, R - 1.4, { yaw: Math.PI });
    await place('metal_stool_01', 146, R - 3.4, { yaw: 1.2 });

    // ----- real NASA hardware around the stations (public domain, github.com/nasa/NASA-3D-Resources) -----
    // Models are normalised to stand on y = 0 at a real-world height; their fronts face -z, so yaw 0 looks at the hall centre.
    const pedestal = (deg, r, w, hgt, d, material = DARK_STEEL) => {
      const m = box(w, hgt, d, material, { y: hgt / 2 });
      m.position.add(polar(deg, r, 0));
      m.rotation.y = -deg * DEG + Math.PI / 2;
      m.castShadow = m.receiveShadow = true;
      group.add(m);
      return m;
    };
    const placeNasa = async (slug, cfg, height, deg, r, { yaw = 0, y = 0, collider = 0 } = {}) => {
      const obj = await nasaProp(slug, cfg, height);
      if (!obj) return null;
      obj.position.copy(polar(deg, r, y));
      obj.rotation.y = -deg * DEG + Math.PI / 2 + yaw;
      group.add(obj);
      if (collider) obstacles.push({ x: obj.position.x, z: obj.position.z, r: collider });
      return obj;
    };
    // propulsion workshop: a Space Shuttle main engine on a yellow transport dolly
    {
      const deg = 78, r = 13.0;
      pedestal(deg, r, 2.3, 0.22, 2.3, YELLOW);
      for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
        const wheel = cylinder(0.14, 0.14, 0.1, std(0x1b1d1f, { roughness: 0.9 }), { x: dx, y: 0.14, z: dz });
        wheel.rotation.z = Math.PI / 2;
        const p = polar(deg, r, 0);
        wheel.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), -deg * DEG + Math.PI / 2).add(p);
        group.add(wheel);
      }
      await placeNasa('shuttle_engines', { up: 'x', tint: 0x9aa0a6, forceTint: true, metalness: 0.75, roughness: 0.38 }, 3.2, deg, r, { y: 0.22, collider: 1.4 });
    }
    // crew systems lab: Robonaut 2 and the suits the crew will wear
    pedestal(167, 9.7, 1.0, 0.12, 1.0);
    await placeNasa('robonaut', { up: 'y', roughness: 0.45, metalness: 0.3 }, 2.2, 167, 9.7, { y: 0.12, collider: 0.7 });
    await placeNasa('mark3_suit', { up: 'y' }, 1.95, 141, R - 1.4, { collider: 0.5 });
    await placeNasa('astronaut', { up: 'y' }, 1.9, 134, R - 1.4, { yaw: Math.PI, collider: 0.5 });
    await placeNasa('aces_suit', { up: 'y', roughness: 0.6 }, 1.85, 127, R - 1.4, { collider: 0.5 });
    // the Mars helicopter on a work table near the structures bay
    {
      const deg = 136, r = 12.4;
      pedestal(deg, r, 1.5, 0.78, 0.9, std(0x3a4046, { roughness: 0.5, metalness: 0.7 }));
      await placeNasa('ingenuity', { up: 'y' }, 0.5, deg, r, { y: 0.78, collider: 0.9 });
    }
    // warehouse: a stowed spacecraft (Mars Global Surveyor, folded for launch) on a pallet, and cubesats on the crates
    pedestal(214, 11.6, 1.6, 0.14, 1.3, YELLOW);
    await placeNasa('mgs_launch', { up: 'long', tint: 0xcfd3d8 }, 1.6, 214, 11.6, { y: 0.14, yaw: 0.5, collider: 1.0 });
    for (const [i, slug] of [['0', 'cubesat2'], ['1', 'cubesat1']]) {
      const crate = props.crates[+i];
      if (!crate) continue;
      const top = new THREE.Box3().setFromObject(crate).max.y;
      const sat = await nasaProp(slug, { up: 'y', tint: 0xb9bec4 }, 0.3);
      if (!sat) continue;
      sat.position.set(crate.position.x, top, crate.position.z);
      sat.rotation.y = crate.rotation.y + 0.4;
      group.add(sat);
    }
    // test conductor: a scale model of the mobile launcher on a display stand
    pedestal(318, R - 2.0, 1.1, 0.5, 1.1);
    await placeNasa('mobile_launcher', { up: 'y' }, 1.8, 318, R - 2.0, { y: 0.5, collider: 0.8 });
    return props;
  })();

  return { group, ready, props, obstacles, platformHeight, hall: HALL };
}

/** The hold-down stand and service tower the vehicle sits on. */
export function createStand(scene, { radiusHint = 1.7 } = {}) {
  const g = new THREE.Group();
  g.name = 'stand';
  const y0 = HALL.platformHeight;
  const base = cylinder(radiusHint + 1.6, radiusHint + 1.8, 0.3, std(0x30363c, { roughness: 0.6, metalness: 0.7 }), { y: y0 + 0.15 });
  base.castShadow = base.receiveShadow = true;
  g.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radiusHint + 1.5, 0.035, 8, 64), CYAN_GLOW);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = y0 + 0.31;
  g.add(ring);
  for (let a = 45; a < 360; a += 90) {
    const p = polar(a, radiusHint + 0.9, y0 + 0.3);
    const clamp = box(0.5, 0.9, 0.5, YELLOW, { x: p.x, y: y0 + 0.75, z: p.z });
    clamp.rotation.y = -a * DEG;
    clamp.castShadow = true;
    const arm = box(0.9, 0.18, 0.3, DARK_STEEL, { x: p.x * 0.72, y: y0 + 1.15, z: p.z * 0.72 });
    arm.rotation.y = -a * DEG;
    g.add(clamp, arm);
  }
  const tower = new THREE.Group();
  const tx = radiusHint + 3.4;
  const truss = std(0xb8bec4, { roughness: 0.5, metalness: 0.8 });
  for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) tower.add(tube([tx + dx, y0, dz], [tx + dx, y0 + 15.5, dz], 0.08, truss, 8));
  for (let y = y0 + 1; y < y0 + 15.5; y += 1.5) {
    tower.add(tube([tx - 0.6, y, -0.6], [tx + 0.6, y, 0.6], 0.035, truss, 6), tube([tx + 0.6, y, -0.6], [tx - 0.6, y, 0.6], 0.035, truss, 6));
    tower.add(tube([tx - 0.6, y, -0.6], [tx + 0.6, y, -0.6], 0.035, truss, 6), tube([tx - 0.6, y, 0.6], [tx + 0.6, y, 0.6], 0.035, truss, 6));
  }
  tower.add(box(1.6, 0.4, 1.6, DARK_STEEL, { x: tx, y: y0 + 15.7 }));
  tower.add(cylinder(0.12, 0.12, 0.25, new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff3300, emissiveIntensity: 2 }), { x: tx, y: y0 + 16 }));
  const arms = [];
  for (const [y, len] of [[y0 + 4.5, 2.4], [y0 + 9, 2.4], [y0 + 12.5, 2.2]]) {
    const arm = new THREE.Group();
    const beam = box(len, 0.3, 0.5, truss, { x: tx - len / 2 - 0.6, y });
    beam.castShadow = true;
    arm.add(beam, box(0.25, 0.9, 0.9, DARK_STEEL, { x: tx - len - 0.72, y }));
    tower.add(arm);
    arms.push(arm);
  }
  shadowed(tower);
  g.add(tower);
  const flood = new THREE.SpotLight(0xffffff, 600, 30, Math.PI / 6, 0.5, 2);
  flood.position.set(tx - 0.8, y0 + 13, 0);
  flood.target.position.set(0, y0 + 6, 0);
  g.add(flood, flood.target);
  scene.add(g);
  return { group: g, tower, arms, towerX: tx, standTop: y0 + 0.3 };
}
