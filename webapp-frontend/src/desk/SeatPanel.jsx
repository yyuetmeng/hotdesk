// Seat details beside the floor: state, who is on / booked, today's activity, and the booking form (BookingPanel).
import { useEffect, useState } from 'react';
import { flaskRequest } from '../api.js';
import { Notice } from '../components.jsx';
import { formatTime } from '../format.js';
import BookingPanel from './BookingPanel.jsx';
import { seatAction, stateLabel } from './deskLogic.js';
import { checkInLocation } from './location.js';

export default function SeatPanel({ planId, seat, isToday, onChanged, booking }) {
  const [info, setInfo] = useState(null);
  const [activity, setActivity] = useState([]);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setMessage(null); }, [seat.id]);   // keep a check-in message when the seat turns occupied
  useEffect(() => {
    setInfo(null); setActivity([]);
    flaskRequest(`/api/desk/seats/${seat.id}`).then(setInfo).catch((err) => setMessage({ kind: 'error', text: err.message }));
    flaskRequest(`/api/desk/seats/${seat.id}/activity`).then((d) => setActivity(d.items)).catch(() => setActivity([]));
  }, [seat.id, seat.state]);

  const action = seatAction(seat, isToday);
  const act = async () => {
    setBusy(true); setMessage(null);
    try {
      if (action === 'check_in') {
        const c = await flaskRequest(`/api/desk/seats/${seat.id}/check-in`, { method: 'POST', body: await checkInLocation() });
        setMessage({ kind: 'success', text: `You're checked in at ${c.seat_label} until ${formatTime(c.ends_at).slice(0, 5)}.${c.warning ? ` ${c.warning}` : ''}` });
      } else {
        await flaskRequest(`/api/desk/seats/${seat.id}/give-up`, { method: 'POST' });
        setMessage({ kind: 'success', text: `You gave up ${seat.label}.` });
      }
      onChanged();
    } catch (err) { setMessage({ kind: 'error', text: err.message }); } finally { setBusy(false); }
  };

  return <aside className="card desk-panel">
    <h2>{seat.label}</h2>
    <p className="muted">{info?.department ?? (seat.open_to_all ? 'Free for all' : '')} · {stateLabel(seat.state)}</p>
    {message && <Notice kind={message.kind}>{message.text}</Notice>}
    {seat.occupant && <p>Checked in: <b>{seat.occupant.name}</b></p>}
    {seat.booking && <p>Booked for <b>{seat.booking.booked_for.name}</b>
      {seat.booking.booked_by && <> by {seat.booking.booked_by.name}</>}
      {' '}({formatTime(seat.booking.starts_at).slice(0, 5)}–{formatTime(seat.booking.ends_at).slice(0, 5)})</p>}

    {action && <div className="desk-actions">
      <button className={`button${action === 'check_in' ? ' primary' : ''}`} disabled={busy} onClick={act}>
        {busy ? 'Please wait…' : action === 'check_in' ? 'Check in now' : 'Give up seat'}</button>
      {action === 'check_in' && <p className="bk-hint">{seat.open_to_all ? 'Free for all' : "Your project team's seat"}: no booking needed. Your device location is recorded with the check-in.</p>}
    </div>}
    {seat.open_to_all && (seat.state === 'not_bookable'
      ? <p className="muted">This seat has no project team.</p>
      : <BookingPanel planId={planId} seat={seat} onChanged={onChanged} {...booking} />)}
    {!seat.open_to_all && seat.department_id && !action && <p className="muted">Project team seat: members of its team can check in here without booking{isToday ? '' : ' (today only)'}.</p>}

    <h3>Today's activity</h3>
    {!isToday && <p className="muted">Shows today; booking above is for the next working day.</p>}
    {activity.length
      ? <ul className="desk-activity">{activity.map((a, i) => <li key={i}><time>{formatTime(a.at)}</time>{a.text}</li>)}</ul>
      : <p className="muted">Nothing yet today.</p>}
  </aside>;
}
