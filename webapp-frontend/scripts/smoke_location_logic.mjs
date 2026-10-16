import assert from 'node:assert/strict';
import { checkInLocation } from '../src/desk/location.js';

// Check-in location (owner 2026-10-16): coordinates when the browser gives them, otherwise why not.
const geo = (fn) => ({ getCurrentPosition: (ok, fail, opts) => fn(ok, fail, opts) });
assert.deepEqual(await checkInLocation(geo((ok) => ok({ coords: { latitude: 1.3, longitude: 103.8, accuracy: 25 } }))),
  { location: { lat: 1.3, lng: 103.8, accuracy: 25 } });
assert.deepEqual(await checkInLocation(geo((ok, fail) => fail({ code: 1 }))), { location_status: 'denied' });
assert.deepEqual(await checkInLocation(geo((ok, fail) => fail({ code: 2 }))), { location_status: 'unavailable' });
assert.deepEqual(await checkInLocation(geo((ok, fail) => fail({ code: 3 }))), { location_status: 'timeout' });
assert.deepEqual(await checkInLocation(undefined), { location_status: 'unsupported' });
assert.deepEqual(await checkInLocation(geo(() => {}), 20), { location_status: 'timeout' });    // never answers
let asked;
await checkInLocation(geo((ok, fail, opts) => { asked = opts; ok({ coords: { latitude: 0, longitude: 0, accuracy: 1 } }); }));
assert.equal(asked.enableHighAccuracy, true);
console.log('location logic smoke OK');
