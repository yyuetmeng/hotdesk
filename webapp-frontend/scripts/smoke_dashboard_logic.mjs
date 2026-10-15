import assert from 'node:assert/strict';
import { firstName, greeting, outcomeText, slotText, teamCount, trendBar } from '../src/pages/dashboard/dashboardLogic.js';

// Workspace dashboard (spec 2026-10-16-workspace-dashboard-design §4).
assert.equal(greeting('2026-10-16T01:00:00Z'), 'Good morning');      // 09:00 in Singapore
assert.equal(greeting('2026-10-16T06:00:00Z'), 'Good afternoon');    // 14:00
assert.equal(greeting('2026-10-16T11:00:00Z'), 'Good evening');      // 19:00
assert.equal(firstName('Jane Tan'), 'Jane');
assert.equal(firstName(''), 'there');
assert.equal(slotText('am'), 'AM (08:00–13:00)');
assert.equal(slotText(null), '');
assert.equal(outcomeText('released'), 'Released (no check-in)');
assert.equal(outcomeText('plan_changed'), 'Cancelled (floor plan changed)');
assert.equal(outcomeText('active'), 'Booked');
// Trend bars over 08:00–18:00 (600 minutes); outside times are clamped; no check-in = no bar.
assert.deepEqual(trendBar('09:00', '17:30'), { top: '10%', height: '85%' });
assert.deepEqual(trendBar('07:30', '19:00'), { top: '0%', height: '100%' });
assert.equal(trendBar(null, null), null);
assert.equal(teamCount({ size: 9, members: [{ today: { state: 'checked_in' } }, { today: { state: 'booked' } }, { today: null }] }), '1 of 9 in');
console.log('dashboard logic smoke OK');
