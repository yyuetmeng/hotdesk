import assert from 'node:assert/strict';
import { canBookAny, footprint, initials, presetLabel, stateLabel, zoneCaption, floorLoading, firstLoad, nextDayName, sgToday, seatAction } from '../src/desk/deskLogic.js';

assert.equal(initials('Jane Tan'), 'JT');
assert.equal(initials('Prince'), 'P');
assert.equal(initials('  '), '?');
assert.equal(initials('ali bin rahman'), 'AR');
assert.equal(presetLabel('am'), 'AM (08:00–13:00)');
assert.equal(presetLabel('full'), 'Full day (08:00–18:00)');
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
console.log('desk logic smoke OK');
