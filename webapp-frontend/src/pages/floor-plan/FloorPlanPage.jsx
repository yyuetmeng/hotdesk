import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { appendToken, request, storage } from '../../api.js';
import { useInterval, useStateEvents } from '../../hooks.js';
import { AdminGate, Loading, PageTitle, SeatGrid, Status } from '../../components.jsx';
import { Kpi, options, time, useAdminData } from '../shared.jsx';

export function FloorPlanPage() {
  const load = useCallback(async (token) => {
    const [summary, seats, projects, activity] = await Promise.all([
      request('/api/summary', { token }), request('/api/seats', { token }), request('/api/projects', { token }), request('/api/activity', { token }),
    ]);
    return { summary, seats, projects, activity };
  }, []);
  const { loading, error, data, token, refresh, askForToken } = useAdminData(load);
  const [selected, setSelected] = useState(null);
  const [floor, setFloor] = useState(storage.get('hotdesk.floor'));
  useStateEvents(token, refresh);
  useInterval(refresh, 30_000);
  if (error) return <AdminGate error={error} onRetry={askForToken} />;
  if (loading || !data) return <main className="page"><Loading label="Loading live desk availability..." /></main>;
  const visible = data.seats.filter((seat) => !floor || seat.floor === floor);
  const counts = visible.reduce((all, seat) => ({ ...all, [seat.status]: (all[seat.status] ?? 0) + 1 }), { total: visible.length });
  const pick = data.seats.find((seat) => seat.id === selected);
  return <main className="page">
    <PageTitle title="Office floor plan"><p>Live desk availability, project allocation, and workplace activity.</p></PageTitle>
    <div className="toolbar"><label>Floor <select value={floor} onChange={(e) => { setFloor(e.target.value); storage.set('hotdesk.floor', e.target.value); }}><option value="">All floors</option>{options(data.summary.floors)}</select></label>
      <a className="button" href={appendToken('/labels', token)} target="_blank" rel="noreferrer">Print labels</a>
      <a className="button" href={appendToken('/api/requesters.csv', token)}>Download requesters</a></div>
    <section className="kpis"><Kpi label="Occupancy" value={`${Math.round((counts.occupied + counts.away) / Math.max(1, counts.total) * 100)}%`} /><Kpi label="Available" value={counts.available ?? 0} /><Kpi label="Occupied" value={counts.occupied ?? 0} /><Kpi label="Away" value={counts.away ?? 0} /><Kpi label="Reserved" value={counts.reserved ?? 0} /></section>
    <div className="content-split"><section className="card"><h2>Floor plan</h2><SeatGrid seats={visible} selected={selected} onSelect={(seat) => setSelected(seat.id)} /></section>
      <aside className="card detail"><h2>Desk details</h2>{pick ? <><b>{pick.id}</b><p>{pick.floorName} · {pick.zoneName}</p><Status value={pick.status} />{pick.checkedInBy && <p>Checked in: {pick.checkedInBy}</p>}<Link className="button primary" to={`/checkin?seat=${encodeURIComponent(pick.id)}`}>Open check-in</Link></> : <p>Select a desk to see its status.</p>}</aside></div>
    <div className="content-split"><section className="card"><h2>Project teams</h2><table><thead><tr><th>Project</th><th>Allocated desks</th></tr></thead><tbody>{data.projects.map((project) => <tr key={project.name}><td>{project.name}</td><td>{project.seats.length}</td></tr>)}</tbody></table></section>
      <section className="card"><h2>Recent activity</h2><ul className="activity">{data.activity.slice(0, 12).map((entry, index) => <li key={`${entry.at}-${index}`}><b>{entry.action}</b> {entry.seatId} <small>{time(entry.at)}</small></li>)}</ul></section></div>
  </main>;
}
