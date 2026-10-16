import assert from 'node:assert/strict';
import { CATEGORIES, auditQuery, categoryOf, relativeTime } from '../src/pages/audit/auditLogic.js';

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
console.log('audit logic smoke OK');
