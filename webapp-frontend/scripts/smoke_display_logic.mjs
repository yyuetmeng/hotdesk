import assert from 'node:assert/strict';
import { nextFloorIndex, overall, sgDateTime, sgTime, slugify } from '../src/display/displayLogic.js';

assert.deepEqual(
  overall([{ bookable: 3, available: 1, booked: 1, occupied: 1 }, { bookable: 5, available: 2, booked: 0, occupied: 3 }]),
  { bookable: 8, available: 3, booked: 1, occupied: 4, occupancy_pct: 50 });
assert.equal(overall([]).occupancy_pct, 0);
assert.equal(overall([{ bookable: 0, available: 0, booked: 0, occupied: 0 }]).occupancy_pct, 0);
assert.equal(nextFloorIndex(0, 3), 1);
assert.equal(nextFloorIndex(2, 3), 0);
assert.equal(nextFloorIndex(0, 0), 0);
assert.equal(slugify('Office A — Lobby!'), 'office-a-lobby');
assert.equal(slugify('  '), 'display');
assert.equal(slugify('x'.repeat(60)).length, 40);
assert.match(slugify('Level 3 / East Wing'), /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/);
assert.equal(sgTime('2026-10-16T01:02:03Z'), '09:02:03');          // Singapore time on any machine
assert.equal(sgDateTime('2026-10-16T17:30:00Z'), '17/10/2026 01:30:00');
assert.equal(sgTime('nonsense'), '—');
console.log('display logic smoke OK');
