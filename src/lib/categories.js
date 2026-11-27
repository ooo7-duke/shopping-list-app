// Category list and a keyword-based guesser so most items land in the right
// group without the user picking one.

export const HOUSEHOLD_CATEGORIES = [
  'Produce', 'Dairy & eggs', 'Meat & seafood', 'Bakery', 'Pantry', 'Frozen',
  'Beverages', 'Snacks', 'Household', 'Cleaning', 'Paper goods', 'Personal care',
  'Health', 'Baby', 'Pets', 'Office & stationery', 'Kitchen & breakroom',
  'Tech & electronics', 'Other',
];

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
  'Paper goods': ['paper towel', 'toilet paper', 'tissue', 'napkin', 'paper plate', 'kleenex'],
  'Personal care': ['shampoo', 'conditioner', 'soap', 'toothpaste', 'toothbrush', 'deodorant', 'lotion', 'razor', 'floss', 'body wash'],
  'Health': ['vitamin', 'tylenol', 'advil', 'ibuprofen', 'bandage', 'band-aid', 'medicine'],
  'Baby': ['diaper', 'formula', 'baby'],
  'Pets': ['dog food', 'cat food', 'litter', 'pet'],
  'Office & stationery': ['pen', 'pencil', 'stapler', 'staple', 'sticky note', 'post-it', 'folder', 'binder', 'notebook', 'envelope', 'tape', 'marker', 'highlighter', 'clip', 'label', 'scissors'],
  'Printing': ['toner', 'ink', 'printer paper', 'copy paper', 'ream', 'cartridge'],
  'Kitchen & breakroom': ['cups', 'plates', 'utensil', 'fork', 'spoon', 'foil', 'plastic wrap', 'ziploc', 'filter'],
  'Tech & electronics': ['battery', 'batteries', 'cable', 'charger', 'usb', 'mouse', 'keyboard', 'hdmi', 'headphone'],
  'Safety & first aid': ['first aid', 'gloves', 'mask', 'sanitizer'],
  'Mailing & shipping': ['stamp', 'box', 'mailer', 'bubble wrap', 'shipping'],
};

export function guessCategory(name, allowed = HOUSEHOLD_CATEGORIES) {
  const n = ` ${String(name || '').toLowerCase().replace(/[^a-z0-9&%' -]+/g, ' ')} `;
  let best = null;
  let bestLen = 0;
  for (const [cat, words] of Object.entries(KEYWORDS)) {
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
  if (!allowed.includes('Printing') && /toner|ink|ream|copy paper/.test(n)) return 'Office & stationery';
  return allowed.includes('Other') ? 'Other' : allowed[allowed.length - 1];
}
