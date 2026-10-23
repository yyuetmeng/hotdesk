// Workspace dashboard, the home page for everyone signed in (spec 2026-10-16-workspace-dashboard-design §4):
// where you sit now, your bookings, your project team today, your check-in pattern, history, book again.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { flaskRequest } from '../../api.js';
import { Loading, Notice, PageTitle } from '../../components.jsx';
import { nextDayName } from '../../desk/deskLogic.js';
import { autoBookText, firstName, greeting, outcomeText, slotText, teamCount, trendBar } from './dashboardLogic.js';
import './dashboard.css';

const sgDate = (iso, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', ...opts }).format(new Date(iso));
const sgTime = (iso) => sgDate(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const where = (p) => [p.plan_name, p.zone].filter(Boolean).join(' · ');
const dayText = (isoDate, todayIso) => {
  if (isoDate === todayIso) return 'Today';
  return sgDate(`${isoDate}T04:00:00Z`, { weekday: 'short', day: 'numeric', month: 'short' });
};
const PILL = { checked_in: 'in', booked: 'bk', active: 'bk', released: 'rel', cancelled: 'cx', plan_changed: 'cx' };

function RightNow({ data }) {
  const { current } = data;
  const next = data.upcoming.find((b) => b.date === data.today);
  if (current) return <section className="card dash-now">
    <div><small>You&apos;re checked in at</small><div className="dash-seat">{current.seat_label}</div>
      <small>{where(current)} · since {sgTime(current.checked_in_at)}, until {sgTime(current.ends_at)}</small></div>
    <Link className="button" to={`/checkin/${current.seat_id}`}>Open my seat</Link>
  </section>;
  return <section className="card dash-now">
    <div><small>{next ? 'Your next booking today' : 'Right now'}</small>
      <div className="dash-seat">{next ? next.seat_label : "You're not at a desk"}</div>
      <small>{next ? `${where(next)} · ${slotText(next.preset)}` : 'Book a seat, or scan the QR code on a free desk to check in.'}</small></div>
    <div className="row-actions">
      <Link className="button" to="/scan">Scan to check in</Link>
      <Link className="button primary" to="/book">Book a desk</Link>
    </div>
  </section>;
}

function Upcoming({ items, today, onCancel }) {
  return <section className="card"><h2 className="dash-h">My upcoming bookings <Link to="/book">Book a desk →</Link></h2>
    {!items.length ? <p className="state">No bookings for today or the next working day.</p> : <ul className="dash-list">
      {items.map((b) => <li key={b.id}>
        <div className="dash-grow"><b>{dayText(b.date, today)} · {slotText(b.preset)}</b>
          <small>{b.seat_label} · {where(b)}{b.booked_by_name ? ` · booked by ${b.booked_by_name}` : ''}</small></div>
        <span className="dash-pill bk">Booked</span>
        <button className="button subtle" onClick={() => onCancel(b)}>Cancel</button>
      </li>)}</ul>}
  </section>;
}

function Team({ teams, nextDay }) {
  const [pick, setPick] = useState(0);
  if (!teams.length) return <section className="card"><h2 className="dash-h">My team today</h2>
    <p className="state">You&apos;re not in a project team yet.</p></section>;
  const team = teams[Math.min(pick, teams.length - 1)];
  return <section className="card"><h2 className="dash-h">My team today
    {teams.length > 1
      ? <select value={pick} onChange={(e) => setPick(Number(e.target.value))} aria-label="Project team">
        {teams.map((t, i) => <option key={t.team_id} value={i}>{t.team_name}</option>)}</select>
      : <span>{team.team_name}</span>}</h2>
    <p className="dash-sub">{teamCount(team)}</p>
    {!team.members.length ? <p className="state">Nobody else from {team.team_name} has a seat today or {nextDay.toLowerCase() === 'tomorrow' ? 'tomorrow' : `on ${nextDay}`}.</p> : <ul className="dash-list">
      {team.members.map((m, i) => {
        const today = m.today, tomorrow = m.tomorrow;
        const place = today ?? tomorrow;
        const detail = today
          ? `${today.seat_label} · ${where(today)} · ${today.state === 'checked_in' ? `since ${today.since}` : slotText(today.preset)}`
          : `${nextDay} · ${tomorrow.seat_label} · ${where(tomorrow)} · ${slotText(tomorrow.preset)}`;
        return <li key={i}><span className="dash-av" aria-hidden="true">{m.initials}</span>
          <div className="dash-grow"><b>{m.name}</b><small>{place ? detail : ''}</small></div>
          <span className={`dash-pill ${today ? PILL[today.state] : 'tm'}`}>{today ? (today.state === 'checked_in' ? 'Checked in' : 'Booked') : nextDay}</span>
        </li>;
      })}</ul>}
  </section>;
}

function Trend({ trend }) {
  return <section className="card"><h2 className="dash-h">My check-in and check-out <span>last {trend.days.length} working days</span></h2>
    <div className="dash-kpis">
      <div><b>{trend.days_in_office}</b><small>days in office</small></div>
      <div><b>{trend.usual_arrival ?? '—'}</b><small>usual arrival</small></div>
      <div><b>{trend.usual_leave ?? '—'}</b><small>usual leave</small></div>
    </div>
    <div className="dash-trend" role="img" aria-label={`Check-in and check-out times over the last ${trend.days.length} working days`}>
      <div className="dash-axis"><span>08:00</span><span>11:40</span><span>15:20</span><span>19:00</span></div>
      {trend.days.map((d) => { const bar = trendBar(d.check_in, d.check_out);
        return <div key={d.date} className="dash-col" title={bar ? `${d.weekday} ${d.date}: ${d.check_in}–${d.check_out}` : `${d.weekday} ${d.date}: not in`}>
          {bar && <span className="dash-bar" style={bar} />}</div>; })}
    </div>
    <div className="dash-days"><span />{trend.days.map((d) => <span key={d.date}>{d.weekday.slice(0, 2)}</span>)}</div>
  </section>;
}

function History({ items, today }) {
  return <section className="card"><h2 className="dash-h">Recent history</h2>
    {!items.length ? <p className="state">Nothing yet. Your bookings and check-ins will show here.</p> : <ul className="dash-list">
      {items.map((h, i) => <li key={i}><div className="dash-grow"><b>{h.seat_label}{h.plan_name ? ` · ${h.plan_name}` : ''}</b>
        <small>{dayText(h.date, today)} · {h.from ? `${h.from}–${h.to}` : slotText(h.preset)}{h.kind === 'walk_in' ? ' · walk-in' : ''}</small></div>
        <span className={`dash-pill ${PILL[h.outcome] ?? 'rel'}`}>{outcomeText(h.outcome)}</span></li>)}</ul>}
  </section>;
}

function AutoBookNotes({ notes, today }) {
  if (!notes?.length) return null;
  return <>{notes.map((n) => {
    const day = dayText(n.date, today);
    return <Notice key={n.date} kind={n.ok ? 'success' : 'error'}>
      {autoBookText(n, day === 'Today' ? 'today' : day)}{!n.ok && <> <Link to="/book">Book another desk</Link></>}
    </Notice>;
  })}</>;
}

function BookAgain({ items: all, usual }) {
  const items = usual ? all.filter((f) => f.seat_id !== usual.seat_id) : all;
  return <section className="card"><h2 className="dash-h">Book again <span>your most used seats</span></h2>
    {!items.length && !usual ? <p className="state">Seats you use will appear here for quick booking.</p> : <div className="dash-chips">
      {usual && <div className="dash-chip dash-chip-mine">
        <b>{usual.seat_label} · {usual.plan_name}</b><small>Your seat{usual.zone ? ` · ${usual.zone}` : ''}</small>
        <span className="row-actions">
          {usual.bookable && <Link className="button" to={`/book?plan=${usual.plan_id}&seat=${usual.seat_id}`}>Book</Link>}
        </span>
      </div>}
      {items.map((f) => <Link key={f.seat_id} className="dash-chip" to={`/book?plan=${f.plan_id}&seat=${f.seat_id}`}>
        <b>{f.seat_label} · {f.plan_name}</b><small>{f.zone ? `${f.zone} · ` : ''}used {f.count} {f.count === 1 ? 'time' : 'times'}</small></Link>)}
    </div>}
  </section>;
}

export function DashboardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try { setData(await flaskRequest('/api/desk/dashboard')); setError(null); } catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const cancel = async (b) => {
    if (!window.confirm(`Cancel your booking for ${b.seat_label} (${slotText(b.preset)})?`)) return;
    try { await flaskRequest(`/api/desk/bookings/${b.id}`, { method: 'DELETE' }); await load(); }
    catch (err) { setError(err.message); }
  };

  const heading = data ? `${greeting(data.now)}, ${firstName(data.me.name)}` : 'Dashboard';
  const title = <PageTitle title={heading}><p>{data
    ? `${sgDate(data.now, { weekday: 'long', day: 'numeric', month: 'long' })}${data.me.teams.length ? ` · ${data.me.teams.map((t) => t.name).join(', ')}` : ''}`
    : 'Your seat, your bookings and your team at a glance.'}</p></PageTitle>;
  if (!data) return <main className="page">{title}{error ? <Notice kind="error">{error}</Notice> : <Loading label="Loading your dashboard..." />}</main>;
  const { today } = data;   // Singapore calendar date from the server (also at weekends)
  return <main className="page dash">
    {title}
    {error && <Notice kind="error">{error}</Notice>}
    <AutoBookNotes notes={data.auto_book} today={today} />
    <RightNow data={data} />
    <div className="dash-row">
      <Upcoming items={data.upcoming} today={today} onCancel={cancel} />
      <Team teams={data.team} nextDay={data.next_day ? nextDayName(data.next_day, today) : 'Tomorrow'} />
    </div>
    <div className="dash-row">
      <Trend trend={data.trend} />
      <History items={data.history} today={today} />
    </div>
    <BookAgain items={data.favourites} usual={data.usual_seat} />
  </main>;
}
