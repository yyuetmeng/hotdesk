import assert from 'node:assert/strict';
import { canBookAny, footprint, initials, presetLabel, stateLabel, zoneCaption, floorLoading, firstLoad, nextDayName, sgToday, seatAction, myBookingsToday, checkInWindow, untaggedNote, latestOnly, dayActive } from '../src/desk/deskLogic.js';

assert.equal(initials('Jane Tan'), 'JT');
assert.equal(initials('Prince'), 'P');
assert.equal(initials('  '), '?');
assert.equal(initials('ali bin rahman'), 'AR');
assert.equal(presetLabel('am'), 'AM (08:00–13:00)');
assert.equal(presetLabel('full'), 'Full day (08:00–19:00)');
assert.equal(stateLabel('not_bookable'), 'Not bookable');
assert.equal(canBookAny({ can_book: { am: false, pm: true, full: false } }), true);
assert.equal(canBookAny({ can_book: { am: false, pm: false, full: false } }), false);
assert.equal(canBookAny({}), false);
assert.deepEqual(footprint({ w: 3, h: 1, rotation: 90 }), { w: 1, h: 3 });
assert.deepEqual(footprint({ w: 3, h: 1, rotation: 180 }), { w: 3, h: 1 });
assert.equal(zoneCaption({ free: 16, total: 16 }), '16 of 16 free');
assert.equal(zoneCaption({ free: 0, total: 0 }), '');
// Book a desk: the loader shows until the chosen floor has arrived (first load or a floor change).
assert.equal(floorLoading(null, 'p1'), true);
assert.equal(floorLoading({ id: 'p1' }, 'p1'), false);
assert.equal(floorLoading({ id: 'p1' }, 'p2'), true);
assert.equal(floorLoading(null, ''), false);       // no floor chosen yet
// One loader for the whole first load: until the floor list AND the first floor have arrived.
assert.equal(firstLoad({ floors: null, floor: null, error: null }), true);
assert.equal(firstLoad({ floors: [{ id: 'p1' }], floor: null, error: null }), true);
assert.equal(firstLoad({ floors: [{ id: 'p1' }], floor: { id: 'p1' }, error: null }), false);
assert.equal(firstLoad({ floors: [], floor: null, error: null }), false);          // nothing published
assert.equal(firstLoad({ floors: [{ id: 'p1' }], floor: null, error: 'boom' }), false); // show the error
// The second bookable day is the next working day: on a Friday it is Monday (owner 2026-10-16).
assert.equal(nextDayName('2026-10-16', '2026-10-15'), 'Tomorrow');
assert.equal(nextDayName('2026-10-19', '2026-10-16'), 'Monday');
assert.equal(nextDayName('2026-10-19', '2026-10-17'), 'Monday');      // Saturday
assert.equal(sgToday(new Date('2026-10-16T17:00:00Z')), '2026-10-17'); // 01:00 Saturday in Singapore
// Seat panel: check in without a booking (free-for-all or your team's seat), today only; give up your own seat.
assert.equal(seatAction({ can_check_in: true }, true), 'check_in');
assert.equal(seatAction({ can_check_in: true }, false), null);          // the next working day: book instead
assert.equal(seatAction({ can_give_up: true }, true), 'give_up');
assert.equal(seatAction({}, true), null);
// Desk check-in without a QR code: my active bookings today, and whether each can be checked in now.
const bk = (id, forId, date, state, starts, ends) => ({ id, booked_for: { id: forId }, date, state, starts_at: starts, ends_at: ends });
const mineToday = myBookingsToday([
  bk('b2', 'me', '2026-10-16', 'active', '2026-10-16T13:00:00+08:00', '2026-10-16T18:00:00+08:00'),
  bk('b1', 'me', '2026-10-16', 'active', '2026-10-16T08:00:00+08:00', '2026-10-16T13:00:00+08:00'),
  bk('b3', 'other', '2026-10-16', 'active', '2026-10-16T08:00:00+08:00', '2026-10-16T13:00:00+08:00'),   // I booked it for someone
  bk('b4', 'me', '2026-10-19', 'active', '2026-10-19T08:00:00+08:00', '2026-10-19T13:00:00+08:00'),     // Monday
  bk('b5', 'me', '2026-10-16', 'released', '2026-10-16T08:00:00+08:00', '2026-10-16T13:00:00+08:00'),
], 'me', '2026-10-16');
assert.deepEqual(mineToday.map((b) => b.id), ['b1', 'b2']);
assert.deepEqual(checkInWindow(mineToday[1], '2026-10-16T12:20:00+08:00'), { open: false, opensAt: '2026-10-16T04:30:00.000Z' });   // opens 12:30 SG
assert.deepEqual(checkInWindow(mineToday[1], '2026-10-16T12:30:00+08:00'), { open: true, opensAt: '2026-10-16T04:30:00.000Z' });
assert.equal(checkInWindow(mineToday[0], '2026-10-16T13:00:00+08:00').open, false);              // over
// A seat with no tag cannot be booked or used; say how to fix it.
assert.match(untaggedNote({ open_to_all: false, department_id: null }), /Free for all/);
assert.equal(untaggedNote({ open_to_all: true, department_id: null }), '');
assert.equal(untaggedNote({ open_to_all: false, department_id: 'd1' }), '');
// Book a desk: only the latest floor request may update the page (a slow older one must not overwrite it).
{
  const latest = latestOnly();
  const first = latest.start(), second = latest.start();
  assert.equal(latest.current(first), false);
  assert.equal(latest.current(second), true);
}
// Top day buttons and the panel's Day stay in step: "Both" lights up both day buttons.
assert.equal(dayActive(0, 0, false), true);
assert.equal(dayActive(1, 0, false), false);
assert.equal(dayActive(1, 0, true), true);
console.log('desk logic smoke OK');
