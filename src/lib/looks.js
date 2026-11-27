// Color looks a person can pick for the app, built from Sola's design palette library.
// Every look is light, so white inputs and photos still sit well on it. Text colors are
// checked to reach 4.5:1 on the page and card colors (see lib.test.js).
export const LOOKS = [
  {
    id: 'blueberry', name: 'Blueberry and Cream',
    vars: { bb: '#243b8f', 'bb-ink': '#1c2c6b', 'bb-soft': '#e4e9f8', muted: '#4d5c96', cream: '#fdf1c9', card: '#fffbee', line: '#e9d898', 'line-soft': '#f1e5b5', gold: '#ffc20d', 'on-gold': '#1c2c6b', 'gold-ink': '#8a6500', 'gold-soft': '#fff3c4' },
  },
  {
    id: 'forest', name: 'Forest and Oat Milk',
    vars: { bb: '#1d4a35', 'bb-ink': '#173a2a', 'bb-soft': '#dfe9e2', muted: '#4a6255', cream: '#eee5d4', card: '#faf6ee', line: '#d6c8ad', 'line-soft': '#e7dcc8', gold: '#c2220c', 'on-gold': '#ffffff', 'gold-ink': '#a3220e', 'gold-soft': '#f8e1da' },
  },
  {
    id: 'clay', name: 'Clay and Butter',
    vars: { bb: '#6b352a', 'bb-ink': '#4a231b', 'bb-soft': '#f4e4d8', muted: '#76503f', cream: '#fff4b8', card: '#fffbe3', line: '#ead98a', 'line-soft': '#f3e7ae', gold: '#ffb7a5', 'on-gold': '#4a231b', 'gold-ink': '#8f3b25', 'gold-soft': '#ffe7df' },
  },
  {
    id: 'raspberry', name: 'Raspberry and Pale Sky',
    vars: { bb: '#ad1452', 'bb-ink': '#3d1028', 'bb-soft': '#fbe3ec', muted: '#6e3a52', cream: '#e0f2fe', card: '#f6fbff', line: '#b9dcf2', 'line-soft': '#d4eaf8', gold: '#f3c3c8', 'on-gold': '#3d1028', 'gold-ink': '#9c1148', 'gold-soft': '#fde8ec' },
  },
  {
    id: 'violet', name: 'Violet and Mist',
    vars: { bb: '#6a2ae0', 'bb-ink': '#2a1a4f', 'bb-soft': '#ece3ff', muted: '#5a5470', cream: '#f0f2f5', card: '#ffffff', line: '#d8dbe3', 'line-soft': '#e7e9ee', gold: '#c6ff24', 'on-gold': '#2a1a4f', 'gold-ink': '#4d6400', 'gold-soft': '#f1ffd0' },
  },
];

export const DEFAULT_LOOK = 'blueberry';
export const lookById = (id) => LOOKS.find((l) => l.id === id) || LOOKS[0];

const KEY = (uid) => `sla-look-${uid || 'anon'}`;
export function savedLookLocal(uid) {
  try { return localStorage.getItem(KEY(uid)); } catch { return null; }
}
export function rememberLookLocal(uid, id) {
  try { localStorage.setItem(KEY(uid), id); localStorage.setItem(KEY('last'), id); } catch { /* private mode */ }
}

export function applyLook(id) {
  const look = lookById(id);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(look.vars)) root.style.setProperty(`--${k}`, v);
  root.dataset.look = look.id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', look.vars.cream);
}

// WCAG contrast ratio of two #rrggbb colors.
export function contrast(a, b) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
