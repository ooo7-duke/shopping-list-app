import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../AppContext.jsx';
import { parseQuickAdd, normalizeName } from '../lib/parse.js';
import { addEntries, isOnList } from '../data/actions.js';
import { fmtMoney, fmtQty } from '../lib/format.js';
import { MicIcon, PlusIcon, CameraIcon, CloseIcon } from './Icons.jsx';
import { compressImage } from '../lib/receipts.js';
import { saveErrorMessage } from '../lib/errors.js';
import { findDuplicates, listMatches } from '../lib/dupes.js';
import { guessCategory, HOUSEHOLD_CATEGORIES } from '../lib/categories.js';
import { classifyNames, nameProduct } from '../lib/classify.js';
import { DEMO_MODE } from '../lib/config.js';

const SpeechRec = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export default function QuickAdd({ onJump }) {
  const { ctx, items, showToast } = useApp();
  const [text, setText] = useState('');
  const [sel, setSel] = useState(-1);
  const [listening, setListening] = useState(false);
  const [pending, setPending] = useState(null); // entries held back because some look like duplicates
  const inputRef = useRef();
  const recRef = useRef();
  const photoRef = useRef();
  const [photo, setPhoto] = useState(null); // a product photo waiting to go on the next item added
  const [photoBusy, setPhotoBusy] = useState(false);

  const parsed = useMemo(() => parseQuickAdd(text), [text]);
  const first = parsed[0];
  // Items this device just added are left out of the checks for a few seconds. The list updates the
  // moment an item is saved, and a phone keyboard can put the typed word back in the box right after
  // Add (Android does this when Enter is pressed mid-word), which would then read as a duplicate.
  const justAdded = useRef({ ids: new Set(), names: new Set(), at: 0 });
  const [tick, refresh] = useState(0);
  const fresh = () => Date.now() - justAdded.current.at < 4000;
  const onList = useMemo(
    () => items.filter((it) => isOnList(it) && !(fresh() && justAdded.current.ids.has(it.id))),
    [items, text, tick], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // Shown live while typing, and again (with buttons) if Add is pressed anyway.
  const liveDupes = useMemo(() => findDuplicates(parsed, onList), [parsed, onList]);
  const dupes = pending ? pending.dupes : liveDupes;

  // While typing, look through the list for the name after the last comma, so "sal" already shows Salt.
  const typedMatches = useMemo(() => {
    const last = text.split(/[,\n]/).pop().trim();
    const name = parseQuickAdd(last)[0]?.name || '';
    const seen = new Set(liveDupes.filter((d) => d.onList).map((d) => d.match.id));
    return listMatches(name, onList, 5).filter((it) => !seen.has(it.id));
  }, [text, onList, liveDupes]);

  // Sort each item into a type as it's typed: the word list answers at once, and for names it doesn't
  // know the AI is asked once typing pauses, so the item lands in the right group when it's added.
  const cats = ctx.account?.categories || HOUSEHOLD_CATEGORIES;
  const aiTypes = useRef(new Map()); // lowercased name -> type, or null while asking
  const [, bump] = useState(0);
  const typeFor = (e) => {
    if (e.category) return e.category;
    const word = guessCategory(e.name, cats);
    if (word && word !== 'Other') return word;
    return aiTypes.current.get(e.name.trim().toLowerCase()) || word || 'Other';
  };
  const unknown = parsed.filter((e) => !e.category && (guessCategory(e.name, cats) || 'Other') === 'Other' && !aiTypes.current.has(e.name.trim().toLowerCase()));
  const unknownKey = unknown.map((e) => e.name.trim().toLowerCase()).join('|');
  useEffect(() => {
    if (!unknownKey || DEMO_MODE) return undefined;
    const t = setTimeout(async () => {
      const names = unknownKey.split('|').filter((n) => n.length >= 3);
      if (!names.length) return;
      names.forEach((n) => aiTypes.current.set(n, null));
      bump((x) => x + 1);
      try {
        const found = await classifyNames(names, cats, ctx.backend.getApp?.());
        for (const [n, c] of found) aiTypes.current.set(n.toLowerCase(), c);
      } catch (err) {
        console.warn('Sorting while typing failed', err);
      }
      names.forEach((n) => { if (aiTypes.current.get(n) === null) aiTypes.current.set(n, 'Other'); });
      bump((x) => x + 1);
    }, 600);
    return () => clearTimeout(t);
  }, [unknownKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const withTypes = (entries) => entries.map((e) => {
    const c = typeFor(e);
    return c && c !== 'Other' && !e.category ? { ...e, category: c } : e;
  });
  const firstSorting = first && !first.category && aiTypes.current.get(first.name.trim().toLowerCase()) === null;
  const firstType = first && typeFor(first);

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
      result = await addEntries(ctx, withTypes(entries));
    } catch (e) {
      console.error('Add failed', e);
      showToast(saveErrorMessage(e, 'add that'));
      return false;
    }
    const { added, undo } = result;
    if (entries.some((e) => e.photo)) setPhoto(null);
    justAdded.current = { ids: new Set(added.map((a) => a.id)), names: new Set(entries.map((e) => normalizeName(e.name))), at: Date.now() };
    setTimeout(() => refresh((x) => x + 1), 4100);
    // Prices are looked up only when someone taps Look up prices on the item, to save searches.
    const names = added.map((a) => a.name);
    showToast(label || `Added ${names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')}`, undo);
    return true;
  }

  // Holds the add when something looks like a duplicate, so the banner can ask first.
  // The box is cleared before saving: the list updates the moment the item is written, and
  // text still in the box would then flash "already on your list" for the item just added.
  // If the save fails, the typed text comes back.
  async function tryAdd(entries, { clear = false } = {}) {
    // Only an exact match holds the add. A look-alike ("milk" and "almond milk") is shown while
    // typing but never stops the add, since it is often a different item.
    const found = findDuplicates(entries, onList).filter((d) => d.kind === 'same');
    if (found.length) { setPending({ entries, dupes: found }); return false; }
    const typed = text;
    if (clear) { setText(''); setSel(-1); }
    const ok = await submit(entries);
    if (!ok && clear) setText(typed);
    return true;
  }

  async function addAnyway() {
    const p = pending;
    setPending(null);
    setText('');
    if (p) await submit(p.entries);
    inputRef.current?.focus();
  }

  async function skipDupes() {
    const p = pending;
    setPending(null);
    setText('');
    if (!p) return;
    const skip = new Set(p.dupes.map((d) => d.entry));
    const rest = p.entries.filter((e) => !skip.has(e));
    if (rest.length) await submit(rest);
    else showToast(p.dupes.length === 1 ? `Left ${p.dupes[0].entry.name} off. It's already on the list.` : 'Left those off. They are already on the list.');
    inputRef.current?.focus();
  }

  async function onSubmit(e) {
    e?.preventDefault();
    if (sel >= 0 && suggestions[sel]) return pickSuggestion(suggestions[sel]);
    const entries = withPhoto(parsed);
    setSel(-1);
    await tryAdd(entries, { clear: true });
  }

  // Tap a match under the box to go to that item on the list. The box is cleared and the keyboard
  // put away, so the list has the screen.
  function jumpTo(it) {
    setText(''); setSel(-1); setPending(null);
    inputRef.current?.blur();
    onJump?.(it);
  }
  const jumpBtn = (it, label) => (onJump ? (
    <button type="button" className="onlist-jump" onClick={() => jumpTo(it)} aria-label={`Show ${it.name} on the list`}>{label}</button>
  ) : label);

  async function pickSuggestion(it) {
    const head = text.split(/[,\n]/).slice(0, -1).join(',');
    const before = parseQuickAdd(head);
    const lastParsed = parseQuickAdd(text.split(/[,\n]/).pop())[0] || {};
    setSel(-1);
    await tryAdd(withPhoto([...before, { ...lastParsed, name: it.name, store: lastParsed.store || '', qty: lastParsed.qty !== 1 ? lastParsed.qty : it.qty || 1 }]), { clear: true });
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' && suggestions.length) { e.preventDefault(); setSel((s) => Math.min(s + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp' && suggestions.length) { e.preventDefault(); setSel((s) => Math.max(s - 1, -1)); }
    else if (e.key === 'Escape') { setText(''); setSel(-1); setPending(null); }
  }

  function onPaste(e) {
    const t = e.clipboardData?.getData('text') || '';
    if (/\n/.test(t.trim())) {
      e.preventDefault();
      tryAdd(parseQuickAdd(t));
    }
  }

  // The photo goes on the first item in the box (or the only one).
  const withPhoto = (entries) => (photo && entries.length ? [{ ...entries[0], photo }, ...entries.slice(1)] : entries);

  // Add from a photo: the photo is shrunk to fit on the item, the AI names the product and its
  // section, and the name lands in the box to check before pressing Add.
  async function addPhoto(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) { showToast('Pick a photo (JPG, PNG or HEIC).'); return; }
    setPhotoBusy(true);
    try {
      const img = await compressImage(file, { maxSide: 900, maxChars: 150_000 });
      setPhoto(img);
      try {
        const { name, category } = await nameProduct(img, cats, ctx.backend.getApp?.());
        if (name) {
          if (category) aiTypes.current.set(name.toLowerCase(), category);
          setText((t) => (t.trim() ? t : name));
          setPending(null);
        } else showToast("Couldn't tell what the product is. Type its name; the photo goes with it.");
      } catch (err) {
        console.warn('Naming the photo failed', err);
        showToast('Type the product name; the photo goes with it.');
      }
      inputRef.current?.focus();
    } catch {
      showToast("Couldn't use that photo. Try another one.");
    } finally {
      setPhotoBusy(false);
      if (photoRef.current) photoRef.current.value = '';
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
        tryAdd(parseQuickAdd(finalText, { voice: true }));
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
          placeholder="Add an item"
          onChange={(e) => {
            const v = e.target.value;
            // A keyboard putting back the word that was just added: keep the box empty.
            if (fresh() && !text && justAdded.current.names.has(normalizeName(v))) return;
            setText(v); setSel(-1); setPending(null);
          }}
          onKeyDown={onKeyDown} onPaste={onPaste}
          aria-autocomplete="list" aria-controls="qa-suggest"
        />
        <button type="button" className={`icon-btn${photoBusy ? ' listening' : ''}`} onClick={() => photoRef.current?.click()} disabled={photoBusy} aria-label="Add from a photo of the product" title="Add from a photo">
          <CameraIcon />
        </button>
        <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => addPhoto(e.target.files?.[0])} />
        <button type="button" className={`icon-btn${listening ? ' listening' : ''}`} onClick={toggleVoice} aria-label={listening ? 'Stop listening' : 'Add by voice'} title="Add by voice">
          <MicIcon />
        </button>
        {text.trim() && (
          <button type="submit" className="icon-btn" aria-label="Add" style={{ background: 'var(--bb)', color: 'var(--cream)' }}>
            <PlusIcon />
          </button>
        )}
      </form>
      {(photo || photoBusy) && (
        <div className="qa-photo" aria-live="polite">
          {photo && <img src={photo} alt="Product photo to add" />}
          <span className="small grow">{photoBusy ? 'Reading the photo…' : text.trim() ? `The photo goes on ${parsed[0]?.name || 'this item'} when you add it.` : 'Type the name, then add. The photo goes with it.'}</span>
          {photo && !photoBusy && (
            <button type="button" className="icon-btn" onClick={() => setPhoto(null)} aria-label="Remove the photo"><CloseIcon /></button>
          )}
        </div>
      )}
      {!pending && (liveDupes.length > 0 || typedMatches.length > 0) && (
        <div className="onlist-note" role="status" aria-live="polite">
          {liveDupes.map((d, i) => <p key={`d${i}`}>{dupeLine(d, jumpBtn)}</p>)}
          {typedMatches.length > 0 && <p>{matchesLine(typedMatches, liveDupes.length > 0, jumpBtn)}</p>}
        </div>
      )}
      {pending && dupes.length > 0 && (
        <div className="dupe-banner" role="alert">
          <strong>{dupes.length === 1 ? 'This may be a duplicate.' : `${dupes.length} of these may be duplicates.`}</strong>
          <ul>
            {dupes.map((d, i) => (
              <li key={i}>{dupeLine(d, jumpBtn)}</li>
            ))}
          </ul>
          {pending && (
            <div className="row">
              <button type="button" className="btn primary" onClick={skipDupes}>{pending.entries.length > pending.dupes.length ? 'Add the rest only' : "Don't add"}</button>
              <button type="button" className="btn" onClick={addAnyway}>Add anyway</button>
            </div>
          )}
        </div>
      )}
      {first && (
        <div className="qa-preview" aria-live="polite">
          <span className="chip blue">{first.name}</span>
          {(first.qty !== 1 || first.unit) && <span className="chip">Qty {fmtQty(first.qty, first.unit) || first.qty}</span>}
          {first.store && <span className="chip">@ {first.store}</span>}
          {firstSorting ? <span className="chip">Sorting…</span> : firstType && <span className="chip"># {firstType}</span>}
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

function withDetail(item) {
  const detail = [fmtQty(item.qty, item.unit), item.store].filter((x) => x && x !== '1').join(', ');
  return `${item.name}${detail ? ` (${detail})` : ''}`;
}

function matchesLine(found, also, link) {
  if (found.length === 1) return <>{also ? 'Also on the list: ' : ''}{link(found[0], withDetail(found[0]))}{also ? '.' : ' is on the list.'}</>;
  return (
    <>
      {also ? 'Also on the list' : 'On the list'}:{' '}
      {found.map((it, i) => (
        <span key={it.id}>{i > 0 && (i === found.length - 1 ? ' and ' : ', ')}{link(it, it.name)}</span>
      ))}.
    </>
  );
}

function dupeLine({ entry, match, kind, onList }, link) {
  if (!onList) return `${entry.name} is in this entry twice.`;
  const where = link(match, withDetail(match));
  const state = match.status === 'ordered' ? 'already ordered' : 'already on your list';
  return kind === 'same'
    ? <>{where} is {state}.</>
    : <>Similar item {match.status === 'ordered' ? 'ordered' : 'on the list'}: {where}.</>;
}
