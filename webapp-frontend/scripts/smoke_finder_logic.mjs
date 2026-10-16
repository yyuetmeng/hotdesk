import assert from 'node:assert/strict';
import { locationText, statusText, timeText } from '../src/pages/finder/finderLogic.js';

// Colleague Finder: what to say about where someone is.
const seat = { seat_label: 'E1', plan_name: 'Level 1', zone: 'AI Lab' };
assert.equal(statusText({ status: 'checked_in' }), 'Checked in');
assert.equal(statusText({ status: 'booked' }), 'Booked today');
assert.equal(statusText({ status: 'tomorrow', date: '2026-10-16' }, '2026-10-15'), 'Booked tomorrow');
assert.equal(statusText({ status: 'tomorrow', date: '2026-10-19' }, '2026-10-16'), 'Booked Monday');
assert.equal(statusText({ status: 'away' }), 'Not in the office today');
assert.equal(locationText({ status: 'checked_in', seat }), 'E1 · Level 1 · AI Lab');
assert.equal(locationText({ status: 'booked', seat: { ...seat, zone: null } }), 'E1 · Level 1');
assert.equal(locationText({ status: 'away', seat: null }), 'No seat booked for today or the next working day');
assert.equal(timeText({ status: 'checked_in', since: '09:00', until: '18:00' }), 'Since 09:00, until 18:00');
assert.equal(timeText({ status: 'booked', preset: 'pm' }), 'PM (13:00–19:00)');
assert.equal(timeText({ status: 'tomorrow', preset: 'full', date: '2026-10-16' }, '2026-10-15'), 'Tomorrow · Full day (08:00–19:00)');
assert.equal(timeText({ status: 'tomorrow', preset: 'am', date: '2026-10-19' }, '2026-10-16'), 'Monday · AM (08:00–13:00)');
assert.equal(timeText({ status: 'away' }), '');
console.log('finder logic smoke OK');

// Dropdown keyboard: arrows move the highlight and wrap; nothing to move in an empty list.
{
  const { moveActive } = await import('../src/pages/finder/finderLogic.js');
  assert.equal(moveActive(-1, 1, 3), 0);
  assert.equal(moveActive(2, 1, 3), 0);
  assert.equal(moveActive(0, -1, 3), 2);
  assert.equal(moveActive(-1, -1, 3), 2);
  assert.equal(moveActive(0, 1, 0), -1);
}
console.log('finder dropdown smoke OK');
