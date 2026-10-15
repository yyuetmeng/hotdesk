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
