import assert from 'node:assert/strict';
import { importLabel, resultText, statusLabel } from '../src/pages/users/importLogic.js';

// Bulk import (owner 2026-10-16): preview statuses, the import button, and the result line.
assert.equal(statusLabel('create'), 'New');
assert.equal(statusLabel('update'), 'Add to team');
assert.equal(statusLabel('skip'), 'Skipped');
assert.equal(statusLabel('error'), 'Error');
assert.equal(importLabel('users', { create: 3, skip: 1, error: 2 }), 'Import 3 users');
assert.equal(importLabel('users', { create: 1, skip: 0, error: 0 }), 'Import 1 user');
assert.equal(importLabel('teams', { create: 1, update: 2, skip: 0, error: 0 }), 'Import 3 project teams');
assert.equal(importLabel('users', { create: 0, skip: 4, error: 0 }), 'Nothing to import');
assert.equal(resultText('users', 3, { create: 3, skip: 1, error: 2 }), 'Imported 3 users. 1 skipped (already there), 2 with errors not imported.');
assert.equal(resultText('teams', 1, { create: 1, update: 0, skip: 0, error: 0 }), 'Imported 1 project team.');
console.log('import logic smoke OK');
