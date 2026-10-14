import assert from 'node:assert/strict';
import { addElement, cellsOf, metaChanged, moveElement, resizeElement, rotateElement, removeElement, placementError, validateAll } from '../src/floorplan/logic.js';
import { setCatalog, sizeOf } from '../src/floorplan/palette.js';

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
