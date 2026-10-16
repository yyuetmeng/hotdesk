import assert from 'node:assert/strict';
import { bookingProblem, bookingRequests, canAddSeat, confirmLabel, dayDates, resultSummary } from '../src/desk/bookingLogic.js';

// Booking panel (owner 2026-10-16, preview v3): Myself = one seat; Someone else = one or several seats,
// one colleague per seat; Day = first / second (next working day) / both; then Confirm.
const days = ['2026-10-16', '2026-10-19'];
const s1 = { id: 's1', label: 'A1' }, s2 = { id: 's2', label: 'A2' };
const tan = { id: 'u1', name: 'Tan Wei Ming' }, priya = { id: 'u2', name: 'Priya Nair' };

assert.deepEqual(dayDates('first', days), ['2026-10-16']);
assert.deepEqual(dayDates('second', days), ['2026-10-19']);
assert.deepEqual(dayDates('both', days), ['2026-10-16', '2026-10-19']);

assert.deepEqual(bookingRequests({ forWho: 'me', rows: [{ seat: s1 }], dayChoice: 'first', days, preset: 'am', planId: 'p' }),
  [{ plan_id: 'p', seat_id: 's1', date: '2026-10-16', preset: 'am' }]);
assert.deepEqual(bookingRequests({ forWho: 'me', rows: [{ seat: s1 }, { seat: s2 }], dayChoice: 'both', days, preset: 'full', planId: 'p' }).map((r) => [r.seat_id, r.date]),
  [['s1', '2026-10-16'], ['s1', '2026-10-19']]);                                  // myself: only the clicked seat
assert.deepEqual(bookingRequests({ forWho: 'other', rows: [{ seat: s1, person: tan }, { seat: s2, person: priya }], dayChoice: 'both', days, preset: 'pm', planId: 'p' })
  .map((r) => [r.seat_id, r.user_id, r.date]),
  [['s1', 'u1', '2026-10-16'], ['s2', 'u2', '2026-10-16'], ['s1', 'u1', '2026-10-19'], ['s2', 'u2', '2026-10-19']]);

assert.equal(bookingProblem({ forWho: 'me', rows: [{ seat: s1 }] }), '');
assert.equal(bookingProblem({ forWho: 'other', rows: [{ seat: s1, person: tan }, { seat: s2 }], allowance: { limit: 3, left: 3 } }), 'A2 needs a person.');
assert.equal(bookingProblem({ forWho: 'other', rows: [{ seat: s1, person: tan }, { seat: s2, person: tan }], allowance: { limit: 3, left: 3 } }),
  'Tan Wei Ming is picked for more than one seat.');
assert.equal(bookingProblem({ forWho: 'other', rows: [{ seat: s1, person: tan }, { seat: s2, person: priya }], allowance: { limit: 3, left: 1 } }),
  'You can book for 1 more colleague on this day.');
assert.equal(bookingProblem({ forWho: 'other', rows: [{ seat: s1, person: tan }], allowance: { limit: 0, left: 0 } }), 'You are not allowed to book for colleagues.');
assert.equal(bookingProblem({ forWho: 'other', rows: [{ seat: s1, person: tan }, { seat: s2, person: priya }], allowance: { limit: 3, left: 2 } }), '');
assert.equal(bookingProblem({ forWho: 'other', rows: [{ seat: s1, person: tan }], allowance: null }), '');   // allowance not loaded yet: server checks
// Admins have no limit (allowance limit/left null): never blocked by the allowance.
assert.equal(bookingProblem({ forWho: 'other', rows: [{ seat: s1, person: tan }, { seat: s2, person: priya }], allowance: { limit: null, used: 4, left: null } }), '');

// Several seats: only free-for-all seats bookable for the slot, never the same seat twice.
const free = { id: 's3', open_to_all: true, can_book: { am: true } };
assert.equal(canAddSeat(free, 'am', ['s1']), true);
assert.equal(canAddSeat(free, 'pm', ['s1']), false);
assert.equal(canAddSeat({ ...free, open_to_all: false }, 'am', []), false);
assert.equal(canAddSeat(free, 'am', ['s3']), false);

assert.equal(confirmLabel(1), 'Confirm booking');
assert.equal(confirmLabel(4), 'Confirm 4 bookings');

assert.equal(resultSummary([{ ok: true }]), 'Booked.');
assert.equal(resultSummary([{ ok: true }, { ok: true }]), 'All 2 bookings made.');
assert.equal(resultSummary([{ ok: true }, { ok: false }, { ok: true }]), '2 of 3 bookings made. These could not be booked:');
assert.equal(resultSummary([{ ok: false }]), 'Nothing was booked:');
console.log('booking logic smoke OK');
