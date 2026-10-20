// Seat assignments (admins): who owns which seat, until when. Spec docs/superpowers/specs/2026-10-19-seat-assignments-design.md §3.
// Left: the floor drawing with a name / end-date plate beside each assigned seat. Right: the floor's seats as a table,
// and a form for the selected seat. The drawing never shows live use (bookings, check-ins): every seat is neutral.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { flaskRequest } from '../../api.js';
import { Loading, Notice, PageTitle } from '../../components.jsx';
import { formatDate } from '../../format.js';
import FloorDrawing from '../../display/FloorDrawing.jsx';
import '../../display/display.css';
import { STATUS_TEXT, moveQuestion, replaceQuestion, seatNotes, sortRows, tableRows } from './assignmentLogic.js';
import './assignments.css';

const FIELD_NAMES = { user_id: 'Person', end_date: 'End date', note: 'Note', seat_id: 'Seat' };
const fieldText = (fields) => Object.entries(fields ?? {}).map(([k, v]) => `${FIELD_NAMES[k] ?? k}: ${v}`).join('. ');

// Live use never shows here: no occupant, no booking, no free-seat dot, no "N of M free" on the zones.
function neutral(floor) {
  return { ...floor, seats: floor.seats.map((s) => ({ ...s, state: 'neutral', occupant: null, booking: null })),
    zones: (floor.zones ?? []).map((z) => ({ ...z, free: 0, total: 0 })) };
}

function PersonCell({ a }) {
  if (!a) return <span className="muted">—</span>;
  return <>{a.person_name}
    {!a.user ? <small>Account deleted</small> : !a.user.is_active && <small>Account deactivated</small>}</>;
}

function SortHeader({ k, label, sortKey, setSortKey }) {
  const on = sortKey === k;
  return <th aria-sort={on ? 'ascending' : 'none'}>
    <button type="button" className={`sa-sort${on ? ' active' : ''}`} onClick={() => setSortKey(k)}>{label}{on ? ' ▲' : ''}</button>
  </th>;
}

// Person search over active accounts (debounced).
function PersonSearch({ onPick }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const text = q.trim();
    if (!text) { setResults([]); setSearching(false); return undefined; }
    let alive = true;
    setSearching(true);
    const timer = setTimeout(() => {
      flaskRequest(`/api/admin/users?q=${encodeURIComponent(text)}&status=active&page_size=10`)
        .then((d) => { if (alive) setResults(d.items ?? []); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [q]);
  return <div className="sa-search">
    <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" aria-label="Search for a person" autoComplete="off" />
    {q.trim() && <ul className="sa-results">
      {results.map((u) => <li key={u.id}><button type="button" onClick={() => { onPick({ id: u.id, full_name: u.full_name, is_active: true }); setQ(''); }}>
        {u.full_name}<small>{u.email}</small></button></li>)}
      {!results.length && <li className="muted">{searching ? 'Searching…' : 'No active account matches.'}</li>}
    </ul>}
  </div>;
}

// The form for one selected seat. Keyed by seat and assignment, so it starts fresh when either changes.
function AssignForm({ row, onDone, onRace }) {
  const a = row.assignment;
  const removed = Boolean(a?.seat_removed);
  const [person, setPerson] = useState(a?.user ?? null);
  const [changing, setChanging] = useState(!a?.user);
  const [endDate, setEndDate] = useState(a?.end_date ?? '');
  const [note, setNote] = useState(a?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const put = (move) => flaskRequest(`/api/admin/seat-assignments/seats/${row.seat_id}`, { method: 'PUT',
    body: { user_id: person.id, end_date: endDate || null, note, ...(move ? { move: true } : {}) } });

  const save = async (e) => {
    e.preventDefault();
    if (!person) { setError('Choose a person.'); return; }
    if (a && a.user?.id !== person.id && !window.confirm(replaceQuestion(a.person_name, person.full_name, row.seat_label))) return;
    setBusy(true); setError(null);
    try {
      try { await put(false); }
      catch (err) {
        if (err.status !== 409 || !err.data?.needs_move) throw err;
        if (!window.confirm(moveQuestion(person.full_name, err.data.current_seat_label, row.seat_label))) return;
        await put(true);
      }
      await onDone('Saved.');
    } catch (err) {
      if (err.status === 409) { onRace(err.message); return; }
      setError(err.status === 400 && err.fields ? fieldText(err.fields) : err.message);
    } finally { setBusy(false); }
  };

  const clear = async () => {
    setBusy(true); setError(null);
    try { await flaskRequest(`/api/admin/seat-assignments/${a.id}`, { method: 'DELETE' }); await onDone('Assignment cleared.'); }
    catch (err) {
      if (err.status === 404) { onRace('That assignment was already cleared or changed. The list has been reloaded.'); return; }
      setError(err.message);
    } finally { setBusy(false); }
  };

  return <form className="sa-form" onSubmit={save}>
    <h3>{row.seat_label}{removed && <span className="sa-removed">Seat removed</span>}</h3>
    {error && <Notice kind="error">{error}</Notice>}
    {removed
      ? <><p className="muted">{a.person_name} still holds this seat, but it is no longer on a published floor plan. Clear the assignment to free {a.person_name}.</p>
        <div className="button-row"><button type="button" className="button" disabled={busy} onClick={clear}>Clear assignment</button></div></>
      : <>
        <div className="sa-field"><span>Person</span>
          {person && !changing
            ? <div className="sa-person"><b>{person.full_name}</b>{person.is_active === false && <small>Account deactivated</small>}
              <button type="button" className="button sa-small" onClick={() => setChanging(true)}>Change person</button></div>
            : <>{person && <div className="sa-person"><b>{person.full_name}</b>
              {a?.user && <button type="button" className="button sa-small" onClick={() => { setPerson(a.user); setChanging(false); }}>Keep {a.user.full_name}</button>}</div>}
              <PersonSearch onPick={(p) => { setPerson(p); setChanging(false); }} /></>}
        </div>
        <label className="sa-field"><span>End date (last day)</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
        <label className="sa-field"><span>Note</span>
          <input type="text" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Optional" /></label>
        <div className="button-row">
          <button type="submit" className="button primary" disabled={busy || !person}>{busy ? 'Saving…' : 'Save'}</button>
          {a && <button type="button" className="button" disabled={busy} onClick={clear}>Clear assignment</button>}
        </div>
      </>}
  </form>;
}

export function SeatAssignmentsPage() {
  const [params, setParams] = useSearchParams();
  const wantSeat = useRef(params.get('seat'));
  const wantAssignment = useRef(params.get('assignment'));
  const [floors, setFloors] = useState(null);
  const [planId, setPlanId] = useState('');
  const [floor, setFloor] = useState(null);
  const [items, setItems] = useState([]);
  const [assignedOnly, setAssignedOnly] = useState(false);
  const [sortKey, setSortKey] = useState('seat');
  const [selectedSeatId, setSelectedSeatId] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const tableRef = useRef(null);

  useEffect(() => {
    flaskRequest('/api/public/floors').then((d) => {
      setFloors(d.items);
      if (d.items.length) setPlanId(d.items.find((f) => f.id === params.get('floor'))?.id ?? d.items[0].id);
    }).catch((err) => setError(err.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadItems = useCallback(async (id) => {
    const d = await flaskRequest(`/api/admin/seat-assignments?plan_id=${id}`);
    setItems(d.items);
    return d.items;
  }, []);

  useEffect(() => {
    if (!planId) return undefined;
    let alive = true;
    Promise.all([flaskRequest(`/api/public/floors/${planId}`), flaskRequest(`/api/admin/seat-assignments?plan_id=${planId}`)])
      .then(([f, d]) => {
        if (!alive) return;
        setFloor(f); setItems(d.items); setError(null);
        // ?assignment= (from the Insights card): switch to its floor, or select its row (a removed seat shows on every floor).
        if (wantAssignment.current) {
          const hit = d.items.find((i) => i.id === wantAssignment.current);
          if (hit && hit.plan_id && hit.plan_id !== planId) { setPlanId(hit.plan_id); return; }
          wantAssignment.current = null;
          if (hit) setSelectedSeatId(hit.seat_id);
          else setMessage('That seat assignment is no longer current.');
        }
        if (wantSeat.current) {   // ?seat=, once
          if (f.seats.some((s) => s.id === wantSeat.current)) setSelectedSeatId(wantSeat.current);
          wantSeat.current = null;
        }
      })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [planId]);

  const neutralFloor = useMemo(() => (floor ? neutral(floor) : null), [floor]);
  const notes = useMemo(() => seatNotes(items), [items]);
  const allRows = useMemo(() => tableRows(floor?.seats, items, false), [floor, items]);
  const rows = useMemo(() => {
    const shown = tableRows(floor?.seats, items, assignedOnly);
    if (sortKey === 'seat') return shown;
    const kept = shown.filter((r) => !r.assignment?.seat_removed), removed = shown.filter((r) => r.assignment?.seat_removed);
    return [...sortRows(kept, sortKey), ...sortRows(removed, sortKey)];   // removed seats stay at the bottom
  }, [floor, items, assignedOnly, sortKey]);
  const selected = allRows.find((r) => r.seat_id === selectedSeatId) ?? null;

  useEffect(() => {   // keep the selected row in view when it was picked on the drawing
    tableRef.current?.querySelector('tr.selected')?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedSeatId]);

  const reload = async (text) => {
    try { await loadItems(planId); setMessage(text); }
    catch (err) { setError(err.message); }
  };
  const onRace = async (text) => { setMessage(null); await reload(null); setError(text); };
  const onDone = async (text) => { setError(null); await reload(text); };

  const chooseFloor = (id) => {
    setPlanId(id); setSelectedSeatId(null); setMessage(null);
    setParams({ floor: id }, { replace: true });
  };

  const title = <PageTitle title="Seat assignments"><p>Who owns which seat, and until when. Click a seat or a row to assign, change or clear it.</p></PageTitle>;
  if (!floors && !error) return <main className="page">{title}<Loading label="Loading floors…" /></main>;
  if (!floors) return <main className="page">{title}<Notice kind="error">{error}</Notice></main>;
  if (!floors.length) return <main className="page">{title}<Notice>No floor plan has been published yet.</Notice></main>;

  return <main className="page">
    {title}
    {error && <Notice kind="error">{error}</Notice>}
    {message && <Notice kind="success">{message}</Notice>}
    <div className="desk-controls">
      {floors.length > 1 && <label>Floor <select value={planId} onChange={(e) => chooseFloor(e.target.value)}>
        {floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select></label>}
      <label className="sa-toggle"><input type="checkbox" checked={assignedOnly} onChange={(e) => setAssignedOnly(e.target.checked)} /> Show assigned only</label>
    </div>
    {(!floor || floor.id !== planId) && !error && <Loading label="Loading the floor…" />}
    {floor && floor.id === planId && <div className="sa-layout">
      <section className="card"><h2>{floor.name}</h2>
        <div className="sa-drawing"><FloorDrawing floor={neutralFloor} notes={notes} selectedId={selectedSeatId}
          onSeatClick={(seat) => { setSelectedSeatId(seat.id); setMessage(null); }} /></div>
        <ul className="sa-legend">
          <li><span className="sa-key ok" />Assigned</li><li><span className="sa-key soon" />Leaving soon (14 days)</li><li><span className="sa-key left" />Left</li>
        </ul></section>
      <section className="card sa-side">
        <h2>Seats</h2>
        {!floor.seats.length && <p className="state">This floor has no seats.</p>}
        {rows.length > 0 && <div className="sa-table-wrap" ref={tableRef}><table className="sa-table">
          <thead><tr>
            <SortHeader k="seat" label="Seat" sortKey={sortKey} setSortKey={setSortKey} />
            <th>Person</th>
            <SortHeader k="end_date" label="End date" sortKey={sortKey} setSortKey={setSortKey} />
            <SortHeader k="status" label="Status" sortKey={sortKey} setSortKey={setSortKey} />
            <th>Note</th>
          </tr></thead>
          <tbody>{rows.map((r) => {
            const a = r.assignment;
            return <tr key={`${r.seat_id}-${a?.id ?? ''}`} className={r.seat_id === selectedSeatId ? 'selected' : undefined}
              onClick={() => { setSelectedSeatId(r.seat_id); setMessage(null); }} tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') { setSelectedSeatId(r.seat_id); setMessage(null); } }}>
              <td>{r.seat_label}{a?.seat_removed && <span className="sa-removed">Seat removed</span>}</td>
              <td><PersonCell a={a} /></td>
              <td>{a ? (a.end_date ? formatDate(a.end_date) : <span className="muted">No end date</span>) : ''}</td>
              <td>{a ? <span className={`sa-status ${a.status}`}>{STATUS_TEXT[a.status] ?? a.status}</span> : <span className="muted">Not assigned</span>}</td>
              <td className="sa-note">{a?.note ?? ''}</td>
            </tr>;
          })}</tbody>
        </table></div>}
        {floor.seats.length > 0 && !rows.length && <p className="state">No seats on this floor are assigned.</p>}
        {selected
          ? <AssignForm key={`${selected.seat_id}-${selected.assignment?.id ?? 'none'}`} row={selected} onDone={onDone} onRace={onRace} />
          : floor.seats.length > 0 && <p className="muted sa-hint">Click a seat on the floor or a row in the table.</p>}
      </section>
    </div>}
  </main>;
}
