// The slim open launch mount (port of updateMount in sandbox/role1.hangar.v5.js): with no mobile launcher the ship's
// base stays at ML_TOP = 7 on a ring table with an exhaust hole, six slender splayed legs, a brace ring and plinths,
// sized to the ship's footprint at its base. Returns the ground circle the engineer cannot walk into.
import * as THREE from 'three';

export function createLaunchMount(scene, top = 7) {
  const mount = new THREE.Group();
  mount.name = 'vab-launch-mount';
  scene.add(mount);
  const steel = new THREE.MeshStandardMaterial({ color: 0x6f7a7e, roughness: 0.55, metalness: 0.45 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xd7a024, roughness: 0.6, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3a4448, roughness: 0.7, metalness: 0.35 });
  let footprint = { x: 0, z: 0, r: 4 };

  function update(data) {
    for (const c of [...mount.children]) { c.geometry?.dispose(); mount.remove(c); }
    let core = 0, reach = 0;
    for (const h of data.hull) if (h.y0 <= 1) core = Math.max(core, h.r0);
    for (const e of data.entries) {
      if (e.attach === 'radial') { const o = e.outline; if (o && o.y0 <= 1.5) reach = Math.max(reach, (o.centerRadius ?? 0) + (o.radialHalf ?? 0)); continue; }
      for (const p of e.outline?.profile ?? []) if (p.y <= 1) core = Math.max(core, p.r);
    }
    core = Math.max(core, 0.8);
    const outer = Math.max(core + 1.6, reach + 0.6), inner = Math.max(0.6, core * 0.55), depth = 1.1;
    const add = (geometry, material, x, y, z, ry = 0) => { const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); m.rotation.y = ry; mount.add(m); return m; };
    const ring = new THREE.Shape();
    ring.absarc(0, 0, outer, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
    ring.holes.push(hole);
    const table = new THREE.ExtrudeGeometry(ring, { depth, bevelEnabled: false, curveSegments: 48 });
    table.rotateX(-Math.PI / 2);
    add(table, steel, 0, top - depth, 0);
    add(new THREE.CylinderGeometry(outer + 0.03, outer + 0.03, 0.22, 64, 1, true), yellow, 0, top - 0.13, 0);
    add(new THREE.CylinderGeometry(inner + 0.02, inner + 0.02, depth + 0.2, 48, 1, true), dark, 0, top - depth / 2, 0);
    const legR = outer - 0.55, footR = outer + 1.4;
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3 + Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
      const from = new THREE.Vector3(footR * c, 0, footR * s), to = new THREE.Vector3(legR * c, top - depth, legR * s), len = from.distanceTo(to);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, len, 0.7), steel);
      leg.position.copy(from).add(to).multiplyScalar(0.5);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      mount.add(leg);
      add(new THREE.BoxGeometry(1.5, 0.35, 1.5), yellow, footR * c, 0.175, footR * s, -a);
      add(new THREE.BoxGeometry(0.9, 0.6, 0.9), dark, legR * c, top + 0.3, legR * s, -a); // hold-down clamp
    }
    const brace = new THREE.TorusGeometry((legR + footR) / 2, 0.16, 8, 64);
    brace.rotateX(Math.PI / 2);
    add(brace, steel, 0, (top - depth) / 2, 0);
    mount.traverse((m) => m.updateMatrixWorld(true));
    footprint = { x: 0, z: 0, r: footR + 0.9 };
    return footprint;
  }

  return {
    group: mount, update,
    get footprint() { return footprint; },
    dispose() { for (const c of [...mount.children]) c.geometry?.dispose(); [steel, yellow, dark].forEach((m) => m.dispose()); scene.remove(mount); },
  };
}
