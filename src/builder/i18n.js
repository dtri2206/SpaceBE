// Language of the explanation card and the investigation board: English (the game's UI language, the default) or
// Vietnamese. Everything else in the game stays English. The choice is saved as builderLang through core save.
export const LANGS = ['en', 'vi'];
let lang = 'en';
let store = null;
const listeners = new Set();

export function initLang(save) {
  store = save ?? null;
  const v = store?.load?.()?.builderLang;
  lang = LANGS.includes(v) ? v : 'en';
}
export const getLang = () => lang;
export function setLang(l) {
  if (!LANGS.includes(l) || l === lang) return;
  lang = l;
  store?.update?.({ builderLang: l });
  for (const f of listeners) f(l);
}
/** Call f(lang) whenever the language changes; returns a function that stops it. */
export function onLang(f) { listeners.add(f); return () => listeners.delete(f); }
/** One text in the current language: a plain string, or { en, vi } (falls back to English). */
export function tr(entry, l = lang) {
  if (entry == null) return '';
  if (typeof entry === 'string') return entry;
  return entry[l] ?? entry.en ?? '';
}
