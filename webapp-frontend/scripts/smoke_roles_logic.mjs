import assert from 'node:assert/strict';
import { isAdmin, canManageAccounts, isAccountManager } from '../src/roles.js';

// Analytics and Administration are for the admin role only (menu and routes).
assert.equal(isAdmin({ role: 'admin' }), true);
assert.equal(isAdmin({ role: 'user' }), false);
assert.equal(isAdmin({ role: 'Admin' }), false);   // roles are exact names from the server
assert.equal(isAdmin(null), false);
assert.equal(isAdmin(undefined), false);
assert.equal(isAdmin({}), false);
assert.equal(canManageAccounts({ role: 'user', manages: [{ id: 't', name: 'Eng' }] }), true);
assert.equal(canManageAccounts({ role: 'user', manages: [] }), false);
assert.equal(canManageAccounts({ role: 'admin', manages: [] }), true);
assert.equal(isAccountManager({ role: 'admin', manages: [] }), false);
assert.equal(isAccountManager({ role: 'user', manages: [{ id: 't', name: 'Eng' }] }), true);
console.log('roles logic smoke OK');
