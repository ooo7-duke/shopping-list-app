import { useState } from 'react';
import { SNOOZE_CHOICES, snoozeEnd } from '../data/actions.js';
import { toInputDate, fromInputDate } from '../lib/format.js';

const day = (ms) => new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

// The lengths to snooze an item for, each showing the day it comes back, plus a date of your own.
export default function SnoozePicker({ onPick, current }) {
  const now = Date.now();
  const tomorrow = toInputDate(now + 86400e3);
  const [date, setDate] = useState('');
  return (
    <div className="snooze-pick">
      <div className="snooze-grid" role="group" aria-label="Snooze for">
        {SNOOZE_CHOICES.map((c) => {
          const until = snoozeEnd(c, now);
          return (
            <button key={c.label} type="button" className="btn snooze-opt" onClick={() => onPick(until, c.label)}>
              <strong>{c.label}</strong>
              <span className="tiny muted">back {day(until)}</span>
            </button>
          );
        })}
      </div>
      <div className="row snooze-date">
        <label className="field grow"><span>Or pick the day it comes back</span>
          <input type="date" className="input" min={tomorrow} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button type="button" className="btn primary" disabled={!date || date < tomorrow} onClick={() => onPick(fromInputDate(date), `until ${day(fromInputDate(date))}`)}>Snooze</button>
      </div>
      {current && <p className="tiny muted" style={{ marginTop: 6 }}>Snoozed now until {day(current)}. Picking again changes it.</p>}
    </div>
  );
}
