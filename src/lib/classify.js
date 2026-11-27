// Sorting items the keyword list doesn't know, with the same Gemini model that reads receipts
// (Firebase AI Logic, no API key in the app). Only names are sent, never photos or prices.
import { DEMO_MODE, GEMINI_MODEL } from './config.js';

const PROMPT = (names, cats) => `You sort shopping list items into store sections for a household shopping app.
For each item, pick the one section a shopper would find it in. Food is never "Other": frozen foods such as french fries go to Frozen, breakfast cereals such as Cheerios go to Pantry.
Use "Other" only when no section fits at all.
SECTIONS: ${cats.join(' | ')}
ITEMS:
${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}`;

/** Returns a Map from each name to a category on the list (names it couldn't place are left out). */
export async function classifyNames(names, cats, app) {
  const list = [...new Set(names.map((n) => String(n || '').trim()).filter(Boolean))].slice(0, 60);
  if (!list.length || DEMO_MODE || !app) return new Map();
  const { getAI, getGenerativeModel, GoogleAIBackend, Schema } = await import('firebase/ai');
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const schema = Schema.object({
    properties: {
      items: Schema.array({ items: Schema.object({ properties: { name: Schema.string(), category: Schema.string() } }) }),
    },
  });
  const model = getGenerativeModel(ai, {
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 },
  });
  const result = await model.generateContent(PROMPT(list, cats));
  return pickCategories(JSON.parse(result.response.text()), list, cats);
}

// Keeps only answers that name an item we asked about and a category on the list.
export function pickCategories(parsed, asked, cats) {
  const out = new Map();
  const byLower = new Map(cats.map((c) => [c.toLowerCase(), c]));
  const askedLower = new Map(asked.map((n) => [n.toLowerCase(), n]));
  for (const row of parsed?.items || []) {
    const name = askedLower.get(String(row?.name || '').trim().toLowerCase());
    const cat = byLower.get(String(row?.category || '').trim().toLowerCase());
    if (name && cat) out.set(name, cat);
  }
  return out;
}

// Names the product in a photo, keeping the brand and the variety that makes it the right one
// ("Trader Joe's gluten-free bread"), so a photo can start a new list item.
export async function nameProduct(dataUrl, cats, app) {
  if (DEMO_MODE || !app) {
    return new Promise((res) => setTimeout(() => res({ name: "Trader Joe's gluten-free bread", category: cats.includes('Pantry') ? 'Pantry' : '' }), 700));
  }
  const { getAI, getGenerativeModel, GoogleAIBackend, Schema } = await import('firebase/ai');
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const schema = Schema.object({ properties: { name: Schema.string(), category: Schema.string() } });
  const model = getGenerativeModel(ai, {
    model: GEMINI_MODEL,
    generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 },
  });
  const prompt = `This photo shows a product someone wants on their household shopping list.
Give name: the product as a shopper would write it on a list, short, keeping the brand and the variety that tells it apart (for example "Trader Joe's gluten-free bread", "Tide Free & Clear detergent"). No sizes or prices. If no product is visible, give an empty name.
Give category: the one store section it belongs in, from: ${cats.join(' | ')}`;
  const result = await model.generateContent([prompt, { inlineData: { mimeType: 'image/jpeg', data: dataUrl.split(',')[1] } }]);
  const parsed = JSON.parse(result.response.text());
  const name = String(parsed?.name || '').trim().slice(0, 80);
  const category = cats.find((c) => c.toLowerCase() === String(parsed?.category || '').trim().toLowerCase()) || '';
  return { name, category };
}
