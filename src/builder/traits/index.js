// Flight traits: what each part the player chose does in flight and on Mars (wave 5, 2026-11-08; all four roles agreed
// that Role 1 builds these effects end to end). computeShipSpec puts the result in ShipSpec.stats.traits; the flight
// (src/flight/effects/), the surface (oxygen, rovers), the cruise and the hangar's flight analysis read it. Every field
// is optional for the readers: a missing one means "as before". Pure, Node-testable.
import { propulsionTraits } from './propulsion.js';
import { structureTraits } from './structure.js';
import { lifeTraits } from './life.js';
import { landingTraits } from './landing.js';

export const TRAIT_GROUPS = ['propulsion', 'structure', 'life', 'landing'];
const FNS = { propulsion: propulsionTraits, structure: structureTraits, life: lifeTraits, landing: landingTraits };

/**
 * flightTraits(layout, ctx) → { version, propulsion, structure, life, landing }.
 * ctx: { catalog, engines, materials, hull, padFx, stats, optionsOf(entry), traitsData: { <group>: parsed <group>.json } }.
 * A group that throws gives its neutral values (and the error in `errors`), so a bad number never breaks the builder.
 */
export function flightTraits(layout, ctx = {}) {
  const out = { version: 1 };
  const errors = [];
  for (const g of TRAIT_GROUPS) {
    const data = ctx.traitsData?.[g] ?? null;
    try { out[g] = FNS[g](layout, ctx, data) ?? {}; } catch (e) { out[g] = { ...(data?.neutral ?? {}) }; errors.push(`${g}: ${e.message}`); }
  }
  if (errors.length) out.errors = errors;
  return out;
}

/**
 * The flat stats Role 2's FlightController already reads (shipParams): minThrottle and ignitions (null = unlimited).
 */
export function flatTraits(traits) {
  const p = traits?.propulsion ?? {};
  return { minThrottle: Number.isFinite(p.minThrottle) ? p.minThrottle : 0, ignitions: Number.isFinite(p.ignitions) ? p.ignitions : null };
}
