const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const fmtMoney = (n) => (n == null || Number.isNaN(Number(n)) ? '' : money.format(Number(n)));
export const fmtMoney0 = (n) => money0.format(Number(n) || 0);

export function fmtDate(ms, { withYear = false } = {}) {
  if (!ms) return '';
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear || !sameYear ? { year: 'numeric' } : {}) });
}

export function fmtDateLong(ms) {
  return ms ? new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
}

export function fmtQty(qty, unit) {
  const q = Number(qty) || 1;
  const n = Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return unit ? `${n} ${unit}` : q === 1 ? '' : `×${n}`;
}

export const toInputDate = (ms) => {
  const d = new Date(ms || Date.now());
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const fromInputDate = (s) => {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
};

export function initials(name) {
  return String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

export function firstName(name) {
  return String(name || '').split(/\s+/)[0];
}
