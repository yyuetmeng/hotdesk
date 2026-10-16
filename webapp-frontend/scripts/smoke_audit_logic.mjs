import assert from 'node:assert/strict';
import { CATEGORIES, PERIODS, auditQuery, categoryOf, clearBody, oldText, relativeTime } from '../src/pages/audit/auditLogic.js';

// Audit views: categories, relative times, query strings for the shared endpoint.
assert.deepEqual(CATEGORIES.map((c) => c.key), ['security', 'users', 'teams', 'floor_plans', 'displays', 'desks', 'exports']);
assert.equal(categoryOf('security').label, 'Sign-in & security');
assert.equal(categoryOf('nope').label, 'Other');
const now = '2026-10-16T10:00:00+08:00';
assert.equal(relativeTime('2026-10-16T09:59:40+08:00', now), 'just now');
assert.equal(relativeTime('2026-10-16T09:15:00+08:00', now), '45 min ago');
assert.equal(relativeTime('2026-10-16T07:00:00+08:00', now), '3 h ago');
assert.equal(relativeTime('2026-10-15T10:00:00+08:00', now), 'yesterday');
assert.equal(relativeTime('2026-10-11T10:00:00+08:00', now), '5 days ago');
assert.equal(relativeTime('2026-08-01T10:00:00+08:00', now), '1 Aug 2026');
assert.equal(auditQuery({ category: 'security', q: ' jane ', from: '', to: '2026-10-16', page: 2 }), 'category=security&q=jane&to=2026-10-16&page=2');
assert.equal(auditQuery({}), '');
// Clearing by hand (owner 2026-10-16): period + categories; an empty category list means all.
assert.deepEqual(PERIODS.map((p) => p.days), [30, 90, 180, 365, null]);
assert.deepEqual(clearBody({ period: 90, before: '', categories: [] }, true), { older_than_days: 90, categories: [], dry_run: true });
assert.deepEqual(clearBody({ period: null, before: '2026-01-01', categories: ['security'] }), { before: '2026-01-01', categories: ['security'] });
assert.equal(clearBody({ period: null, before: '', categories: [] }), null);           // no date picked yet
assert.equal(oldText({ count: 0, oldest: null }), '');
assert.equal(oldText({ count: 1, oldest: '2026-08-01' }), '1 entry is older than a month (oldest 1 Aug 2026).');
assert.equal(oldText({ count: 1234, oldest: '2026-01-03' }), '1,234 entries are older than a month (oldest 3 Jan 2026).');
console.log('audit logic smoke OK');
