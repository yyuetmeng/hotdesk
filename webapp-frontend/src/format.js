// Display formatting for dates and times. See docs/CODING_GUIDELINES.md, "Dates and times".
// Input: ISO 8601 strings from the API ("2026-10-14T09:05:03Z" or date-only "2026-10-14"),
// or Date objects. Output is in the viewer's local time zone, 24-hour clock.

const EMPTY = '—';
const pad = (n) => String(n).padStart(2, '0');

function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' || !value) return null;
  // Date-only strings are calendar dates, not instants: build them in local time so they
  // never shift a day (new Date('2026-10-14') would be UTC midnight).
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  return new Date(value);
}

/** dd/MM/yyyy, e.g. 14/10/2026 */
export function formatDate(value) {
  const d = toDate(value);
  if (!d || Number.isNaN(d.getTime())) return EMPTY;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** dd/MM/yyyy HH:mm:ss, e.g. 14/10/2026 17:05:03 */
export function formatDateTime(value) {
  const d = toDate(value);
  if (!d || Number.isNaN(d.getTime())) return EMPTY;
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** HH:mm:ss, e.g. 17:05:03 (local time). */
export function formatTime(value) {
  const d = toDate(value);
  if (!d || Number.isNaN(d.getTime())) return EMPTY;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
