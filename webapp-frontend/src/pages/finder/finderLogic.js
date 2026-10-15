// Pure helpers for Colleague Finder: how to describe where someone is today (or tomorrow).
import { presetLabel } from '../../desk/deskLogic.js';

const STATUS = { checked_in: 'Checked in', booked: 'Booked today', tomorrow: 'Booked tomorrow', away: 'Not in the office today' };
export const statusText = (p) => STATUS[p.status] ?? p.status;

export function locationText(p) {
  if (!p.seat) return 'No seat booked for today or tomorrow';
  return [p.seat.seat_label, p.seat.plan_name, p.seat.zone].filter(Boolean).join(' · ');
}

export function timeText(p) {
  if (p.status === 'checked_in') return `Since ${p.since}, until ${p.until}`;
  if (p.status === 'booked') return presetLabel(p.preset);
  if (p.status === 'tomorrow') return `Tomorrow · ${presetLabel(p.preset)}`;
  return '';
}

/** Arrow-key highlight in the staff dropdown: moves by `delta` and wraps; -1 when the list is empty. */
export const moveActive = (index, delta, length) => (length ? (((index < 0 && delta < 0 ? 0 : index) + delta) % length + length) % length : -1);
