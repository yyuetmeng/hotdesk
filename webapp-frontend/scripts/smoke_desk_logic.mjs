import assert from 'node:assert/strict';
import { canBookAny, footprint, initials, presetLabel, stateLabel } from '../src/desk/deskLogic.js';

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
console.log('desk logic smoke OK');
