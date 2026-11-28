// Receipt reading with Gemini through Firebase AI Logic (no server, no API key in the app).
import { DEMO_MODE, GEMINI_MODEL } from './config.js';
import { HOUSEHOLD_CATEGORIES } from './categories.js';

const HEIC = /\.(heic|heif)$/i;
const isHeic = (file) => /image\/hei[cf]/i.test(file?.type || '') || HEIC.test(file?.name || '');

// Some phones and computers hand over a photo with no type (often HEIC from an iPhone), so the name counts too.
export function isImageFile(file) {
  if (!file) return false;
  if ((file.type || '').startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(file.name || '');
}

function canDecode(file) {
  const url = URL.createObjectURL(file);
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(url); res(true); };
    i.onerror = () => { URL.revokeObjectURL(url); res(false); };
    i.src = url;
  });
}

// Returns a file the browser can draw. iPhone HEIC photos open in Safari but not in Chrome,
// Edge or Firefox, so those get converted to JPEG first (the converter only loads when needed).
export async function toReadableImage(file) {
  if (await canDecode(file)) return file;
  if (isHeic(file)) {
    let blob;
    try {
      const { default: heic2any } = await import('heic2any');
      const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
      blob = Array.isArray(out) ? out[0] : out;
    } catch (e) {
      console.error(e);
      throw new Error("Couldn't convert that iPhone (HEIC) photo. Take a new photo, or save it as JPG first.");
    }
    return new File([blob], (file.name || 'receipt').replace(HEIC, '') + '.jpg', { type: 'image/jpeg' });
  }
  throw new Error("Couldn't open that photo. Try a JPG or PNG, or take a new photo.");
}

export async function compressImage(file, { maxSide = 2000, maxChars = 880_000 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    let scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    let quality = 0.72;
    for (let attempt = 0; attempt < 8; attempt++) {
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= maxChars) return dataUrl;
      if (quality > 0.5) quality -= 0.1;
      else scale *= 0.8;
    }
    throw new Error('That image is too large. Try a closer photo of the receipt.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

const PROMPT = (known) => `You read store receipts for a shopping list app.
Return every purchased product line. Skip subtotal, tax, total, payment, change, coupons summary and loyalty lines; fold a coupon or discount into the line it applies to.
For each line give:
- rawText: the line as printed
- name: a plain-English product name a shopper would write on a list (expand abbreviations: "GV 2% MLK GAL" -> "2% milk")
- quantity: units bought (default 1; for weighed items use 1)
- unitPrice: price per unit after discounts
- lineTotal: amount charged for the line
- category: best fit from this list, or "Other": Produce, Dairy & eggs, Meat & seafood, Bakery, Pantry, Frozen, Beverages, Snacks, Household, Cleaning, Paper goods, Personal care, Health, Baby, Pets, Office & stationery, Printing, Kitchen & breakroom, Tech & electronics, Other
- matchName: if the product is clearly the same thing as one of the KNOWN ITEMS below, copy that known name exactly; otherwise an empty string
Also return store (store name), date (YYYY-MM-DD), tax and total.
KNOWN ITEMS: ${known.slice(0, 250).join(' | ') || '(none yet)'}`;

export async function extractReceipt(dataUrl, knownNames, app) {
  if (DEMO_MODE) return demoExtract(knownNames);
  const { getAI, getGenerativeModel, GoogleAIBackend, Schema } = await import('firebase/ai');
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const schema = Schema.object({
    properties: {
      store: Schema.string(),
      date: Schema.string(),
      tax: Schema.number(),
      total: Schema.number(),
      items: Schema.array({
        items: Schema.object({
          properties: {
            rawText: Schema.string(), name: Schema.string(), quantity: Schema.number(),
            unitPrice: Schema.number(), lineTotal: Schema.number(), category: Schema.string(), matchName: Schema.string(),
          },
          optionalProperties: ['unitPrice', 'matchName', 'category'],
        }),
      }),
    },
    optionalProperties: ['store', 'date', 'tax', 'total'],
  });
  const model = getGenerativeModel(ai, {
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.1 },
  });
  const base64 = dataUrl.split(',')[1];
  const result = await model.generateContent([PROMPT(knownNames), { inlineData: { mimeType: 'image/jpeg', data: base64 } }]);
  const parsed = JSON.parse(result.response.text());
  return normalize(parsed);
}

// Emailed receipts: an order confirmation or e-receipt as plain text, with any PDF receipt.
const EMAIL_PROMPT = (known, cats) => `You read emails that were forwarded to a household shopping list app.
First decide whether this email is a receipt or order confirmation listing products that were bought (isReceipt true).
Shipping, delivery, return, refund, survey, account and marketing emails are not receipts (isReceipt false, no items).
For a receipt, return every purchased product. Skip subtotal, tax, shipping fee, total, payment and loyalty lines; fold a discount into the line it applies to.
For each product give:
- rawText: the product as written in the email
- name: a plain-English product name a shopper would write on a list ("Bounty Select-A-Size Paper Towels, 12 Double Rolls" -> "Paper towels")
- quantity: units bought (default 1)
- unitPrice: price per unit after discounts
- lineTotal: amount charged for the line
- category: exactly one of: ${cats.join(', ')}
- matchName: if the product is clearly the same thing as one of the KNOWN ITEMS below, copy that known name exactly; otherwise an empty string
Also return store (the store or website the order was placed with, not the person who forwarded it), orderId (the order or receipt number, or empty), date of purchase (YYYY-MM-DD), tax and total.
KNOWN ITEMS: ${known.slice(0, 250).join(' | ') || '(none yet)'}`;

export async function extractReceiptText({ subject = '', text = '', pdfs = [], id = '' }, knownNames, app, cats = HOUSEHOLD_CATEGORIES) {
  if (DEMO_MODE) return demoExtractEmail(id, knownNames);
  const { getAI, getGenerativeModel, GoogleAIBackend, Schema } = await import('firebase/ai');
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const schema = Schema.object({
    properties: {
      isReceipt: Schema.boolean(), store: Schema.string(), orderId: Schema.string(), date: Schema.string(), tax: Schema.number(), total: Schema.number(),
      items: Schema.array({
        items: Schema.object({
          properties: {
            rawText: Schema.string(), name: Schema.string(), quantity: Schema.number(),
            unitPrice: Schema.number(), lineTotal: Schema.number(), category: Schema.string(), matchName: Schema.string(),
          },
          optionalProperties: ['unitPrice', 'matchName', 'category'],
        }),
      }),
    },
    optionalProperties: ['store', 'orderId', 'date', 'tax', 'total', 'items'],
  });
  const model = getGenerativeModel(ai, {
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.1 },
  });
  const parts = [EMAIL_PROMPT(knownNames, cats), `EMAIL SUBJECT: ${subject}\n\nEMAIL TEXT:\n${String(text).slice(0, 40000)}`];
  for (const p of pdfs.slice(0, 2)) parts.push({ inlineData: { mimeType: 'application/pdf', data: p.data } });
  const result = await model.generateContent(parts);
  const parsed = JSON.parse(result.response.text());
  return { ...normalize(parsed), isReceipt: parsed.isReceipt !== false && (parsed.items || []).length > 0, orderId: parsed.orderId || '' };
}

function normalize(r) {
  let date = null;
  if (r.date && /^\d{4}-\d{2}-\d{2}/.test(r.date)) {
    const [y, m, d] = r.date.slice(0, 10).split('-').map(Number);
    date = new Date(y, m - 1, d, 12).getTime();
    if (date > Date.now() + 2 * 864e5 || y < 2000) date = null;
  }
  return {
    store: r.store || '',
    date,
    tax: r.tax ?? null,
    total: r.total ?? null,
    items: (r.items || []).map((x) => ({ ...x, quantity: x.quantity || 1 })),
  };
}

function demoExtract(knownNames) {
  const pick = (n) => (knownNames.includes(n) ? n : '');
  return new Promise((res) =>
    setTimeout(() => res({
      store: 'Giant', date: Date.now() - 864e5, tax: 0.42, total: 21.79,
      items: [
        { rawText: 'GNT 2% MLK GAL', name: '2% milk', quantity: 1, unitPrice: 3.59, lineTotal: 3.59, category: 'Dairy & eggs', matchName: pick('Milk') },
        { rawText: 'WHT BRD 20OZ', name: 'White bread', quantity: 1, unitPrice: 3.29, lineTotal: 3.29, category: 'Bakery', matchName: pick('Bread') },
        { rawText: 'TROP OJ 52OZ', name: 'Orange juice', quantity: 2, unitPrice: 4.25, lineTotal: 8.5, category: 'Beverages', matchName: '' },
        { rawText: 'BNNA', name: 'Bananas', quantity: 1, unitPrice: 1.89, lineTotal: 1.89, category: 'Produce', matchName: pick('Bananas') },
        { rawText: 'BDAY CARD', name: 'Birthday card', quantity: 1, unitPrice: 4.1, lineTotal: 4.1, category: 'Other', matchName: '' },
      ],
    }), 900),
  );
}

// Demo emails (see src/lib/emailReceipts.js): one that checks itself off, one with a guess to
// confirm, and a delivery notice that is skipped.
function demoExtractEmail(id, knownNames) {
  const pick = (n) => (knownNames.includes(n) ? n : '');
  const day = 864e5;
  const by = {
    'demo-target': {
      isReceipt: true, store: 'Target', orderId: '102-4471', date: Date.now() - day, tax: 1.3, total: 33.77,
      items: [
        { rawText: 'Bounty Select-A-Size Paper Towels, 12 Double Rolls', name: 'Paper towels', quantity: 1, unitPrice: 24.99, lineTotal: 24.99, category: 'Household', matchName: pick('Paper towels') },
        { rawText: 'Simply Orange Pulp Free Juice 52 fl oz', name: 'Orange juice', quantity: 1, unitPrice: 4.49, lineTotal: 4.49, category: 'Pantry', matchName: pick('Orange juice') },
        { rawText: 'Up&Up Ultra Dish Soap 24 oz', name: 'Dish soap', quantity: 1, unitPrice: 2.99, lineTotal: 2.99, category: 'Household', matchName: pick('Dish soap') },
      ],
    },
    'demo-amazon': {
      isReceipt: true, store: 'Amazon', orderId: '113-5582201-7730645', date: Date.now() - 2 * day, tax: 0.84, total: 22.82,
      items: [
        { rawText: 'Post-it Super Sticky Notes, 3x3 in, 12 Pads', name: 'Post-it super sticky notes, 12 pads', quantity: 1, unitPrice: 11.99, lineTotal: 11.99, category: 'Household', matchName: '' },
        { rawText: 'Crest Pro-Health Toothpaste, 2 Pack', name: 'Toothpaste', quantity: 1, unitPrice: 9.99, lineTotal: 9.99, category: 'Health & personal care', matchName: pick('Toothpaste') },
      ],
    },
  };
  const r = by[id] || { isReceipt: false, items: [] };
  return new Promise((res) => setTimeout(() => res({ store: '', date: null, tax: null, total: null, orderId: '', ...r }), 600));
}
