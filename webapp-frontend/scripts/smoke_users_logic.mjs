import assert from 'node:assert/strict';
import { seatGroups, seatName } from '../src/pages/users/usualSeat.js';
import { managedLine, teamsOwnFirst, holderChanges, errorText } from '../src/pages/users/teamAccess.js';

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

// Account-manager view helpers.
assert.equal(managedLine([{ name: 'Design' }, { name: 'Engineering' }]), 'You can manage accounts in: Design, Engineering.');
assert.equal(managedLine([]), '');
assert.deepEqual(teamsOwnFirst([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['c']).map((d) => d.id), ['c', 'a', 'b']);
const user = { full_name: 'Eve', start_date: null, end_date: null, usual_seat_id: null, booking_allowance: 0, is_active: true, email: 'e@x.com' };
assert.deepEqual(holderChanges({ ...user, full_name: 'Eve Ng', start_date: '', usual_seat_id: '', booking_allowance: '2', email: 'z@x.com' }, user),
  { full_name: 'Eve Ng', booking_allowance: 2 });
assert.equal(errorText({ status: 403, message: 'admin required' }), 'You need an administrator account to manage users.');
assert.equal(errorText({ status: 403, message: 'Only an administrator can change this.' }), 'Only an administrator can change this.');
assert.equal(errorText({ status: 401, message: 'x' }), 'Session expired — sign in again.');
assert.equal(errorText({ status: 500, message: 'boom' }), 'boom');
console.log('users usual seat smoke OK');
