// Pure helpers for the Workspace dashboard (spec 2026-10-16-workspace-dashboard-design §4).
import { presetLabel } from '../../desk/deskLogic.js';

const TZ = 'Asia/Singapore';
const DAY_START = 8 * 60, DAY_SPAN = 11 * 60;   // trend chart shows 08:00–19:00 (the bookable day)

/** "Good morning" / "Good afternoon" / "Good evening" by the hour in Singapore. */
export function greeting(nowIso) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date(nowIso)));
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] || 'there';

export const slotText = (preset) => (preset ? presetLabel(preset) : '');

const OUTCOME = { checked_in: 'Checked in', released: 'Released (no check-in)', cancelled: 'Cancelled',
  plan_changed: 'Cancelled (floor plan changed)', active: 'Booked' };
export const outcomeText = (outcome) => OUTCOME[outcome] ?? outcome;

const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const pct = (n) => `${Math.round(n * 100) / 100}%`;

/** Position of a day's bar (check-in to check-out) on the 08:00–19:00 axis, clamped; null if no check-in. */
export function trendBar(checkIn, checkOut) {
  if (!checkIn) return null;
  const clamp = (m) => Math.min(Math.max(m - DAY_START, 0), DAY_SPAN);
  const from = clamp(minutes(checkIn));
  const to = Math.max(clamp(minutes(checkOut ?? checkIn)), from);
  return { top: pct((100 * from) / DAY_SPAN), height: pct((100 * (to - from)) / DAY_SPAN) };
}

/** "N of <size> in": members checked in today out of the team's active members. */
export const teamCount = (team) =>
  `${team.members.filter((m) => m.today?.state === 'checked_in').length} of ${team.size} in`;
