// Pure helpers for Colleague Finder: how to describe where someone is today (or the next working day).
import { nextDayName, presetLabel, sgToday } from '../../desk/deskLogic.js';

const STATUS = { checked_in: 'Checked in', booked: 'Booked today', tomorrow: 'Booked tomorrow', away: 'Not in the office today' };
export const statusText = (p, today = sgToday()) => {
  if (p.status !== 'tomorrow' || !p.date) return STATUS[p.status] ?? p.status;
  const name = nextDayName(p.date, today);
  return `Booked ${name === 'Tomorrow' ? 'tomorrow' : name}`;
};

export function locationText(p) {
  if (!p.seat) return 'No seat booked for today or the next working day';
  return [p.seat.seat_label, p.seat.plan_name, p.seat.zone].filter(Boolean).join(' · ');
}

export function timeText(p, today = sgToday()) {
  if (p.status === 'checked_in') return `Since ${p.since}, until ${p.until}`;
  if (p.status === 'booked') return presetLabel(p.preset);
  if (p.status === 'tomorrow') return `${p.date ? nextDayName(p.date, today) : 'Tomorrow'} · ${presetLabel(p.preset)}`;
  return '';
}

/** Arrow-key highlight in the staff dropdown: moves by `delta` and wraps; -1 when the list is empty. */
export const moveActive = (index, delta, length) => (length ? (((index < 0 && delta < 0 ? 0 : index) + delta) % length + length) % length : -1);
