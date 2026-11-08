// Plain-language explanations for the big explanation card, in English and Vietnamese.
// Every file holds { "_about": "...", "entries": { "<key>": { "en": { ... }, "vi": { ... } } } }; this module merges them.
//
// Keys:
//   part:<partId>                      { what, why, without, inside, analogy }  a part (what it does in everyday words,
//                                        why the rocket needs it, what happens without it or with a cheap one, how it
//                                        works inside, one everyday comparison)
//   slot:<kitId>/<slotKey>             { what }                                  one piece inside a part (a kit slot)
//   option:<kitId>/<slotKey>/<optionId> { what }                                 one choice for that piece
//   shape:<sectionId>/<shapeId>        { what, why }                             a shape taken from a real rocket
//   row:<sectionId>/<rowId>            { what }                                  a row of a card (Engines, Steering…)
//   family:<familyId>                  { what }                                  a part family
//   term:<word>                        { what }                                  a word such as thrust, delta-v, Isp
//   pad:<padId>  equip:<key>  equip:<key>/<optionId>   { what, why, without }   the launch pad card
//   hull:<materialId>                  { what, why, without }                    an outer-skin material
// Every field is optional except what. Missing Vietnamese falls back to English (i18n.tr).
import general from './data/explain-general.json';
import hull from './data/explain-hull.json';
import nose from './sections/nose/explain.json';
import body from './sections/body/explain.json';
import tail from './sections/tail/explain.json';
import pad from './sections/pad/explain.json';

export const EXPLAIN = Object.freeze({ ...general.entries, ...hull.entries, ...nose.entries, ...body.entries, ...tail.entries, ...pad.entries });

/** The entry for a key, or null. */
export const explainFor = (key) => EXPLAIN[key] ?? null;
