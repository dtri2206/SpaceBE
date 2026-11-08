// Reach rings for the mission map: pure functions, no DOM and no imports (tested in Node).
// Role 2's surface.getReach() gives { walkMetres, roverMetres, roverName, origin: {x,z}, ship: {x,z} }: how far the
// player can go from `origin` and still get back to `ship` on the air and battery they have left.
// A trip is "out and back": origin -> task -> ship. It fits a reach when it is no longer than 2 x that reach
// (with origin = ship this is exactly "the task is within `reach` metres").

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export const REACH_LABELS = { walk: 'in walking reach', rover: 'rover needed', out: 'out of reach' };

/** True when `reach` has the shape we need. */
export function validReach(r) {
  const ok = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.z);
  return !!r && ok(r.origin) && ok(r.ship) && Number.isFinite(r.walkMetres) && Number.isFinite(r.roverMetres);
}

/** Round trip in metres for a task at {x, z}: origin -> task -> ship. */
export function tripMetres(task, reach) {
  return dist(reach.origin, task) + dist(task, reach.ship);
}

/** 'walk' | 'rover' | 'out' for one task. */
export function classifyTask(task, reach) {
  const trip = tripMetres(task, reach);
  if (trip <= 2 * reach.walkMetres) return 'walk';
  if (trip <= 2 * reach.roverMetres) return 'rover';
  return 'out';
}

/** Classifies a list of { label, x, z, ... } tasks. Returns [] when reach is missing or invalid. */
export function classifyTasks(tasks, reach) {
  if (!validReach(reach)) return [];
  return tasks.map((t) => {
    const reachClass = classifyTask(t, reach);
    return { ...t, reachClass, reachLabel: REACH_LABELS[reachClass], oneWay: Math.round(dist(reach.origin, t)), tripMetres: Math.round(tripMetres(t, reach)) };
  });
}

/** Counts per class, for the one-line summary. */
export function summarise(classified) {
  const n = { walk: 0, rover: 0, out: 0 };
  for (const t of classified) n[t.reachClass] += 1;
  return n;
}
