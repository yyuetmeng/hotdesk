// Seat details beside the floor: state, who is on / booked, today's activity, and the booking form (BookingPanel).
import { useEffect, useState } from 'react';
import { flaskRequest } from '../api.js';
import { Notice } from '../components.jsx';
import { formatTime } from '../format.js';
import BookingPanel from './BookingPanel.jsx';
import { stateLabel } from './deskLogic.js';

export default function SeatPanel({ planId, seat, isToday, onChanged, booking }) {
  const [info, setInfo] = useState(null);
  const [activity, setActivity] = useState([]);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    setInfo(null); setActivity([]); setMessage(null);
    flaskRequest(`/api/desk/seats/${seat.id}`).then(setInfo).catch((err) => setMessage({ kind: 'error', text: err.message }));
    flaskRequest(`/api/desk/seats/${seat.id}/activity`).then((d) => setActivity(d.items)).catch(() => setActivity([]));
  }, [seat.id, seat.state]);

  return <aside className="card desk-panel">
    <h2>{seat.label}</h2>
    <p className="muted">{info?.department ?? (seat.open_to_all ? 'Free for all' : '')} · {stateLabel(seat.state)}</p>
    {message && <Notice kind={message.kind}>{message.text}</Notice>}
    {seat.occupant && <p>Checked in: <b>{seat.occupant.name}</b></p>}
    {seat.booking && <p>Booked for <b>{seat.booking.booked_for.name}</b>
      {seat.booking.booked_by && <> by {seat.booking.booked_by.name}</>}
      {' '}({formatTime(seat.booking.starts_at).slice(0, 5)}–{formatTime(seat.booking.ends_at).slice(0, 5)})</p>}

    {seat.open_to_all && (seat.state === 'not_bookable'
      ? <p className="muted">This seat has no project team.</p>
      : <BookingPanel planId={planId} seat={seat} onChanged={onChanged} {...booking} />)}
    {!seat.open_to_all && seat.department_id && <p className="muted">Project team seat: walk in and scan its QR code to check in.</p>}

    <h3>Today's activity</h3>
    {!isToday && <p className="muted">Shows today; booking above is for the next working day.</p>}
    {activity.length
      ? <ul className="desk-activity">{activity.map((a, i) => <li key={i}><time>{formatTime(a.at)}</time>{a.text}</li>)}</ul>
      : <p className="muted">Nothing yet today.</p>}
  </aside>;
}
