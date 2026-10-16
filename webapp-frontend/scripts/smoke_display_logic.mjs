import assert from 'node:assert/strict';
import { initialDisplayState, nextFloorIndex, overall, overviewConfig, reduceRefresh, rotationKey, sgDateTime, sgTime, slugify } from '../src/display/displayLogic.js';

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

// Live preview in Manage Floor Display: the unsaved form becomes the same config the TV reads.
{
  const { previewConfig } = await import('../src/display/displayLogic.js');
  const plans = [{ id: 'a', name: 'Level 1', published_version: 3 }, { id: 'b', name: 'Level 2', published_version: null }];
  const form = { name: '  Lobby TV ', slug: 'lobby', plan_ids: ['b', 'a', 'gone'], show_overall: false, layout: 'rotate', rotate_seconds: '20' };
  assert.deepEqual(previewConfig(form, plans), {
    name: 'Lobby TV', slug: 'lobby', show_overall: false, layout: 'rotate', rotate_seconds: 20,
    plan_ids: ['b', 'a', 'gone'],
    floors: [{ id: 'b', name: 'Level 2', published: false }, { id: 'a', name: 'Level 1', published: true }],
  });
  assert.equal(previewConfig({ ...form, name: '' }, plans).name, 'Display preview');
  assert.equal(previewConfig({ ...form, rotate_seconds: 'x' }, plans).rotate_seconds, 20);   // bad input: default
  assert.equal(previewConfig({ ...form, rotate_seconds: '500' }, plans).rotate_seconds, 120); // clamped to 10-120
}
console.log('display preview smoke OK');

// Walls and windows are drawn as a thin bar along their long side, centred in their cells.
{
  const { thinBar } = await import('../src/display/displayLogic.js');
  assert.deepEqual(thinBar(0, 0, 112, 28, 6), { x: 0, y: 11, width: 112, height: 6 });   // horizontal run
  assert.deepEqual(thinBar(56, 0, 28, 84, 6), { x: 67, y: 0, width: 6, height: 84 });   // vertical run
  assert.deepEqual(thinBar(0, 0, 28, 28, 6), { x: 0, y: 11, width: 28, height: 6 });    // single cell: horizontal
}
console.log('display walls smoke OK');

// New floor style: monitor marks along a table, plants that fit their cell, toilet gender.
{
  const { monitorMarks, plantRadius, toiletGender } = await import('../src/display/displayLogic.js');
  assert.deepEqual(monitorMarks(0, 0, 28, 84, 28), { vertical: true, at: [14, 42, 70] });   // one per cell along a tall table
  assert.deepEqual(monitorMarks(0, 0, 112, 28, 28), { vertical: false, at: [14, 42, 70, 98] });
  assert.equal(plantRadius(28, 28), 10.08);                                                  // 36% of the smaller side
  assert.ok(plantRadius(28, 25.2) * 2 < 25.2);                                               // always inside its element
  assert.equal(toiletGender({ config: { gender: 'female' } }), 'female');
  assert.equal(toiletGender({ config: { gender: 'male' } }), 'male');
  assert.equal(toiletGender({ config: {} }), 'unisex');
  assert.equal(toiletGender({ config: { gender: 'nonsense' } }), 'unisex');
  assert.equal(toiletGender({}), 'unisex');
}
console.log('display floor style smoke OK');

// Floor overview "All floors": the same display view over every published floor, shown together.
assert.deepEqual(overviewConfig([{ id: 'p1', name: 'L1' }, { id: 'p2', name: 'L2' }]), {
  name: 'All floors', slug: '', show_overall: true, layout: 'grid', rotate_seconds: 20, plan_ids: ['p1', 'p2'],
  floors: [{ id: 'p1', name: 'L1', published: true }, { id: 'p2', name: 'L2', published: true }] });
console.log('floor overview smoke OK');

