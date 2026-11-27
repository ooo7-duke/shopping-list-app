// Receipt reading with Gemini through Firebase AI Logic (no server, no API key in the app).
import { DEMO_MODE, GEMINI_MODEL } from './config.js';

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
