// Desk check-in, opened by a seat's QR code (/checkin/:seatId) — or /checkin for "my seat", which also lists
// today's bookings with a Check in button, so no QR code is needed (owner 2026-10-16).
// Scanning checks in automatically when allowed; giving the seat up always needs a tap.
// Spec: docs/superpowers/specs/2026-10-15-seat-booking-and-checkin-design.md §2.5, §6.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { flaskRequest } from '../api.js';
import { Loading, Notice, PageTitle } from '../components.jsx';
import { formatTime } from '../format.js';
import { checkInWindow, myBookingsToday, presetLabel, sgToday, stateLabel } from './deskLogic.js';
import { checkInLocation } from './location.js';
import { checkInOutcome } from './scanLogic.js';
import './desk.css';

const CheckInTitle = () => <PageTitle title="Desk check-in"><p>Scan the QR code on a desk to check in there, and give the seat up when you leave.</p></PageTitle>;

export function CheckInPage() {
  const { seatId } = useParams();
  return seatId ? <SeatCheckIn seatId={seatId} /> : <MySeat />;
}

function SeatCheckIn({ seatId }) {
  const [seat, setSeat] = useState(null);
  const [result, setResult] = useState(null);   // { kind: 'checked_in', checkin, warning } | { kind: 'gave_up' } | { kind: 'error', text }
  const [busy, setBusy] = useState(false);
  const attempted = useRef(false);                // StrictMode runs effects twice in development

  const reload = useCallback(async () => setSeat(await flaskRequest(`/api/desk/seats/${seatId}`)), [seatId]);

  useEffect(() => {
    (async () => {
      try {
        const info = await flaskRequest(`/api/desk/seats/${seatId}`);
        setSeat(info);
        if (info.can_check_in && !attempted.current) {
          attempted.current = true;
          const c = await flaskRequest(`/api/desk/seats/${seatId}/check-in`, { method: 'POST', body: await checkInLocation() });
          setResult({ kind: 'checked_in', checkin: c, warning: c.warning });
          await reload();
        }
      } catch (err) { setResult({ kind: 'error', text: err.message }); }
    })();
  }, [seatId, reload]);

  const giveUp = async () => {
    setBusy(true);
    try {
      await flaskRequest(`/api/desk/seats/${seatId}/give-up`, { method: 'POST' });
      setResult({ kind: 'gave_up' });
      await reload();
    } catch (err) { setResult({ kind: 'error', text: err.message }); }
    finally { setBusy(false); }
  };

  if (!seat && !result) return <main className="page"><CheckInTitle /><Loading label="Checking the seat..." /></main>;
  const outcome = checkInOutcome({ seat, result });
  if (outcome) return <main className="page desk-checkin"><CheckInResult outcome={outcome} seat={seat} busy={busy} onGiveUp={giveUp} /></main>;
  return <main className="page desk-checkin">
    <CheckInTitle />
    {seat && <>
      <p className="big"><b>{seat.label}</b> · {seat.plan.name}</p>
      <p className="muted">{seat.department} · {stateLabel(seat.state)}</p>
    </>}
    {result && <Notice kind={result.kind}>{result.text}</Notice>}
    {seat?.my_checkin && !result && <Notice kind="success">You're checked in here since {formatTime(seat.my_checkin.checked_in_at)},
      until {formatTime(seat.my_checkin.ends_at).slice(0, 5)}.</Notice>}
    {seat?.can_give_up && <button className="button primary" disabled={busy} onClick={giveUp}>Give up seat</button>}
    {seat && !seat.can_give_up && !seat.can_check_in && seat.reason && !result && <Notice kind="error">{seat.reason}</Notice>}
    <p><Link to="/book">Book a desk</Link> · <Link to="/checkin">My seat</Link></p>
  </main>;
}

// The result after scanning (owner 2026-10-16, preview scan-flow-v1): a big tick or cross, the seat, and what next.
// Everything stays in the app; "Scan another desk" goes straight back to the camera.
function CheckInResult({ outcome, seat, busy, onGiveUp }) {
  const where = seat ? [seat.plan?.name, seat.zone].filter(Boolean).join(' · ') : '';
  const c = outcome.checkin;
  return <section className={`desk-result ${outcome.kind}`} role="status" aria-live="polite">
    <div className="desk-result-badge" aria-hidden="true">{outcome.kind === 'bad' ? '✕' : '✓'}</div>
    <h1>{outcome.title}</h1>
    {seat && <p className="desk-result-seat">Seat <b>{seat.label}</b>{where && ` · ${where}`}</p>}
    {outcome.kind === 'ok' && <div className="desk-result-card">
      Since <b>{formatTime(c.checked_in_at).slice(0, 5)}</b>, until <b>{formatTime(c.ends_at).slice(0, 5)}</b>
      <br />{c.method === 'walk_in' ? 'Walk-in (no booking)' : 'Your booked seat'}
      {outcome.note && <><br /><span className="desk-result-warn">{outcome.note}</span></>}
      <br /><span className="muted">Give the seat up when you leave.</span>
    </div>}
    {outcome.kind === 'bad' && <div className="desk-result-card"><b>{outcome.reason}</b>
      <br /><span className="muted">Free-for-all seats and your own team's seats can be used without booking.</span></div>}
    {outcome.kind === 'done' && <p className="muted">{outcome.note}</p>}
    <div className="desk-result-actions">
      {outcome.kind === 'ok' && <><Link className="button primary" to="/">Done</Link>
        {seat?.can_give_up && <button className="button" disabled={busy} onClick={onGiveUp}>{busy ? 'Giving up…' : 'Give up seat'}</button>}</>}
      {outcome.kind === 'bad' && <><Link className="button primary" to="/scan">Scan another desk</Link>
        <Link className="button" to="/book">Find a free seat</Link></>}
      {outcome.kind === 'done' && <><Link className="button primary" to="/">Done</Link><Link className="button" to="/scan">Scan another desk</Link></>}
    </div>
  </section>;
}

function MySeat() {
  const [mine, setMine] = useState(undefined);
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);   // { kind, text }
  const load = useCallback(async () => {
    try {
      const [me, list] = await Promise.all([flaskRequest('/api/desk/me'), flaskRequest('/api/desk/bookings/mine')]);
      setMine(me.checkin);
      setBookings(myBookingsToday(list.items, me.user_id, sgToday()));
      setError(null);
    } catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const checkIn = async (b) => {
    setBusy(b.id); setResult(null);
    try {
      const c = await flaskRequest(`/api/desk/seats/${b.seat_id}/check-in`, { method: 'POST', body: await checkInLocation() });
      setResult({ kind: 'success', text: `You're checked in at ${c.seat_label} until ${formatTime(c.ends_at).slice(0, 5)}.${c.warning ? ` ${c.warning}` : ''}` });
      await load();
    } catch (err) { setResult({ kind: 'error', text: err.message }); } finally { setBusy(null); }
  };

  if (error) return <main className="page"><CheckInTitle /><Notice kind="error">{error}</Notice></main>;
  if (mine === undefined) return <main className="page"><CheckInTitle /><Loading label="Finding your seat..." /></main>;
  const now = new Date().toISOString();
  return <main className="page desk-checkin">
    <CheckInTitle />
    {result && <Notice kind={result.kind}>{result.text}</Notice>}
    {mine
      ? <><p className="big">You're checked in at <b>{mine.seat_label}</b></p>
        <p className="muted">Since {formatTime(mine.checked_in_at)}, until {formatTime(mine.ends_at).slice(0, 5)}.</p>
        <Link className="button primary" to={`/checkin/${mine.seat_id}`}>Open seat (give up)</Link></>
      : <>
        {bookings.length ? <section className="card desk-mybookings"><h2>Your bookings today</h2>
          <ul>{bookings.map((b) => {
            const w = checkInWindow(b, now);
            return <li key={b.id}>
              <div><b>{b.seat_label}</b><small>{presetLabel(b.preset)}</small></div>
              {w.open
                ? <button className="button primary" disabled={busy !== null} onClick={() => checkIn(b)}>{busy === b.id ? 'Checking in…' : 'Check in'}</button>
                : <span className="muted">{w.opensAt > now ? `Check in from ${formatTime(w.opensAt).slice(0, 5)}` : 'Ended'}</span>}
            </li>;
          })}</ul></section>
          : <p className="big">No booking for today.</p>}
        <p className="muted">You can also scan the QR code on a desk, or <Link to="/book">pick a seat on the floor</Link> and press
          {' '}<b>Check in now</b>: free-for-all seats and your project team's seats need no booking.</p>
      </>}
    <p><Link to="/book">Book a desk</Link></p>
  </main>;
}
