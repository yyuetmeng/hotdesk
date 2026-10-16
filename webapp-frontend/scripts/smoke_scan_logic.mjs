import assert from 'node:assert/strict';
import { seatFromCode } from '../src/desk/scanLogic.js';

// Scan QR code (owner 2026-10-16): a desk label holds <site>/checkin/<seat id>; anything else is not a seat code.
const id = '3f2a8c1e-1d2b-4c3d-9e8f-0a1b2c3d4e5f';
assert.equal(seatFromCode(`https://hotdesk.example.com/checkin/${id}`), id);
assert.equal(seatFromCode(`http://localhost:5173/checkin/${id}?x=1`), id);          // printed on another site: still ours
assert.equal(seatFromCode(`  https://a.b/checkin/${id.toUpperCase()}  `), id);
assert.equal(seatFromCode('https://evil.example.com/login'), null);
assert.equal(seatFromCode('hello'), null);
assert.equal(seatFromCode(`https://a.b/checkin/not-a-uuid`), null);
console.log('scan logic smoke OK');
