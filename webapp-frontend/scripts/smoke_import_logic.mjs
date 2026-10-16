import assert from 'node:assert/strict';
import { importLabel, resultText, statusLabel } from '../src/pages/users/importLogic.js';

// Upload Users (owner 2026-10-16): preview statuses, the upload button, and the result line.
assert.equal(statusLabel('create'), 'New');
assert.equal(statusLabel('skip'), 'Skipped');
assert.equal(statusLabel('error'), 'Error');
assert.equal(importLabel({ create: 3, skip: 1, error: 2 }), 'Upload 3 users');
assert.equal(importLabel({ create: 1, skip: 0, error: 0 }), 'Upload 1 user');
assert.equal(importLabel({ create: 0, skip: 4, error: 0 }), 'Nothing to upload');
assert.equal(resultText(3, { create: 3, skip: 1, error: 2 }), 'Uploaded 3 users. 1 skipped (already there), 2 with errors not uploaded.');
assert.equal(resultText(1, { create: 1, skip: 0, error: 0 }), 'Uploaded 1 user.');
console.log('import logic smoke OK');
