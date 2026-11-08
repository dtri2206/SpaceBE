// Number formatting shared by the builder screens. Pure JS.
export const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');
export const fmtMoney = (n) => (Number.isFinite(n) ? `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}` : '—');
export const fmtMoneyShort = (n) => {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  // trailing zeros are dropped only after a decimal point (10M stays 10M); billions read as B
  const short = (v) => v.toFixed(2).replace(/\.?0+$/, '');
  if (a >= 1e9) return `${sign}$${short(a / 1e9)}B`;
  if (a >= 1e6) return `${sign}$${short(a / 1e6)}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}k`;
  return `${sign}$${Math.round(a)}`;
};
export const fmtMass = (kg) => (Number.isFinite(kg) ? (Math.abs(kg) >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg)} kg`) : '—');
export const fmtKN = (n) => (Number.isFinite(n) ? `${Math.round(n / 1000).toLocaleString('en-US')} kN` : '—');
// one decimal from 99 % up, so a 99.8 % part never reads 100 % (its pros say 99.8 %); 100 % only when it is
export const fmtPct = (x) => (Number.isFinite(x) ? (x >= 0.99 && x < 1 ? `${(Math.floor(x * 1000) / 10).toFixed(1)} %` : `${Math.round(x * 100)} %`) : '—');
