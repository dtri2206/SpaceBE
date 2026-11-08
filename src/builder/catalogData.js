// Loads the builder's data for the browser: the shared families plus every section folder (src/builder/sections/*),
// merged into the catalogue, the internals kits and the four sections of the design page.
import familiesJson from './data/families.json';
import noseParts from './sections/nose/parts.json';
import noseInternals from './sections/nose/internals.json';
import noseSection from './sections/nose/section.json';
import bodyParts from './sections/body/parts.json';
import bodyInternals from './sections/body/internals.json';
import bodySection from './sections/body/section.json';
import tailParts from './sections/tail/parts.json';
import tailInternals from './sections/tail/internals.json';
import tailSection from './sections/tail/section.json';
import padParts from './sections/pad/parts.json';
import padInternals from './sections/pad/internals.json';
import padSection from './sections/pad/section.json';
import { createSections, mergeSectionData } from './sections.js';
import propulsionTraits from './traits/propulsion.json';
import structureTraits from './traits/structure.json';
import lifeTraits from './traits/life.json';
import landingTraits from './traits/landing.json';

/** The real numbers behind each part's flight traits (traits/*.json), passed to computeShipSpec as deps.traitsData. */
export const traitsData = { propulsion: propulsionTraits, structure: structureTraits, life: lifeTraits, landing: landingTraits };

const files = {
  nose: { parts: noseParts, internals: noseInternals, section: noseSection },
  body: { parts: bodyParts, internals: bodyInternals, section: bodySection },
  tail: { parts: tailParts, internals: tailInternals, section: tailSection },
  pad: { parts: padParts, internals: padInternals, section: padSection },
};

export const { partsJson, internalsJson } = mergeSectionData(familiesJson, files);
export const sections = createSections(files);
