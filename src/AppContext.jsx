import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import backend from './data/backend.js';
import { predictAll } from './lib/predict.js';
import { can } from './lib/config.js';
import { saveErrorMessage } from './lib/errors.js';
import { setPriceAccount } from './lib/prices.js';
import { applyLook, rememberLookLocal, savedLookLocal, lookById } from './lib/looks.js';
import { foldCategory, householdCategories, isHouseholdList } from './lib/categories.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const ACTIVE_KEY = 'sla-active-account';

export function AppProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still checking
  const [accounts, setAccounts] = useState(null);
  const [activeId, setActiveId] = useState(() => localStorage.getItem(ACTIVE_KEY));
  const [rawItems, setItems] = useState([]);
  const [rawPurchases, setPurchases] = useState([]);
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

  // Invites waiting for this Google account. Shown everywhere in the app, not only on the
  // first screen, so someone who already started their own list can still join another.
  const [myInvites, setMyInvites] = useState([]);
  useEffect(() => {
    if (!user) { setMyInvites([]); return undefined; }
    return backend.subscribeMyInvites(user, setMyInvites);
  }, [user?.uid]);
  const invites = useMemo(
    () => myInvites.filter((iv) => !(accounts || []).some((a) => a.id === iv.accountId)),
    [myInvites, accounts],
  );

  const account = useMemo(() => {
    if (!accounts?.length) return null;
    const a = accounts.find((x) => x.id === activeId) || accounts[0];
    // Household lists use the broad store-order groups, whatever older list they started with.
    return isHouseholdList(a) ? { ...a, categories: householdCategories(a.categories) } : a;
  }, [accounts, activeId]);

  useEffect(() => { setPriceAccount(account?.id); }, [account?.id]);

  // Items saved under an older fine group show in the broad group that now holds it.
  const foldAll = useCallback((rows) => {
    const cats = account?.categories;
    if (!cats || !isHouseholdList(account) || !rows.some((r) => foldCategory(r.category, cats) !== r.category)) return rows;
    return rows.map((r) => { const c = foldCategory(r.category, cats); return c === r.category ? r : { ...r, category: c }; });
  }, [account]);
  const items = useMemo(() => foldAll(rawItems), [rawItems, foldAll]);
  const purchases = useMemo(() => foldAll(rawPurchases), [rawPurchases, foldAll]);

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

  const joinInvite = useCallback(async (iv) => {
    try {
      await backend.acceptInvite(iv, user);
      switchAccount(iv.accountId);
      showToastRef.current?.(`You joined ${iv.accountName}.`);
    } catch (e) {
      showToastRef.current?.(`Couldn't join: ${e?.message || e}`);
    }
  }, [user, switchAccount]);

  // Re-run predictions when data changes, and once an hour so "due in" stays fresh.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 3600e3);
    return () => clearInterval(t);
  }, []);
  const predictions = useMemo(() => predictAll(items, purchases), [items, purchases, tick]);

  const showToast = useCallback((message, undo, ms) => {
    clearTimeout(toastTimer.current);
    setToast({ message, undo, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), ms || (undo || String(message).length > 60 ? 6000 : 3500));
  }, []);
  showToastRef.current = showToast;

  // Each person's color look, saved on every list they belong to so it follows them to
  // other devices, and on this device so it paints before the lists load.
  const look = lookById((user && account?.settings?.looks?.[user.uid]) || savedLookLocal(user?.uid) || savedLookLocal('last')).id;
  useEffect(() => { applyLook(look); if (user) rememberLookLocal(user.uid, look); }, [look, user?.uid]);
  const setLook = useCallback(async (id) => {
    if (!user) return;
    applyLook(id);
    rememberLookLocal(user.uid, id);
    await Promise.all((accounts || []).map((a) => backend.updateAccount(a.id, { [`settings.looks.${user.uid}`]: id }).catch(() => {})));
  }, [user, accounts]);

  const ctx = useMemo(() => ({ backend, accountId: account?.id, user, role, items, account }), [account, user, role, items]);

  const value = {
    backend, user, accounts, account, role, items, purchases, receipts, batches, predictions,
    switchAccount, invites, joinInvite, ctx, look, setLook, toast, showToast, dismissToast: () => setToast(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
