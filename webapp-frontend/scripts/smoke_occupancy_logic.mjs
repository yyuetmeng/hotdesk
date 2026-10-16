import assert from 'node:assert/strict';
import { chartPath, rangeSubtitle, tickIndexes, tickLabel } from '../src/pages/insights/occupancyLogic.js';

// Occupancy chart geometry: x spread over the width, y from 100% (top) to 0% (bottom).
assert.equal(chartPath([0, 50, 100], 200, 100), 'M0,100 L100,50 L200,0');
assert.equal(chartPath([25], 200, 100), 'M0,75 L200,75');          // a single point draws a flat line
assert.equal(chartPath([], 200, 100), '');
assert.deepEqual(tickIndexes(13, 5), [0, 3, 6, 9, 12]);             // five evenly spread labels, first and last included
assert.deepEqual(tickIndexes(3, 5), [0, 1, 2]);
assert.equal(tickLabel('2026-10-16T16:16:00+08:00', '24h'), '04:16 PM');
assert.equal(tickLabel('2026-10-15T16:00:00+08:00', '7d'), 'Thu 04:00 PM');
assert.equal(tickLabel('2026-10-15T00:00:00+08:00', '30d'), 'Oct 15');
assert.equal(rangeSubtitle({ range: '24h', since: '2026-10-15T16:16:00+08:00' }), 'Seats in use, last 24 hours · since 04:16 PM');
assert.equal(rangeSubtitle({ range: '7d', since: '2026-10-09T16:00:00+08:00' }),
  'Seats in use, last 7 days (hourly average; dashed line: peak) · since Oct 9, 04:00 PM');
assert.equal(rangeSubtitle({ range: '30d', since: '2026-09-17T00:00:00+08:00' }),
  'Seats in use, last 30 days (daily average 08:00–18:00; dashed line: peak) · since Sep 17');
console.log('occupancy logic smoke OK');
