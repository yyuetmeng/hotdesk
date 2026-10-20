// "Seat assignments ending" card for admins (spec 2026-10-19-seat-assignments §4): current assignments whose end
// date is in the next 14 days (Leaving soon) or was in the last 14 days (Left), soonest first. Loaded once.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { flaskRequest } from '../../api.js';
import { Loading, Notice } from '../../components.jsx';
import { formatDate } from '../../format.js';
import { cardRows } from '../assignments/assignmentLogic.js';
import '../assignments/assignments.css';
import './insights.css';

const GROUPS = [['leaving_soon', 'Leaving soon'], ['left', 'Left']];

export default function SeatAssignmentsEndingCard() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    flaskRequest('/api/admin/insights/seat-assignments-ending')
      .then((d) => { if (alive) setRows(cardRows(d.items)); })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, []);

  if (!rows && !error) return <Loading label="Loading seat assignments..." />;
  return <section className="card sa-ending">
    <h2>Seat assignments ending</h2>
    <p className="sa-ending-sub">Assigned seats ending in the next 14 days, or ended in the last 14 days.</p>
    {error && <Notice kind="error">{error}</Notice>}
    {rows && !rows.length && <p className="state">No seat assignments ending in the next 14 days.</p>}
    {rows && GROUPS.map(([status, label]) => {
      const group = rows.filter((r) => r.status === status);
      return group.length > 0 && <div key={status} className={status}>
        <h3>{label}</h3>
        <ul>{group.map((r) => <li key={r.id}><Link to={r.link}>
          <span><b>{r.person_name}</b><small>{r.seat_label} · {r.plan_id ? r.plan_name : 'Seat removed'}</small></span>
          <time dateTime={r.end_date}>{formatDate(r.end_date)}</time>
        </Link></li>)}</ul>
      </div>;
    })}
  </section>;
}
