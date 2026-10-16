// Insights "Occupancy" card: seats in use over time, with 1H / 6H / 24H / 7D / 30D ranges.
// 7D and 30D show the average (solid) and the peak (dashed). Refreshes every minute.
import { useEffect, useState } from 'react';
import { flaskRequest } from '../../api.js';
import { Notice } from '../../components.jsx';
import { RANGES, chartPath, rangeSubtitle, tickIndexes, tickLabel } from './occupancyLogic.js';

const W = 640, H = 300, LEFT = 52, RIGHT = 12, TOP = 10, BOTTOM = 30;
const PW = W - LEFT - RIGHT, PH = H - TOP - BOTTOM;
const REFRESH_MS = 60000;

export default function OccupancyCard() {
  const [range, setRange] = useState('24h');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => flaskRequest(`/api/admin/insights/occupancy?range=${range}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((err) => { if (alive) setError(err.message); });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [range]);

  const shown = data?.range === range ? data : null;
  const values = shown ? shown.points.map((p) => p.pct) : [];
  const peaks = shown && shown.aggregate !== 'sample' ? shown.points.map((p) => p.peak ?? 0) : null;
  const ticks = shown ? tickIndexes(shown.points.length, 5) : [];
  const x = (i) => LEFT + (shown.points.length > 1 ? (i * PW) / (shown.points.length - 1) : 0);

  return <section className="card occ">
    <div className="occ-head">
      <div><h2>Occupancy</h2><p className="occ-sub">{shown ? rangeSubtitle(shown) : 'Seats in use over time'}</p></div>
      <div className="occ-ranges" role="radiogroup" aria-label="Time range">
        {RANGES.map((r) => <button key={r} type="button" role="radio" aria-checked={r === range}
          className={r === range ? 'active' : ''} onClick={() => setRange(r)}>{r.toUpperCase()}</button>)}
      </div>
    </div>
    {error && <Notice kind="error">{error}</Notice>}
    <svg className="occ-chart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={shown ? `Occupancy ${rangeSubtitle(shown)}; latest ${values[values.length - 1] ?? 0}%` : 'Loading occupancy'}>
      {[100, 75, 50, 25, 0].map((v) => { const y = TOP + PH - (PH * v) / 100;
        return <g key={v}><line x1={LEFT} x2={W - RIGHT} y1={y} y2={y} className="occ-grid" />
          <text x={LEFT - 10} y={y} className="occ-axis" textAnchor="end" dominantBaseline="middle">{v}%</text></g>; })}
      {shown && <g transform={`translate(${LEFT} ${TOP})`}>
        {peaks && <path d={chartPath(peaks, PW, PH)} className="occ-peak" />}
        <path d={chartPath(values, PW, PH)} className="occ-line" />
      </g>}
      {shown && ticks.map((i, n) => <text key={i} x={x(i)} y={H - 8} className="occ-axis"
        textAnchor={n === 0 ? 'start' : n === ticks.length - 1 ? 'end' : 'middle'}>{tickLabel(shown.points[i].t, range)}</text>)}
      {!shown && !error && <text x={W / 2} y={H / 2} className="occ-axis" textAnchor="middle">Loading…</text>}
    </svg>
    {shown && !shown.capacity && <p className="state">No usable seats on published floors yet.</p>}
  </section>;
}
