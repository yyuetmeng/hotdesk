import { useCallback, useEffect, useState } from 'react';
import { request, storage } from '../../api.js';
import { useInterval } from '../../hooks.js';
import { Loading, Notice, PageTitle, SeatGrid } from '../../components.jsx';
import { options } from '../shared.jsx';

const date = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : '';

export function BookDeskPage() {
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
