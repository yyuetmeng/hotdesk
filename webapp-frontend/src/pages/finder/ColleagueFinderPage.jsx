// Colleague Finder (Workspace): search a colleague by name and see where they are now, or are booked
// to be, with their seat blinking on the floor drawing (same drawing as Book a desk and the TVs).
import { useEffect, useState } from 'react';
import { flaskRequest } from '../../api.js';
import { Notice, PageTitle } from '../../components.jsx';
import FloorDrawing from '../../display/FloorDrawing.jsx';
import '../../display/display.css';
import { locationText, statusText, timeText } from './finderLogic.js';
import './finder.css';

const PILL = { checked_in: 'in', booked: 'bk', tomorrow: 'tm', away: 'away' };

function Floor({ person }) {
  const [floor, setFloor] = useState(null);
  const [error, setError] = useState(null);
  const { seat } = person;
  useEffect(() => {
    if (!seat?.plan_id) return undefined;
    let alive = true;
    setFloor(null); setError(null);
    flaskRequest(`/api/desk/floors/${seat.plan_id}?date=${person.date}`)
      .then((f) => { if (alive) setFloor(f); })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [seat?.plan_id, person.date]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!seat) return null;
  if (!seat.plan_id) return <p className="state">That seat is no longer on a published floor plan.</p>;
  if (error) return <Notice kind="error">{error}</Notice>;
  if (!floor) return <p className="state">Loading {seat.plan_name}…</p>;
  return <div className="finder-floor">
    <h3>{floor.name}{person.status === 'tomorrow' ? ' · tomorrow' : ''}</h3>
    <div className="finder-drawing"><FloorDrawing floor={floor} highlightId={seat.seat_id} /></div>
  </div>;
}

export function ColleagueFinderPage() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);   // null: not searched yet
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setResults(null); setPicked(null); return undefined; }
    let alive = true;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const { items } = await flaskRequest(`/api/desk/people?q=${encodeURIComponent(text)}`);
        if (!alive) return;
        setResults(items); setError(null);
        setPicked((old) => items.find((p) => p.id === old?.id) ?? (items.length === 1 ? items[0] : null));
      } catch (err) { if (alive) setError(err.message); }
      finally { if (alive) setBusy(false); }
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [q]);

  return <main className="page">
    <PageTitle title="Colleague Finder"><p>Find a colleague and see where they are sitting, or where they have booked.</p></PageTitle>
    <section className="card finder-search">
      <input type="search" autoFocus placeholder="Search by name or username" value={q} onChange={(e) => setQ(e.target.value)}
        aria-label="Search colleagues" />
      {busy && <span className="muted">Searching…</span>}
    </section>
    {error && <Notice kind="error">{error}</Notice>}
    {results === null ? <p className="state">Type at least two letters of a name or username.</p>
      : !results.length ? <p className="state">No colleague matches “{q.trim()}”.</p>
        : <div className="finder-layout">
          <ul className="finder-results" aria-label="Colleagues">
            {results.map((p) => <li key={p.id}>
              <button type="button" className={picked?.id === p.id ? 'active' : ''} onClick={() => setPicked(p)}>
                <span className="finder-av" aria-hidden="true">{p.initials}</span>
                <span className="finder-who"><b>{p.name}</b><small>{p.teams.join(', ') || 'No project team'}</small></span>
                <span className={`finder-pill ${PILL[p.status]}`}>{statusText(p)}</span>
              </button>
            </li>)}
          </ul>
          <section className="card finder-detail">
            {!picked ? <p className="state">Choose a colleague to see where they are.</p> : <>
              <div className="finder-head">
                <span className="finder-av big" aria-hidden="true">{picked.initials}</span>
                <div><h2>{picked.name}</h2><p className="muted">{picked.teams.join(', ') || 'No project team'}</p></div>
                <span className={`finder-pill ${PILL[picked.status]}`}>{statusText(picked)}</span>
              </div>
              <dl className="finder-facts">
                <div><dt>Where</dt><dd>{locationText(picked)}</dd></div>
                {timeText(picked) && <div><dt>When</dt><dd>{timeText(picked)}</dd></div>}
              </dl>
              <Floor key={`${picked.id}-${picked.seat?.seat_id ?? ''}`} person={picked} />
            </>}
          </section>
        </div>}
  </main>;
}
