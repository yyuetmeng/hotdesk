import { useCallback, useEffect, useState } from 'react';
import { request } from '../../api.js';
import { AdminGate, Loading, Notice, PageTitle } from '../../components.jsx';
import { Kpi, time, useAdminData } from '../shared.jsx';

export function SensorsPage() {
  const load = useCallback((token) => request('/api/sensors', { token }), []); const { loading, error, data, token, refresh, askForToken } = useAdminData(load); const [filter, setFilter] = useState(''); const [message, setMessage] = useState('');
  const save = async (id, sensorId) => { try { await request(`/api/seats/${encodeURIComponent(id)}/sensor`, { method: 'PUT', token, body: { sensorId } }); setMessage(`${id} updated.`); refresh(); } catch (requestError) { setMessage(requestError.message); } };
  if (error) return <AdminGate error={error} onRetry={askForToken} />; if (loading || !data) return <main className="page"><Loading /></main>;
  const desks = data.desks.filter((desk) => `${desk.id} ${desk.sensorId ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  return <main className="page"><PageTitle title="Desk sensors"><p>Link reporting sensors to desks and review sensor health.</p></PageTitle>{message && <Notice>{message}</Notice>}<section className="kpis"><Kpi label="Linked" value={data.desks.filter((desk) => desk.sensorId).length} /><Kpi label="Online" value={data.desks.filter((desk) => desk.sensorOnline).length} /><Kpi label="Unlinked reports" value={data.unlinked.length} /></section><section className="card"><h2>Unlinked sensors</h2>{data.unlinked.length ? <ul className="activity">{data.unlinked.map((sensor) => <li key={sensor.sensorId}>{sensor.sensorId} <small>last seen {time(sensor.lastSeenAt)}</small></li>)}</ul> : <p>No unlinked sensors are reporting.</p>}</section><section className="card"><div className="toolbar"><h2>Desk links</h2><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter desks or sensors" /></div><table><thead><tr><th>Desk</th><th>Sensor</th><th>State</th><th /></tr></thead><tbody>{desks.map((desk) => <SensorRow key={desk.id} desk={desk} onSave={save} />)}</tbody></table></section></main>;
}

function SensorRow({ desk, onSave }) { const [sensor, setSensor] = useState(desk.sensorId ?? ''); useEffect(() => setSensor(desk.sensorId ?? ''), [desk.sensorId]); return <tr><td>{desk.id}<small>{desk.floorName} · {desk.zoneName}</small></td><td><input value={sensor} onChange={(e) => setSensor(e.target.value)} /></td><td>{desk.sensorOnline ? 'Online' : desk.sensorId ? 'Offline' : 'Unlinked'}</td><td><button className="button" onClick={() => onSave(desk.id, sensor)}>Save</button></td></tr>; }
