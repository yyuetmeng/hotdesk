import assert from 'node:assert/strict';
import { clearToken, readToken, writeToken } from '../src/session.js';

const fake = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const KEY = 'hotdesk.auth.token';

// Not kept: this tab only. Kept: survives new tabs (QR scans) until the 5-day token expires.
{
  const stores = { session: fake(), local: fake() };
  writeToken(stores, 't1', false);
  assert.equal(stores.session.getItem(KEY), 't1'); assert.equal(stores.local.getItem(KEY), null);
  assert.equal(readToken(stores), 't1');
  writeToken(stores, 't2', true);                        // switching to kept removes the tab copy
  assert.equal(stores.local.getItem(KEY), 't2'); assert.equal(stores.session.getItem(KEY), null);
  assert.equal(readToken(stores), 't2');
  clearToken(stores);
  assert.equal(readToken(stores), '');
}
// A tab sign-in wins over an older kept one (the person just signed in here).
{
  const stores = { session: fake(), local: fake() };
  stores.local.setItem(KEY, 'old'); stores.session.setItem(KEY, 'new');
  assert.equal(readToken(stores), 'new');
}
// Storage unavailable (private mode / blocked): nothing throws.
{
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const stores = { session: broken, local: broken };
  assert.equal(readToken(stores), '');
  writeToken(stores, 't', true); clearToken(stores);
}
console.log('session logic smoke OK');
