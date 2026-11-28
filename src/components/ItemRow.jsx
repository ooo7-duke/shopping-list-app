import { useState } from 'react';
import { useHold } from './Pick.jsx';
import { createPortal } from 'react-dom';
import { describePrediction } from '../lib/predict.js';
import { fmtMoney, fmtQty, fmtDate } from '../lib/format.js';
import { seenPrices, refurbPrice } from '../lib/prices.js';
import { deptOf } from '../lib/tripPlan.js';
import { ClockIcon, TrashIcon } from './Icons.jsx';
import FitText from './FitText.jsx';

export default function ItemRow({ item, pred, done, last, showHistory = false, onPrices, showStore = true, showCategory = false, onToggle, onOpen, onSnooze, onRemove, onDelete, readOnly, extra, onLongPress, selecting = false, selected = false }) {
  const [viewing, setViewing] = useState(false);
  const hold = useHold(onLongPress); // press and hold starts picking rows
  const qty = fmtQty(item.qty, item.unit);
  const predText = pred && pred.basis !== 'off' && pred.basis !== 'learning' ? describePrediction(pred) : '';
  const overdue = pred?.daysLeft != null && pred.daysLeft < 1;
  const price = item.lastPrice != null ? Number(item.lastPrice) : null;
  const total = price != null && Number(item.qty) > 1 ? price * Number(item.qty) : null;
  const { best } = seenPrices(item);
  const refurb = item.seenPrices?.refurb && deptOf(item) === 'electronics' ? refurbPrice(item) : null;
  const lastParts = last ? [
    fmtDate(last.at),
    last.qty != null ? fmtQty(last.qty, last.unit) || '1' : '',
    last.unitPrice != null ? `${fmtMoney(last.unitPrice)} ea` : '',
    last.store,
  ].filter(Boolean) : [];

  const onKeyDown = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') onOpen?.();
    else if (e.key === ' ' && !readOnly) { e.preventDefault(); onToggle?.(); }
    else if (e.key.toLowerCase() === 's' && onSnooze) onSnooze();
  };

  return (
    <div className={`item${done ? ' done' : ''}${onLongPress ? ' holdable' : ''}${selected ? ' selected' : ''}`} data-item-id={done ? undefined : item.id} onClick={onOpen} onKeyDown={onKeyDown} {...hold} tabIndex={0} role="group" aria-label={`${item.name}${qty ? `, ${qty}` : ''}${done ? ', bought' : ''}${selected ? ', selected' : ''}`}>
      <button
        type="button" className={`check${selecting ? ' pick' : ''}${(selecting ? selected : done) ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
        aria-label={selecting ? `${selected ? 'Unselect' : 'Select'} ${item.name}` : done ? `Put ${item.name} back on the list` : `Mark ${item.name} as bought`} aria-pressed={selecting ? selected : undefined}
        disabled={readOnly} style={readOnly ? { visibility: 'hidden' } : undefined}
      >
        <span />
      </button>
      {item.photo && (
        <button type="button" className="thumb" onClick={(e) => { e.stopPropagation(); if (selecting) onToggle?.(); else setViewing(true); }} aria-label={`See the photo of ${item.name}`}>
          <img src={item.photo} alt="" />
        </button>
      )}
      <div className="grow" style={{ minWidth: 0 }}>
        <FitText className="name">{item.name}{qty && <span className="muted" style={{ fontWeight: 400 }}> · {qty}</span>}</FitText>
        <div className="meta">
          {item.urgent && !done && <span className="chip warn">Needed now</span>}
          {item.status === 'ordered' && <span className="chip blue">Ordered</span>}
          {refurb && !done && <span className="chip gold">Refurbished {fmtMoney(refurb.price)}</span>}
          {showStore && item.store && <span>{item.store}</span>}
          {showCategory && item.category && <span>{item.category}</span>}
          {predText && !done && <span className={overdue ? 'chip warn' : ''}>{predText}</span>}
          {done && item.lastPurchasedAt && <span>Bought {fmtDate(item.lastPurchasedAt)}</span>}
          {extra}
        </div>
        {showHistory && (
          <div className="history">
            {last ? <span>Last bought {lastParts.join(' · ')}</span> : <span className="muted">Not bought yet</span>}
            {onPrices && (
              <button type="button" className="chip blue" onClick={(e) => { e.stopPropagation(); onPrices(); }} aria-label={`See prices for ${item.name}`}>{best ? 'All prices' : 'Find prices'}</button>
            )}
          </div>
        )}
      </div>
      {!readOnly && !selecting && (onSnooze || onRemove) && (
        <div className="hover-actions">
          {onSnooze && <button type="button" className="icon-btn" title="Snooze (S)" aria-label={`Snooze ${item.name}`} onClick={(e) => { e.stopPropagation(); onSnooze(); }}><ClockIcon /></button>}
          {onRemove && <button type="button" className="icon-btn" title="Take off list" aria-label={`Take ${item.name} off the list`} onClick={(e) => { e.stopPropagation(); onRemove(); }}><TrashIcon /></button>}
        </div>
      )}
      {viewing && createPortal(
        <div className="photo-view" role="dialog" onPointerDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} aria-label={`Photo of ${item.name}`} onClick={(e) => { e.stopPropagation(); setViewing(false); }}>
          <img src={item.photo} alt={`The ${item.name} to buy`} />
          <div className="photo-cap">{item.name}{item.note ? ` · ${item.note}` : ''}<br /><span className="small">Tap anywhere to close</span></div>
        </div>,
        document.body,
      )}
      {price != null && (
        <div className="price">
          {fmtMoney(total ?? price)}
          {total != null && <small>{fmtMoney(price)} ea</small>}
        </div>
      )}
      {!readOnly && !selecting && onDelete && (
        <button type="button" className="icon-btn row-del" title="Delete from list" aria-label={`Delete ${item.name} from the list`} onClick={(e) => { e.stopPropagation(); onDelete(); }}><TrashIcon /></button>
      )}
    </div>
  );
}
