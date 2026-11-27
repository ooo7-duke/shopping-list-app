import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import backend from './data/backend.js';
import { predictAll } from './lib/predict.js';
import { can } from './lib/config.js';
import { saveErrorMessage } from './lib/errors.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const ACTIVE_KEY = 'sla-active-account';

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still checking
  const [accounts, setAccounts] = useState(null);
  const [activeId, setActiveId] = useState(() => localStorage.getItem(ACTIVE_KEY));
  const [items, setItems] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [receipts, setReceipts] = useState([]);
  const [batches, setBatches] = useState([]);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();
  const showToastRef = useRef();

  useEffect(() => backend.onAuth(setUser), []);

  useEffect(() => {
    if (!user) { setAccounts(user === null ? [] : null); return undefined; }
    return backend.subscribeAccounts(user, setAccounts);
  }, [user]);

  const account = useMemo(() => {
    if (!accounts?.length) return null;
    return accounts.find((a) => a.id === activeId) || accounts[0];
  }, [accounts, activeId]);

  const role = account && user ? account.members?.[user.uid]?.role || 'editor' : null;

  useEffect(() => {
    if (!account) return undefined;
    const onError = (e) => showToastRef.current?.(saveErrorMessage(e, 'load your list'));
    const subs = [backend.subscribe(account.id, 'items', setItems, onError), backend.subscribe(account.id, 'batches', setBatches, onError)];
    if (can(role, 'spend')) {
      subs.push(backend.subscribe(account.id, 'purchases', setPurchases, onError), backend.subscribe(account.id, 'receipts', setReceipts, onError));
    } else {
      setPurchases([]);
      setReceipts([]);
    }
    return () => subs.forEach((u) => u());
  }, [account?.id, role]);

  const switchAccount = useCallback((id) => {
    localStorage.setItem(ACTIVE_KEY, id);
    setActiveId(id);
    setItems([]); setPurchases([]); setReceipts([]); setBatches([]);
  }, []);

  // Re-run predictions when data changes, and once an hour so "due in" stays fresh.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 3600e3);
    return () => clearInterval(t);
  }, []);
  const predictions = useMemo(() => predictAll(items, purchases), [items, purchases, tick]);

  const showToast = useCallback((message, undo) => {
    clearTimeout(toastTimer.current);
    setToast({ message, undo, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 6000 : 3500);
  }, []);
  showToastRef.current = showToast;

  const ctx = useMemo(() => ({ backend, accountId: account?.id, user, role, items, account }), [account, user, role, items]);

  const value = {
    backend, user, accounts, account, role, items, purchases, receipts, batches, predictions,
    switchAccount, ctx, toast, showToast, dismissToast: () => setToast(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
