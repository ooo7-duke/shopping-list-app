// Spots occasions and projects on the list (Christmas, a birthday party, back to school)
// so related items can be grouped together. A theme becomes its own group only when two or
// more items on the list share it, so a lone "wrapping paper" stays in its usual type.

export const THEMES = [
  { name: 'Christmas', words: ['christmas', 'xmas', 'ornament', 'ornaments', 'tinsel', 'wreath', 'garland', 'stocking', 'stockings', 'nativity', 'advent', 'mistletoe', 'poinsettia', 'tree skirt', 'tree topper', 'candy cane', 'candy canes', 'gingerbread', 'eggnog', 'santa', 'reindeer', 'snowman', 'holiday lights', 'string lights', 'wrapping paper', 'gift wrap', 'gift tags', 'gift bags', 'christmas cards', 'holiday cards'] },
  { name: 'Thanksgiving', words: ['thanksgiving', 'cranberry sauce', 'stuffing', 'pumpkin pie', 'whole turkey', 'turkey baster', 'gravy', 'yams'] },
  { name: 'Halloween', words: ['halloween', 'costume', 'costumes', 'trick or treat', 'jack-o-lantern', 'carving pumpkin'] },
  { name: 'Easter', words: ['easter', 'egg dye', 'easter basket', 'plastic eggs'] },
  { name: "Valentine's Day", words: ['valentine', "valentine's", 'valentines'] },
  { name: 'Fourth of July', words: ['fourth of july', '4th of july', 'fireworks', 'sparklers'] },
  { name: 'New Year', words: ['new year', "new year's", 'champagne', 'party poppers', 'noisemakers'] },
  { name: 'Birthday party', words: ['birthday', 'balloons', 'balloon', 'party hats', 'candles for cake', 'birthday candles', 'party favors', 'piñata', 'pinata', 'streamers', 'cake topper'] },
  { name: 'Back to school', words: ['back to school', 'school supplies', 'backpack', 'lunchbox', 'lunch box', 'crayons', 'composition notebook', 'glue sticks', 'pencil case'] },
  { name: 'Baby', words: ['baby shower', 'diaper', 'diapers', 'wipes for baby', 'baby wipes', 'formula', 'onesie', 'onesies', 'pacifier', 'bottles for baby'] },
  { name: 'Camping', words: ['camping', 'tent', 'sleeping bag', 'lantern', 'bug spray', 'marshmallows', 'firewood', 'cooler'] },
  { name: 'Garden', words: ['garden', 'mulch', 'potting soil', 'fertilizer', 'seeds', 'plant food', 'weed killer', 'hose'] },
  { name: 'Moving', words: ['moving boxes', 'packing tape', 'bubble wrap', 'packing paper'] },
  { name: 'Game day', words: ['game day', 'super bowl', 'wings', 'tailgate'] },
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MATCHERS = THEMES.map((t) => ({
  name: t.name,
  re: new RegExp(`(^|[^a-z])(${t.words.map(esc).join('|')})([^a-z]|$)`, 'i'),
}));

export function themeOf(item) {
  const text = [item?.name, item?.note].filter(Boolean).join(' ').toLowerCase();
  if (!text) return null;
  for (const m of MATCHERS) if (m.re.test(text)) return m.name;
  return null;
}

// Themes that two or more of these items share, mapped to the items' ids.
export function sharedThemes(items, min = 2) {
  const by = new Map();
  for (const it of items) {
    const t = themeOf(it);
    if (!t) continue;
    if (!by.has(t)) by.set(t, []);
    by.get(t).push(it.id);
  }
  const out = new Map();
  for (const [t, ids] of by) if (ids.length >= min) for (const id of ids) out.set(id, t);
  return out;
}
