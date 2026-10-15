// Public floor display for TVs (/display/:slug, no sign-in): chosen floors in style E, live seat
// states, per-floor and overall capacity, today's seat activity. Refreshes every 30 seconds and
// keeps the last data when offline. Spec: docs/superpowers/specs/2026-10-15-floor-dashboard-design.md.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { flaskRequest } from '../api.js';
import CapacityBar from './CapacityBar.jsx';
import FloorDrawing from './FloorDrawing.jsx';
import SeatPopover from './SeatPopover.jsx';
import { nextFloorIndex, overall, sgDateTime, sgTime } from './displayLogic.js';
import './display.css';

const REFRESH_MS = 30000;

export function DisplayPage() {
  const { slug } = useParams();
  const [display, setDisplay] = useState(null);
  const [floors, setFloors] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [offline, setOffline] = useState(false);
  const [fatal, setFatal] = useState(null);
  const [index, setIndex] = useState(0);
  const [seat, setSeat] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const loaded = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const d = await flaskRequest(`/api/public/displays/${encodeURIComponent(slug)}`);
      const published = d.floors.filter((f) => f.published);
      const data = await Promise.all(published.map((f) => flaskRequest(`/api/public/floors/${f.id}`)));
      setDisplay(d); setFloors(data); setUpdatedAt(new Date()); setOffline(false); loaded.current = true;
    } catch (err) {
      if (err.status === 404) setFatal('Display not found');
      else if (loaded.current) setOffline(true);    // keep the last data, retry on the next tick
      else setFatal('Cannot reach the server. Retrying…');
    }
  }, [slug]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!display || display.layout !== 'rotate' || floors.length < 2 || seat) return undefined;
    const timer = setInterval(() => setIndex((i) => nextFloorIndex(i, floors.length)), display.rotate_seconds * 1000);
    return () => clearInterval(timer);
  }, [display, floors.length, seat]);

  const closeSeat = useCallback(() => setSeat(null), []);

  if (fatal && !loaded.current) return <main className="disp disp-message"><p>{fatal}</p></main>;
  if (!display) return <main className="disp disp-message"><p>Loading…</p></main>;

  const shown = display.layout === 'rotate' ? floors.slice(index % Math.max(floors.length, 1), (index % Math.max(floors.length, 1)) + 1) : floors;
  return <main className="disp">
    <header className="disp-head">
      <h1>{display.name}</h1>
      <div className="disp-clock">
        <b>{sgDateTime(now)}</b>
        <small>{offline ? `Offline — last updated ${sgTime(updatedAt)}` : `Updated ${sgTime(updatedAt)}`}</small>
      </div>
    </header>
    {display.show_overall && floors.length > 0 &&
      <CapacityBar title="All floors" summary={overall(floors.map((f) => f.summary))} large />}
    {!floors.length && <p className="disp-message">No published floors for this display.</p>}
    <section className={`disp-floors layout-${display.layout}`}>
      {shown.map((f) => <article key={f.id} className="disp-floor-card">
        <CapacityBar title={f.name} summary={f.summary} />
        <FloorDrawing floor={f} onSeatClick={setSeat} />
      </article>)}
    </section>
    {display.layout === 'rotate' && floors.length > 1 && <nav className="disp-dots" aria-label="Floors">
      {floors.map((f, i) => <button key={f.id} className={i === index % floors.length ? 'active' : ''}
        aria-label={f.name} onClick={() => setIndex(i)} />)}
    </nav>}
    <footer className="disp-legend">
      <span><i className="available" />Available</span><span><i className="booked" />Booked</span>
      <span><i className="occupied" />Occupied</span><span><i className="not_bookable" />Not bookable</span>
      <span>Tap a seat to see today&apos;s activity</span>
    </footer>
    {seat && <SeatPopover seat={seat} onClose={closeSeat} />}
  </main>;
}
