// "Shop online": the items still on the list, each with a link to that item on a store's own site.
// The app never checks out anywhere: the person adds each item to the cart on the store's site.
import { PRICE_STORES, searchQuery } from './prices.js';
import { linkHost } from './storeMatch.js';

// Stores you can shop online from here. Google Shopping isn't a store, so it isn't one of them.
export const ONLINE_STORES = PRICE_STORES.filter((s) => s.id !== 'any');

const DOMAINS = { samsclub: 'samsclub.com', amazon: 'amazon.com', walmart: 'walmart.com', target: 'target.com', costco: 'costco.com' };

// The link for one item at one store: the product page a price lookup found there, if it is on
// that store's own site, otherwise a search for the item on that site.
export function shopLink(item, storeId) {
  const store = ONLINE_STORES.find((s) => s.id === storeId) || ONLINE_STORES[0];
  const seen = item.seenPrices?.[store.id];
  const host = seen?.url ? linkHost(seen.url) : '';
  const own = host && (host === DOMAINS[store.id] || host.endsWith(`.${DOMAINS[store.id]}`));
  return { href: own ? seen.url : store.url(searchQuery(item)), exact: !!own, price: seen?.price != null && seen.by !== 'sample' ? Number(seen.price) : null };
}
