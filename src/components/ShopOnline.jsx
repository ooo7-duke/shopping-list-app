import { useMemo, useState } from 'react';
import { useApp } from '../AppContext.jsx';
import Sheet from './Sheet.jsx';
import { isOnList } from '../data/actions.js';
import { ONLINE_STORES, shopLink } from '../lib/shopOnline.js';
import { fmtMoney, fmtQty } from '../lib/format.js';

const STORE_KEY = 'sla-shop-online-store';

// Opened from the cart at the top right. Pick a store, then tap each item to open it on that
// store's site and add it to the cart there. Items tapped are ticked so you can see what's left.
export default function ShopOnline({ onClose }) {
  const { items } = useApp();
  const [storeId, setStoreId] = useState(() => {
    try { const s = localStorage.getItem(STORE_KEY); if (ONLINE_STORES.some((x) => x.id === s)) return s; } catch { /* private mode */ }
    return ONLINE_STORES[0].id;
  });
  const [opened, setOpened] = useState(() => new Set());
  const pick = (id) => {
    setStoreId(id);
    try { localStorage.setItem(STORE_KEY, id); } catch { /* private mode */ }
  };
  const list = useMemo(
    () => items.filter((it) => isOnList(it) && it.status !== 'ordered').sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0) || a.name.localeCompare(b.name)),
    [items],
  );
  const store = ONLINE_STORES.find((s) => s.id === storeId);
  const left = list.filter((it) => !opened.has(`${storeId}:${it.id}`)).length;

  return (
    <Sheet title="Shop online" onClose={onClose}>
      <p className="small muted" style={{ marginTop: 0 }}>Pick a store, then tap each item to open it on that store's site and add it to your cart there.</p>
      <div className="shop-stores" role="group" aria-label="Store">
        {ONLINE_STORES.map((s) => (
          <button key={s.id} type="button" aria-pressed={s.id === storeId} onClick={() => pick(s.id)}>{s.name}</button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="muted">Nothing on the list right now.</p>
      ) : (
        <>
          <p className="small muted" style={{ margin: '10px 0 6px' }}>
            {left === list.length ? `${list.length} ${list.length === 1 ? 'item' : 'items'} on the list` : `${list.length - left} of ${list.length} opened at ${store.name}`}
          </p>
          <ul className="shop-list">
            {list.map((it) => {
              const link = shopLink(it, storeId);
              const done = opened.has(`${storeId}:${it.id}`);
              const qty = fmtQty(it.qty, it.unit);
              return (
                <li key={it.id} className={done ? 'done' : ''}>
                  <a href={link.href} target="_blank" rel="noopener noreferrer"
                    onClick={() => setOpened((s) => new Set(s).add(`${storeId}:${it.id}`))}
                    aria-label={`Open ${it.name} at ${store.name}${done ? ', opened' : ''}`}>
                    <span className="tick" aria-hidden="true">{done ? '✓' : ''}</span>
                    <span className="grow">
                      <strong>{it.name}</strong>{qty && qty !== '1' && <span className="muted"> · {qty}</span>}
                      <span className="tiny muted" style={{ display: 'block' }}>
                        {link.exact ? `Product page at ${store.name}` : `Search ${store.name}`}{link.price != null ? ` · ${fmtMoney(link.price)} last seen` : ''}
                      </span>
                    </span>
                    <span className="go" aria-hidden="true">↗</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Sheet>
  );
}
