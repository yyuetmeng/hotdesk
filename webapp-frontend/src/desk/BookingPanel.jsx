// Booking form inside the seat panel (owner 2026-10-16, preview v3): For (Myself / Someone else),
// Seats (one / several, Someone else only), Day (today / next working day / both), Slot, summary, Confirm.
// Rules live in bookingLogic.js; the server re-checks every booking.
import { useEffect, useState } from 'react';
import { flaskRequest } from '../api.js';
import { Notice } from '../components.jsx';
import { formatDate } from '../format.js';
import { bookingProblem, bookingRequests, confirmLabel, dayDates, resultSummary } from './bookingLogic.js';
import { PRESETS, nextDayName, presetLabel } from './deskLogic.js';

function Segment({ label, options, value, onChange }) {
  return <div className="bk-field"><span className="bk-label">{label}</span>
    <div className="desk-segment bk-segment" role="group" aria-label={label}>
      {options.map((o) => <button key={o.key} type="button" className={value === o.key ? 'active' : ''} aria-pressed={value === o.key}
        onClick={() => onChange(o.key)}>{o.text}{o.sub && <small>{o.sub}</small>}</button>)}
    </div></div>;
}

// Search-as-you-type colleague picker for one seat.
function PersonPicker({ date, person, taken, onPick }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => {
      flaskRequest(`/api/desk/colleagues?date=${date}&q=${encodeURIComponent(q)}`).then((d) => setItems(d.items)).catch(() => setItems([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, open, date]);
  if (person) return <span className="bk-person">{person.name}
    <button type="button" className="bk-x" aria-label={`Remove ${person.name}`} onClick={() => onPick(null)}>✕</button></span>;
  const shown = items.filter((c) => !taken.includes(c.id)).slice(0, 8);
  return <span className="bk-picker">
    <input type="search" placeholder="Search colleague…" value={q} aria-label="Search colleague"
      onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => setQ(e.target.value)} />
    {open && <span className="bk-options" role="listbox">
      {shown.length ? shown.map((c) => <button key={c.id} type="button" role="option" aria-selected="false"
        onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(c); setQ(''); setOpen(false); }}>{c.name}</button>)
        : <span className="bk-none">No colleagues found</span>}
    </span>}
  </span>;
}

export default function BookingPanel({ planId, seat, picked, multi, setMulti, onRemovePicked, days, dayOffset, setDayOffset,
  bothDays: both, setBothDays: setBoth, preset, setPreset, skipped, onChanged }) {
  const [forWho, setForWho] = useState('me');
  const [people, setPeople] = useState({});
  const [allowance, setAllowance] = useState(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);

  const dayChoice = both ? 'both' : dayOffset === 1 ? 'second' : 'first';
  const dates = dayDates(dayChoice, days);
  useEffect(() => {
    if (forWho !== 'other') return;
    flaskRequest(`/api/desk/colleagues?date=${dates[0]}&q=`).then((d) => setAllowance(d.allowance)).catch(() => setAllowance(null));
  }, [forWho, dates[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setResults(null); }, [seat.id]);

  const seats = [seat, ...(forWho === 'other' && multi ? picked : [])];
  const rows = seats.map((s) => ({ seat: s, person: people[s.id] ?? null }));
  const problem = bookingProblem({ forWho, rows, allowance });
  const seatFree = Boolean(seat.can_book?.[preset]);
  const requests = bookingRequests({ forWho, rows: rows.filter((r) => forWho === 'me' || r.person), dayChoice, days, preset, planId });

  const chooseFor = (key) => { setForWho(key); setResults(null); if (key === 'me') setMulti(false); };
  const chooseDay = (key) => { setBoth(key === 'both'); if (key !== 'both') setDayOffset(key === 'second' ? 1 : 0); };
  const dayName = (date) => (date === days[0] ? 'Today' : nextDayName(date, days[0]));

  const confirm = async () => {
    setBusy(true);
    const out = [];
    for (const body of requests) {   // one at a time, so the allowance and seat checks see the earlier ones
      const row = rows.find((r) => r.seat.id === body.seat_id);
      const who = forWho === 'me' ? 'You' : row.person.name;
      try {
        await flaskRequest('/api/desk/bookings', { method: 'POST', body });
        out.push({ ok: true, who, seat: row.seat.label, date: body.date });
      } catch (err) { out.push({ ok: false, who, seat: row.seat.label, date: body.date, error: err.message }); }
    }
    setResults(out);
    setBusy(false);
    if (out.every((r) => r.ok)) { setPeople({}); setBoth(false); setMulti(false); }
    onChanged();
  };

  return <div className="bk">
    {results && <div className={`notice ${results.every((r) => r.ok) ? 'success' : 'error'}`}>
      {resultSummary(results)}
      {results.some((r) => !r.ok) && <ul className="bk-failed">{results.filter((r) => !r.ok).map((r, i) =>
        <li key={i}>{r.who} · {r.seat} · {dayName(r.date)}: {r.error}</li>)}</ul>}
    </div>}

    <Segment label="For" value={forWho} onChange={chooseFor}
      options={[{ key: 'me', text: 'Myself' }, { key: 'other', text: 'Someone else' }]} />
    {forWho === 'other' && <Segment label="Seats" value={multi ? 'several' : 'one'} onChange={(k) => setMulti(k === 'several')}
      options={[{ key: 'one', text: 'One seat' }, { key: 'several', text: 'Several seats' }]} />}

    {forWho === 'other' && <div className="bk-field"><span className="bk-label">{multi ? 'Who sits where' : 'Who'}</span>
      {multi && <p className="bk-hint">Click more free seats on the floor to add them.</p>}
      {rows.map((r) => <div key={r.seat.id} className="bk-row">
        <span className="bk-seat"><span className="bk-dot" />{r.seat.label}</span>
        <PersonPicker date={dates[0]} person={r.person} taken={rows.filter((o) => o.person && o.seat.id !== r.seat.id).map((o) => o.person.id)}
          onPick={(p) => setPeople((all) => ({ ...all, [r.seat.id]: p }))} />
        {r.seat.id !== seat.id && <button type="button" className="bk-x" aria-label={`Remove ${r.seat.label}`} onClick={() => onRemovePicked(r.seat.id)}>✕</button>}
      </div>)}
      {skipped && <p className="bk-hint warn">{skipped}</p>}
      {allowance && allowance.limit === null && <p className="bk-hint">As an admin you can book for anyone, with no daily limit. Each person can be picked once.</p>}
      {allowance && allowance.limit > 0 && <p className="bk-hint">Allowance: {allowance.limit} colleague{allowance.limit === 1 ? '' : 's'} per day, {allowance.used} used. Each person can be picked once.</p>}
    </div>}

    <Segment label="Day" value={dayChoice} onChange={chooseDay} options={[
      { key: 'first', text: 'Today', sub: formatDate(days[0]) },
      { key: 'second', text: nextDayName(days[1], days[0]), sub: formatDate(days[1]) },
      { key: 'both', text: 'Both' }]} />
    <Segment label="Slot" value={preset} onChange={setPreset}
      options={PRESETS.map((p) => { const [name, time] = presetLabel(p).split(' ('); return { key: p, text: name, sub: time?.replace(')', '') }; })} />

    {!seatFree && <Notice kind="error">{seat.label} is not free for {presetLabel(preset)} on the day shown. Pick another slot or seat.</Notice>}
    {both && <p className="bk-hint">The floor shows {dayName(days[dayOffset])}; the other day is checked when you confirm.</p>}

    <div className="bk-summary">
      <b>{requests.length || rows.length * dates.length} booking{(requests.length || rows.length * dates.length) === 1 ? '' : 's'}</b>
      {' · '}{dates.map(dayName).join(' and ')}, {presetLabel(preset)}
      <div className="bk-chips">{rows.map((r) => <span key={r.seat.id} className={`bk-chip${forWho === 'other' && !r.person ? ' missing' : ''}`}>
        <b>{forWho === 'me' ? 'You' : r.person?.name ?? 'needs a person'}</b> {r.seat.label}</span>)}</div>
      {problem && <p className="bk-hint warn">{problem}</p>}
    </div>
    <button type="button" className="button primary bk-confirm" disabled={busy || !seatFree || Boolean(problem) || !requests.length} onClick={confirm}>
      {busy ? 'Booking…' : confirmLabel(requests.length || 1)}</button>
  </div>;
}
