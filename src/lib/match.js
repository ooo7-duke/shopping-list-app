// Matching receipt lines ("GV 2% MLK GAL") to items on the list ("Milk").
// The AI already suggests a match; this is the local fallback and tiebreaker.

import { normalizeName } from './parse.js';

const ABBREV = {
  mlk: 'milk', wht: 'white', whl: 'whole', brd: 'bread', chkn: 'chicken', chk: 'chicken',
  brst: 'breast', bnls: 'boneless', sknls: 'skinless', grnd: 'ground', bf: 'beef', org: 'organic',
  tp: 'toilet paper', ppr: 'paper', twl: 'towel', twls: 'towel', det: 'detergent', ldry: 'laundry',
  lg: 'large', sm: 'small', xl: 'extra large', yog: 'yogurt', ygt: 'yogurt', chs: 'cheese',
  shrd: 'shredded', bttr: 'butter', vgtbl: 'vegetable', veg: 'vegetable', frz: 'frozen',
  bnna: 'banana', bnn: 'banana', strwb: 'strawberry', tom: 'tomato', pot: 'potato', onn: 'onion',
  dz: 'dozen', egg: 'egg', eggs: 'egg', crm: 'cream', cof: 'coffee', wtr: 'water', sda: 'soda',
  jce: 'juice', cer: 'cereal', pnt: 'peanut', btr: 'butter', dsh: 'dish', sp: 'soap', dsp: 'dish soap',
  gal: '', ct: '', oz: '', lb: '', pk: '', gv: '', ks: '', mm: '', ea: '', kirkland: '', great: '', value: '',
};

export function expandLine(text) {
  return normalizeName(text)
    .split(' ')
    .map((t) => (t in ABBREV ? ABBREV[t] : t))
    .filter((t) => t && !/^\d+$/.test(t))
    .join(' ')
    .trim();
}

function tokens(s) {
  return expandLine(s).split(' ').filter((t) => t.length > 1);
}

export function similarity(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.length || !B.length) return 0;
  let hits = 0;
  for (const x of A) {
    if (B.some((y) => y === x || (x.length >= 3 && y.length >= 3 && (y.startsWith(x.slice(0, 4)) || x.startsWith(y.slice(0, 4)))))) hits++;
  }
  // Fraction of the shorter name that is covered by the longer one.
  return hits / Math.min(A.length, B.length) * (0.75 + 0.25 * Math.min(A.length, B.length) / Math.max(A.length, B.length));
}

export function bestMatch(line, items) {
  const candidates = [line.matchName, line.name, line.rawText].filter(Boolean);
  // An exact match on the AI's suggested name wins outright.
  if (line.matchName) {
    const exact = items.find((it) => normalizeName(it.name) === normalizeName(line.matchName));
    if (exact) return { item: exact, score: 1 };
  }
  let best = null;
  let score = 0;
  for (const it of items) {
    for (const c of candidates) {
      const s = similarity(c, it.name);
      if (s > score) {
        score = s;
        best = it;
      }
    }
  }
  return score >= 0.55 ? { item: best, score } : { item: null, score };
}
