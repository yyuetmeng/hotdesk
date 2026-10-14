import assert from 'node:assert/strict';
import { addElement, moveElement, rotateElement, removeElement, placementError, validateAll } from '../src/floorplan/logic.js';

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

state = addElement(state, 'meeting_room', 1, 4, COLS, ROWS, nextId).elements;
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
