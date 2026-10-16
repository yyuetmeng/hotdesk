// Insights "Bookings" card (spec 2026-10-16-audit-views §4): what happened to bookings per day (checked in,
// no-show, cancelled), the no-show rate per project team, and how auto-booked seats were used.
import { useEffect, useState } from 'react';
import { flaskRequest } from '../../api.js';
import { Notice } from '../../components.jsx';
import { SEGMENT_KEYS, autoText, barSegments, dayLabel, funnelTotals } from './funnelLogic.js';

const RANGES = [7, 14, 30];

export default function FunnelCard() {
  const [days, setDays] = useState(14);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    flaskRequest(`/api/admin/insights/funnel?days=${days}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [days]);

  const totals = data ? funnelTotals(data.days) : null;
  const max = data ? Math.max(...data.days.map((d) => d.booked), 0) : 0;
  return <section className="card funnel">
    <div className="occ-head">
      <div><h2>Bookings</h2><p className="occ-sub">What happened to bookings, by booking date · last {days} days</p></div>
      <div className="occ-ranges" role="radiogroup" aria-label="Period">
        {RANGES.map((r) => <button key={r} type="button" role="radio" aria-checked={r === days}
          className={r === days ? 'active' : ''} onClick={() => setDays(r)}>{r}D</button>)}
      </div>
    </div>
    {error && <Notice kind="error">{error}</Notice>}
    {!data ? <p className="state">Loading bookings…</p> : <>
      <div className="funnel-kpis">
        <div><b>{totals.booked}</b><small>bookings</small></div>
        <div><b>{totals.show_rate}%</b><small>used (checked in)</small></div>
        <div><b>{totals.released}</b><small>no-shows</small></div>
        <div><b>{totals.cancelled + totals.plan_changed}</b><small>cancelled</small></div>
      </div>
      <div className="funnel-body">
        <div className="funnel-chart" role="img" aria-label={`Bookings per day: ${totals.booked} in total`}>
          {data.days.map((d) => <div key={d.date} className="funnel-col" title={`${d.date}: ${d.booked} booked`}>
            <div className="funnel-stack">{barSegments(d, max).map((s) => <span key={s.key} className={`seg-${s.key}`}
              style={{ height: `${s.pct}%` }} title={`${s.label}: ${s.value}`} />)}</div>
            <small>{dayLabel(d.date)}</small>
          </div>)}
        </div>
        <div className="funnel-teams">
          <h3>No-shows by project team</h3>
          {!data.teams.length ? <p className="state">No bookings in this period.</p>
            : <ul>{data.teams.map((t) => <li key={t.name}>
              <span>{t.name}<small>{t.no_shows} of {t.bookings}</small></span>
              <span className="funnel-rate"><i style={{ width: `${t.rate}%` }} /></span><b>{t.rate}%</b>
            </li>)}</ul>}
        </div>
      </div>
      <ul className="funnel-legend">{SEGMENT_KEYS.map(([key, label]) => <li key={key}><i className={`seg-${key}`} />{label}</li>)}</ul>
      <p className="funnel-auto">{autoText(data.auto)}</p>
    </>}
  </section>;
}
