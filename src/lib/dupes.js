import { normalizeName } from './parse.js';

// Words that say little about what the item is, so "a bag of apples" still matches "apples".
const FILLER = new Set(['a', 'an', 'the', 'of', 'and', 'for', 'with', 'some', 'more', 'bag', 'box', 'pack', 'can', 'jar', 'bottle']);

const words = (name) => normalizeName(name).split(' ').filter((w) => w && !FILLER.has(w));

// Edit distance, capped: only small typos matter here.
function closeSpelling(a, b) {
  if (Math.abs(a.length - b.length) > 2) return false;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length] <= (Math.min(a.length, b.length) >= 8 ? 2 : 1);
}

/**
 * How a new name relates to one already on the list:
 * 'same'  — the same item ("Paper towels" vs "paper towel")
 * 'close' — probably the same thing ("milk" vs "2% milk", "bananna" vs "banana")
 * null    — different items
 */
export function matchKind(newName, oldName) {
  const a = normalizeName(newName);
  const b = normalizeName(oldName);
  if (!a || !b) return null;
  if (a === b) return 'same';
  const wa = words(newName);
  const wb = words(oldName);
  if (!wa.length || !wb.length) return null;
  if (wa.join(' ') === wb.join(' ')) return 'same';
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  // Every real word of the shorter name appears in the longer one, and it says enough to mean the same thing.
  if (short.some((w) => w.length >= 3) && long.length - short.length <= 2 && short.every((w) => long.includes(w))) return 'close';
  const ja = wa.join('');
  const jb = wb.join('');
  // A typo, not a different word: long enough, and the same first two letters ("bananna", not "toffee" for "coffee").
  if (ja.length >= 6 && jb.length >= 6 && ja.slice(0, 2) === jb.slice(0, 2) && closeSpelling(ja, jb)) return 'close';
  return null;
}

/**
 * Entries that would duplicate an item already on the list, or each other.
 * Returns [{ entry, match, kind }] where match is the item on the list or the earlier entry.
 */
export function findDuplicates(entries, onList) {
  const out = [];
  entries.forEach((entry, i) => {
    let best = null;
    for (const it of onList) {
      const kind = matchKind(entry.name, it.name);
      if (kind && (!best || (kind === 'same' && best.kind !== 'same'))) best = { entry, match: it, kind, onList: true };
    }
    if (!best) {
      for (const earlier of entries.slice(0, i)) {
        const kind = matchKind(entry.name, earlier.name);
        if (kind) { best = { entry, match: earlier, kind, onList: false }; break; }
      }
    }
    if (best) out.push(best);
  });
  return out;
}

/**
 * Items on the list that match what is being typed, so "sa" finds Salt and Salsa before the name is finished.
 * Every typed word has to start a word of the item's name. Best matches first: whole names, then by position.
 */
export function listMatches(query, onList, limit = 4) {
  const q = normalizeName(query).split(' ').filter(Boolean);
  const typed = q.filter((w) => !FILLER.has(w));
  const want = typed.length ? typed : q;
  if (!want.length || want.join('').length < 2) return [];
  const scored = [];
  for (const it of onList) {
    const ws = normalizeName(it.name).split(' ').filter(Boolean);
    const at = want.map((w) => ws.findIndex((x) => x.startsWith(w)));
    if (at.some((i) => i < 0)) continue;
    const whole = want.every((w) => ws.includes(w));
    scored.push({ it, score: (whole ? 0 : 100) + Math.min(...at) * 10 + ws.length });
  }
  scored.sort((a, b) => a.score - b.score || a.it.name.localeCompare(b.it.name));
  return scored.slice(0, limit).map((s) => s.it);
}
