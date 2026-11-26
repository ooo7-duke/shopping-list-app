// Natural-language quick add.
// "2 gal milk @costco #dairy $3.49!"  ->  { qty: 2, unit: 'gal', name: 'Milk', store: 'Costco', ... }
// "eggs, bread, 3 paper towels"       ->  three items
// Voice input also splits on the word "and" ("eggs and bread and milk").

const UNITS = {
  gal: 'gal', gals: 'gal', gallon: 'gal', gallons: 'gal',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  kg: 'kg', g: 'g', l: 'L', liter: 'L', liters: 'L', litre: 'L', ml: 'mL',
  pk: 'pack', pack: 'pack', packs: 'pack', box: 'box', boxes: 'box',
  bag: 'bag', bags: 'bag', dozen: 'dozen', doz: 'dozen', dz: 'dozen',
  ct: 'ct', count: 'ct', roll: 'roll', rolls: 'roll', case: 'case', cases: 'case',
  bottle: 'bottle', bottles: 'bottle', can: 'can', cans: 'can', jar: 'jar', jars: 'jar',
  ream: 'ream', reams: 'ream', carton: 'carton', cartons: 'carton', bunch: 'bunch', bunches: 'bunch',
  loaf: 'loaf', loaves: 'loaf', tub: 'tub', tubs: 'tub', tube: 'tube', tubes: 'tube',
};

const WORD_NUMBERS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };

function toNumber(s) {
  if (s == null) return null;
  const t = String(s).toLowerCase();
  if (t in WORD_NUMBERS) return WORD_NUMBERS[t];
  if (/^\d+\/\d+$/.test(t)) {
    const [a, b] = t.split('/').map(Number);
    return b ? a / b : null;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function titleCase(s) {
  return s.replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());
}

function cleanTag(s) {
  return titleCase(s.replace(/[_-]+/g, ' '));
}

export function splitEntries(text, { voice = false } = {}) {
  let parts = String(text || '').split(/[\n,;]+/);
  if (voice) parts = parts.flatMap((p) => p.split(/\s+(?:and|also|plus)\s+/i));
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function parseEntry(raw) {
  let s = ` ${String(raw).trim()} `;
  const out = { name: '', qty: 1, unit: '', store: '', category: '', price: null, urgent: false };

  // Urgent marker "!" anywhere (but not inside a word like "Yahoo!" at the start).
  if (/!\s*$/.test(s) || /\s!\s/.test(s)) {
    out.urgent = true;
    s = s.replace(/!+/g, ' ');
  }
  // @store, allows @"whole foods" or @whole_foods
  s = s.replace(/@"([^"]+)"|@([\w'&-]+)/g, (_, q, w) => {
    out.store = cleanTag(q || w);
    return ' ';
  });
  // #category
  s = s.replace(/#"([^"]+)"|#([\w&-]+)/g, (_, q, w) => {
    out.category = cleanTag(q || w);
    return ' ';
  });
  // $price
  s = s.replace(/\$\s?(\d+(?:\.\d{1,2})?)/g, (_, p) => {
    out.price = Number(p);
    return ' ';
  });
  // trailing "x2" / "×2" / "(2)"
  s = s.replace(/\s(?:x|×)\s?(\d+(?:\.\d+)?)\s*$/i, (_, n) => {
    out.qty = Number(n);
    return ' ';
  });
  s = s.replace(/\((\d+(?:\.\d+)?)\)\s*$/, (_, n) => {
    out.qty = Number(n);
    return ' ';
  });

  // Leading quantity + optional unit: "2 gal", "2x", "1/2 lb", "a dozen", "3 packs of"
  const m = s.match(/^\s*(\d+(?:\.\d+)?|\d+\/\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve)(?:x)?\s+([a-zA-Z]+)?\s*/i);
  if (m) {
    const n = toNumber(m[1]);
    const maybeUnit = m[2] ? m[2].toLowerCase() : '';
    // "a" / "an" only count when followed by a unit ("a dozen eggs"), so "a pple" style names are safe.
    const isArticle = /^(a|an)$/i.test(m[1]);
    if (n != null && (!isArticle || UNITS[maybeUnit])) {
      out.qty = n;
      if (UNITS[maybeUnit]) {
        out.unit = UNITS[maybeUnit];
        s = s.slice(m[0].length);
        s = s.replace(/^\s*of\s+/i, ' ');
      } else {
        s = s.slice(m[0].length - (m[2] ? m[2].length + 1 : 0));
      }
    }
  }
  if (out.unit === 'dozen') {
    out.qty = out.qty * 12;
    out.unit = '';
  }
  out.name = titleCase(s);
  return out;
}

export function parseQuickAdd(text, opts) {
  return splitEntries(text, opts).map(parseEntry).filter((e) => e.name);
}

export function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(\w{3,})s\b/g, '$1') // crude singular: "towels" -> "towel"
    .trim();
}
