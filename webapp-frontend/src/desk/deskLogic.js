// Pure helpers for the booking and check-in pages (spec 2026-10-15-seat-booking-and-checkin).

export const PRESETS = ['full', 'am', 'pm'];   // full day first and the default (owner 2026-10-21)
const PRESET_TEXT = { am: 'AM (08:00–13:00)', pm: 'PM (13:00–19:00)', full: 'Full day (08:00–19:00)' };
const STATE_TEXT = { available: 'Available', booked: 'Booked', occupied: 'Occupied', not_bookable: 'Not bookable' };

export const presetLabel = (preset) => PRESET_TEXT[preset] ?? preset;
export const stateLabel = (state) => STATE_TEXT[state] ?? state;

export function initials(name) {
  const parts = String(name ?? '').split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** "Your project team has a free seat: E1 on Level 1." (`whose` for a colleague's team). */
export const teamSeatText = (s, whose = 'Your project team') => `${whose} has a free seat: ${s.seat_label} on ${s.plan_name}.`;

export const canBookAny = (seat) => Object.values(seat.can_book ?? {}).some(Boolean);

/** Grid footprint of a published element (its own w/h, swapped when rotated a quarter turn). */
export function footprint(el) {
  return el.rotation === 90 || el.rotation === 270 ? { w: el.h, h: el.w } : { w: el.w, h: el.h };
}

/** "N of M free" under a zone's name; empty when the zone has no usable seats (spec 2026-10-15-floor-zones §5). */
export const zoneCaption = (zone) => (zone.total ? `${zone.free} of ${zone.total} free` : '');

/** Book a desk: true until the chosen floor's data has arrived (first load, or after changing floor). */
export const floorLoading = (floor, planId) => Boolean(planId) && floor?.id !== planId;

/** Book a desk: the first load (floor list, then the first floor) shows one loader, not two in a row. */
// The second bookable day is the next working day (owner 2026-10-16): "Tomorrow", or its weekday on a Friday.
const dayNumber = (iso) => Date.UTC(...iso.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0))) / 86400000;
export const nextDayName = (dayIso, todayIso) => (dayNumber(dayIso) - dayNumber(todayIso) === 1 ? 'Tomorrow'
  : new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${dayIso}T00:00:00Z`)));
/** Today's date in Singapore as YYYY-MM-DD. */
export const sgToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(now);

/** A check-in suggestion's button: "Go to E1", or "Go to E1 (until 13:00)" when the walk-in there would end
 * before 19:00 on `todayIso` (someone booked the seat later today; spec 2026-10-19-team-seats-first §2). */
export function goToLabel(s, todayIso = sgToday()) {
  const until = s.until ? new Date(s.until) : null;
  const hhmm = until && new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(until);
  return until && sgToday(until) === todayIso && hhmm < '19:00' ? `Go to ${s.seat_label} (until ${hhmm})` : `Go to ${s.seat_label}`;
}

/** The seat panel's check-in button: 'check_in' (no booking needed on a free-for-all or own-team seat; the
 * server decides via can_check_in), 'give_up' (your own seat), or null. Today only. */
export const seatAction = (seat, isToday) => (!isToday ? null : seat.can_give_up ? 'give_up' : seat.can_check_in ? 'check_in' : null);

/** Desk check-in without a QR code: my active bookings for `todayIso` (not ones I made for others), earliest first. */
export const myBookingsToday = (bookings, userId, todayIso) => bookings
  .filter((b) => b.booked_for?.id === userId && b.date === todayIso && b.state === 'active')
  .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));

/** Check-in opens 30 minutes before the booking starts and closes when it ends (as on the server). */
export function checkInWindow(booking, nowIso) {
  const opens = new Date(new Date(booking.starts_at).getTime() - 30 * 60000), now = new Date(nowIso);
  return { open: opens <= now && now < new Date(booking.ends_at), opensAt: opens.toISOString() };
}

/** Why a seat with no tag cannot be booked or used, and how an admin fixes it ('' for tagged seats). */
export const untaggedNote = (seat) => (seat.open_to_all || seat.department_id ? ''
  : 'This seat is not set up yet, so it cannot be booked or checked in to. An admin can tag it Free for all, or give it a project team, in Manage Floor Plan and publish again.');

/** Request tokens: only the latest started request may update the page (a slow older one is ignored). */
export function latestOnly() {
  let n = 0;
  return { start: () => (n += 1), current: (token) => token === n };
}

/** Whether a top day button (0 today, 1 next working day) is lit: its own day, or both when "Both" is chosen. */
export const dayActive = (index, dayOffset, bothDays) => bothDays || dayOffset === index;

export const firstLoad = ({ floors, floor, error }) => !error && (!floors || (floors.length > 0 && !floor));
