// Booking panel rules (owner 2026-10-16, preview v3). Pure helpers, no React.
// Myself books exactly one seat (the one clicked). Someone else books one or several seats, a different
// colleague in each, never yourself (the colleague list leaves you out), within the daily allowance.
// Day: 'first' (today), 'second' (the next working day) or 'both'.

export { firstName } from '../pages/dashboard/dashboardLogic.js';

export const dayDates = (choice, days) => (choice === 'both' ? [...days] : [days[choice === 'second' ? 1 : 0]]);

/** One POST /api/desk/bookings body per seat and day, day by day. */
export function bookingRequests({ forWho, rows, dayChoice, days, preset, planId }) {
  const used = forWho === 'me' ? rows.slice(0, 1) : rows;
  return dayDates(dayChoice, days).flatMap((date) => used.map((row) => ({
    plan_id: row.seat.plan_id ?? planId, seat_id: row.seat.id, date, preset, ...(forWho === 'me' ? {} : { user_id: row.person.id }),
  })));
}

/** Why Confirm is not possible yet ('' when it is). The server re-checks everything. */
export function bookingProblem({ forWho, rows, allowance }) {
  if (forWho === 'me') return '';
  if (allowance && allowance.limit === 0) return 'You are not allowed to book for colleagues.';
  const missing = rows.find((r) => !r.person);
  if (missing) return `${missing.seat.label} needs a person.`;
  const seen = new Set();
  const twice = rows.find((r) => (seen.has(r.person.id) ? true : (seen.add(r.person.id), false)));
  if (twice) return `${twice.person.name} is picked for more than one seat.`;
  if (allowance && allowance.left !== null && rows.length > allowance.left) return `You can book for ${allowance.left} more colleague${allowance.left === 1 ? '' : 's'} on this day.`;
  return '';
}

/** A seat can join a several-seats booking when it is free for the slot (team seats too) and not picked yet. */
export const canAddSeat = (seat, preset, pickedIds) => Boolean(seat.free?.[preset] && !pickedIds.includes(seat.id));

/** Why a clicked seat cannot be booked as-is: null, { kind: 'team_hint', suggestion } (a team seat is free instead),
 * { kind: 'other_team' } (another team's seat) or { kind: 'not_free' }. Booking for someone else only needs the seat free. */
export function bookBlock({ seat, preset, forWho, teamFirst }) {
  if (forWho !== 'me') return seat.free?.[preset] ? null : { kind: 'not_free' };
  const hint = teamFirst?.[preset];
  if (seat.open_to_all && hint && hint.seat_id !== seat.id) return { kind: 'team_hint', suggestion: hint };
  if (!seat.open_to_all && seat.free?.[preset] && !seat.can_book?.[preset]) return { kind: 'other_team' };
  return seat.can_book?.[preset] ? null : { kind: 'not_free' };
}

/** The colleague's team seat to offer on a row whose seat is free for all (result of GET /api/desk/suggest), or null.
 * `takenIds`: seats other rows already hold, so two teammates are never offered the same seat (the next one instead). */
export function rowTeamHint(row, result, takenIds = []) {
  if (result?.tier !== 'team' || !row.seat.open_to_all) return null;
  return result.seats.find((s) => s.seat_id !== row.seat.id && !takenIds.includes(s.seat_id)) ?? null;
}

/** "Find a seat for {name}" (One seat only, and not beside a row hint): the colleague's first suggested seat when
 * it is a team seat other than the row's, or when the row's seat is not free for the slot; else null.
 * A row seat without `free` came from a suggestion, so it counts as free. */
export function findSeatFor({ row, result, preset, multi = false, hint = null }) {
  const s = !multi && !hint && result && result.tier !== 'none' ? result.seats[0] : null;
  if (!s || s.seat_id === row.seat.id) return null;
  return result.tier === 'team' || !(row.seat.free?.[preset] ?? true) ? s : null;
}

/** Acting on a failed row's suggestion while Both days is on: the day offset to switch to (that row's day, so
 * Confirm retries only the failed day), or null to leave the days as they are. */
export const retryDayOffset = (both, days, date) => (both ? Math.max(0, days.indexOf(date)) : null);

/** A suggestion as a row seat. */
export const toRowSeat = (s) => ({ id: s.seat_id, label: s.seat_label, plan_id: s.plan_id, open_to_all: false });

export const confirmLabel = (count) => (count === 1 ? 'Confirm booking' : `Confirm ${count} bookings`);

export function resultSummary(results) {
  const ok = results.filter((r) => r.ok).length;
  if (ok === results.length) return results.length === 1 ? 'Booked.' : `All ${ok} bookings made.`;
  return ok ? `${ok} of ${results.length} bookings made. These could not be booked:` : 'Nothing was booked:';
}
