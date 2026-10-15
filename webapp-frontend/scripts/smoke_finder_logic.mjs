import assert from 'node:assert/strict';
import { locationText, statusText, timeText } from '../src/pages/finder/finderLogic.js';

// Colleague Finder: what to say about where someone is.
const seat = { seat_label: 'E1', plan_name: 'Level 1', zone: 'AI Lab' };
assert.equal(statusText({ status: 'checked_in' }), 'Checked in');
assert.equal(statusText({ status: 'booked' }), 'Booked today');
assert.equal(statusText({ status: 'tomorrow' }), 'Booked tomorrow');
assert.equal(statusText({ status: 'away' }), 'Not in the office today');
assert.equal(locationText({ status: 'checked_in', seat }), 'E1 · Level 1 · AI Lab');
assert.equal(locationText({ status: 'booked', seat: { ...seat, zone: null } }), 'E1 · Level 1');
assert.equal(locationText({ status: 'away', seat: null }), 'No seat booked for today or tomorrow');
assert.equal(timeText({ status: 'checked_in', since: '09:00', until: '18:00' }), 'Since 09:00, until 18:00');
assert.equal(timeText({ status: 'booked', preset: 'pm' }), 'PM (13:00–18:00)');
assert.equal(timeText({ status: 'tomorrow', preset: 'full' }), 'Tomorrow · Full day (08:00–18:00)');
assert.equal(timeText({ status: 'away' }), '');
console.log('finder logic smoke OK');
