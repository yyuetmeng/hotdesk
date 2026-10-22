// Book a desk: today / next working day, AM/PM/full day, published floors, seat panel, my bookings.
// Spec: docs/superpowers/specs/2026-10-15-seat-booking-and-checkin-design.md §6.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { flaskRequest } from '../api.js';
import { Loading, Notice, PageTitle } from '../components.jsx';
import { formatDate, formatTime } from '../format.js';
import FloorDrawing, { SeatKey } from '../display/FloorDrawing.jsx';
import '../display/display.css';
import SeatPanel from './SeatPanel.jsx';
import { canAddSeat } from './bookingLogic.js';
import { PRESETS, dayActive, firstLoad, floorLoading, latestOnly, nextDayName, presetLabel, stateLabel } from './deskLogic.js';

const STATE_TEXT = { active: 'Booked', checked_in: 'Checked in', released: 'Released (no check-in)',
  cancelled: 'Cancelled', plan_changed: 'Cancelled (floor plan changed)' };

export function BookDeskPage() {
  const [params] = useSearchParams();
  const wantSeat = useRef(params.get('seat'));
  const [floors, setFloors] = useState(null);
  const [planId, setPlanId] = useState('');
  const [days, setDays] = useState(null);   // [today, next working day] from the server
  const [dayOffset, setDayOffset] = useState(0);
  const [bothDays, setBothDays] = useState(false);   // the panel's Day = Both; the floor then shows `dayOffset`
  const [preset, setPreset] = useState(PRESETS[0]);
  const [floor, setFloor] = useState(null);
  const [selected, setSelected] = useState(null);
  const [multi, setMulti] = useState(false);     // booking several seats for colleagues: clicks add seats
  const [picked, setPicked] = useState([]);       // the extra seats (the clicked seat is `selected`)
  const [skipped, setSkipped] = useState(null);
  const [mine, setMine] = useState([]);
  const [error, setError] = useState(null);
  const [findNote, setFindNote] = useState(null);   // Find me a seat: nothing free
  const [finding, setFinding] = useState(false);
  const latest = useRef(latestOnly()).current;   // changing day/slot fast must not let an old answer win

  useEffect(() => {
    flaskRequest('/api/desk/floors').then((d) => {
      setFloors(d.items);
      setDays(d.days);
      // ?plan= (from the dashboard's Book again) picks the floor when it is still published.
      if (d.items.length) setPlanId(d.items.find((f) => f.id === params.get('plan'))?.id ?? d.items[0].id);
    }).catch((err) => setError(err.message));
  }, []);

  const date = days ? days[dayOffset] : null;
  const load = useCallback(async () => {
    if (!planId) return;
    const token = latest.start();
    try {
      const query = date ? `?date=${date}&preset=${preset}` : `?preset=${preset}`;
      const data = await flaskRequest(`/api/desk/floors/${planId}${query}`);
      if (!latest.current(token)) return;
      setFloor(data);
      const wanted = wantSeat.current ? data.seats.find((s) => s.id === wantSeat.current) : null;   // ?seat=, once
      if (wanted) wantSeat.current = null;
      setSelected((old) => wanted ?? (old ? data.seats.find((s) => s.id === old.id) ?? null : null));
      setPicked((old) => old.map((p) => data.seats.find((s) => s.id === p.id)).filter((s) => s && canAddSeat(s, preset, [])));
      const list = (await flaskRequest('/api/desk/bookings/mine')).items;
      if (!latest.current(token)) return;
      setMine(list);
      setError(null);
    } catch (err) { if (latest.current(token)) setError(err.message); }
  }, [planId, date, preset]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setFindNote(null); }, [date, preset]);

  // Select a suggested seat, switching floor when it is on another one (wantSeat picks it once the floor loads).
  const jumpTo = (s) => {
    wantSeat.current = s.seat_id;
    setPicked([]); setMulti(false); setSkipped(null);
    if (s.plan_id === planId) load(); else setPlanId(s.plan_id);
  };
  const findSeat = async () => {
    setFinding(true); setFindNote(null);
    try {
      const r = await flaskRequest(`/api/desk/suggest?date=${date}&preset=${preset}`);
      if (r.tier === 'none') {
        const day = dayOffset === 0 ? 'today' : nextDayName(days[1], days[0]).replace('Tomorrow', 'tomorrow');
        setFindNote(`No free seat for ${day} ${presetLabel(preset)}.`);
      } else jumpTo(r.seats[0]);
    } catch (err) { setError(err.message); } finally { setFinding(false); }
  };

  const clickSeat = (seat) => {
    if (multi && selected && seat.id !== selected.id) {
      if (picked.some((p) => p.id === seat.id)) { setPicked((ps) => ps.filter((p) => p.id !== seat.id)); return; }
      if (canAddSeat(seat, preset, [selected.id, ...picked.map((p) => p.id)])) { setPicked((ps) => [...ps, seat]); setSkipped(null); }
      else setSkipped(`${seat.label} can't be added: only seats that are free for ${presetLabel(preset)}.`);
      return;
    }
    setSelected(seat); setPicked([]); setMulti(false); setSkipped(null);
  };
  const chooseMulti = (on) => { setMulti(on); if (!on) setPicked([]); setSkipped(null); };

  const cancel = async (b) => {
    try { await flaskRequest(`/api/desk/bookings/${b.id}`, { method: 'DELETE' }); await load(); }
    catch (err) { setError(err.message); }
  };

  const title = <PageTitle title="Book a Desk"><p>Book a seat for today or the next working day, for yourself or a colleague.</p></PageTitle>;
  if (firstLoad({ floors, floor, error })) return <main className="page">{title}<Loading label="Looking for a free desk…" /></main>;
  if (!floors) return <main className="page">{title}<Notice kind="error">{error}</Notice></main>;
  if (!floors.length) return <main className="page">{title}<Notice>No floor plan has been published yet.</Notice></main>;

  return <main className="page">
    {title}
    {error && <Notice kind="error">{error}</Notice>}
    <div className="desk-controls">
      <div className="desk-segment" role="group" aria-label="Day">
        {['Today', days ? nextDayName(days[1], days[0]) : 'Tomorrow'].map((label, i) => <button key={i} className={dayActive(i, dayOffset, bothDays) ? 'active' : ''}
          aria-pressed={dayActive(i, dayOffset, bothDays)} onClick={() => { setDayOffset(i); setBothDays(false); }}>{label}{days ? ` · ${formatDate(days[i])}` : ''}</button>)}
      </div>
      <div className="desk-segment" role="group" aria-label="Time">
        {PRESETS.map((p) => <button key={p} className={preset === p ? 'active' : ''} onClick={() => setPreset(p)}>{presetLabel(p)}</button>)}
      </div>
      {floors.length > 1 && <label>Floor <select value={planId} onChange={(e) => { setPlanId(e.target.value); setSelected(null); setPicked([]); setMulti(false); }}>
        {floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select></label>}
      <button type="button" className="button primary" disabled={finding || !date} onClick={findSeat}>{finding ? 'Looking…' : 'Find me a seat'}</button>
    </div>
    {findNote && <Notice>{findNote}</Notice>}
    {floorLoading(floor, planId) && !error && <Loading label={`Looking for a free desk on ${floors.find((f) => f.id === planId)?.name ?? 'this floor'}…`} />}
    {floor && <div className="desk-layout">
      <section className="card"><h2>{floor.name} <small className="desk-showing">
        · {floor.date === days?.[0] ? 'Today' : nextDayName(floor.date, days?.[0] ?? floor.date)} {formatDate(floor.date)} · {presetLabel(preset)}</small></h2>
        <div className="desk-drawing"><FloorDrawing floor={floor} selectedId={selected?.id} selectedIds={picked.map((p) => p.id)} onSeatClick={clickSeat} /></div>
        <ul className="desk-legend">
          {['available', 'booked', 'occupied', 'not_bookable'].map((s) => <li key={s}><SeatKey state={s} />{stateLabel(s)}</li>)}
        </ul></section>
      {selected
        ? <SeatPanel planId={planId} seat={selected} isToday={dayOffset === 0} onChanged={load} teamFirst={floor.team_first} jumpTo={jumpTo}
          booking={{ picked, multi, setMulti: chooseMulti, onRemovePicked: (id) => setPicked((ps) => ps.filter((p) => p.id !== id)),
            days: days ?? [floor.date, floor.date], dayOffset, setDayOffset, bothDays, setBothDays, preset, setPreset, skipped }} />
        : <aside className="card desk-panel"><p className="muted">Click a seat to see who is there, today's activity, and to book it.</p></aside>}
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
        : <p className="muted">No bookings for today or the next working day.</p>}
    </section>
  </main>;
}
