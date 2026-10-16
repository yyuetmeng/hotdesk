import assert from 'node:assert/strict';
import { autoText, barSegments, dayLabel, funnelTotals } from '../src/pages/insights/funnelLogic.js';

// Insights "Bookings" card: stacked bars per booking date, totals, team no-shows, auto-booking line.
const day = { date: '2026-10-16', booked: 4, checked_in: 2, released: 1, cancelled: 1, plan_changed: 0, active: 0 };
assert.deepEqual(barSegments(day, 8), [
  { key: 'checked_in', label: 'Checked in', value: 2, pct: 25 }, { key: 'released', label: 'No-show', value: 1, pct: 12.5 },
  { key: 'cancelled', label: 'Cancelled', value: 1, pct: 12.5 }]);                     // zero segments are left out
assert.deepEqual(barSegments({ ...day, booked: 0, checked_in: 0, released: 0, cancelled: 0 }, 0), []);
assert.deepEqual(funnelTotals([day, { ...day, date: '2026-10-15' }]),
  { booked: 8, checked_in: 4, released: 2, cancelled: 2, plan_changed: 0, active: 0, show_rate: 67 });  // 4 of 6 kept bookings used
assert.equal(dayLabel('2026-10-16'), 'Fri 16');
assert.equal(autoText({ booked: 0, used: 0, unused: 0 }), 'No seats were auto-booked in this period.');
assert.equal(autoText({ booked: 10, used: 7, unused: 2 }), 'Auto-booked 10 seats: 7 used, 2 not used (no-show).');
console.log('funnel logic smoke OK');
