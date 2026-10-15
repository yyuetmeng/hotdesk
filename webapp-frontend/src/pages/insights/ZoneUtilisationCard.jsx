// Live "Utilisation by zone" card for admins (spec 2026-10-15-floor-zones §6): free seats per zone and
// how the rest are used, refreshed every 30 seconds.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { flaskRequest } from '../../api.js';
import { Loading, Notice } from '../../components.jsx';
import { sgTime } from '../../display/displayLogic.js';
import { barWidths, pctText, showNoZones } from './zoneLogic.js';
import './insights.css';

const REFRESH_MS = 30000;

export default function ZoneUtilisationCard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => flaskRequest('/api/admin/insights/zones')
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((err) => { if (alive) setError(err.message); });
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  if (!data && !error) return <Loading label="Loading zones..." />;
  return <section className="card zone-util">
    {data && <span className="zone-util-updated">Live · updated {sgTime(data.now).slice(0, 5)}</span>}
    <h2>Utilisation by zone</h2>
    <p className="zone-util-sub">Free seats and how the rest are used, per zone.</p>
    {error && <Notice kind="error">{error}</Notice>}
    {!data ? null
      : showNoZones(data)
        ? <p className="state">No zones yet. Draw zones in <Link to="/floor-plans">Manage Floor Plan</Link> and publish.</p>
        : <>
          <table>
            <thead><tr><th>Zone</th><th className="zone-util-free">Free</th><th className="zone-util-bar-col">In use</th><th /></tr></thead>
            <tbody>{data.rows.map((row) => {
              const widths = barWidths(row);
              return <tr key={`${row.plan_id}-${row.zone_id ?? row.name}`}>
                <td>{row.name}<small>{row.level}</small></td>
                <td className="zone-util-free"><b>{row.free}</b> / {row.total}</td>
                <td><div className="zone-util-bar" role="img"
                  aria-label={`${row.occupied} occupied, ${row.booked} booked, of ${row.total}`}>
                  <span className="occupied" style={{ width: widths.occupied }} />
                  <span className="booked" style={{ width: widths.booked }} />
                </div></td>
                <td className="zone-util-pct">{pctText(row)}</td>
              </tr>;
            })}</tbody>
          </table>
          <ul className="zone-util-legend">
            <li><span className="occupied" />Occupied (checked in)</li>
            <li><span className="booked" />Booked, not yet checked in</li>
          </ul>
        </>}
  </section>;
}
