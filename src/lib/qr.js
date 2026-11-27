// Reads the QR code printed on a receipt, if there is one.
// Most US store receipts put a link (to a digital receipt, a survey or a return page) or
// a code in the QR, not the line items, so the items still come from reading the photo.
// What the QR does hold (a link, sometimes a date or total) fills in or confirms the header.

export async function decodeQr(file) {
  const { default: jsQR } = await import('jsqr');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    // Small QR codes on long receipts need a big image; big ones read faster small. Try a few sizes.
    for (const side of [1600, 2400, 1000]) {
      const scale = Math.min(1, side / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, c.width, c.height);
      const data = g.getImageData(0, 0, c.width, c.height);
      const hit = jsQR(data.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
      if (hit?.data) return hit.data;
      if (scale === 1) break;
    }
    return null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const HOSTS = {
  walmart: 'Walmart', target: 'Target', costco: 'Costco', samsclub: "Sam's Club", kroger: 'Kroger',
  giantfood: 'Giant', safeway: 'Safeway', harristeeter: 'Harris Teeter', aldi: 'Aldi', lidl: 'Lidl',
  wegmans: 'Wegmans', cvs: 'CVS', walgreens: 'Walgreens', homedepot: 'Home Depot', lowes: "Lowe's",
  staples: 'Staples', officedepot: 'Office Depot', bestbuy: 'Best Buy', traderjoes: "Trader Joe's",
  wholefoodsmarket: 'Whole Foods', bjs: "BJ's", dollartree: 'Dollar Tree', dollargeneral: 'Dollar General',
};

function storeFromHost(host) {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.');
  for (const p of parts) if (HOSTS[p]) return HOSTS[p];
  return '';
}

function toDate(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 100) y += 2000;
  if (y < 2000 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(y, m - 1, d, 12).getTime();
  return t > Date.now() + 2 * 864e5 ? null : t;
}

function findDate(s) {
  let m = s.match(/(?:^|[^\d])(20\d{2})[-/.]?(0[1-9]|1[0-2])[-/.]?(0[1-9]|[12]\d|3[01])(?!\d)/);
  if (m) return toDate(m[1], m[2], m[3]);
  m = s.match(/(?:^|[^\d])(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(20\d{2}|\d{2})(?!\d)/);
  if (m) return toDate(m[3], m[1], m[2]);
  return null;
}

function findTotal(s) {
  const m = s.match(/(?:^|[^a-z])(?:total|tot|amt|amount|sum)[a-z]*\s*[:=]\s*\$?\s*(\d{1,6}(?:[.,]\d{2}))/i);
  return m ? Number(m[1].replace(',', '.')) : null;
}

// Pull what we can out of the QR text. Never trusts it for anything but filling in the form.
export function parseQr(text) {
  if (!text || typeof text !== 'string') return null;
  const raw = text.trim().slice(0, 2000);
  const out = { raw, url: '', store: '', date: null, total: null };
  let body = raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.protocol === 'https:' || u.protocol === 'http:') {
        out.url = u.href;
        out.store = storeFromHost(u.hostname);
        body = [...u.searchParams.entries()].map(([k, v]) => `${k}=${v}`).join('&');
      }
    } catch { /* not a link after all */ }
  }
  out.date = findDate(body);
  out.total = findTotal(body);
  return out;
}

// Short label for showing the QR link without the whole address.
export function qrHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}
