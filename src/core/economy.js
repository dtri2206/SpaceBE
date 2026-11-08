// Money. The only place money changes. Reads src/core/balance.json and saves through save.js.
import balance from './balance.json';
import { emit } from './events.js';
import { save } from './save.js';

// Testing money: in development (`npm run dev`) or with ?debug=1, every page load starts with $1,000,000,000 so
// tests never run out. ?money=N picks another amount there (e.g. ?money=5000000 to test the real economy). The built
// game (npm run build) ignores both and uses balance.startMoney and the save as before.
function testStartMoney() {
  if (typeof location === 'undefined') return null; // Node tests
  const query = new URLSearchParams(location.search);
  if (!(import.meta.env?.DEV || query.get('debug') === '1')) return null;
  const asked = Number(query.get('money'));
  return query.has('money') && Number.isFinite(asked) ? asked : 1e9;
}
const testMoney = testStartMoney();
const saved = save.load().money;
let money = testMoney ?? (typeof saved === 'number' ? saved : balance.startMoney);
if (testMoney !== null) save.update({ money });

function set(next, reason) {
  money = next;
  save.update({ money });
  emit('economy:changed', { money, reason });
}

export const economy = {
  balance,
  getMoney: () => money,
  canAfford: (cost) => money >= cost,
  /** Pay for something (a ship). Money may go below 0, which means Bankrupt. */
  spend(cost, reason = '') {
    set(money - cost, reason);
  },
  reward(amount, reason = '') {
    set(money + amount, reason);
  },
  /** Charge the failure penalty (20% of ship cost + $250,000). No refund. Returns the penalty charged. */
  chargeFailure(shipCost) {
    const penalty = Math.round(shipCost * balance.penaltyRate + balance.penaltyBase);
    set(money - penalty, 'failure');
    return penalty;
  },
  /** Money below 0, as in the spec. */
  isBankrupt: () => money < 0,
  /** Back to the starting money. */
  reset() {
    set(testMoney ?? balance.startMoney, 'reset');
  },
  /** Debug only: set money directly. */
  debugSet(amount) {
    set(amount, 'debug');
  },
};
