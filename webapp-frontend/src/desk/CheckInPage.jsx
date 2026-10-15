// Desk check-in, opened by a seat's QR code (/checkin/:seatId) — or /checkin for "my seat".
// Scanning checks in automatically when allowed; giving the seat up always needs a tap.
// Spec: docs/superpowers/specs/2026-10-15-seat-booking-and-checkin-design.md §2.5, §6.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { flaskRequest } from '../api.js';
import { Loading, Notice, PageTitle } from '../components.jsx';
import { formatTime } from '../format.js';
import { stateLabel } from './deskLogic.js';
import './desk.css';

const CheckInTitle = () => <PageTitle title="Desk check-in"><p>Scan the QR code on a desk to check in there, and give the seat up when you leave.</p></PageTitle>;

export function CheckInPage() {
  const { seatId } = useParams();
  return seatId ? <SeatCheckIn seatId={seatId} /> : <MySeat />;
}

function SeatCheckIn({ seatId }) {
  const [seat, setSeat] = useState(null);
  const [result, setResult] = useState(null);   // { kind, text }
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
          const c = await flaskRequest(`/api/desk/seats/${seatId}/check-in`, { method: 'POST' });
          setResult({ kind: 'success', text: `You're checked in at ${c.seat_label} since ${formatTime(c.checked_in_at)}, `
            + `until ${formatTime(c.ends_at).slice(0, 5)}.${c.warning ? ` ${c.warning}` : ''}` });
          await reload();
        }
      } catch (err) { setResult({ kind: 'error', text: err.message }); }
    })();
  }, [seatId, reload]);

  const giveUp = async () => {
    setBusy(true);
    try {
      await flaskRequest(`/api/desk/seats/${seatId}/give-up`, { method: 'POST' });
      setResult({ kind: 'success', text: 'Seat given up. Thanks!' });
      await reload();
    } catch (err) { setResult({ kind: 'error', text: err.message }); }
    finally { setBusy(false); }
  };

  if (!seat && !result) return <main className="page"><CheckInTitle /><Loading label="Checking the seat..." /></main>;
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

function MySeat() {
  const [mine, setMine] = useState(undefined);
  const [error, setError] = useState(null);
  useEffect(() => {
    flaskRequest('/api/desk/me').then((d) => setMine(d.checkin)).catch((err) => setError(err.message));
  }, []);
  if (error) return <main className="page"><CheckInTitle /><Notice kind="error">{error}</Notice></main>;
  if (mine === undefined) return <main className="page"><CheckInTitle /><Loading label="Finding your seat..." /></main>;
  return <main className="page desk-checkin">
    <CheckInTitle />
    {mine
      ? <><p className="big">You're checked in at <b>{mine.seat_label}</b></p>
        <p className="muted">Since {formatTime(mine.checked_in_at)}, until {formatTime(mine.ends_at).slice(0, 5)}.</p>
        <Link className="button primary" to={`/checkin/${mine.seat_id}`}>Open seat (give up)</Link></>
      : <p className="big">Scan the QR code on a desk to check in.</p>}
    <p><Link to="/book">Book a desk</Link></p>
  </main>;
}
