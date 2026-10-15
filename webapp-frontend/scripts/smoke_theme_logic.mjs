import assert from 'node:assert/strict';
import { THEME_CHOICES, normalizeTheme, resolveTheme } from '../src/theme.js';

// Theme setting in the sidebar: follow system / light / dark.
assert.deepEqual(THEME_CHOICES.map((c) => c.value), ['system', 'light', 'dark']);
assert.equal(normalizeTheme('dark'), 'dark');
assert.equal(normalizeTheme('light'), 'light');
assert.equal(normalizeTheme(null), 'system');          // nothing saved yet
assert.equal(normalizeTheme('purple'), 'system');      // stale or tampered value
assert.equal(resolveTheme('system', true), 'dark');
assert.equal(resolveTheme('system', false), 'light');
assert.equal(resolveTheme('light', true), 'light');
assert.equal(resolveTheme('dark', false), 'dark');
console.log('theme logic smoke OK');
