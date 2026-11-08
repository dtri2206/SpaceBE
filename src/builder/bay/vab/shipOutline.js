// Measures the real ship art the hall shows (port of sandbox/role1.hangar.ship.js): for each visible part an outline
// in metres above ML_TOP (axial: radius profile; radial: box in its own unrotated frame) plus true cross-sections at
// the deck levels, which the collars (collarSmooth.mjs), the crew arm and the launch mount read.
import * as THREE from 'three';

const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), v = new THREE.Vector3();

function crossSections(holder, levels, bounds) {
  const out = [];
  for (const y of levels) {
    if (y + 0.16 < bounds.min.y || y - 0.15 > bounds.max.y) continue;
    const segments = [];
    holder.traverse((n) => {
      if (!n.isMesh || !n.geometry?.attributes?.position) return;
      const p = n.geometry.attributes.position, index = n.geometry.index, count = index?.count ?? p.count;
      for (let i = 0; i + 2 < count; i += 3) {
        a.fromBufferAttribute(p, index ? index.getX(i) : i).applyMatrix4(n.matrixWorld);
        b.fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1).applyMatrix4(n.matrixWorld);
        c.fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2).applyMatrix4(n.matrixWorld);
        if (Math.min(a.y, b.y, c.y) > y + 0.16 || Math.max(a.y, b.y, c.y) < y - 0.15) continue;
        for (const plane of [y - 0.15, y, y + 0.16]) {
          const points = [];
          for (const [s, w] of [[a, b], [b, c], [c, a]]) {
            if (Math.abs(w.y - s.y) < 1e-9) { if (Math.abs(s.y - plane) < 1e-7) points.push([s.x, s.z], [w.x, w.z]); continue; }
            const t = (plane - s.y) / (w.y - s.y);
            if (t >= 0 && t <= 1) points.push([s.x + t * (w.x - s.x), s.z + t * (w.z - s.z)]);
          }
          if (points.length >= 2) segments.push(...points[0], ...points[1]);
        }
      }
    });
    out.push({ y, segments });
  }
  return out;
}

/** An axial part's art, already at its height (art.position.y = e.y) and not yet parented. */
export function measureAxial(art, e, levels) {
  art.updateMatrixWorld(true);
  const profile = new Map();
  art.traverse((n) => {
    if (!n.isMesh || !n.geometry?.attributes?.position) return;
    const p = n.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(n.matrixWorld);
      const y = Math.round(v.y * 1000) / 1000;
      profile.set(y, Math.max(profile.get(y) ?? 0, Math.hypot(v.x, v.z)));
    }
  });
  const bounds = new THREE.Box3().setFromObject(art);
  e.outline = { profile: [...profile].sort((p, q) => p[0] - q[0]).map(([y, r]) => ({ y, r })), sections: crossSections(art, levels, bounds) };
}

/** A radial part on its mount (mountRadial holder), measured in its own unrotated frame. */
export function measureRadial(holder, e, levels) {
  const angle = holder.rotation.y;
  holder.rotation.y = 0;
  holder.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(holder);
  e.outline = { y0: box.min.y, y1: box.max.y, centerRadius: (box.min.x + box.max.x) / 2, radialHalf: (box.max.x - box.min.x) / 2, tangentHalf: Math.max(Math.abs(box.min.z), Math.abs(box.max.z)), width: box.max.x - box.min.x };
  e.outline.sections = crossSections(holder, levels, box);
  holder.rotation.y = angle;
  holder.updateMatrixWorld(true);
}
