// Colleague Finder (Workspace): pick a colleague from the search dropdown (everyone is listed on click,
// typing and the project team filter narrow it) and see where they are now, or are booked to be,
// with their seat blinking on the floor drawing (same drawing as Book a desk and the TVs).
import { useEffect, useRef, useState } from 'react';
import { flaskRequest } from '../../api.js';
import { Notice, PageTitle } from '../../components.jsx';
import FloorDrawing from '../../display/FloorDrawing.jsx';
import '../../display/display.css';
import { locationText, moveActive, statusText, timeText } from './finderLogic.js';
import './finder.css';

const PILL = { checked_in: 'in', booked: 'bk', tomorrow: 'tm', away: 'away' };

function Floor({ person }) {
  const [floor, setFloor] = useState(null);
  const [error, setError] = useState(null);
  const usual = !person.seat && person.usual_seat ? person.usual_seat : null;   // away: show where they usually sit
  const seat = person.seat ?? usual;
  useEffect(() => {
    if (!seat?.plan_id) return undefined;
    let alive = true;
    setFloor(null); setError(null);
    flaskRequest(`/api/desk/floors/${seat.plan_id}${person.date ? `?date=${person.date}` : ''}`)
      .then((f) => { if (alive) setFloor(f); })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [seat?.plan_id, person.date]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!seat) return null;
  if (!seat.plan_id) return <p className="state">That seat is no longer on a published floor plan.</p>;
  if (error) return <Notice kind="error">{error}</Notice>;
  if (!floor) return <p className="state">Loading {seat.plan_name}…</p>;
  return <div className="finder-floor">
    <h3>{floor.name}{usual ? ' · their usual seat' : person.status === 'tomorrow' ? ' · tomorrow' : ''}</h3>
    <div className="finder-drawing"><FloorDrawing floor={floor} highlightId={seat.seat_id} /></div>
  </div>;
}

function Person({ p }) {
  return <>
    <span className="finder-av" aria-hidden="true">{p.initials}</span>
    <span className="finder-who"><b>{p.name}</b><small>{p.teams.join(', ') || 'No project team'}</small></span>
    <span className={`finder-pill ${PILL[p.status]}`}>{statusText(p)}</span>
  </>;
}

export function ColleagueFinderPage() {
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [teams, setTeams] = useState([]);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [picked, setPicked] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => { flaskRequest('/api/desk/teams').then((d) => setTeams(d.items)).catch(() => {}); }, []);

  // Everyone on an empty search; typing and the team filter narrow the list (debounced).
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const params = new URLSearchParams({ q: q.trim(), ...(team ? { team } : {}) });
        const { items } = await flaskRequest(`/api/desk/people?${params}`);
        if (!alive) return;
        setResults(items); setError(null); setActive(-1);
        setPicked((old) => (old ? items.find((p) => p.id === old.id) ?? old : old));   // refresh the shown status
      } catch (err) { if (alive) setError(err.message); }
      finally { if (alive) setBusy(false); }
    }, q ? 250 : 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [q, team]);

  useEffect(() => {
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const choose = (p) => { setPicked(p); setOpen(false); setQ(''); };
  const onKey = (e) => {
    const list = results ?? [];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); setOpen(true);
      setActive((i) => moveActive(i, e.key === 'ArrowDown' ? 1 : -1, list.length));
    } else if (e.key === 'Enter' && open && list[active]) { e.preventDefault(); choose(list[active]); }
    else if (e.key === 'Escape') setOpen(false);
  };

  const list = results ?? [];
  return <main className="page">
    <PageTitle title="Colleague Finder"><p>Find a colleague and see where they are sitting, or where they have booked.</p></PageTitle>
    <section className="card finder-search">
      <div className="finder-combo" ref={boxRef}>
        <input type="search" placeholder="Search by name or username, or click to browse" value={q} autoComplete="off"
          role="combobox" aria-expanded={open} aria-controls="finder-list" aria-autocomplete="list" aria-label="Search colleagues"
          aria-activedescendant={active >= 0 && list[active] ? `finder-opt-${list[active].id}` : undefined}
          onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onKeyDown={onKey}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
        {open && <ul className="finder-dropdown" id="finder-list" role="listbox" aria-label="Colleagues">
          {!list.length
            ? <li className="finder-empty">{busy ? 'Searching…' : `No colleague matches${q.trim() ? ` “${q.trim()}”` : ''}.`}</li>
            : list.map((p, i) => <li key={p.id} id={`finder-opt-${p.id}`} role="option" aria-selected={i === active}
              className={i === active ? 'active' : ''} onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); choose(p); }}><Person p={p} /></li>)}
          {list.length === 50 && <li className="finder-empty">Showing the first 50. Type a name to narrow it down.</li>}
        </ul>}
      </div>
      <label className="finder-team">Project team <select value={team} onChange={(e) => { setTeam(e.target.value); setOpen(true); }}>
        <option value="">All project teams</option>
        {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select></label>
    </section>
    {error && <Notice kind="error">{error}</Notice>}
    {!picked ? <p className="state">Click the search box to see everyone, or type a name.</p>
      : <section className="card finder-detail">
        <div className="finder-head">
          <span className="finder-av big" aria-hidden="true">{picked.initials}</span>
          <div><h2>{picked.name}</h2><p className="muted">{picked.teams.join(', ') || 'No project team'}</p></div>
          <span className={`finder-pill ${PILL[picked.status]}`}>{statusText(picked)}</span>
        </div>
        <dl className="finder-facts">
          <div><dt>Where</dt><dd>{locationText(picked)}</dd></div>
          {timeText(picked) && <div><dt>When</dt><dd>{timeText(picked)}</dd></div>}
          {picked.usual_seat && <div><dt>Usually sits at</dt>
            <dd>{[picked.usual_seat.seat_label, picked.usual_seat.plan_name, picked.usual_seat.zone].filter(Boolean).join(' · ')}</dd></div>}
        </dl>
        <Floor key={`${picked.id}-${picked.seat?.seat_id ?? ''}`} person={picked} />
      </section>}
  </main>;
}
