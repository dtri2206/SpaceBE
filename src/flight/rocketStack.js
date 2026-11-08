// Pure helper (no three.js) so it can be tested in node. Used by src/flight/index.js to build the player's rocket.
// Parts on the axis (x ≈ z ≈ 0) are re-stacked bottom-up in their spec y order with each model's real height;
// side parts (legs, fins, boosters) keep their offset from the axial part just below them.
// Returns { placed: Map(part → y), top: total stack height }.
export function stackParts(parts, heightOf) {
  const axial = parts.filter((p) => Math.hypot(p.x ?? 0, p.z ?? 0) < 0.05).sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
  const placed = new Map();
  let y = 0;
  for (const p of axial) {
    placed.set(p, y);
    y += heightOf(p);
  }
  // piecewise map from the spec's y to the stacked y, using the axial parts as anchors
  const anchors = axial.map((p) => [p.y ?? 0, placed.get(p)]);
  const mapY = (oy) => {
    if (!anchors.length) return oy;
    let best = anchors[0];
    for (const a of anchors) if (a[0] <= oy) best = a;
    return best[1] + (oy - best[0]);
  };
  for (const p of parts) if (!placed.has(p)) placed.set(p, mapY(p.y ?? 0));
  return { placed, top: y };
}

