// Number formatting shared by the builder screens. Pure JS.
export const fmtInt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—');
export const fmtMoney = (n) => (Number.isFinite(n) ? `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toLocaleString('en-US')}` : '—');
export const fmtMoneyShort = (n) => {
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a % 1e6 === 0 ? 0 : 2).replace(/\.?0+$/, '')}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}k`;
  return `${sign}$${Math.round(a)}`;
};
export const fmtMass = (kg) => (Number.isFinite(kg) ? (Math.abs(kg) >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg)} kg`) : '—');
export const fmtKN = (n) => (Number.isFinite(n) ? `${Math.round(n / 1000).toLocaleString('en-US')} kN` : '—');
export const fmtPct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)} %` : '—');
