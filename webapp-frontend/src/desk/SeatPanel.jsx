// Seat details beside the floor: state, who is on / booked, today's activity, and booking actions.
import { useEffect, useState } from 'react';
import { flaskRequest } from '../api.js';
import { Notice } from '../components.jsx';
import { formatTime } from '../format.js';
import { presetLabel, stateLabel } from './deskLogic.js';

export default function SeatPanel({ planId, seat, date, preset, isToday, onChanged }) {
  const [info, setInfo] = useState(null);
  const [activity, setActivity] = useState([]);
  const [message, setMessage] = useState(null);
  const [q, setQ] = useState('');
  const [colleagues, setColleagues] = useState(null);

  useEffect(() => {
    setInfo(null); setActivity([]); setMessage(null); setColleagues(null); setQ('');
    flaskRequest(`/api/desk/seats/${seat.id}`).then(setInfo).catch((err) => setMessage({ kind: 'error', text: err.message }));
    flaskRequest(`/api/desk/seats/${seat.id}/activity`).then((d) => setActivity(d.items)).catch(() => setActivity([]));
  }, [seat.id, seat.state]);

  useEffect(() => {
    if (colleagues === null) return undefined;
    const timer = setTimeout(() => {
      flaskRequest(`/api/desk/colleagues?date=${date}&q=${encodeURIComponent(q)}`)
        .then(setColleagues).catch((err) => setMessage({ kind: 'error', text: err.message }));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, date, colleagues === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const book = async (userId) => {
    setMessage(null);
    try {
      const b = await flaskRequest('/api/desk/bookings', {
        method: 'POST', body: { plan_id: planId, seat_id: seat.id, date, preset, ...(userId ? { user_id: userId } : {}) },
      });
      setMessage({ kind: 'success', text: `Booked ${b.seat_label} for ${b.booked_for.name}, ${presetLabel(b.preset)}.` });
      onChanged();
    } catch (err) { setMessage({ kind: 'error', text: err.message }); }
  };

  const canBook = seat.can_book?.[preset];
  return <aside className="card desk-panel">
    <h2>{seat.label}</h2>
    <p className="muted">{info?.department ?? (seat.open_to_all ? 'Free for all' : '')} · {stateLabel(seat.state)}</p>
    {message && <Notice kind={message.kind}>{message.text}</Notice>}
    {seat.occupant && <p>Checked in: <b>{seat.occupant.name}</b></p>}
    {seat.booking && <p>Booked for <b>{seat.booking.booked_for.name}</b>
      {seat.booking.booked_by && <> by {seat.booking.booked_by.name}</>}
      {' '}({formatTime(seat.booking.starts_at).slice(0, 5)}–{formatTime(seat.booking.ends_at).slice(0, 5)})</p>}

    {seat.open_to_all && <div className="desk-actions">
      {canBook
        ? <button className="button primary" onClick={() => book(null)}>Book for me · {presetLabel(preset)}</button>
        : <p className="muted">{seat.state === 'not_bookable' ? 'This seat has no department.' : `Not bookable for ${presetLabel(preset)}.`}</p>}
      {canBook && (colleagues === null
        ? <button className="button" onClick={() => setColleagues({ items: [], allowance: null })}>Book for a colleague…</button>
        : <div>
          {colleagues.allowance && <p className="muted">{colleagues.allowance.used} of {colleagues.allowance.limit} colleagues booked for this day</p>}
          {colleagues.allowance?.limit === 0
            ? <p className="muted">You are not allowed to book for others.</p>
            : <>
              <input type="search" placeholder="Search colleagues" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search colleagues" />
              <div className="desk-colleagues">{colleagues.items.map((c) =>
                <button key={c.id} className="button" onClick={() => book(c.id)}>Book for {c.name}</button>)}</div>
            </>}
        </div>)}
    </div>}
    {!seat.open_to_all && seat.department_id && <p className="muted">Department seat: walk in and scan its QR code to check in.</p>}

    <h3>Today's activity</h3>
    {!isToday && <p className="muted">Shows today; booking above is for tomorrow.</p>}
    {activity.length
      ? <ul className="desk-activity">{activity.map((a, i) => <li key={i}><time>{formatTime(a.at)}</time>{a.text}</li>)}</ul>
      : <p className="muted">Nothing yet today.</p>}
  </aside>;
}
