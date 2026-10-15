// Book a desk: today/tomorrow, AM/PM/full day, published floors, seat panel, my bookings.
// Spec: docs/superpowers/specs/2026-10-15-seat-booking-and-checkin-design.md §6.
import { useCallback, useEffect, useState } from 'react';
import { flaskRequest } from '../api.js';
import { Loading, Notice, PageTitle } from '../components.jsx';
import { formatDate, formatTime } from '../format.js';
import FloorView from './FloorView.jsx';
import SeatPanel from './SeatPanel.jsx';
import { PRESETS, presetLabel } from './deskLogic.js';

const addDays = (isoDay, days) => {
  const [y, m, d] = isoDay.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
};
const STATE_TEXT = { active: 'Booked', checked_in: 'Checked in', released: 'Released (no check-in)',
  cancelled: 'Cancelled', plan_changed: 'Cancelled (floor plan changed)' };

export function BookDeskPage() {
  const [floors, setFloors] = useState(null);
  const [planId, setPlanId] = useState('');
  const [today, setToday] = useState(null);
  const [dayOffset, setDayOffset] = useState(0);
  const [preset, setPreset] = useState('am');
  const [floor, setFloor] = useState(null);
  const [selected, setSelected] = useState(null);
  const [mine, setMine] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    flaskRequest('/api/desk/floors').then((d) => {
      setFloors(d.items);
      if (d.items.length) setPlanId(d.items[0].id);
    }).catch((err) => setError(err.message));
  }, []);

  const date = today ? addDays(today, dayOffset) : null;
  const load = useCallback(async () => {
    if (!planId) return;
    try {
      const query = date ? `?date=${date}&preset=${preset}` : `?preset=${preset}`;
      const data = await flaskRequest(`/api/desk/floors/${planId}${query}`);
      if (!today) setToday(data.date);
      setFloor(data);
      setSelected((old) => (old ? data.seats.find((s) => s.id === old.id) ?? null : null));
      setMine((await flaskRequest('/api/desk/bookings/mine')).items);
      setError(null);
    } catch (err) { setError(err.message); }
  }, [planId, date, preset, today]);
  useEffect(() => { load(); }, [load]);

  const cancel = async (b) => {
    try { await flaskRequest(`/api/desk/bookings/${b.id}`, { method: 'DELETE' }); await load(); }
    catch (err) { setError(err.message); }
  };

  if (!floors) return <main className="page">{error ? <Notice kind="error">{error}</Notice> : <Loading label="Loading floors..." />}</main>;
  if (!floors.length) return <main className="page"><PageTitle title="Book a desk" /><Notice>No floor plan has been published yet.</Notice></main>;

  return <main className="page">
    <PageTitle title="Book a desk"><p>Book a free-for-all seat for today or tomorrow, for yourself or a colleague.</p></PageTitle>
    {error && <Notice kind="error">{error}</Notice>}
    <div className="desk-controls">
      <div className="desk-segment" role="group" aria-label="Day">
        {['Today', 'Tomorrow'].map((label, i) => <button key={label} className={dayOffset === i ? 'active' : ''}
          onClick={() => setDayOffset(i)}>{label}{today ? ` · ${formatDate(addDays(today, i))}` : ''}</button>)}
      </div>
      <div className="desk-segment" role="group" aria-label="Time">
        {PRESETS.map((p) => <button key={p} className={preset === p ? 'active' : ''} onClick={() => setPreset(p)}>{presetLabel(p)}</button>)}
      </div>
      {floors.length > 1 && <label>Floor <select value={planId} onChange={(e) => { setPlanId(e.target.value); setSelected(null); }}>
        {floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select></label>}
    </div>
    {!floor ? <Loading label="Loading floor..." /> : <div className="desk-layout">
      <section className="card"><h2>{floor.name}</h2>
        <FloorView floor={floor} selectedId={selected?.id} onSelect={setSelected} /></section>
      {selected
        ? <SeatPanel planId={planId} seat={selected} date={date ?? floor.date} preset={preset} isToday={dayOffset === 0} onChanged={load} />
        : <aside className="card desk-panel"><p className="muted">Click a seat to see who is there, today's activity, and to book a free-for-all seat.</p></aside>}
    </div>}

    <section className="card desk-bookings">
      <h2>My bookings</h2>
      {mine.length ? <table><thead><tr><th>Day</th><th>Seat</th><th>Time</th><th>For</th><th>Status</th><th /></tr></thead>
        <tbody>{mine.map((b) => <tr key={b.id}>
          <td>{formatDate(b.date)}</td><td>{b.seat_label}</td>
          <td>{formatTime(b.starts_at).slice(0, 5)}–{formatTime(b.ends_at).slice(0, 5)}<small>{presetLabel(b.preset)}</small></td>
          <td>{b.booked_for.name}{b.booked_by.name && b.booked_by.id !== b.booked_for.id && <small>booked by {b.booked_by.name}</small>}</td>
          <td>{STATE_TEXT[b.state] ?? b.state}</td>
          <td>{b.state === 'active' && <button className="button" onClick={() => cancel(b)}>Cancel</button>}</td>
        </tr>)}</tbody></table>
        : <p className="muted">No bookings for today or tomorrow.</p>}
    </section>
  </main>;
}
