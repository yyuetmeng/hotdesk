import assert from 'node:assert/strict';
import { addElement, cellsOf, metaChanged, moveElement, resizeElement, rotateElement, removeElement, placementError, validateAll } from '../src/floorplan/logic.js';
import { setCatalog, sizeOf } from '../src/floorplan/palette.js';
import { countUntagged, ctrlClickSelection, departmentColor, isSeat, seatsInBox, setTag, sharedTag, tagOf, toggleSelection } from '../src/floorplan/selection.js';

// Same shape as GET /api/admin/floor-plans/catalog (seeded by sql/0012_floor_elements.sql).
setCatalog([
  { type: 'wall', label: 'Wall', w: 1, h: 1, color: '#64748b', resizable: true, config: {} },
  { type: 'seat', label: 'Seat', w: 1, h: 1, color: '#16a34a', resizable: false, config: { bookable: true } },
  { type: 'table', label: 'Table', w: 2, h: 1, color: '#ca8a04', resizable: true, config: {} },
  { type: 'toilet', label: 'Toilet', w: 2, h: 2, color: '#0d9488', resizable: true, config: {} },
]);

let seq = 0;
const nextId = () => `t${seq++}`;
const COLS = 10, ROWS = 10;

let state = [];
let res = addElement(state, 'seat', 1, 1, COLS, ROWS, nextId);
assert.equal(res.error, null); state = res.elements;
assert.equal(state.length, 1);

res = addElement(state, 'seat', 1, 1, COLS, ROWS, nextId);
assert.match(res.error, /overlaps/);

res = addElement(state, 'toilet', 9, 9, COLS, ROWS, nextId);
assert.match(res.error, /outside/);

state = addElement(state, 'table', 1, 4, COLS, ROWS, nextId).elements;
res = rotateElement(state, state[1].id, COLS, ROWS);
assert.equal(res.error, null);
assert.equal(res.elements[1].rotation, 90);

res = moveElement(state, state[0].id, 0, 0, COLS, ROWS);
assert.equal(res.error, null);
assert.deepEqual([res.elements[0].x, res.elements[0].y], [0, 0]);

state = removeElement(state, state[0].id);
assert.equal(state.length, 1);

const overlap = [{ id: 'a', type: 'seat', x: 2, y: 2, rotation: 0 },
                 { id: 'b', type: 'seat', x: 2, y: 2, rotation: 0 }];
assert.equal(validateAll(overlap, COLS, ROWS).length, 1);
assert.match(validateAll(overlap, COLS, ROWS)[0], /overlaps/);

assert.equal(placementError({ id: 'z', type: 'seat', x: 10, y: 0, rotation: 0 }, [], COLS, ROWS), 'outside the grid');

assert.equal(placementError({ id: 'z', type: 'desk', x: 0, y: 0, rotation: 0 }, [], COLS, ROWS), 'unknown type');
assert.match(validateAll([{ id: 'z', type: 'desk', x: 0, y: 0, rotation: 0 }], COLS, ROWS)[0], /unknown type/);

console.log('floorplan logic smoke OK');

// Per-element size: resize, rotation of a resized element, fixed seats.
{
  let els = addElement([], 'wall', 0, 0, COLS, ROWS, nextId).elements;
  let r = resizeElement(els, els[0].id, 4, 1, COLS, ROWS);
  assert.equal(r.error, null); els = r.elements;
  assert.deepEqual(cellsOf(els[0]).length, 4);
  r = rotateElement(els, els[0].id, COLS, ROWS);              // 4x1 -> 1x4
  assert.equal(r.error, null);
  assert.deepEqual(sizeOf(r.elements[0]), { w: 1, h: 4 });
  assert.match(resizeElement(els, els[0].id, 11, 1, COLS, ROWS).error, /outside/);
  assert.match(resizeElement(els, els[0].id, 0, 1, COLS, ROWS).error, /1 to 20/);
  els = addElement(els, 'seat', 0, 2, COLS, ROWS, nextId).elements;
  assert.match(resizeElement(els, els[1].id, 2, 2, COLS, ROWS).error, /fixed/);
  assert.deepEqual(sizeOf({ type: 'seat', w: 3, h: 3, rotation: 0 }), { w: 1, h: 1 });
  assert.match(resizeElement(els, els[0].id, 4, 3, COLS, ROWS).error, /overlaps/);
}
console.log('floorplan resize smoke OK');

// Toolbar name/grid edits not yet applied count as pending changes (publish must include them).
{
  const plan = { name: 'Level 1', cols: 20, rows: 15 };
  assert.equal(metaChanged({ name: 'Level 1', cols: 20, rows: 15 }, plan), false);
  assert.equal(metaChanged({ name: 'Level 1', cols: '20', rows: '15' }, plan), false); // number inputs give strings
  assert.equal(metaChanged({ name: 'Level 2', cols: 20, rows: 15 }, plan), true);
  assert.equal(metaChanged({ name: 'Level 1', cols: '24', rows: 15 }, plan), true);
  assert.equal(metaChanged({ name: ' Level 1 ', cols: 20, rows: 15 }, plan), false); // server trims names
}
console.log('floorplan meta smoke OK');

// Seat selection and department tags (docs/superpowers/specs/2026-10-15-seat-department-tags-design.md).
{
  const els = [
    { id: 's1', type: 'seat', x: 1, y: 1, rotation: 0 },
    { id: 's2', type: 'seat', x: 3, y: 1, rotation: 0 },
    { id: 't1', type: 'table', x: 1, y: 2, rotation: 0 },           // 2x1
    { id: 's3', type: 'seat', x: 6, y: 6, rotation: 0 },
    { id: 'w1', type: 'wall', x: 0, y: 0, rotation: 0 },
  ];
  assert.equal(isSeat(els[0]), true);
  assert.equal(isSeat(els[2]), false);
  assert.deepEqual(seatsInBox(els, { x1: 1, y1: 1, x2: 3, y2: 2 }).sort(), ['s1', 's2']);  // table ignored
  assert.deepEqual(seatsInBox(els, { x1: 3, y1: 2, x2: 1, y2: 1 }).sort(), ['s1', 's2']);  // reversed corners
  const wide = { id: 'sw', type: 'table', x: 4, y: 4, rotation: 0 };
  assert.deepEqual(seatsInBox([...els, wide], { x1: 4, y1: 4, x2: 4, y2: 4 }), []);       // not a seat
  assert.deepEqual(seatsInBox(els, { x1: 2, y1: 1, x2: 3, y2: 1 }), ['s2']);              // s1 outside

  let ids = toggleSelection([], els[0]);
  assert.deepEqual(ids, ['s1']);
  ids = toggleSelection(ids, els[1]);
  assert.deepEqual(ids, ['s1', 's2']);
  assert.deepEqual(toggleSelection(ids, els[4]), ['s1', 's2']);                           // wall: unchanged
  assert.deepEqual(toggleSelection(ids, els[0]), ['s2']);                                 // removes

  assert.equal(tagOf(els[0]), 'none');
  const tagged = setTag(els, ['s1', 's2'], 'all');
  assert.notEqual(tagged, els);
  assert.equal(els[0].open_to_all, undefined);                                            // input untouched
  assert.equal(sharedTag(tagged, ['s1', 's2']), 'all');
  assert.deepEqual([tagged[0].department_id, tagged[0].open_to_all], [null, true]);
  const dept = setTag(tagged, ['s1'], 'd-eng');
  assert.deepEqual([dept[0].department_id, dept[0].open_to_all], ['d-eng', false]);
  assert.equal(sharedTag(dept, ['s1', 's2']), 'mixed');
  assert.equal(setTag(dept, ['w1'], 'd-eng')[4].department_id, undefined);              // non-seats never tagged
  assert.equal(countUntagged(dept), 1);                                                    // s3 only
  assert.equal(departmentColor('d-eng'), departmentColor('d-eng'));
  assert.match(departmentColor('d-eng'), /^#[0-9a-f]{6}$/);
}
console.log('floorplan selection smoke OK');

// Ctrl/Shift-click: a non-seat never changes the selection; a seat toggles within the seat selection.
{
  const els = [
    { id: 's1', type: 'seat', x: 1, y: 1, rotation: 0 },
    { id: 's2', type: 'seat', x: 3, y: 1, rotation: 0 },
    { id: 'w1', type: 'wall', x: 0, y: 0, rotation: 0 },
    { id: 'w2', type: 'wall', x: 5, y: 0, rotation: 0 },
  ];
  assert.deepEqual(ctrlClickSelection(['w1'], els, els[3]), ['w1']);            // wall selected, ctrl-click wall
  assert.deepEqual(ctrlClickSelection(['s1'], els, els[2]), ['s1']);            // seat selected, ctrl-click wall
  assert.deepEqual(ctrlClickSelection(['s1'], els, els[1]), ['s1', 's2']);      // adds seat
  assert.deepEqual(ctrlClickSelection(['s1', 's2'], els, els[0]), ['s2']);      // removes seat
  assert.deepEqual(ctrlClickSelection(['w1'], els, els[0]), ['s1']);            // wall selection replaced by the seat
}
console.log('floorplan ctrl-click smoke OK');

// Zones (spec 2026-10-15-floor-zones §3-4): own layer, up to 80 cells, never rotated.
{
  const { seatsInZone, zoneName } = await import('../src/floorplan/logic.js');
  const { isZone } = await import('../src/floorplan/selection.js');
  const { maxSizeFor } = await import('../src/floorplan/palette.js');
  setCatalog([
    { type: 'seat', label: 'Seat', w: 1, h: 1, color: '#16a34a', resizable: false, config: {} },
    { type: 'table', label: 'Table', w: 2, h: 1, color: '#ca8a04', resizable: true, config: {} },
    { type: 'zone', label: 'Zone', w: 6, h: 4, color: '#3b82f6', resizable: true, config: {} },
  ]);
  const zone = { id: 'z1', type: 'zone', x: 2, y: 2, w: 3, h: 2, rotation: 0, label: 'Z' };
  assert.equal(isZone(zone), true);
  assert.equal(maxSizeFor('zone'), 80);
  assert.equal(maxSizeFor('table'), 20);
  assert.equal(placementError({ id: 's9', type: 'seat', x: 3, y: 3, rotation: 0 }, [zone], 40, 40), null);
  assert.equal(placementError({ id: 'z2', type: 'zone', x: 4, y: 3, w: 2, h: 2, rotation: 0 }, [zone], 40, 40), 'overlaps another element');
  assert.equal(placementError({ id: 'z2', type: 'zone', x: 5, y: 2, w: 2, h: 2, rotation: 0 }, [zone], 40, 40), null);
  assert.equal(resizeElement([zone], 'z1', 30, 25, 40, 40).error, null);
  const table = { id: 't1', type: 'table', x: 10, y: 10, w: 2, h: 1, rotation: 0 };
  assert.match(resizeElement([table], 't1', 21, 1, 40, 40).error, /1 to 20/);
  assert.equal(rotateElement([zone], 'z1', 40, 40).error, 'zones cannot be rotated');
  const seats = [[4, 3, 'in1'], [2, 2, 'in2'], [5, 3, 'out1'], [4, 4, 'out2']]
    .map(([x, y, id]) => ({ id, type: 'seat', x, y, rotation: 0 }));
  assert.deepEqual(seatsInZone([zone, ...seats], zone), ['in1', 'in2']);
  assert.equal(zoneName({ label: '  ' }), 'Unnamed zone');
  assert.equal(zoneName({ label: ' AI Lab ' }), 'AI Lab');
  assert.deepEqual(validateAll([zone, ...seats], 40, 40), []);
  assert.equal(validateAll([zone, { ...zone, id: 'z2', x: 3 }], 40, 40).length, 1);
}
console.log('floorplan zones smoke OK');

// Manage Floor Plan list: Publish / Unpublish beside Delete, by publishing status.
{
  const { planActions } = await import('../src/floorplan/logic.js');
  assert.deepEqual(planActions('draft'), [{ action: 'publish', label: 'Publish' }]);
  assert.deepEqual(planActions('unpublished'), [{ action: 'publish', label: 'Publish' }]);
  assert.deepEqual(planActions('changed'), [{ action: 'publish', label: 'Publish changes' }, { action: 'unpublish', label: 'Unpublish' }]);
  assert.deepEqual(planActions('published'), [{ action: 'unpublish', label: 'Unpublish' }]);
  assert.deepEqual(planActions('weird'), []);
}
console.log('floorplan list actions smoke OK');

// Preview (Manage Floor Plan list and editor): the draft as staff will see it, in the display drawing.
{
  const { previewFloor } = await import('../src/floorplan/logic.js');
  const catalog = [
    { type: 'seat', label: 'Seat', w: 1, h: 1, color: '#16a34a', resizable: false },
    { type: 'table', label: 'Table', w: 2, h: 1, color: '#ca8a04', resizable: true },
    { type: 'zone', label: 'Zone', w: 6, h: 4, color: '#3b82f6', resizable: true },
  ];
  const plan = { id: 'p1', name: 'Level 1', cols: 10, rows: 8 };
  const elements = [
    { id: 'z', type: 'zone', x: 0, y: 0, w: 4, h: 2, rotation: 0, label: ' AI Lab ' },
    { id: 's1', type: 'seat', x: 1, y: 1, rotation: 0, label: 'A1', department_id: 'd1' },
    { id: 's2', type: 'seat', x: 2, y: 1, rotation: 0, open_to_all: true },
    { id: 's3', type: 'seat', x: 3, y: 1, rotation: 0 },                       // untagged
    { id: 't', type: 'table', x: 5, y: 5, rotation: 90 },                      // catalog size 2x1
  ];
  const f = previewFloor(plan, elements, catalog, { d1: 'SAP' });
  assert.deepEqual([f.id, f.name, f.cols, f.rows], ['p1', 'Level 1', 10, 8]);
  assert.deepEqual(f.elements.find((e) => e.id === 't'), { id: 't', type: 'table', x: 5, y: 5, w: 2, h: 1, rotation: 90, label: null, color: null });
  assert.deepEqual(f.seats.map((s) => [s.id, s.label, s.state, s.department]), [
    ['s1', 'A1', 'available', 'SAP'], ['s2', 'Seat 2,1', 'available', 'Free for all'], ['s3', 'Seat 3,1', 'not_bookable', null]]);
  assert.deepEqual(f.zones, [{ id: 'z', name: 'AI Lab', x: 0, y: 0, w: 4, h: 2, color: null, total: 2, free: 2 }]);
  assert.deepEqual(f.summary, { bookable: 2, available: 2, booked: 0, occupied: 0, occupancy_pct: 0 });
  assert.equal(f.catalog, catalog);
}
console.log('floorplan preview smoke OK');
