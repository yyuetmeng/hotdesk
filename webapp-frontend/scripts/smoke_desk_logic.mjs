import assert from 'node:assert/strict';
import { canBookAny, footprint, initials, presetLabel, stateLabel, zoneCaption, floorLoading, firstLoad } from '../src/desk/deskLogic.js';

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
console.log('desk logic smoke OK');
