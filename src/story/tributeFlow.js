// Pure helpers for the memorial sequence and the Silent Return choice (no DOM, no core imports, so Node can test them).

export const OPENING_FADE_MS = 2000; // black fades in, then the opening line
export const CREW_STEP_MS = 900; // one name every 0.9 s, like candles being lit
export const SECTION_STEP_MS = 1800;
export const CONTINUE_HOLD_MS = 6000; // the quiet hold after everything is shown
export const READ_ONLY_HOLD_MS = 1500;
export const CLOSING_MS = 5000;
export const RETRY_LABEL = "They didn't get a second launch. You do. Try again.";

/** The tribute for a history lesson id, or null unless it is a fatal tribute with a crew. Never 'closing'. */
export function tributeFor(tributes, lessonId) {
  if (!lessonId || lessonId === 'closing') return null;
  const t = tributes?.[lessonId];
  return t && t.fatal && Array.isArray(t.crew) && t.crew.length ? t : null;
}

/** [lessonId, tribute] for every fatal tribute, in file order (the Wall of Remembrance). */
export const fatalTributes = (tributes) => Object.keys(tributes ?? {}).filter((id) => tributeFor(tributes, id)).map((id) => [id, tributes[id]]);

/** `happened` items are strings, or { text, sensitive: true } (hidden by "Skip sensitive scenes"). */
export const visibleHappened = (list = [], skipSensitive = false) =>
  list.filter((x) => !(x && typeof x === 'object' && x.sensitive && skipSensitive)).map((x) => (typeof x === 'object' ? x.text : x)).filter(Boolean);

/**
 * When each block appears (ms from the start) and when Continue may appear. Empty parts are left out.
 * Returns { steps: [{ id, at, index? }], completeAt, continueAt }.
 */
export function tributeSchedule(t, { skipSensitive = false, readOnly = false } = {}) {
  const steps = [];
  let at = OPENING_FADE_MS;
  const add = (id, extra = {}, gap = SECTION_STEP_MS) => { steps.push({ id, at, ...extra }); at += gap; };
  if (t.opening) add('opening');
  add('mission');
  (t.crew ?? []).forEach((_, index) => add('crew', { index }, CREW_STEP_MS));
  at += SECTION_STEP_MS - CREW_STEP_MS;
  if (t.highlights?.length) add('highlights');
  if (visibleHappened(t.happened, skipSensitive).length) add('happened');
  if (t.changed?.length) add('changed');
  if (t.lesson) add('lesson');
  if (t.images?.family) add('family');
  if (t.images?.vehicle) add('vehicle');
  if (t.quote?.text) add('quote');
  if (t.sources?.length) add('sources', {}, 0);
  const completeAt = at;
  return { steps, completeAt, continueAt: completeAt + (readOnly ? READ_ONLY_HOLD_MS : CONTINUE_HOLD_MS) };
}

/** Splits text into its first `n` sentences and the rest. */
export function splitSentences(text, n = 2) {
  const parts = String(text ?? '').split(/(?<=[.!?])\s+/).filter(Boolean);
  return { head: parts.slice(0, n).join(' '), rest: parts.slice(n).join(' ') };
}

/** A one-line subtitle: the text itself when short, else truncated at a word boundary with an ellipsis. */
export function shortLine(text, max = 110) {
  const s = String(text ?? '');
  if (s.length <= max) return { short: s, truncated: false };
  const cut = s.slice(0, max - 1);
  return { short: `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : cut.length).replace(/[\s,;:.]+$/, '')}…`, truncated: true };
}

/** Continue is shown only once the quiet hold is over. */
export const canContinue = (elapsedMs, schedule) => elapsedMs >= schedule.continueAt;

export const retryLabel = (isTribute) => (isTribute ? RETRY_LABEL : null);

// ---------- Silent Return choice (RETURN, before Earth entry) ----------

export const SILENT_RETURN_CAPTION = 'A pressure-equalisation valve opened at separation.';
export const SILENT_RETURN_CAUSE = 'You skipped the pressure suits for entry. A valve opened at separation, the cabin lost its air, and nobody was wearing a suit.';

/** Keys 1 and 2 (top row or numpad) answer the choice. Enter and Space never do. */
export function choiceFromKey(code) {
  if (code === 'Digit1' || code === 'Numpad1') return 'suitUp';
  if (code === 'Digit2' || code === 'Numpad2') return 'skip';
  return null;
}

/** The flight:failed payload for a choice, or null when the player suits up. */
export const failureForChoice = (choice) => (choice === 'skip' ? { endingId: 'silentReturn', cause: SILENT_RETURN_CAUSE } : null);
