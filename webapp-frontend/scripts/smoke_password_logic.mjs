import assert from 'node:assert/strict';
import { checkPassword, commonFormsHex } from '../src/passwordPolicy.js';

// Password policy as you type (owner 2026-10-16): 8+ characters, letters and numbers, not well-known.
const weak = checkPassword('abc');
assert.equal(weak.ok, false);
assert.deepEqual(weak.rules.map((r) => r.ok), [false, false, true]);
const fair = checkPassword('abcd7351');
assert.equal(fair.ok, true);
assert.equal(fair.label, 'Fair');
assert.equal(checkPassword('Abcd7351-river').label, 'Strong');
const listed = checkPassword('Abcd7351-river', { common: true });                // the server's hash list matched
assert.equal(listed.ok, false);
assert.equal(listed.label, 'Too weak');
assert.equal(listed.rules[2].ok, false);
assert.equal(checkPassword('jane2026', { username: 'jane2026' }).ok, false);
assert.equal(checkPassword('').label, '');
// Same hashing as the server: lowercase, and symbols read as letters (z3bra -> zebra).
const forms = await commonFormsHex('Z3bra2026x');
const plain = await commonFormsHex('zebra2o26x');
assert.ok(forms.some((h) => plain.includes(h)));
assert.ok(forms.every((h) => /^[0-9a-f]{64}$/.test(h)));
console.log('password logic smoke OK');
