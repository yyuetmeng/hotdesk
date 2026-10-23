import assert from 'node:assert/strict';
import { PRESETS, canBookAny, footprint, initials, presetLabel, stateLabel, zoneCaption, floorLoading, firstLoad, teamSeatText, nextDayName, sgToday, seatAction, untaggedNote, latestOnly, dayActive, goToLabel } from '../src/desk/deskLogic.js';

assert.equal(initials('Jane Tan'), 'JT');
assert.equal(initials('Prince'), 'P');
assert.equal(initials('  '), '?');
assert.equal(initials('ali bin rahman'), 'AR');
assert.equal(presetLabel('am'), 'AM (08:00–13:00)');
assert.equal(presetLabel('full'), 'Full day (08:00–19:00)');
assert.deepEqual(PRESETS, ['full', 'am', 'pm']);                            // full day first: the default on Book a Desk
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
// Seat panel: give up your own seat, today only. Checking in needs a QR scan, so there is no check-in button.
assert.equal(seatAction({ can_check_in: true }, true), null);
assert.equal(seatAction({ can_give_up: true }, true), 'give_up');
assert.equal(seatAction({ can_give_up: true }, false), null);
assert.equal(seatAction({}, true), null);
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
const e1s = { seat_id: 'e1', seat_label: 'E1', plan_id: 'p1', plan_name: 'Level 1', zone: null };
assert.equal(teamSeatText(e1s), 'Your project team has a free seat: E1 on Level 1.');
assert.equal(teamSeatText(e1s, "Tan's team"), "Tan's team has a free seat: E1 on Level 1.");
// Go to a check-in suggestion: its end time only when the walk-in ends before 19:00 that day (team first §2).
const e1go = { seat_id: 'e1', seat_label: 'E1' };
assert.equal(goToLabel(e1go, '2026-10-16'), 'Go to E1');                                           // a book suggestion: no until
assert.equal(goToLabel({ ...e1go, until: '2026-10-16T13:00:00+08:00' }, '2026-10-16'), 'Go to E1 (until 13:00)');
assert.equal(goToLabel({ ...e1go, until: '2026-10-16T19:00:00+08:00' }, '2026-10-16'), 'Go to E1');   // the normal day end
assert.equal(goToLabel({ ...e1go, until: '2026-10-17T00:00:00+08:00' }, '2026-10-16'), 'Go to E1');   // after 19:00: midnight
assert.equal(goToLabel({ ...e1go, until: '2026-10-16T05:30:00Z' }, '2026-10-16'), 'Go to E1 (until 13:30)');   // read in Singapore time
console.log('desk logic smoke OK');
