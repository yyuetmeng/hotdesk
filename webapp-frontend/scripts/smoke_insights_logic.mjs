import assert from 'node:assert/strict';
import { barWidths, pctText, showNoZones } from '../src/pages/insights/zoneLogic.js';

// Utilisation by zone (spec 2026-10-15-floor-zones §6).
assert.deepEqual(barWidths({ total: 36, occupied: 12, booked: 4 }), { occupied: '33.33%', booked: '11.11%' });
assert.deepEqual(barWidths({ total: 0, occupied: 0, booked: 0 }), { occupied: '0%', booked: '0%' });
assert.deepEqual(barWidths({ total: 4, occupied: 4, booked: 0 }), { occupied: '100%', booked: '0%' });
assert.equal(pctText({ pct: null }), '—');
assert.equal(pctText({ pct: 44 }), '44%');
assert.equal(pctText({ pct: 0 }), '0%');
// Spec §6: "No zones yet" whenever no published floor has a zone, even if floors (Whole floor rows) exist.
assert.equal(showNoZones({ has_zones: false, rows: [{ name: 'Whole floor' }] }), true);
assert.equal(showNoZones({ has_zones: false, rows: [] }), true);
assert.equal(showNoZones({ has_zones: true, rows: [{ name: 'Z' }, { name: 'Whole floor' }] }), false);
console.log('insights logic smoke OK');
