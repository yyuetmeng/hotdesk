import assert from 'node:assert/strict';
import { isAdmin } from '../src/roles.js';

// Analytics and Administration are for the admin role only (menu and routes).
assert.equal(isAdmin({ role: 'admin' }), true);
assert.equal(isAdmin({ role: 'user' }), false);
assert.equal(isAdmin({ role: 'Admin' }), false);   // roles are exact names from the server
assert.equal(isAdmin(null), false);
assert.equal(isAdmin(undefined), false);
assert.equal(isAdmin({}), false);
console.log('roles logic smoke OK');
