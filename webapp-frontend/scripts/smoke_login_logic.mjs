import assert from 'node:assert/strict';
import { loginReason, safeReturnTo } from '../src/pages/login/loginLogic.js';

// Where to go after signing in: only same-site paths (no open redirects).
assert.equal(safeReturnTo('/checkin/374627cf-7ca3-46f0-918e-ec3507c03f43'), '/checkin/374627cf-7ca3-46f0-918e-ec3507c03f43');
assert.equal(safeReturnTo('//evil.example'), '/');
assert.equal(safeReturnTo('https://evil.example'), '/');
assert.equal(safeReturnTo(undefined), '/');
// Why the person is being asked to sign in, when they arrived from a desk QR code.
assert.equal(loginReason('/checkin/abc'), 'Sign in to check in at this desk. You will go straight back to it.');
assert.equal(loginReason('/checkin'), null);
assert.equal(loginReason('/book'), null);
console.log('login logic smoke OK');
