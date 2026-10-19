import assert from 'node:assert/strict';
import { checkInOutcome, seatFromCode } from '../src/desk/scanLogic.js';

// Scan QR code (owner 2026-10-16): a desk label holds <site>/checkin/<seat id>; anything else is not a seat code.
const id = '3f2a8c1e-1d2b-4c3d-9e8f-0a1b2c3d4e5f';
assert.equal(seatFromCode(`https://hotdesk.example.com/checkin/${id}`), id);
assert.equal(seatFromCode(`http://localhost:5173/checkin/${id}?x=1`), id);          // printed on another site: still ours
assert.equal(seatFromCode(`  https://a.b/checkin/${id.toUpperCase()}  `), id);
assert.equal(seatFromCode('https://evil.example.com/login'), null);
assert.equal(seatFromCode('hello'), null);
assert.equal(seatFromCode(`https://a.b/checkin/not-a-uuid`), null);
// The result screen after a scan (owner 2026-10-16): a green tick, a red cross, or "given up".
const seat = { label: 'L1-A07', can_check_in: false, can_give_up: true, reason: null, my_checkin: null };
const checkin = { checked_in_at: '2026-10-16T09:02:00+08:00', ends_at: '2026-10-16T18:00:00+08:00', method: 'booking' };
assert.deepEqual(checkInOutcome({ seat, result: { kind: 'checked_in', checkin } }), { kind: 'ok', title: "You're checked in", checkin, note: null });
assert.equal(checkInOutcome({ seat, result: { kind: 'checked_in', checkin, warning: 'Booked from 13:00: your check-in ends then.' } }).note,
  'Booked from 13:00: your check-in ends then.');
assert.deepEqual(checkInOutcome({ seat: { ...seat, my_checkin: checkin }, result: null }),
  { kind: 'ok', title: "You're checked in here", checkin, note: null });
assert.equal(checkInOutcome({ seat, result: { kind: 'gave_up' } }).kind, 'done');
assert.deepEqual(checkInOutcome({ seat: null, result: { kind: 'error', text: 'seat not found' } }),
  { kind: 'bad', title: 'Could not check in', reason: 'seat not found', suggestion: null });
assert.deepEqual(checkInOutcome({ seat: { ...seat, can_give_up: false, reason: 'This seat is for another project team.' }, result: null }),
  { kind: 'bad', title: 'Could not check in', reason: 'This seat is for another project team.', suggestion: null });
assert.equal(checkInOutcome({ seat: { ...seat, can_give_up: false }, result: null }), null);
const e1s = { seat_id: 'e1', seat_label: 'E1', plan_id: 'p1', plan_name: 'Level 1', zone: null };
assert.equal(checkInOutcome({ seat: null, result: { kind: 'error', text: 'x', suggestion: e1s } }).suggestion, e1s);
assert.equal(checkInOutcome({ seat: null, result: { kind: 'error', text: 'x' } }).suggestion, null);
assert.equal(checkInOutcome({ seat: { can_check_in: false, can_give_up: false, reason: 'r', suggestion: e1s } }).suggestion, e1s);
console.log('scan logic smoke OK');
