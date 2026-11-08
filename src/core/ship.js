// The ship the player built. Falls back to the Reliable mock so every role can test alone.
import reliable from './mocks/ship.reliable.json';

let ship = null;

export function setShip(spec) {
  ship = spec;
}

export function getShip() {
  return ship ?? reliable;
}
