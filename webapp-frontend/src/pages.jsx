import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { appendToken, apiUrl, promptForToken, readAdminToken, request, storage } from './api.js';
import { useInterval, useStateEvents } from './hooks.js';
import { AdminGate, Loading, Notice, PageTitle, SeatGrid, Status } from './components.jsx';

const time = (value) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
const date = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const options = (items, valueKey = 'id', labelKey = 'name') => items.map((item) => <option key={item[valueKey]} value={item[valueKey]}>{item[labelKey]}</option>);

function useAdminData(load) {
  const [token, setToken] = useState(readAdminToken);
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const refresh = useCallback(async () => {
    if (!token) { setState({ loading: false, error: new Error('Enter the administrator token to continue.'), data: null }); return; }
    try { setState((old) => ({ ...old, loading: !old.data, error: null })); setState({ loading: false, error: null, data: await load(token) }); }
    catch (error) { setState((old) => ({ ...old, loading: false, error })); }
  }, [load, token]);
  useEffect(() => { refresh(); }, [refresh]);
  return { ...state, token, refresh, askForToken: () => { const next = promptForToken(); if (next) setToken(next); } };
}

export function DashboardPage() {
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

function Kpi({ label, value }) { return <div className="card kpi"><span>{label}</span><b>{value}</b></div>; }

export function CheckInPage() {
  const location = useLocation(); const navigate = useNavigate();
  const [seatId, setSeatId] = useState(new URLSearchParams(location.search).get('seat') ?? '');
  const [seat, setSeat] = useState(null); const [config, setConfig] = useState(null);
  const [user, setUser] = useState(storage.get('hotdesk.user')); const [team, setTeam] = useState(storage.get('hotdesk.team'));
  const [slot, setSlot] = useState('auto'); const [message, setMessage] = useState('');
  useEffect(() => { request('/api/checkin-options').then(setConfig).catch((error) => setMessage(error.message)); }, []);
  const loadSeat = useCallback(async (id = seatId) => { try { setSeat(await request(`/api/seats/${encodeURIComponent(id)}`)); setMessage(''); } catch (error) { setMessage(error.message); setSeat(null); } }, [seatId]);
  useEffect(() => { if (seatId) loadSeat(); }, [seatId, loadSeat]);
  const submit = async (action) => { try { const result = await request(`/api/seats/${encodeURIComponent(seatId)}/${action}`, { method: 'POST', body: { user, projectTeam: team, ...(action === 'checkin' ? { slot } : {}) } }); storage.set('hotdesk.user', user); storage.set('hotdesk.team', team); setSeat(result); setMessage(action === 'checkin' ? 'You are checked in.' : 'You are checked out.'); } catch (error) { setMessage(error.message); } };
  return <main className="page narrow"><PageTitle title="Desk check-in"><p>Scan a desk QR code or enter the desk ID printed at the workstation.</p></PageTitle>
    <section className="card"><form onSubmit={(e) => { e.preventDefault(); navigate(`/checkin?seat=${encodeURIComponent(seatId)}`); loadSeat(); }} className="inline-form"><label>Desk ID<input value={seatId} onChange={(e) => setSeatId(e.target.value.toUpperCase())} placeholder="L1-DF-01" required /></label><button className="button" type="submit">Find desk</button></form>
      {message && <Notice kind={seat ? 'success' : 'error'}>{message}</Notice>}
      {seat && <div className="checkin-card"><h2>{seat.id}</h2><p>{seat.floorName} · {seat.zoneName}</p><Status value={seat.status} />{seat.reservation && <Notice>This desk has a reservation for {seat.reservation.slotLabel}.</Notice>}
        <label>Your name or employee ID<input value={user} onChange={(e) => setUser(e.target.value)} /></label><label>Project team<select value={team} onChange={(e) => setTeam(e.target.value)}><option value="">Choose a project</option>{options(config?.projects ?? [])}</select></label><label>Duration<select value={slot} onChange={(e) => setSlot(e.target.value)}>{options([{ id: 'auto', label: 'Recommended' }, ...(config?.checkinSlots ?? [])], 'id', 'label')}</select></label>
        <div className="button-row"><button className="button primary" type="button" onClick={() => submit('checkin')}>Check in</button><button className="button" type="button" onClick={() => submit('checkout')}>I am leaving</button></div></div>}
    </section><Link className="quiet-link" to="/book">Reserve a desk ahead</Link></main>;
}

export function BookingPage() {
  const [config, setConfig] = useState(null); const [floors, setFloors] = useState([]); const [seats, setSeats] = useState([]);
  const [project, setProject] = useState(storage.get('hotdesk.team')); const [dateValue, setDateValue] = useState(''); const [slot, setSlot] = useState(''); const [selected, setSelected] = useState(null); const [user, setUser] = useState(storage.get('hotdesk.user')); const [message, setMessage] = useState('');
  useEffect(() => { Promise.all([request('/api/checkin-options'), request('/api/floors')]).then(([nextConfig, nextFloors]) => { setConfig(nextConfig); setFloors(nextFloors); setDateValue(nextConfig.reservations.dates[0]); setSlot('am'); }).catch((error) => setMessage(error.message)); }, []);
  const refresh = useCallback(() => { if (dateValue && slot) request(`/api/availability?date=${dateValue}&slot=${slot}`).then(setSeats).catch((error) => setMessage(error.message)); }, [dateValue, slot]);
  useEffect(refresh, [refresh]); useInterval(refresh, 10_000);
  const reserve = async () => { try { await request('/api/reservations', { method: 'POST', body: { seatId: selected, user, projectTeam: project, date: dateValue, slot } }); storage.set('hotdesk.user', user); storage.set('hotdesk.team', project); setMessage(`Reserved ${selected} for ${date(dateValue)}.`); setSelected(null); refresh(); } catch (error) { setMessage(error.message); } };
  return <main className="page"><PageTitle title="Reserve a desk"><p>Choose a project, slot, and an available desk.</p></PageTitle>{!config ? <Loading /> : <>
    <section className="card"><div className="booking-controls"><label>Project<select value={project} onChange={(e) => setProject(e.target.value)}><option value="">Choose a project</option>{config.projectTeams.map((name) => <option key={name}>{name}</option>)}</select></label><label>Day<select value={dateValue} onChange={(e) => setDateValue(e.target.value)}>{config.reservations.dates.map((item) => <option key={item}>{date(item)}</option>)}</select></label><label>Slot<select value={slot} onChange={(e) => setSlot(e.target.value)}>{options(config.reservations.slots, 'id', 'label')}</select></label></div>{message && <Notice>{message}</Notice>}<SeatGrid seats={seats} selected={selected} onSelect={(seat) => setSelected(seat.id)} selectable={(seat) => seat.slotState?.state === 'free'} slotMode /></section>
    <section className="card reservation-form"><h2>{selected ? `Reserve ${selected}` : 'Select an available desk'}</h2><label>Your name or employee ID<input value={user} onChange={(e) => setUser(e.target.value)} /></label><button className="button primary" disabled={!selected || !user || !project} onClick={reserve}>Reserve desk</button><p>Reservations are held until the check-in deadline. Check in by scanning the QR code at the desk.</p></section>
  </>}</main>;
}

export function DisplayPage() {
  const params = new URLSearchParams(useLocation().search); const key = params.get('key'); const token = params.get('token');
  const [data, setData] = useState(null); const [message, setMessage] = useState('');
  const refresh = useCallback(async () => { try { const [people, seats] = await Promise.all([request('/api/display/people', { token, displayKey: key }), request('/api/availability')]); setData({ people, seats }); setMessage(''); } catch (error) { setMessage(error.message); } }, [key, token]);
  useEffect(() => { refresh(); }, [refresh]); useInterval(refresh, 5_000);
  return <main className="page display-page"><PageTitle title="Floor display"><p>{data?.people?.building ?? 'Live availability and colleague finder'}</p></PageTitle>{message && <Notice kind="error">{message}</Notice>}{!data ? <Loading /> : <><section className="kpis"><Kpi label="People today" value={data.people.people.length} /><Kpi label="Available desks" value={data.seats.filter((seat) => seat.status === 'available').length} /></section><section className="card"><SeatGrid seats={data.seats} /></section><section className="card"><h2>Colleague finder</h2><table><thead><tr><th>Name</th><th>Project</th><th>Desk</th><th>Status</th></tr></thead><tbody>{data.people.people.map((person) => <tr key={`${person.name}-${person.team}`}><td>{person.name}</td><td>{person.team}</td><td>{person.seats.map((seat) => seat.id).join(', ')}</td><td>{person.status}</td></tr>)}</tbody></table></section></>}</main>;
}

export function InsightsPage() {
  const load = useCallback((token) => request('/api/insights', { token }), []); const { loading, error, data, askForToken } = useAdminData(load);
  if (error) return <AdminGate error={error} onRetry={askForToken} />; if (loading || !data) return <main className="page"><Loading /></main>;
  const office = data.series.office;
  return <main className="page"><PageTitle title="Capacity and demand planning"><p>Simulated planning data. It does not affect live check-ins or reservations.</p></PageTitle><Notice>This view uses simulated demand and forecasts, not the live occupancy stream.</Notice><section className="kpis"><Kpi label="Seats" value={office?.seats ?? '—'} /><Kpi label="Planning threshold" value={`${Math.round(data.threshold * 100)}%`} /><Kpi label="Forecast horizon" value={`${data.horizonDays} days`} /></section><section className="card"><h2>Available planning scopes</h2><table><thead><tr><th>Area</th><th>Seats</th><th>Forecast points</th></tr></thead><tbody>{Object.entries(data.series).map(([id, series]) => <tr key={id}><td>{series.label}</td><td>{series.seats}</td><td>{series.forecast.length}</td></tr>)}</tbody></table></section></main>;
}

export function SensorsPage() {
  const load = useCallback((token) => request('/api/sensors', { token }), []); const { loading, error, data, token, refresh, askForToken } = useAdminData(load); const [filter, setFilter] = useState(''); const [message, setMessage] = useState('');
  const save = async (id, sensorId) => { try { await request(`/api/seats/${encodeURIComponent(id)}/sensor`, { method: 'PUT', token, body: { sensorId } }); setMessage(`${id} updated.`); refresh(); } catch (requestError) { setMessage(requestError.message); } };
  if (error) return <AdminGate error={error} onRetry={askForToken} />; if (loading || !data) return <main className="page"><Loading /></main>;
  const desks = data.desks.filter((desk) => `${desk.id} ${desk.sensorId ?? ''}`.toLowerCase().includes(filter.toLowerCase()));
  return <main className="page"><PageTitle title="Desk sensors"><p>Link reporting sensors to desks and review sensor health.</p></PageTitle>{message && <Notice>{message}</Notice>}<section className="kpis"><Kpi label="Linked" value={data.desks.filter((desk) => desk.sensorId).length} /><Kpi label="Online" value={data.desks.filter((desk) => desk.sensorOnline).length} /><Kpi label="Unlinked reports" value={data.unlinked.length} /></section><section className="card"><h2>Unlinked sensors</h2>{data.unlinked.length ? <ul className="activity">{data.unlinked.map((sensor) => <li key={sensor.sensorId}>{sensor.sensorId} <small>last seen {time(sensor.lastSeenAt)}</small></li>)}</ul> : <p>No unlinked sensors are reporting.</p>}</section><section className="card"><div className="toolbar"><h2>Desk links</h2><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter desks or sensors" /></div><table><thead><tr><th>Desk</th><th>Sensor</th><th>State</th><th /></tr></thead><tbody>{desks.map((desk) => <SensorRow key={desk.id} desk={desk} onSave={save} />)}</tbody></table></section></main>;
}

function SensorRow({ desk, onSave }) { const [sensor, setSensor] = useState(desk.sensorId ?? ''); useEffect(() => setSensor(desk.sensorId ?? ''), [desk.sensorId]); return <tr><td>{desk.id}<small>{desk.floorName} · {desk.zoneName}</small></td><td><input value={sensor} onChange={(e) => setSensor(e.target.value)} /></td><td>{desk.sensorOnline ? 'Online' : desk.sensorId ? 'Offline' : 'Unlinked'}</td><td><button className="button" onClick={() => onSave(desk.id, sensor)}>Save</button></td></tr>; }
