import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppProvider, useApp } from './AppContext.jsx';
import ListView from './components/ListView.jsx';
import TripsView from './components/TripsView.jsx';
import ReceiptsView from './components/ReceiptsView.jsx';
import InsightsView from './components/InsightsView.jsx';
import AccountSheet from './components/AccountSheet.jsx';
import ShopOnline from './components/ShopOnline.jsx';
import { SignIn, Onboarding, InviteBanner } from './components/Welcome.jsx';
import { LookupMeter, BackToTop, LookPicker } from './components/PageExtras.jsx';
import { ListIcon, CartIcon, ReceiptIcon, ChartIcon, ChevronDown, LogoMark, MenuIcon } from './components/Icons.jsx';
import { isOnList } from './data/actions.js';
import { can, DEMO_MODE, APP_NAME } from './lib/config.js';
import { initials } from './lib/format.js';

const TABS = [
  { id: 'list', label: 'List', Icon: ListIcon },
  { id: 'trips', label: 'Trips', Icon: CartIcon },
  { id: 'receipts', label: 'Receipts', Icon: ReceiptIcon, spend: true },
  { id: 'insights', label: 'Insights', Icon: ChartIcon, spend: true },
];

function useHashTab() {
  const read = () => (location.hash.replace('#/', '') || 'list');
  const [tab, setTab] = useState(read);
  useEffect(() => {
    const on = () => setTab(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [tab, (t) => { location.hash = `/${t}`; window.scrollTo(0, 0); }];
}

function Shell() {
  const { user, accounts, account, role, items, toast, dismissToast } = useApp();
  const [tab, go] = useHashTab();
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  const [shop, setShop] = useState(false);
  const headRef = useRef();

  useEffect(() => {
    if (!menu) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMenu(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  useLayoutEffect(() => {
    if (!headRef.current) return undefined;
    const ro = new ResizeObserver(([e]) => document.documentElement.style.setProperty('--top-h', `${Math.round(e.target.getBoundingClientRect().height)}px`));
    ro.observe(headRef.current);
    return () => ro.disconnect();
  });

  if (user === undefined || (user && accounts === null)) return <div className="signin"><LogoMark width="56" height="56" /></div>;
  if (!user) return <SignIn />;
  if (!account) return <Onboarding />;

  const tabs = TABS.filter((t) => !t.spend || can(role, 'spend'));
  const current = tabs.find((t) => t.id === tab) ? tab : 'list';
  const listCount = items.filter((i) => isOnList(i) && i.status !== 'ordered').length;
  const View = { list: ListView, trips: TripsView, receipts: ReceiptsView, insights: InsightsView }[current];

  return (
    <div className="app">
      <header className="topwrap" ref={headRef}>
        {DEMO_MODE && <div className="demo-banner">Demo mode · sample data on this device only</div>}
        <div className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu} aria-controls="main-menu">
            <MenuIcon />
            {listCount > 0 && <span className="badge">{listCount}</span>}
          </button>
          <button type="button" className="acct grow" onClick={() => setSheet(true)} aria-label="Accounts and people">
            <h1 className="ellipsis">{account.name}</h1>
            <span className="page-name">· {tabs.find((t) => t.id === current)?.label}</span>
            <ChevronDown width="20" height="20" style={{ color: 'var(--bb)', flex: 'none' }} />
          </button>
          <button type="button" className="icon-btn shop-btn" onClick={() => setShop(true)} aria-label="Shop online" title="Shop online">
            <CartIcon />
          </button>
          <button type="button" className="avatar" onClick={() => setSheet(true)} aria-label="Account menu" style={{ cursor: 'pointer' }}>
            {user.photo ? <img src={user.photo} alt="" referrerPolicy="no-referrer" /> : initials(user.name)}
          </button>
        </div>
      </header>

      {/* On a phone the menu slides in from the hamburger; on a wider screen it stays open on the left. */}
      {menu && <div className="menu-scrim" onClick={() => setMenu(false)} />}
      <nav id="main-menu" className={`menu${menu ? ' open' : ''}`} aria-label="Main">
        <div className="brand"><LogoMark width="30" height="30" /> {APP_NAME}</div>
        {tabs.map(({ id, label, Icon }) => (
          <button key={id} type="button" aria-current={current === id ? 'page' : undefined} onClick={() => { go(id); setMenu(false); }}>
            <Icon />
            <span>{label}</span>
            {id === 'list' && listCount > 0 && <span className="badge">{listCount}</span>}
          </button>
        ))}
      </nav>

      <main className={current === 'insights' || current === 'trips' ? 'wide' : ''}>
        <InviteBanner />
        <View />
        <LookPicker />
        <LookupMeter />
      </main>
      <BackToTop />

      {sheet && <AccountSheet onClose={() => setSheet(false)} />}
      {shop && <ShopOnline onClose={() => setShop(false)} />}
      {toast && (
        <div className="toast" role="status" key={toast.key}>
          <span>{toast.message}</span>
          {toast.undo && <button type="button" onClick={() => { toast.undo(); dismissToast(); }}>Undo</button>}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>;
}
