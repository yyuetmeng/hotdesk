// Pure helpers for the booking and check-in pages (spec 2026-10-15-seat-booking-and-checkin).

export const PRESETS = ['am', 'pm', 'full'];
const PRESET_TEXT = { am: 'AM (08:00–13:00)', pm: 'PM (13:00–18:00)', full: 'Full day (08:00–18:00)' };
const STATE_TEXT = { available: 'Available', booked: 'Booked', occupied: 'Occupied', not_bookable: 'Not bookable' };

export const presetLabel = (preset) => PRESET_TEXT[preset] ?? preset;
export const stateLabel = (state) => STATE_TEXT[state] ?? state;

export function initials(name) {
  const parts = String(name ?? '').split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

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

export const firstLoad = ({ floors, floor, error }) => !error && (!floors || (floors.length > 0 && !floor));
