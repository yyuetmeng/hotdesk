import assert from 'node:assert/strict';
import { initialDisplayState, nextFloorIndex, overall, reduceRefresh, rotationKey, sgDateTime, sgTime, slugify } from '../src/display/displayLogic.js';

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

// Rotation must not restart on every poll: its key only changes with the layout settings.
assert.equal(rotationKey({ layout: 'rotate', rotate_seconds: 60, name: 'A' }), rotationKey({ layout: 'rotate', rotate_seconds: 60, name: 'B' }));
assert.notEqual(rotationKey({ layout: 'rotate', rotate_seconds: 60 }), rotationKey({ layout: 'rotate', rotate_seconds: 20 }));
assert.equal(rotationKey(null), '');

// Refresh outcomes (spec §3 errors): display 404 always wins; floor 404s are skipped; network errors keep data.
{
  const t1 = new Date('2026-10-16T01:00:00Z');
  const display = { name: 'Lobby' };
  const ok = (id) => ({ status: 'fulfilled', value: { id } });
  const gone = { status: 'rejected', reason: { status: 404 } };
  const down = { status: 'rejected', reason: { status: 0 } };
  let s = reduceRefresh(initialDisplayState, { type: 'ok', display, floors: [ok('f1'), gone, ok('f3')], at: t1 });
  assert.deepEqual(s.floors.map((f) => f.id), ['f1', 'f3']);
  assert.equal(s.offline, false); assert.equal(s.loaded, true); assert.equal(s.updatedAt, t1);
  const before = s;
  s = reduceRefresh(before, { type: 'ok', display, floors: [ok('f1'), down], at: new Date() });
  assert.equal(s.offline, true); assert.equal(s.floors, before.floors); assert.equal(s.updatedAt, t1);   // keep last data
  s = reduceRefresh(before, { type: 'error', status: 0 });
  assert.equal(s.offline, true); assert.equal(s.floors, before.floors);
  s = reduceRefresh(before, { type: 'error', status: 404 });
  assert.equal(s.missing, true);                                                                           // deleted/renamed display
  s = reduceRefresh(initialDisplayState, { type: 'error', status: 0 });
  assert.equal(s.loaded, false); assert.equal(s.unreachable, true);
}
console.log('display refresh smoke OK');
