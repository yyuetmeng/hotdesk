import assert from 'node:assert/strict';
import { autoBookText, firstName, greeting, outcomeText, slotText, teamCount, trendBar } from '../src/pages/dashboard/dashboardLogic.js';

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
// Trend bars over 08:00–19:00 (660 minutes); outside times are clamped; no check-in = no bar.
assert.deepEqual(trendBar('08:00', '13:30'), { top: '0%', height: '50%' });
assert.deepEqual(trendBar('07:30', '19:30'), { top: '0%', height: '100%' });
assert.equal(trendBar(null, null), null);
assert.equal(teamCount({ size: 9, members: [{ today: { state: 'checked_in' } }, { today: { state: 'booked' } }, { today: null }] }), '1 of 9 in');
assert.equal(autoBookText({ ok: true, seat_label: 'E1', usual_seat_label: null }, 'tomorrow'), 'Auto-booked E1 for tomorrow (full day).');
assert.equal(autoBookText({ ok: true, seat_label: 'E1', usual_seat_label: 'A1' }, 'tomorrow'),
  'Your usual seat A1 was not available; auto-booked E1 for tomorrow.');
assert.equal(autoBookText({ ok: false, message: 'no free seat' }, 'Mon 19 Oct'), 'Could not auto-book for Mon 19 Oct: no free seat.');
assert.equal(autoBookText({ ok: false, seat_label: 'E1', message: 'no free seat' }, 'today'), 'Could not auto-book for today: no free seat.');
console.log('dashboard logic smoke OK');
