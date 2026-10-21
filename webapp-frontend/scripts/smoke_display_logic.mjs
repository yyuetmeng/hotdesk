import assert from 'node:assert/strict';
import { initialDisplayState, nextFloorIndex, overall, overviewConfig, overviewOptions, plateSide, reduceRefresh, resolvePick, rotationKey, seatCells, seatTip, sgDateTime, sgTime, slugify, tableLabel } from '../src/display/displayLogic.js';

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

// Door swing: the leaf stands open from the hinge, the arc ends on the doorway (opposite the way it opens).
{
  const { doorSwing, DOOR_SWINGS } = await import('../src/display/displayLogic.js');
  const at = (swing) => doorSwing({ config: { swing } }, 0, 0, 30, 30);
  assert.deepEqual(at('up-left'), { swing: 'up-left', hinge: [1, 29], open: [1, 1], shut: [29, 29], radius: 28, sweep: 1 });   // the old drawing
  assert.deepEqual(at('down-right'), { swing: 'down-right', hinge: [29, 1], open: [29, 29], shut: [1, 1], radius: 28, sweep: 1 });
  assert.deepEqual(at('left-top'), { swing: 'left-top', hinge: [29, 1], open: [1, 1], shut: [29, 29], radius: 28, sweep: 0 });
  assert.deepEqual(at('right-bottom'), { swing: 'right-bottom', hinge: [1, 29], open: [29, 29], shut: [1, 1], radius: 28, sweep: 0 });
  assert.equal(doorSwing({}, 0, 0, 30, 30).swing, 'up-left');                                 // no setting
  assert.equal(at('sideways').swing, 'up-left');                                                 // unknown setting
  for (const [swing] of DOOR_SWINGS) {                                                           // all eight stay inside the box
    const d = at(swing);
    for (const [px, py] of [d.hinge, d.open, d.shut]) assert.ok(px >= 1 && px <= 29 && py >= 1 && py <= 29, swing);
    assert.equal(Math.hypot(d.open[0] - d.hinge[0], d.open[1] - d.hinge[1]), 28);
    assert.equal(Math.hypot(d.shut[0] - d.hinge[0], d.shut[1] - d.hinge[1]), 28);
  }
  assert.deepEqual(doorSwing({ config: { swing: 'up-right' } }, 0, 0, 60, 30).hinge, [59, 29]);   // hinge at the box's own corner
}
console.log('display door swing smoke OK');

// Floor overview "All floors": the same display view over every published floor, shown together.
assert.deepEqual(overviewConfig([{ id: 'p1', name: 'L1' }, { id: 'p2', name: 'L2' }]), {
  name: 'All floors', slug: '', show_overall: true, layout: 'grid', rotate_seconds: 20, plan_ids: ['p1', 'p2'],
  floors: [{ id: 'p1', name: 'L1', published: true }, { id: 'p2', name: 'L2', published: true }] });
console.log('floor overview smoke OK');

// Floor overview picker: All floors, then displays, then single floors (all published only; the server filters).
{
  const opts = overviewOptions([{ name: 'Lobby', slug: 'lobby' }], [{ id: 'p1', name: 'L1' }, { id: 'p2', name: 'L2' }]);
  assert.deepEqual(opts, { all: { value: '*all', label: 'All floors' }, displays: [{ value: 'd:lobby', label: 'Lobby' }],
    floors: [{ value: 'f:p1', label: 'L1' }, { value: 'f:p2', label: 'L2' }] });
  assert.equal(resolvePick('f:p2', opts), 'f:p2');
  assert.equal(resolvePick('lobby', opts), 'd:lobby');               // older saved choice / gone: first display
  assert.equal(resolvePick('f:gone', overviewOptions([], [{ id: 'p1', name: 'L1' }])), '*all');
  assert.equal(overviewConfig([{ id: 'p1', name: 'L1' }], 'L1').name, 'L1');
}
console.log('overview picker smoke OK');

// Seat hover tip (owner 2026-10-16): seat number and team, then who / when, in two short lines.
assert.deepEqual(seatTip({ label: 'L1-A07', department: 'Bolt On', state: 'occupied',
  occupant: { name: 'Jane Tan', since: '2026-10-16T09:02:00+08:00', until: '2026-10-16T18:00:00+08:00' } }),
  ['L1-A07 · Bolt On', 'Jane Tan · in since 09:02, until 18:00']);
assert.deepEqual(seatTip({ label: 'F1', department: 'Free for all', state: 'booked',
  booking: { booked_for: { name: 'Carl Lim' }, starts_at: '2026-10-16T13:00:00+08:00', ends_at: '2026-10-16T18:00:00+08:00' } }),
  ['F1 · Free for all', 'Booked for Carl Lim · 13:00–18:00']);
assert.deepEqual(seatTip({ label: 'F2', department: 'Free for all', state: 'available' }), ['F2 · Free for all', 'Available']);
assert.deepEqual(seatTip({ label: '', department: null, state: 'not_bookable' }), ['Seat', 'Not set up for booking']);
console.log('seat tip smoke OK');

assert.equal(tableLabel('T1', 84), 'T1');                                    // a 3-cell table
assert.equal(tableLabel('  Hot desk row A  ', 84), 'Hot desk row A');
assert.equal(tableLabel('Engineering hot desks', 84), 'Engineering h…');     // 14 characters fit
assert.equal(tableLabel('', 84), '');
assert.equal(tableLabel(null, 84), '');
assert.equal(tableLabel('T1', 18), '');                                      // no room on a tiny table
console.log('table label smoke OK');

// Assignment plate side, from the grid: right, else left, else below (crowded row), else above (bottom row).
const cell = (x, y, w = 1, h = 1) => ({ x, y, w, h });
const grid = seatCells([cell(0, 0), cell(1, 0), cell(2, 0), cell(4, 0), cell(0, 9), cell(1, 9), cell(2, 9), cell(5, 5, 2, 1)]);
assert.deepEqual([...seatCells([cell(5, 5, 2, 1)])], ['5,5', '6,5']);
assert.equal(plateSide(cell(2, 0), grid, 10, 10), 'right');       // (3,0) is empty
assert.equal(plateSide(cell(4, 0), grid, 10, 10), 'right');
assert.equal(plateSide(cell(0, 0), grid, 10, 10), 'below');       // right is a seat, left is off the floor
assert.equal(plateSide(cell(1, 0), grid, 10, 10), 'below');       // seats on both sides
assert.equal(plateSide(cell(1, 9), grid, 10, 10), 'above');       // crowded bottom row: no room below
assert.equal(plateSide(cell(9, 3), grid, 10, 10), 'left');        // right edge of the floor
assert.equal(plateSide(cell(5, 5, 2, 1), grid, 10, 10), 'right'); // a two-cell seat looks past its own footprint
console.log('plate side smoke OK');
