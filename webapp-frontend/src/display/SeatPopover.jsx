// Seat details on the public display: who is there and today's activity (spec §3).
// Closes after 20 seconds or when tapping outside.
import { useEffect, useState } from 'react';
import { flaskRequest } from '../api.js';
import { stateLabel } from '../desk/deskLogic.js';
import { sgTime } from './displayLogic.js';

export default function SeatPopover({ seat, onClose }) {
  const [activity, setActivity] = useState(null);
  useEffect(() => {
    flaskRequest(`/api/public/seats/${seat.id}/activity`).then((d) => setActivity(d.items)).catch(() => setActivity([]));
    const timer = setTimeout(onClose, 20000);
    return () => clearTimeout(timer);
  }, [seat.id, onClose]);
  const who = seat.occupant ? `Checked in: ${seat.occupant.name}`
    : seat.booking ? `Booked for ${seat.booking.booked_for.name}${seat.booking.booked_by ? ` by ${seat.booking.booked_by.name}` : ''}`
      : null;
  return <div className="disp-pop-backdrop" onClick={onClose}>
    <div className="disp-pop" role="dialog" aria-label={`Seat ${seat.label}`} onClick={(e) => e.stopPropagation()}>
      <h2>{seat.label}</h2>
      <p className="disp-muted">{seat.department ?? 'No project team'} · {stateLabel(seat.state)}</p>
      {who && <p className="disp-who">{who}</p>}
      <h3>Today</h3>
      {activity === null ? <p className="disp-muted">Loading…</p>
        : activity.length
          ? <ul className="disp-activity">{activity.map((a, i) => <li key={i}><time>{sgTime(a.at)}</time>{a.text}</li>)}</ul>
          : <p className="disp-muted">Nothing yet today.</p>}
      <button className="disp-close" onClick={onClose}>Close</button>
    </div>
  </div>;
}
