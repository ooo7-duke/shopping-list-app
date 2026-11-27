// Category list and a keyword-based guesser so most items land in the right
// group without the user picking one.

// Household lists use a few broad groups, in the order you walk a typical store.
export const HOUSEHOLD_CATEGORIES = [
  'Produce', 'Meat, dairy & eggs', 'Frozen', 'Pantry', 'Household',
  'Health & personal care', 'Pets', 'Electronics', 'Other',
];

// The finer groups older household lists used, and the broad group each now belongs to.
export const HOUSEHOLD_FOLD = {
  'Dairy & eggs': 'Meat, dairy & eggs', 'Meat & seafood': 'Meat, dairy & eggs',
  'Bakery': 'Pantry', 'Snacks': 'Pantry', 'Beverages': 'Pantry',
  'Cleaning': 'Household', 'Paper goods': 'Household', 'Kitchen & breakroom': 'Household',
  'Office & stationery': 'Household', 'Tech & electronics': 'Electronics', 'Printing': 'Household',
  'Mailing & shipping': 'Household', 'Furniture': 'Household', 'Event supplies': 'Household',
  'Personal care': 'Health & personal care', 'Health': 'Health & personal care',
  'Baby': 'Health & personal care', 'Safety & first aid': 'Health & personal care',
};

export const ORG_CATEGORIES = [
  'Office & stationery', 'Printing', 'Kitchen & breakroom', 'Beverages', 'Snacks',
  'Cleaning', 'Paper goods', 'Tech & electronics', 'Furniture', 'Safety & first aid',
  'Mailing & shipping', 'Event supplies', 'Other',
];

const KEYWORDS = {
  'Produce': ['eggplant', 'apple', 'banana', 'orange', 'lemon', 'lime', 'lettuce', 'spinach', 'kale', 'tomato', 'onion', 'garlic', 'potato', 'carrot', 'pepper', 'cucumber', 'avocado', 'berries', 'strawberr', 'blueberr', 'grape', 'broccoli', 'celery', 'mushroom', 'plantain', 'yam', 'ginger', 'cilantro', 'parsley', 'fruit', 'veg'],
  'Dairy & eggs': ['milk', 'egg', 'cheese', 'yogurt', 'yoghurt', 'butter', 'cream', 'creamer'],
  'Meat & seafood': ['deli', 'lunch meat', 'sandwich meat', 'salami', 'bologna', 'pepperoni', 'hot dog', 'chicken', 'beef', 'pork', 'turkey', 'fish', 'salmon', 'shrimp', 'tilapia', 'sausage', 'bacon', 'ham', 'goat', 'lamb', 'steak', 'ground'],
  'Bakery': ['bread', 'bagel', 'bun', 'roll', 'tortilla', 'muffin', 'croissant', 'cake'],
  'Pantry': ['cheerios', 'frosted flakes', 'corn flakes', 'raisin bran', 'rice krispies', 'chex', 'lucky charms', 'froot loops', 'cinnamon toast crunch', 'grits', 'noodle', 'ramen', 'spaghetti', 'macaroni', 'garri', 'semolina', 'cornmeal', 'tomato paste', 'bouillon', 'maggi', 'mustard', 'salsa', 'olive', 'oatmeal', 'pancake', 'syrup', 'rice', 'pasta', 'flour', 'sugar', 'salt', 'oil', 'beans', 'cereal', 'oat', 'spice', 'sauce', 'ketchup', 'mayo', 'honey', 'peanut butter', 'jam', 'canned', 'soup', 'broth', 'seasoning', 'vinegar'],
  'Frozen': ['frozen', 'ice cream', 'pizza', 'french fries', 'fries', 'tater tot', 'hash brown', 'nugget', 'popsicle', 'frozen waffle', 'eggo', 'fish stick'],
  'Beverages': ['drink', 'lemonade', 'malt', 'water', 'juice', 'soda', 'coffee', 'tea', 'pop', 'sparkling', 'gatorade', 'k-cup', 'kcup'],
  'Snacks': ['chips', 'cookie', 'cracker', 'snack', 'popcorn', 'nuts', 'granola', 'candy', 'chocolate'],
  'Cleaning': ['detergent', 'bleach', 'cleaner', 'disinfect', 'lysol', 'clorox', 'sponge', 'dish soap', 'dishwasher', 'trash bag', 'garbage bag', 'mop', 'windex', 'wipes'],
  'Paper goods': ['paper goods', 'paper towel', 'toilet paper', 'tissue', 'napkin', 'paper plate', 'kleenex'],
  'Household': ['christmas tree', 'xmas tree', 'christmas decor', 'christmas lights', 'holiday decor', 'decoration', 'ornament', 'wreath', 'garland', 'tinsel', 'string lights', 'fairy lights', 'lights', 'light bulb', 'bulb', 'lamp', 'candle', 'extension cord', 'power strip', 'towel', 'bath mat', 'bed sheet', 'sheet set', 'pillow', 'blanket', 'comforter', 'duvet', 'curtain', 'rug', 'hanger', 'storage bin', 'basket', 'shelf', 'hook', 'picture frame', 'vase', 'air filter', 'furnace filter', 'smoke detector', 'tool', 'screwdriver', 'hammer', 'drill', 'wrench', 'pliers', 'screws', 'nails', 'glue', 'duct tape', 'paint', 'skillet', 'frying pan', 'saucepan', 'pots and pans', 'cookware', 'knife', 'cutting board', 'mug', 'water filter', 'umbrella', 'doormat', 'flower pot', 'potting soil', 'fertilizer', 'hose', 'gift wrap', 'wrapping paper', 'gift bag', 'balloon'],
  'Personal care': ['nail polish', 'nail clipper', 'shampoo', 'conditioner', 'soap', 'toothpaste', 'toothbrush', 'deodorant', 'lotion', 'razor', 'floss', 'body wash'],
  'Health': ['vitamin', 'tylenol', 'advil', 'ibuprofen', 'bandage', 'band-aid', 'medicine'],
  'Baby': ['diaper', 'formula', 'baby'],
  'Pets': ['dog food', 'cat food', 'litter', 'pet'],
  'Office & stationery': ['pen', 'pencil', 'stapler', 'staple', 'sticky note', 'post-it', 'folder', 'binder', 'notebook', 'envelope', 'tape', 'marker', 'highlighter', 'clip', 'label', 'scissors'],
  'Printing': ['toner', 'ink', 'printer paper', 'copy paper', 'ream', 'cartridge'],
  'Kitchen & breakroom': ['cups', 'plates', 'utensil', 'fork', 'spoon', 'foil', 'plastic wrap', 'ziploc', 'filter'],
  'Tech & electronics': ['samsung', 'galaxy', 'pixel', 'android', 'motorola', 'oneplus', 'phone case', 'screen protector', 'earphone', 'bluetooth', 'wireless charger', 'power bank', 'alexa', 'echo dot', 'roku', 'fire stick', 'firestick', 'chromecast', 'apple tv', 'ring doorbell', 'smart plug', 'smart bulb', 'surge protector', 'sd card', 'memory card', 'flash drive', 'thumb drive', 'gaming', 'controller', 'projector', 'dvd', 'blu-ray', 'computer', 'desktop', 'battery', 'batteries', 'cable', 'charger', 'usb', 'mouse', 'keyboard', 'hdmi', 'headphone', 'earbud', 'airpods', 'laptop', 'chromebook', 'macbook', 'tablet', 'ipad', 'iphone', 'smartphone', 'phone', 'monitor', 'tv', 'television', 'camera', 'webcam', 'speaker', 'soundbar', 'router', 'smartwatch', 'apple watch', 'kindle', 'console', 'playstation', 'xbox', 'nintendo', 'ssd', 'hard drive'],
  'Safety & first aid': ['first aid', 'gloves', 'mask', 'sanitizer'],
  'Mailing & shipping': ['stamp', 'box', 'mailer', 'bubble wrap', 'shipping'],
};

// Every fine-grained group the keyword list knows, for routing items to the right store.
export const ALL_FINE_CATEGORIES = [...Object.keys(KEYWORDS), 'Other'];

// A fine group this list doesn't have becomes the broad group that holds it, when the list
// has that one. Workplace lists keep their own groups.
export function foldCategory(cat, allowed = HOUSEHOLD_CATEGORIES) {
  if (!cat || allowed.includes(cat)) return cat;
  const broad = HOUSEHOLD_FOLD[cat];
  return broad && allowed.includes(broad) ? broad : cat;
}

// A household list's groups, with old fine groups replaced by the broad ones, in store order.
export function householdCategories(cats) {
  const extra = (cats || []).filter((c) => !HOUSEHOLD_CATEGORIES.includes(c) && !HOUSEHOLD_FOLD[c]);
  return [...HOUSEHOLD_CATEGORIES.slice(0, -1), ...extra, 'Other'];
}
export const isHouseholdList = (account) => account?.type === 'household' || (!account?.type && (account?.categories || []).includes('Pantry'));

export function guessCategory(name, allowed = HOUSEHOLD_CATEGORIES) {
  const n = ` ${String(name || '').toLowerCase().replace(/[^a-z0-9&%' -]+/g, ' ')} `;
  let best = null;
  let bestLen = 0;
  for (const [key, words] of Object.entries(KEYWORDS)) {
    const cat = foldCategory(key, allowed);
    if (!allowed.includes(cat)) continue;
    for (const w of words) {
      // Match at the start of a word, so "drink" isn't ink and "foil" isn't oil.
      if (n.includes(` ${w}`) && w.length > bestLen) {
        best = cat;
        bestLen = w.length;
      }
    }
  }
  if (best) return best;
  // Fall back to a sibling category that exists in this account's list.
  if (!allowed.includes('Printing') && /toner|ink|ream|copy paper/.test(n)) return foldCategory('Office & stationery', allowed);
  return allowed.includes('Other') ? 'Other' : allowed[allowed.length - 1];
}
