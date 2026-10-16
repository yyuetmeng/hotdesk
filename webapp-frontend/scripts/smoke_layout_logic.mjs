import assert from 'node:assert/strict';
import { BOTTOM_LINKS, parseCollapsed, shellClass } from '../src/layout.js';

// Collapsible sidebar (desktop rail) and slide-out drawer (mobile).
assert.equal(parseCollapsed('1'), true);
assert.equal(parseCollapsed('0'), false);
assert.equal(parseCollapsed(null), false);        // never saved: expanded
assert.equal(parseCollapsed('yes'), false);
assert.equal(shellClass({ collapsed: false, drawerOpen: false }), 'app-shell');
assert.equal(shellClass({ collapsed: true, drawerOpen: false }), 'app-shell collapsed');
assert.equal(shellClass({ collapsed: true, drawerOpen: true }), 'app-shell collapsed drawer-open');
// Mobile bottom bar (owner 2026-10-16): Book a desk, Desk check-in (raised, centre), Colleague Finder.
assert.deepEqual(BOTTOM_LINKS.map((l) => [l.to, l.main]), [['/book', false], ['/checkin', true], ['/finder', false]]);
console.log('layout logic smoke OK');
