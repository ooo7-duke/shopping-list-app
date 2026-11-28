// Sorting items the keyword list doesn't know, with the same Gemini model that reads receipts
// (Firebase AI Logic, no API key in the app). Only names are sent, never photos or prices.
import { DEMO_MODE } from './config.js';
import { generateJSON } from './ai.js';

const PROMPT = (names, cats) => `You sort shopping list items into store sections for a household shopping app.
For each item, pick the one section a shopper would find it in. When no section is a perfect fit, pick the closest one.
Food is never "Other": frozen foods such as french fries go to Frozen, breakfast cereals such as Cheerios go to Pantry.${cats.includes('Electronics') ? '\nPhones, tablets, laptops, TVs, chargers, cables, headphones, game consoles and smart home devices go to Electronics, brand names included (Samsung Galaxy, Pixel, iPhone).' : ''}${cats.includes('Household') ? '\nHoliday decorations and lights, light bulbs, tools, cookware, linens, towels, home and garden goods go to Household.' : ''}
"Other" is a last resort: use it only for something that belongs in no store section at all, such as a gift card or a service.
SECTIONS: ${cats.join(' | ')}
ITEMS:
${names.map((n, i) => `${i + 1}. ${n}`).join('\n')}`;

/** Returns a Map from each name to a category on the list (names it couldn't place are left out). */
export async function classifyNames(names, cats, app) {
  const list = [...new Set(names.map((n) => String(n || '').trim()).filter(Boolean))].slice(0, 60);
  if (!list.length || DEMO_MODE || !app) return new Map();
  const { Schema } = await import('firebase/ai');
  const schema = Schema.object({
    properties: {
      items: Schema.array({ items: Schema.object({ properties: { name: Schema.string(), category: Schema.string() } }) }),
    },
  });
  return pickCategories(await generateJSON(app, { schema, temperature: 0 }, PROMPT(list, cats)), list, cats);
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
  const { Schema } = await import('firebase/ai');
  const schema = Schema.object({ properties: { name: Schema.string(), category: Schema.string() } });
  const prompt = `This photo shows a product someone wants on their household shopping list.
Give name: the product as a shopper would write it on a list, short, keeping the brand and the variety that tells it apart (for example "Trader Joe's gluten-free bread", "Tide Free & Clear detergent"). No sizes or prices. If no product is visible, give an empty name.
Give category: the one store section it belongs in, from: ${cats.join(' | ')}`;
  const parsed = await generateJSON(app, { schema, temperature: 0 }, [prompt, { inlineData: { mimeType: 'image/jpeg', data: dataUrl.split(',')[1] } }]);
  const name = String(parsed?.name || '').trim().slice(0, 80);
  const category = cats.find((c) => c.toLowerCase() === String(parsed?.category || '').trim().toLowerCase()) || '';
  return { name, category };
}
