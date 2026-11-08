// Flight Report "Phases" section: pure formatting of Role 2's getPhaseRatings()
// (array of { phase: 'ascent'|'entry'|'landing', stars: 1..3, stats: {...}, text }). No DOM, no imports, so it can be tested in Node.
const NAMES = { ascent: 'Launch & ascent', entry: 'Mars entry', landing: 'Landing' };
const MAX_STATS = 4;

/** 'peakG' -> 'peak G', 'touchdown_speed' -> 'touchdown speed'. */
export function statLabel(key) {
  return String(key).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').toLowerCase()
    .replace(/\bg\b/, 'G').replace(/\bkpa\b/, '(kPa)').replace(/\bpct\b/, '(%)').replace(/\bdeg\b/, '(°)').replace(/\bm s\b/, '(m/s)');
}

export function statValue(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.abs(v) >= 100 || Number.isInteger(v) ? Math.round(v) : Math.round(v * 10) / 10) : '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return v == null ? '—' : String(v);
}

/** '★★☆' for 2 out of 3. Out-of-range or missing values are clamped to 1..3. */
export function starString(stars) {
  const n = Math.min(3, Math.max(1, Math.round(Number(stars)) || 1));
  return '★'.repeat(n) + '☆'.repeat(3 - n);
}

/** Cleans a ratings array into rows for the screen. Returns [] when there is nothing to show (the section is then hidden). */
export function formatPhases(ratings) {
  if (!Array.isArray(ratings)) return [];
  return ratings.filter((r) => r && typeof r === 'object' && r.phase).map((r) => ({
    phase: r.phase,
    name: NAMES[r.phase] ?? String(r.phase),
    stars: starString(r.stars),
    starCount: Math.min(3, Math.max(1, Math.round(Number(r.stars)) || 1)),
    text: typeof r.text === 'string' ? r.text : '',
    stats: Object.entries(r.stats && typeof r.stats === 'object' ? r.stats : {}).slice(0, MAX_STATS).map(([k, v]) => [statLabel(k), statValue(v)]),
  }));
}
