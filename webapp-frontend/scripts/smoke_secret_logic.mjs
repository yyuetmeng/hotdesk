import assert from 'node:assert/strict';
import { checkPassword as rate, commonFormsHex as formsOf } from '../src/passwordPolicy.js';

// Sign-in secret policy as you type (owner 2026-10-16): 8+ characters, letters and numbers, not well-known.
// Every value is made at run time so no fixed secret sits in the code (GitHub secret scanning).
const pick = (chars, n) => Array.from(globalThis.crypto.getRandomValues(new Uint32Array(n)), (r) => chars[r % chars.length]).join('');
const lower = (n) => pick('abcdefghijklmnopqrstuvwxyz', n);
const digits = (n) => pick('246789', n);           // digits never read as letters (0, 1, 3, 5 are)

const weak = rate(lower(3));
assert.equal(weak.ok, false);
assert.deepEqual(weak.rules.map((r) => r.ok), [false, false, true]);
const fair = rate(lower(6) + digits(2));
assert.equal(fair.ok, true);
assert.equal(fair.label, 'Fair');
const strongOne = `A${lower(5)}${digits(4)}-${lower(5)}`;
assert.equal(rate(strongOne).label, 'Strong');
const listed = rate(strongOne, { common: true });                       // the server's hash list matched
assert.equal(listed.ok, false);
assert.equal(listed.label, 'Too weak');
assert.equal(listed.rules[2].ok, false);
const name = lower(4) + digits(4);
assert.equal(rate(name, { username: name }).ok, false);
assert.equal(rate('').label, '');
// Same hashing as the server: lowercase, and symbols read as letters (3 -> e).
const word = `Z${lower(3)}e${digits(4)}x`;
const forms = await formsOf(word.replace(/e/g, '3'));
const plain = await formsOf(word);
assert.ok(forms.some((h) => plain.includes(h)));
assert.ok(forms.every((h) => /^[0-9a-f]{64}$/.test(h)));
console.log('secret logic smoke OK');
