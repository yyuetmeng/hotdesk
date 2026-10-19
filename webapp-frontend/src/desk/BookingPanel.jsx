// Booking form inside the seat panel (owner 2026-10-16, preview v3): For (Myself / Someone else),
// Seats (one / several, Someone else only), Day (today / next working day / both), Slot, summary, Confirm.
// Team first (spec 2026-10-19-team-seats-first §6): a free team seat is offered instead of a free-for-all one,
// for you (jump to it) and for each colleague (swap the row's seat). Rules live in bookingLogic.js; the server
// re-checks every booking.
import { useEffect, useState } from 'react';
import { flaskRequest } from '../api.js';
import { Notice } from '../components.jsx';
import { formatDate } from '../format.js';
import { bookBlock, bookingProblem, bookingRequests, confirmLabel, dayDates, firstName, resultSummary, rowTeamHint, toRowSeat } from './bookingLogic.js';
import { PRESETS, nextDayName, presetLabel, teamSeatText } from './deskLogic.js';

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
  bothDays: both, setBothDays: setBoth, preset, setPreset, skipped, onChanged, teamFirst, jumpTo }) {
  const [forWho, setForWho] = useState('me');
  const [people, setPeople] = useState({});        // { [clicked seat id]: person }
  const [swaps, setSwaps] = useState({});          // { [clicked seat id]: row seat } (a colleague's team seat instead)
  const [suggested, setSuggested] = useState({});  // { [person id]: GET /api/desk/suggest result }
  const [allowance, setAllowance] = useState(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState(null);

  const dayChoice = both ? 'both' : dayOffset === 1 ? 'second' : 'first';
  const dates = dayDates(dayChoice, days);
  useEffect(() => {
    if (forWho !== 'other') return;
    flaskRequest(`/api/desk/colleagues?date=${dates[0]}&q=`).then((d) => setAllowance(d.allowance)).catch(() => setAllowance(null));
  }, [forWho, dates[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setResults(null); setSwaps({}); }, [seat.id]);
  // A new day or slot: drop seats and hints found for the previous one (declared before the fetch below).
  useEffect(() => { setSwaps({}); setSuggested({}); }, [dates[0], preset]); // eslint-disable-line react-hooks/exhaustive-deps
  // Each picked colleague's best free seat for the day and slot (their team's first).
  const personIds = Object.values(people).filter(Boolean).map((p) => p.id).join(',');
  useEffect(() => {
    if (forWho !== 'other') return undefined;
    let live = true;
    personIds.split(',').filter(Boolean).forEach((id) => flaskRequest(`/api/desk/suggest?date=${dates[0]}&preset=${preset}&user_id=${id}`)
      .then((r) => { if (live) setSuggested((all) => ({ ...all, [id]: r })); }).catch(() => {}));
    return () => { live = false; };
  }, [forWho, personIds, dates[0], preset]); // eslint-disable-line react-hooks/exhaustive-deps

  const seats = [seat, ...(forWho === 'other' && multi ? picked : [])];
  const rows = seats.map((s) => ({ key: s.id, seat: (forWho === 'other' && swaps[s.id]) || s, person: people[s.id] ?? null }));
  const problem = bookingProblem({ forWho, rows, allowance });
  // A swapped first row books another seat, so the clicked one need not be free (the server re-checks).
  const block = forWho === 'other' && swaps[seat.id] ? null : bookBlock({ seat, preset, forWho, teamFirst });
  const requests = bookingRequests({ forWho, rows: rows.filter((r) => forWho === 'me' || r.person), dayChoice, days, preset, planId });

  const chooseFor = (key) => { setForWho(key); setResults(null); if (key === 'me') setMulti(false); };
  const swap = (key, s) => { setSwaps((all) => ({ ...all, [key]: toRowSeat(s) })); setResults(null); };
  const pick = (key, p) => {
    setPeople((all) => ({ ...all, [key]: p }));
    if (!p) setSwaps((all) => { const { [key]: _, ...rest } = all; return rest; });   // the swap was for that person
  };
  const chooseDay = (key) => { setBoth(key === 'both'); if (key !== 'both') setDayOffset(key === 'second' ? 1 : 0); };
  const dayName = (date) => (date === days[0] ? 'Today' : nextDayName(date, days[0]));

  const confirm = async () => {
    setBusy(true);
    const out = [];
    for (const body of requests) {   // one at a time, so the allowance and seat checks see the earlier ones
      const row = rows.find((r) => r.seat.id === body.seat_id && (forWho === 'me' || r.person.id === body.user_id));
      const who = forWho === 'me' ? 'You' : row.person.name;
      try {
        await flaskRequest('/api/desk/bookings', { method: 'POST', body });
        out.push({ ok: true, who, seat: row.seat.label, date: body.date });
      } catch (err) { out.push({ ok: false, who, seat: row.seat.label, date: body.date, error: err.message, key: row.key, suggestion: err.suggestion }); }
    }
    setResults(out);
    setBusy(false);
    if (out.every((r) => r.ok)) { setPeople({}); setSwaps({}); setBoth(false); setMulti(false); }
    onChanged();
  };

  return <div className="bk">
    {results && <div className={`notice ${results.every((r) => r.ok) ? 'success' : 'error'}`}>
      {resultSummary(results)}
      {results.some((r) => !r.ok) && <ul className="bk-failed">{results.filter((r) => !r.ok).map((r, i) =>
        <li key={i}>{r.who} · {r.seat} · {dayName(r.date)}: {r.error}
          {r.suggestion && <> <button type="button" className="button"
            onClick={() => (forWho === 'me' ? jumpTo(r.suggestion) : swap(r.key, r.suggestion))}>Use {r.suggestion.seat_label}</button></>}</li>)}</ul>}
    </div>}

    <Segment label="For" value={forWho} onChange={chooseFor}
      options={[{ key: 'me', text: 'Myself' }, { key: 'other', text: 'Someone else' }]} />
    {forWho === 'other' && <Segment label="Seats" value={multi ? 'several' : 'one'} onChange={(k) => setMulti(k === 'several')}
      options={[{ key: 'one', text: 'One seat' }, { key: 'several', text: 'Several seats' }]} />}

    {forWho === 'other' && <div className="bk-field"><span className="bk-label">{multi ? 'Who sits where' : 'Who'}</span>
      {multi && <p className="bk-hint">Click more free seats on the floor to add them.</p>}
      {rows.map((r) => {
        const sug = r.person ? suggested[r.person.id] : null;
        const hint = r.person ? rowTeamHint(r, sug, rows.filter((o) => o.key !== r.key).map((o) => o.seat.id)) : null;
        const find = !multi && !hint && sug && sug.tier !== 'none' && sug.seats[0].seat_id !== r.seat.id ? sug.seats[0] : null;
        return <div key={r.key} className="bk-field">
          <div className="bk-row">
            <span className="bk-seat"><span className="bk-dot" />{r.seat.label}</span>
            <PersonPicker date={dates[0]} person={r.person} taken={rows.filter((o) => o.person && o.key !== r.key).map((o) => o.person.id)}
              onPick={(p) => pick(r.key, p)} />
            {r.key !== seat.id && <button type="button" className="bk-x" aria-label={`Remove ${r.seat.label}`} onClick={() => onRemovePicked(r.key)}>✕</button>}
          </div>
          {hint && <p className="bk-hint">{firstName(r.person.name)}'s team has a free seat: {hint.seat_label}.{' '}
            <button type="button" className="button" onClick={() => swap(r.key, hint)}>Use {hint.seat_label}</button></p>}
          {find && <p className="bk-hint"><button type="button" className="button" onClick={() => swap(r.key, find)}>Find a seat for {firstName(r.person.name)}</button></p>}
        </div>;
      })}
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

    {block?.kind === 'team_hint' && <Notice>{teamSeatText(block.suggestion)}{' '}
      <button type="button" className="button primary" onClick={() => jumpTo(block.suggestion)}>Book {block.suggestion.seat_label} instead</button></Notice>}
    {block?.kind === 'other_team' && <Notice kind="error">This seat is for another project team.</Notice>}
    {block?.kind === 'not_free' && <Notice kind="error">{seat.label} is not free for {presetLabel(preset)} on the day shown. Pick another slot or seat.</Notice>}
    {block?.kind !== 'team_hint' && <>
    {both && <p className="bk-hint">The floor shows {dayName(days[dayOffset])}; the other day is checked when you confirm.</p>}

    <div className="bk-summary">
      <b>{requests.length || rows.length * dates.length} booking{(requests.length || rows.length * dates.length) === 1 ? '' : 's'}</b>
      {' · '}{dates.map(dayName).join(' and ')}, {presetLabel(preset)}
      <div className="bk-chips">{rows.map((r) => <span key={r.key} className={`bk-chip${forWho === 'other' && !r.person ? ' missing' : ''}`}>
        <b>{forWho === 'me' ? 'You' : r.person?.name ?? 'needs a person'}</b> {r.seat.label}</span>)}</div>
      {problem && <p className="bk-hint warn">{problem}</p>}
    </div>
    <button type="button" className="button primary bk-confirm" disabled={busy || block !== null || Boolean(problem) || !requests.length} onClick={confirm}>
      {busy ? 'Booking…' : confirmLabel(requests.length || 1)}</button>
    </>}
  </div>;
}
