import assert from 'node:assert/strict';
import { parseCollapsed, shellClass } from '../src/layout.js';

// Collapsible sidebar (desktop rail) and slide-out drawer (mobile).
assert.equal(parseCollapsed('1'), true);
assert.equal(parseCollapsed('0'), false);
assert.equal(parseCollapsed(null), false);        // never saved: expanded
assert.equal(parseCollapsed('yes'), false);
assert.equal(shellClass({ collapsed: false, drawerOpen: false }), 'app-shell');
assert.equal(shellClass({ collapsed: true, drawerOpen: false }), 'app-shell collapsed');
assert.equal(shellClass({ collapsed: true, drawerOpen: true }), 'app-shell collapsed drawer-open');
console.log('layout logic smoke OK');
