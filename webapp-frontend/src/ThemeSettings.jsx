// Cog at the bottom of the sidebar; opens a small panel to pick follow-system / light / dark.
import { useEffect, useRef, useState } from 'react';
import { flaskRequest } from './api.js';
import { THEME_CHOICES, applyTheme, readTheme, saveTheme } from './theme.js';

const ICONS = {
  system: <><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></>,
  light: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  dark: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>,
  cog: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></>,
};

const Icon = ({ name }) => <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;

export default function ThemeSettings() {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(readTheme);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (value) => { setChoice(value); saveTheme(value); applyTheme(value); };

  // Auto-booking (spec 2026-10-19-team-seats-first §6.4): the usual seat first, then a team seat; no usual seat needed.
  const [me, setMe] = useState(null);
  useEffect(() => {
    if (!open) return;
    flaskRequest('/api/desk/me').then(setMe).catch(() => setMe(null));
  }, [open]);
  const seat = me?.usual_seat;
  const toggleAuto = async (on) => {
    setMe((old) => ({ ...old, auto_book: on }));
    try { await flaskRequest('/api/desk/me', { method: 'PATCH', body: { auto_book: on } }); }
    catch { setMe((old) => ({ ...old, auto_book: !on })); }
  };

  return <div className="theme-settings" ref={ref}>
    {open && <div className="theme-panel" role="dialog" aria-label="Settings">
      <p className="theme-panel-label">Theme</p>
      <div className="theme-toggle" role="radiogroup" aria-label="Theme">
        {THEME_CHOICES.map((c) => <button key={c.value} type="button" role="radio" aria-checked={choice === c.value}
          aria-label={c.label} title={c.label} className={choice === c.value ? 'active' : ''} onClick={() => pick(c.value)}>
          <Icon name={c.value} />
        </button>)}
      </div>
      <p className="theme-panel-current">{THEME_CHOICES.find((c) => c.value === choice).label}</p>
      {me && <div className="theme-auto">
        <p className="theme-panel-label theme-auto-head">Booking
          <span className="theme-info">
            <button type="button" className="theme-info-btn" aria-label="How auto-booking works" aria-describedby="auto-book-tip">i</button>
            <span role="tooltip" id="auto-book-tip" className="theme-info-tip">
              <b>How auto-booking works</b>
              <span>When you sign in or open the Dashboard, a full-day seat (08:00–19:00) is booked for you for today and the next working day (Mon–Fri).</span>
              <span>A day is skipped when you already have a booking for it. Today is also skipped once you have checked in, or after 18:30.</span>
              <b>How the seat is chosen</b>
              <ol>
                <li>Only seats free for the whole booking count: no one has booked them or checked in.</li>
                <li>Your project team's seats come first, on every published floor.</li>
                <li>Among those: your usual seat, then seats in the same zone of its floor, then the rest of that floor, then other floors.</li>
                <li>Ties go by floor order, then seat label (A–Z). With no usual seat, it is floor order, then label.</li>
                <li>Only when no team seat is free does it pick a free-for-all seat, ranked the same way.</li>
              </ol>
              <span>If no seat is free, the Dashboard tells you so you can book another way.</span>
              <span>Normal booking rules apply: check in by 10:00 (or within 30 minutes if booked after 08:00), or the seat is released as a no-show. You can cancel it like any other booking.</span>
            </span>
          </span>
        </p>
        <label className="theme-switch">
          <input type="checkbox" role="switch" checked={Boolean(me.auto_book)} onChange={(e) => toggleAuto(e.target.checked)} />
          <span className="theme-switch-track" aria-hidden="true" />
          <span>Auto-book a seat for me (my usual seat first, then my team's seats).
            <small>{seat?.bookable ? `${seat.seat_label} · ${seat.plan_name}, next working day` : 'Next working day'}</small></span>
        </label>
      </div>}
    </div>}
    <button type="button" className="sidebar-signout theme-cog" aria-expanded={open} aria-haspopup="dialog"
      title="Settings" onClick={() => setOpen((v) => !v)}><Icon name="cog" /><span className="nav-text">Settings</span></button>
  </div>;
}
