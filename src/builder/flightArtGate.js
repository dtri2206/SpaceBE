// Lets the builder's own scenes ask Role 3 for its built-in rocket parts without getting the flight art back.
// flightArt.js registers Role 1's models for the flight scenes through assets.setRocketPartArt; inside the builder
// (studio, hangar, card pictures) partArt.js asks for Role 3's built-in parts and must not receive those back.
export const flightArtGate = { bypass: 0 };
/** Runs fn with the flight-art hook switched off (nested calls are fine). */
export function withoutFlightArt(fn) {
  flightArtGate.bypass += 1;
  try { return fn(); } finally { flightArtGate.bypass -= 1; }
}
