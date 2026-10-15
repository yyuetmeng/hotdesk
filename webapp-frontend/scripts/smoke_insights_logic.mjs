import assert from 'node:assert/strict';
import { barWidths, pctText } from '../src/pages/insights/zoneLogic.js';

// Utilisation by zone (spec 2026-10-15-floor-zones §6).
assert.deepEqual(barWidths({ total: 36, occupied: 12, booked: 4 }), { occupied: '33.33%', booked: '11.11%' });
assert.deepEqual(barWidths({ total: 0, occupied: 0, booked: 0 }), { occupied: '0%', booked: '0%' });
assert.deepEqual(barWidths({ total: 4, occupied: 4, booked: 0 }), { occupied: '100%', booked: '0%' });
assert.equal(pctText({ pct: null }), '—');
assert.equal(pctText({ pct: 44 }), '44%');
assert.equal(pctText({ pct: 0 }), '0%');
console.log('insights logic smoke OK');
