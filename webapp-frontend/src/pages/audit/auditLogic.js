// Shared helpers for audit views (spec 2026-10-16-audit-views): categories, relative times, query strings.

export const CATEGORIES = [
  { key: 'security', label: 'Sign-in & security', tone: 'red' },
  { key: 'users', label: 'Users', tone: 'blue' },
  { key: 'teams', label: 'Project teams', tone: 'blue' },
  { key: 'floor_plans', label: 'Floor plans', tone: 'blue' },
  { key: 'displays', label: 'Displays', tone: 'blue' },
  { key: 'desks', label: 'Bookings & check-ins', tone: 'green' },
  { key: 'exports', label: 'Exports', tone: 'grey' },
];

export const categoryOf = (key) => CATEGORIES.find((c) => c.key === key) ?? { key, label: 'Other', tone: 'grey' };

/** "just now", "45 min ago", "3 h ago", "yesterday", "5 days ago", then the date. */
export function relativeTime(iso, nowIso = new Date().toISOString()) {
  const seconds = (new Date(nowIso) - new Date(iso)) / 1000;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  const days = Math.floor(seconds / 86400);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

// Clearing by hand (owner 2026-10-16): nothing is deleted automatically; only entries older than a month.
export const PERIODS = [
  { days: 30, label: 'Older than 1 month' }, { days: 90, label: 'Older than 3 months' },
  { days: 180, label: 'Older than 6 months' }, { days: 365, label: 'Older than 1 year' }, { days: null, label: 'Before a date…' },
];

/** Body for POST /api/admin/audit/clear, or null while "Before a date" has no date yet. */
export function clearBody({ period, before, categories }, dryRun = false) {
  if (period === null && !before) return null;
  return { ...(period === null ? { before } : { older_than_days: period }), categories, ...(dryRun ? { dry_run: true } : {}) };
}

const day = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T00:00:00Z`));
/** The banner text for entries older than a month ('' when there are none). */
export function oldText(old) {
  if (!old?.count) return '';
  return `${old.count.toLocaleString('en-GB')} ${old.count === 1 ? 'entry is' : 'entries are'} older than a month (oldest ${day(old.oldest)}).`;
}

/** Query string for GET /api/admin/audit from filters; empty values are left out. */
export function auditQuery(filters) {
  return Object.entries(filters)
    .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}
