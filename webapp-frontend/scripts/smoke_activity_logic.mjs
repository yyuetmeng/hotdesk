import assert from 'node:assert/strict';
import { activityPlace, activityTitle, activityWhen } from '../src/pages/insights/activityLogic.js';

// Recent activity rows.
assert.equal(activityTitle({ kind: 'check_in' }), 'Checked in');
assert.equal(activityTitle({ kind: 'check_out', ended: 'ended automatically' }), 'Checked out (ended automatically)');
assert.equal(activityTitle({ kind: 'check_out', ended: 'checked out' }), 'Checked out');
assert.equal(activityPlace({ seat_label: 'E1', plan_name: 'Level 1', zone: 'AI Lab' }), 'E1 · Level 1 · AI Lab');
assert.equal(activityPlace({ seat_label: 'E1', plan_name: null, zone: null }), 'E1');
assert.equal(activityWhen('2026-10-16T09:00:00+08:00', '2026-10-16'), 'Today 09:00');
assert.equal(activityWhen('2026-10-15T17:46:00+08:00', '2026-10-16'), 'Thu 15 Oct 17:46');
console.log('activity logic smoke OK');
