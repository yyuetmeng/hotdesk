// Public floor display for TVs (/display/:slug, no sign-in): chosen floors in style E, live seat
// states, per-floor and overall capacity, today's seat activity. Refreshes every 30 seconds and
// keeps the last data when offline. Spec: docs/superpowers/specs/2026-10-15-floor-dashboard-design.md.
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { flaskRequest } from '../api.js';
import CapacityBar from './CapacityBar.jsx';
import FloorDrawing from './FloorDrawing.jsx';
import SeatPopover from './SeatPopover.jsx';
import { MIN_LOADER_MS, initialDisplayState, nextFloorIndex, overall, reduceRefresh, rotationKey, sgDateTime, sgTime, waitLeft } from './displayLogic.js';
import './display.css';
import PinLoader from '../PinLoader.jsx';

const REFRESH_MS = 30000;

export function DisplayPage() {
  const { slug } = useParams();
  const load = useCallback(() => flaskRequest(`/api/public/displays/${encodeURIComponent(slug)}`), [slug]);
  return <DisplayView loadConfig={load} />;
}

// The display itself. `loadConfig` returns the display config: the saved one for a TV, or the unsaved
// form for the live preview in Manage Floor Display. Seat data is always live.
export function DisplayView({ loadConfig }) {
  const [view, setView] = useState(initialDisplayState);
  const [index, setIndex] = useState(0);
  const [seat, setSeat] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [waited, setWaited] = useState(false);   // the loader stays at least 1 s, so it does not flash
  const { display, floors, updatedAt, offline } = view;

  useEffect(() => {
    const started = Date.now();
    const timer = setTimeout(() => setWaited(true), waitLeft(started, Date.now(), MIN_LOADER_MS));
    return () => clearTimeout(timer);
  }, []);

  const refresh = useCallback(async () => {
    let d;
    try {
      d = await loadConfig();
    } catch (err) {
      setView((state) => reduceRefresh(state, { type: 'error', status: err.status ?? 0 }));
      return;
    }
    // One floor unpublished since the display was read (404) is skipped, not fatal.
    const results = await Promise.allSettled(
      d.floors.filter((f) => f.published).map((f) => flaskRequest(`/api/public/floors/${f.id}`)));
    setView((state) => reduceRefresh(state, { type: 'ok', display: d, floors: results, at: new Date() }));
  }, [loadConfig]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Keyed by layout settings only: the display object is replaced on every poll.
  const rotation = rotationKey(display);
  useEffect(() => {
    if (!display || display.layout !== 'rotate' || floors.length < 2 || seat) return undefined;
    const timer = setInterval(() => setIndex((i) => nextFloorIndex(i, floors.length)), display.rotate_seconds * 1000);
    return () => clearInterval(timer);
  }, [rotation, floors.length, seat]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeSeat = useCallback(() => setSeat(null), []);

  if (view.missing) return <main className="disp disp-message"><p>Display not found</p></main>;
  if (!view.loaded || !waited) return <main className="disp disp-message">
    <PinLoader label={view.unreachable ? 'Cannot reach the server. Retrying…' : 'Loading the floor display…'} /></main>;

  const shown = display.layout === 'rotate' ? floors.slice(index % Math.max(floors.length, 1), (index % Math.max(floors.length, 1)) + 1) : floors;
  return <main className="disp">
    <div className="disp-top">
      <header className="disp-head">
        <h1>{display.name}</h1>
        <div className="disp-clock">
          <b>{sgDateTime(now)}</b>
          <small>{offline ? `Offline — last updated ${sgTime(updatedAt)}` : `Updated ${sgTime(updatedAt)}`}</small>
        </div>
      </header>
      {floors.length > 0 && <section className="disp-summary" aria-label="Capacity">
        {display.show_overall && <CapacityBar title="All floors" summary={overall(floors.map((f) => f.summary))} />}
        {shown.map((f) => <CapacityBar key={f.id} title={f.name} summary={f.summary} />)}
      </section>}
    </div>
    {!floors.length && <p className="disp-message">No published floors for this display.</p>}
    <section className={`disp-floors layout-${display.layout}`}>
      {shown.map((f) => <article key={f.id} className="disp-floor-card">
        {shown.length > 1 && <h2 className="disp-floor-name">{f.name}</h2>}
        <FloorDrawing floor={f} onSeatClick={setSeat} />
      </article>)}
    </section>
    <footer className="disp-foot">
      {display.layout === 'rotate' && floors.length > 1 && <nav className="disp-dots" aria-label="Floors">
        {floors.map((f, i) => <button key={f.id} className={i === index % floors.length ? 'active' : ''}
          aria-label={f.name} onClick={() => setIndex(i)} />)}
      </nav>}
      <div className="disp-legend">
        <span><i className="available" />Available</span><span><i className="booked" />Booked</span>
        <span><i className="occupied" />Occupied</span><span><i className="not_bookable" />Not bookable</span>
        <span>Tap a seat to see today&apos;s activity</span>
      </div>
    </footer>
    {seat && <SeatPopover seat={seat} onClose={closeSeat} />}
  </main>;
}
