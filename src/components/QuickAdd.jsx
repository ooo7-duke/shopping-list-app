import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../AppContext.jsx';
import { parseQuickAdd, normalizeName } from '../lib/parse.js';
import { addEntries, isOnList, refreshPrices } from '../data/actions.js';
import { hasPriceProvider } from '../lib/prices.js';
import { fmtMoney, fmtQty } from '../lib/format.js';
import { MicIcon, PlusIcon } from './Icons.jsx';
import { saveErrorMessage } from '../lib/errors.js';

const SpeechRec = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export default function QuickAdd() {
  const { ctx, items, showToast } = useApp();
  const [text, setText] = useState('');
  const [sel, setSel] = useState(-1);
  const [listening, setListening] = useState(false);
  const inputRef = useRef();
  const recRef = useRef();

  const parsed = useMemo(() => parseQuickAdd(text), [text]);
  const first = parsed[0];

  // Catalog matches for the text after the last comma: re-adding a known item keeps its store, price and history.
  const suggestions = useMemo(() => {
    const last = text.split(/[,\n]/).pop().trim();
    const q = normalizeName(parseQuickAdd(last)[0]?.name || '');
    if (q.length < 2) return [];
    return items
      .filter((it) => !isOnList(it) && normalizeName(it.name).includes(q))
      .sort((a, b) => normalizeName(a.name).indexOf(q) - normalizeName(b.name).indexOf(q) || (b.lastPurchasedAt || 0) - (a.lastPurchasedAt || 0))
      .slice(0, 5);
  }, [text, items]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function submit(entries, label) {
    if (!entries.length) return;
    let result;
    try {
      result = await addEntries(ctx, entries);
    } catch (e) {
      console.error('Add failed', e);
      showToast(saveErrorMessage(e, 'add that'));
      return;
    }
    const { added, undo } = result;
    // Look up today's prices in the background; the list updates when they arrive.
    for (const a of added) refreshPrices(ctx, a).catch(() => {});
    const names = added.map((a) => a.name);
    const pricing = hasPriceProvider() ? '. Looking up prices.' : '';
    showToast(label || `Added ${names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')}${pricing}`, undo);
  }

  async function onSubmit(e) {
    e?.preventDefault();
    if (sel >= 0 && suggestions[sel]) return pickSuggestion(suggestions[sel]);
    const entries = parsed;
    setText('');
    setSel(-1);
    await submit(entries);
  }

  async function pickSuggestion(it) {
    const head = text.split(/[,\n]/).slice(0, -1).join(',');
    const before = parseQuickAdd(head);
    const lastParsed = parseQuickAdd(text.split(/[,\n]/).pop())[0] || {};
    setText('');
    setSel(-1);
    await submit([...before, { ...lastParsed, name: it.name, store: lastParsed.store || '', qty: lastParsed.qty !== 1 ? lastParsed.qty : it.qty || 1 }]);
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' && suggestions.length) { e.preventDefault(); setSel((s) => Math.min(s + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp' && suggestions.length) { e.preventDefault(); setSel((s) => Math.max(s - 1, -1)); }
    else if (e.key === 'Escape') { setText(''); setSel(-1); }
  }

  function onPaste(e) {
    const t = e.clipboardData?.getData('text') || '';
    if (/\n/.test(t.trim())) {
      e.preventDefault();
      submit(parseQuickAdd(t));
    }
  }

  function toggleVoice() {
    if (!SpeechRec) {
      showToast('Voice input works in Chrome, Edge and Safari.');
      return;
    }
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SpeechRec();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = '';
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript;
        else interim += ev.results[i][0].transcript;
      }
      setText(finalText + interim);
    };
    rec.onend = () => {
      setListening(false);
      if (finalText.trim()) {
        setText('');
        submit(parseQuickAdd(finalText, { voice: true }));
      }
    };
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }

  return (
    <div className="quickadd">
      <form className="qa-box" onSubmit={onSubmit} role="search">
        <label htmlFor="qa" className="sr-only">Add items</label>
        <input
          id="qa" ref={inputRef} value={text} autoComplete="off" enterKeyHint="done"
          placeholder="Add an item, like milk or eggs"
          onChange={(e) => { setText(e.target.value); setSel(-1); }}
          onKeyDown={onKeyDown} onPaste={onPaste}
          aria-autocomplete="list" aria-controls="qa-suggest"
        />
        <button type="button" className={`icon-btn${listening ? ' listening' : ''}`} onClick={toggleVoice} aria-label={listening ? 'Stop listening' : 'Add by voice'} title="Add by voice">
          <MicIcon />
        </button>
        {text.trim() && (
          <button type="submit" className="icon-btn" aria-label="Add" style={{ background: 'var(--bb)', color: 'var(--cream)' }}>
            <PlusIcon />
          </button>
        )}
      </form>
      {first && (
        <div className="qa-preview" aria-live="polite">
          <span className="chip blue">{first.name}</span>
          {(first.qty !== 1 || first.unit) && <span className="chip">Qty {fmtQty(first.qty, first.unit) || first.qty}</span>}
          {first.store && <span className="chip">@ {first.store}</span>}
          {first.category && <span className="chip"># {first.category}</span>}
          {first.price != null && <span className="chip">{fmtMoney(first.price)}</span>}
          {first.urgent && <span className="chip warn">Needed now</span>}
          {parsed.length > 1 && <span className="chip gold">+{parsed.length - 1} more</span>}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="qa-suggest" id="qa-suggest" role="listbox" aria-label="Items you've bought before">
          {suggestions.map((it, i) => (
            <button key={it.id} type="button" role="option" aria-selected={i === sel} onMouseDown={(e) => e.preventDefault()} onClick={() => pickSuggestion(it)}>
              <span className="grow ellipsis"><strong>{it.name}</strong> <span className="muted small">{[it.store, it.category].filter(Boolean).join(' · ')}</span></span>
              {it.lastPrice != null && <span className="small" style={{ fontWeight: 700 }}>{fmtMoney(it.lastPrice)}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
