import { describePrediction } from '../lib/predict.js';
import { fmtMoney, fmtQty, fmtDate, firstName } from '../lib/format.js';
import { ClockIcon, TrashIcon } from './Icons.jsx';

export default function ItemRow({ item, pred, done, showStore = true, showCategory = false, onToggle, onOpen, onSnooze, onRemove, readOnly, extra }) {
  const qty = fmtQty(item.qty, item.unit);
  const predText = pred && pred.basis !== 'off' && pred.basis !== 'learning' ? describePrediction(pred) : '';
  const overdue = pred?.daysLeft != null && pred.daysLeft < 1;
  const price = item.lastPrice != null ? Number(item.lastPrice) : null;
  const total = price != null && Number(item.qty) > 1 ? price * Number(item.qty) : null;

  const onKeyDown = (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') onOpen?.();
    else if (e.key === ' ' && !readOnly) { e.preventDefault(); onToggle?.(); }
    else if (e.key.toLowerCase() === 's' && onSnooze) onSnooze();
  };

  return (
    <div className={`item${done ? ' done' : ''}`} onClick={onOpen} onKeyDown={onKeyDown} tabIndex={0} role="group" aria-label={`${item.name}${qty ? `, ${qty}` : ''}${done ? ', bought' : ''}`}>
      <button
        type="button" className={`check${done ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
        aria-label={done ? `Put ${item.name} back on the list` : `Mark ${item.name} as bought`} disabled={readOnly} style={readOnly ? { visibility: 'hidden' } : undefined}
      >
        <span />
      </button>
      <div className="grow">
        <div className="name ellipsis">{item.name}{qty && <span className="muted" style={{ fontWeight: 400 }}> · {qty}</span>}</div>
        <div className="meta">
          {item.urgent && !done && <span className="chip warn">Needed now</span>}
          {item.status === 'requested' && <span className="chip gold">Requested by {firstName(item.addedByName) || 'staff'}</span>}
          {item.status === 'ordered' && <span className="chip blue">Ordered</span>}
          {showStore && item.store && <span>{item.store}</span>}
          {showCategory && item.category && <span>{item.category}</span>}
          {predText && !done && <span className={overdue ? 'chip warn' : ''}>{predText}</span>}
          {done && item.lastPurchasedAt && <span>Bought {fmtDate(item.lastPurchasedAt)}</span>}
          {extra}
        </div>
      </div>
      {!readOnly && (onSnooze || onRemove) && (
        <div className="hover-actions">
          {onSnooze && <button type="button" className="icon-btn" title="Snooze 1 week (S)" aria-label={`Snooze ${item.name} for a week`} onClick={(e) => { e.stopPropagation(); onSnooze(); }}><ClockIcon /></button>}
          {onRemove && <button type="button" className="icon-btn" title="Take off list" aria-label={`Take ${item.name} off the list`} onClick={(e) => { e.stopPropagation(); onRemove(); }}><TrashIcon /></button>}
        </div>
      )}
      {price != null && (
        <div className="price">
          {fmtMoney(total ?? price)}
          {total != null && <small>{fmtMoney(price)} ea</small>}
        </div>
      )}
    </div>
  );
}
