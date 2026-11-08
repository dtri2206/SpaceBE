import * as THREE from 'three';

/**
 * One tier of the ground: a square grid whose heights come from getTerrainHeight.
 * `coord` maps -1..1 to metres (uniform for the near tiers, bunched towards the middle for the far ring).
 * `hole` leaves out cells fully inside that half-width, where a finer tier covers the ground. `skirt` hangs a wall
 * below the outer edge, so the seam to the next tier never shows a crack. `sink` pushes vertices inside the hole
 * down, for cells that straddle its edge.
 */
export function buildTier({ segments, coord, hole = 0, skirt = 0, sink = 0, cell, height, extra = null }) {
  const n = segments + 1;
  const xs = new Float32Array(n);
  for (let i = 0; i < n; i++) xs[i] = coord(i / segments * 2 - 1);
  const heights = new Float32Array(n * n);
  const positions = new Float32Array(n * n * 3);
  const terr = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = xs[i], z = xs[j], k = j * n + i;
      const h = height(x, z);
      heights[k] = h;
      const inside = hole > 0 && Math.abs(x) < hole - 1e-3 && Math.abs(z) < hole - 1e-3;
      positions[k * 3] = x;
      positions[k * 3 + 1] = h - (inside ? sink : 0);
      positions[k * 3 + 2] = z;
    }
  }
  // Optional material cues per vertex: extra(x, z, hollow, out) fills out[0..2]. `hollow` is positive in a bowl, negative on a ridge.
  if (extra) {
    const spread = cell * 0.08, out = [0, 0, 0];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const avg = (heights[j * n + Math.max(0, i - 1)] + heights[j * n + Math.min(segments, i + 1)] + heights[Math.max(0, j - 1) * n + i] + heights[Math.min(segments, j + 1) * n + i]) / 4;
        extra(xs[i], xs[j], Math.max(-1, Math.min(1, (avg - heights[k]) / spread)), out);
        terr.set(out, k * 3);
      }
    }
  }
  // Cells that are not wholly inside the hole.
  const indices = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      if (hole > 0 && Math.max(Math.abs(xs[i]), Math.abs(xs[i + 1]), Math.abs(xs[j]), Math.abs(xs[j + 1])) <= hole + 1e-3) continue;
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (extra) geometry.setAttribute('aTerr', new THREE.BufferAttribute(terr, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  if (skirt > 0) {
    // Duplicate the outer ring below the edge, with the same normals, and join it to the surface.
    const ring = [];
    for (let i = 0; i < segments; i++) ring.push(i);
    for (let j = 0; j < segments; j++) ring.push(j * n + segments);
    for (let i = segments; i > 0; i--) ring.push(segments * n + i);
    for (let j = segments; j > 0; j--) ring.push(j * n);
    const pos = geometry.attributes.position, nor = geometry.attributes.normal, att = geometry.attributes.aTerr ?? { array: new Float32Array(n * n * 3) };
    const m = ring.length;
    const P = new Float32Array((n * n + m) * 3), N = new Float32Array((n * n + m) * 3), T = new Float32Array((n * n + m) * 3);
    P.set(pos.array); N.set(nor.array); T.set(att.array);
    const idx = Array.from(geometry.index.array);
    for (let r = 0; r < m; r++) {
      const src = ring[r], dst = n * n + r;
      P[dst * 3] = pos.array[src * 3]; P[dst * 3 + 1] = pos.array[src * 3 + 1] - skirt; P[dst * 3 + 2] = pos.array[src * 3 + 2];
      N[dst * 3] = nor.array[src * 3]; N[dst * 3 + 1] = nor.array[src * 3 + 1]; N[dst * 3 + 2] = nor.array[src * 3 + 2];
      T.set(att.array.subarray(src * 3, src * 3 + 3), dst * 3);
    }
    for (let r = 0; r < m; r++) {
      const a = ring[r], b = ring[(r + 1) % m], ad = n * n + r, bd = n * n + (r + 1) % m;
      // Both windings, so the wall shows from either side whatever the ring direction.
      idx.push(a, b, ad, b, bd, ad, a, ad, b, b, ad, bd);
    }
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(P, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    if (extra) geometry.setAttribute('aTerr', new THREE.BufferAttribute(T, 3));
    geometry.setIndex(idx);
  }
  return geometry;
}
