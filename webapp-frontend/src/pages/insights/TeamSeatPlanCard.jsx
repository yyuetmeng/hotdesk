// Insights "Team seat planning" card (owner 2026-10-22): per project team, seats required (set here with −/+ or by
// typing, and saved), seats allocated on published floors and utilisation (most members checked in at once in the
// period). The Try column is the admins' plan: saved (owner 2026-10-23) so it is there next time, but no seat moves;
// the total stays fixed (see seatPlanLogic.js).
import { useEffect, useRef, useState } from 'react';
import { flaskRequest } from '../../api.js';
import { Notice } from '../../components.jsx';
import { departmentColor } from '../../floorplan/selection.js';
import { SCALE_DEFAULT, changes, donorFor, minus, movedText, planBody, plus, receiverFor, savedTries, scaleMax, startTries, tryTo, verdict } from './seatPlanLogic.js';

const RANGES = [7, 14, 30];
const REQUIRED_MAX = 500;      // as the API allows
const SAVE_AFTER_MS = 600;     // a run of −/+ presses or typing saves once, after the last one
const pct = (n, max) => `${Math.min(100, (n / max) * 100)}%`;
const sameTeams = (tries, teams) => tries && teams.length === Object.keys(tries).length && teams.every((t) => t.id in tries);

export default function TeamSeatPlanCard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tries, setTries] = useState(null);
  const [moved, setMoved] = useState(null);      // the last automatic move, e.g. "1 seat taken from SAP"
  const [typing, setTyping] = useState(null);    // { id, text } while a Try number is being typed
  const timers = useRef({});                     // team id -> pending save
  const saved = useRef({});                      // team id -> required as last saved, to put back if a save fails
  const planTimer = useRef(null);                // pending save of the Try numbers
  useEffect(() => {
    let alive = true;
    flaskRequest(`/api/admin/insights/team-seats?days=${days}`)
      .then((d) => {
        if (!alive) return;
        d.teams.forEach((t) => { saved.current[t.id] = t.required; });
        setData((prev) => ({ ...d, teams: d.teams.map((t) => (timers.current[t.id]   // keep a number not saved yet
          ? { ...t, required: prev?.teams.find((p) => p.id === t.id)?.required ?? t.required } : t)) }));
        setError(null);
        setTries((prev) => (sameTeams(prev, d.teams) ? prev : savedTries(d.teams)));   // keep the plan across periods
      })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [days]);

  const showRequired = (id, value) => setData((d) => ({ ...d, teams: d.teams.map((t) => (t.id === id ? { ...t, required: value } : t)) }));
  function setRequired(team, value) {
    showRequired(team.id, value);
    clearTimeout(timers.current[team.id]);
    timers.current[team.id] = setTimeout(async () => {
      delete timers.current[team.id];
      if (value === saved.current[team.id]) return;
      try {
        await flaskRequest(`/api/admin/departments/${team.id}`, { method: 'PATCH', body: { seats_required: value } });
        saved.current[team.id] = value;
        setError(null);
      } catch (err) {   // not saved: put the saved number back
        showRequired(team.id, saved.current[team.id]);
        setError(err.message);
      }
    }, SAVE_AFTER_MS);
  }
  function typeRequired(team, text) {
    if (text.trim() === '') { setRequired(team, null); return; }      // emptied: not set
    const n = Number.parseInt(text, 10);
    if (Number.isFinite(n)) setRequired(team, Math.min(REQUIRED_MAX, Math.max(0, n)));
  }
  // Try numbers show at once and save a moment after the last change, all teams in one go.
  function commitTries(next) {
    setTries(next);
    clearTimeout(planTimer.current);
    planTimer.current = setTimeout(async () => {
      planTimer.current = null;
      try {
        await flaskRequest('/api/admin/insights/team-seats/plan', { method: 'PUT', body: { plan: planBody(teams, next) } });
        setError(null);
      } catch (err) { setError(`Plan not saved: ${err.message}`); }
    }, SAVE_AFTER_MS);
  }
  function step(team, more) {
    const done = more ? plus(teams, tries, team.id) : minus(teams, tries, team.id);
    if (!done) return;
    commitTries(done.tries);
    setMoved(more ? `${team.name} +1: 1 seat taken from ${done.from.name}` : `${team.name} −1: 1 seat given to ${done.to.name}`);
  }
  // A typed Try number applies on Enter or leaving the box, so typing "16" doesn't first move seats for "1".
  function applyTyped(team) {
    const text = typing?.id === team.id ? typing.text.trim() : '';
    setTyping(null);
    const n = Number.parseInt(text, 10);
    if (!Number.isFinite(n) || n < 0 || n === tries[team.id]) return;
    const done = tryTo(teams, tries, team.id, n);
    commitTries(done.tries);
    const why = done.reached ? '' : (n > tries[team.id] ? ' (no team has more spare)' : ' (no other team is short)');
    setMoved(done.moved.length ? `${team.name} set to ${done.tries[team.id]}: ${movedText(done.moved)}${why}`
      : `${team.name} stays at ${tries[team.id]}${why}`);
  }
  function reset() { commitTries(startTries(teams)); setMoved(null); }

  const teams = data ? data.teams : [];
  const ready = data && sameTeams(tries, teams);
  const max = ready ? scaleMax(teams, tries) : SCALE_DEFAULT;
  const total = teams.reduce((n, t) => n + t.allocated, 0);
  const changed = ready ? changes(teams, tries) : [];
  const planned = ready ? teams.reduce((n, t) => n + tries[t.id], 0) : total;   // differs once seats change on the floors
  return <section className="card seatplan">
    <div className="occ-head">
      <div><h2>Team seat planning</h2><p className="occ-sub">Seats each project team needs, has and uses · utilisation is the most members checked in at once, last {days} days</p></div>
      <div className="occ-ranges" role="radiogroup" aria-label="Period">
        {RANGES.map((r) => <button key={r} type="button" role="radio" aria-checked={r === days}
          className={r === days ? 'active' : ''} onClick={() => setDays(r)}>{r}D</button>)}
      </div>
    </div>
    {error && <Notice kind="error">{error}</Notice>}
    {!ready ? <p className="state">Loading teams…</p> : !teams.length ? <p className="state">No project teams yet.</p> : <>
      <div className="seatplan-scroll"><table className="seatplan-table">
        {/* Fixed widths: numbers and verdicts changing under a click don't move the buttons. */}
        <colgroup><col className="sp-col-team" /><col className="sp-col-step" /><col /><col className="sp-col-step" /><col className="sp-col-verdict" /></colgroup>
        <thead><tr>
          <th>Project team</th><th className="seatplan-center">Required <small>saved</small></th><th>Allocated · utilisation</th>
          <th className="seatplan-center">Try <small>saved · plan only</small></th><th>In your plan</th>
        </tr></thead>
        <tbody>{teams.map((t) => {
          const tried = tries[t.id], v = verdict(t, tried), donor = donorFor(teams, tries, t.id), taker = receiverFor(teams, tries, t.id);
          return <tr key={t.id}>
            <td><span className="seatplan-team"><i style={{ background: departmentColor(t.id, t.color) }} />{t.name}</span></td>
            <td><div className="seatplan-step">
              <button type="button" disabled={!t.required} onClick={() => setRequired(t, t.required - 1)}
                aria-label={`One seat fewer required for ${t.name}`}>−</button>
              <input className="seatplan-num" type="number" inputMode="numeric" min="0" max={REQUIRED_MAX} placeholder="—"
                value={t.required ?? ''} onChange={(e) => typeRequired(t, e.target.value)} aria-label={`Seats required for ${t.name}`}
                title="Seats this team needs. Empty = not set." />
              <button type="button" disabled={(t.required ?? 0) >= REQUIRED_MAX} onClick={() => setRequired(t, (t.required ?? 0) + 1)}
                aria-label={`One seat more required for ${t.name}`}>+</button>
            </div></td>
            <td><div className="seatplan-bars" title={`Allocated ${t.allocated} · utilisation ${t.utilisation}${t.required != null ? ` · required ${t.required}` : ''}`}>
              <div className="seatplan-track">
                <span className="seatplan-alloc" style={{ width: pct(t.allocated, max) }} />
                <span className="seatplan-used" style={{ width: pct(t.utilisation, max) }} />
                {tried !== t.allocated && <span className="seatplan-tried" style={{ left: pct(tried, max) }} title={`Try ${tried}`} />}
                {t.required != null && <span className="seatplan-req" style={{ left: pct(t.required, max) }} />}
              </div>
              <small><b>{t.allocated}</b> allocated · <b>{t.utilisation}</b> utilisation</small>
            </div></td>
            <td><div className="seatplan-step">
              <button type="button" disabled={!taker} onClick={() => step(t, false)} aria-label={`One seat fewer for ${t.name}`}
                title={taker ? `Gives 1 to ${taker.name}` : 'No other team is short'}>−</button>
              <input className={`seatplan-num${tried !== t.allocated ? ' changed' : ''}`} type="number" inputMode="numeric" min="0"
                value={typing?.id === t.id ? typing.text : tried} aria-label={`Seats to try for ${t.name}`}
                title="Type a number, then Enter: seats move the same way as − and +"
                onFocus={(e) => { setTyping({ id: t.id, text: String(tried) }); e.target.select(); }}
                onChange={(e) => setTyping({ id: t.id, text: e.target.value })} onBlur={() => applyTyped(t)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setTyping(null); e.target.blur(); } }} />
              <button type="button" disabled={!donor} onClick={() => step(t, true)} aria-label={`One seat more for ${t.name}`}
                title={donor ? `Takes 1 from ${donor.name}` : 'No team has spare seats'}>+</button>
            </div></td>
            <td><span className={`seatplan-verdict ${v.kind}`}>{v.text}</span></td>
          </tr>;
        })}</tbody>
      </table></div>
      <ul className="seatplan-legend" aria-label="Bar key">
        <li><i className="key-alloc" />Allocated: seats tagged to the team on published floors</li>
        <li><i className="key-used" />Utilisation: most members checked in at once</li>
        <li><i className="key-req" />Required</li>
        <li><i className="key-tried" />Try (shown when it differs from allocated)</li>
      </ul>
      <div className="seatplan-foot">
        <p>{planned === total ? <><b>{total}</b> seats in total, unchanged</>
          : <><b>{planned}</b> seats in the plan, but the floors now have <b>{total}</b>: seats changed since it was saved. Reset to start again</>}
          {' · '}{changed.length ? changed.join(' · ') : 'no changes tried yet'}
          {moved && <small>{moved}</small>}</p>
        <button type="button" className="button" disabled={!changed.length} onClick={reset}>Reset</button>
      </div>
      <p className="seatplan-note">Required and Try are saved, and every admin sees the same plan. Try is a plan only: no seat moves. Make the real changes in Seat Assignments or the floor editor.</p>
      <details className="seatplan-help">
        <summary>How to use</summary>
        <ol>
          <li><b>Pick a period</b> (7D, 14D or 30D). Utilisation is the most members of the team checked in at the same time in it.</li>
          <li><b>Set Required</b> for each team with − and +, or type the number. It saves by itself. Empty the box to unset it (shown as —).</li>
          <li><b>Try a new split</b> with − and + in Try, or type a number and press Enter (Esc cancels). The total never
            changes, so every seat one team gains comes from another team, one seat at a time:
            <ul>
              <li><b>Spare</b> = a team's Try number − its utilisation. <b>Short</b> = the larger of its Required and its
                utilisation − its Try number.</li>
              <li><b>+</b> takes 1 seat from the team with the <b>most spare</b> right now. A team is never taken below its
                utilisation; it can be taken below its Required (it then shows red). With no spare left anywhere, + is greyed out.</li>
              <li><b>−</b> gives 1 seat to the team <b>furthest short</b> right now. With no team short, − is greyed out: a seat
                can't be left with no team.</li>
              <li>After every seat the teams are compared again, so when several teams have spare they give up seats in turn
                and even out. A tie goes to the team first A-Z.</li>
              <li><b>Typing a number</b> does the same one seat at a time until the team reaches it, or stops where there is
                no spare (or no team short) and says so under the table.</li>
              <li><b>Example:</b> Team A has 24 seats and uses 14 (10 spare); Team B has 12 and uses 5 (7 spare). Team C goes
                +6: the first 3 seats come from A (now 7 spare, the same as B), then A, B and A again as they even out.
                A gives 5 and B gives 1.</li>
              <li>Hover − or + to see which team the next seat goes to or comes from.</li>
            </ul></li>
          <li><b>Read the result</b> in In your plan: red is below utilisation or required, amber has spare seats, green covers what the team needs.</li>
          <li><b>Come back any time:</b> Required and Try are saved, and every admin sees the same plan. Reset puts every team back to the seats it has now.</li>
          <li><b>Make it real</b> in Seat Assignments or the floor plan editor. This card never moves a seat.</li>
        </ol>
      </details>
    </>}
  </section>;
}
