// Booking panel rules (owner 2026-10-16, preview v3). Pure helpers, no React.
// Myself books exactly one seat (the one clicked). Someone else books one or several seats, a different
// colleague in each, never yourself (the colleague list leaves you out), within the daily allowance.
// Day: 'first' (today), 'second' (the next working day) or 'both'.

export const dayDates = (choice, days) => (choice === 'both' ? [...days] : [days[choice === 'second' ? 1 : 0]]);

/** One POST /api/desk/bookings body per seat and day, day by day. */
export function bookingRequests({ forWho, rows, dayChoice, days, preset, planId }) {
  const used = forWho === 'me' ? rows.slice(0, 1) : rows;
  return dayDates(dayChoice, days).flatMap((date) => used.map((row) => ({
    plan_id: planId, seat_id: row.seat.id, date, preset, ...(forWho === 'me' ? {} : { user_id: row.person.id }),
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
  if (allowance && rows.length > allowance.left) return `You can book for ${allowance.left} more colleague${allowance.left === 1 ? '' : 's'} on this day.`;
  return '';
}

/** A seat can join a several-seats booking when it is free for all, bookable for the slot and not picked yet. */
export const canAddSeat = (seat, preset, pickedIds) => Boolean(seat.open_to_all && seat.can_book?.[preset] && !pickedIds.includes(seat.id));

export const confirmLabel = (count) => (count === 1 ? 'Confirm booking' : `Confirm ${count} bookings`);

export function resultSummary(results) {
  const ok = results.filter((r) => r.ok).length;
  if (ok === results.length) return results.length === 1 ? 'Booked.' : `All ${ok} bookings made.`;
  return ok ? `${ok} of ${results.length} bookings made. These could not be booked:` : 'Nothing was booked:';
}
