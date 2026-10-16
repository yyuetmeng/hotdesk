// Insights "Recent activity": the last 5 check-ins and check-outs, refreshed every 30 seconds.
import { useEffect, useState } from 'react';
import { flaskRequest } from '../../api.js';
import { Notice } from '../../components.jsx';
import { activityPlace, activityTitle, activityWhen } from './activityLogic.js';

const REFRESH_MS = 30000;
const todaySg = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());

export default function ActivityCard() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => flaskRequest('/api/admin/insights/activity')
      .then((d) => { if (alive) { setItems(d.items); setError(null); } })
      .catch((err) => { if (alive) setError(err.message); });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const today = todaySg();
  return <section className="card activity-card">
    <div className="occ-head"><div><h2>Recent activity</h2><p className="occ-sub">Last 5 check-ins and check-outs · updates every 30 seconds</p></div></div>
    {error && <Notice kind="error">{error}</Notice>}
    {!items ? <p className="state">Loading…</p>
      : !items.length ? <p className="state">No activity yet. Check-ins and check-outs appear here.</p>
        : <ul className="activity-list">{items.map((a, i) => <li key={`${a.at}-${i}`}>
          <span className={`activity-dot ${a.kind}`} aria-hidden="true">{a.initials}</span>
          <div className="activity-main">
            <b>{a.person}</b>
            <small>{a.teams.join(', ') || 'No project team'}</small>
            <small>{activityTitle(a)} · {activityPlace(a)}</small>
          </div>
          <time dateTime={a.at}>{activityWhen(a.at, today)}</time>
        </li>)}</ul>}
  </section>;
}
