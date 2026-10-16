import assert from 'node:assert/strict';
import { seatGroups, seatName } from '../src/pages/users/usualSeat.js';

// Usual seat picker in Manage Users: published floors' seats, grouped by floor (A-Z), labels A-Z.
const floors = [
  { id: 'p2', name: 'Level 2', seats: [{ id: 'c', label: 'C1', department: null }] },
  { id: 'p1', name: 'Level 1', seats: [{ id: 'b', label: 'B2', department: 'Free for all' }, { id: 'a', label: 'A1', department: 'SAP' }] },
];
assert.deepEqual(seatGroups(floors), [
  { plan: 'Level 1', seats: [{ id: 'a', text: 'A1 · SAP' }, { id: 'b', text: 'B2 · Free for all' }] },
  { plan: 'Level 2', seats: [{ id: 'c', text: 'C1 · No project team' }] },
]);
assert.equal(seatName(floors, 'a'), 'A1 · Level 1');
assert.equal(seatName(floors, 'zzz'), null);      // not on a published floor any more
assert.equal(seatName(floors, null), null);
console.log('users usual seat smoke OK');
