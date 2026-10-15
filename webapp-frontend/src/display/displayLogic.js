// Pure helpers for the public floor displays (spec 2026-10-15-floor-dashboard).

const TZ = 'Asia/Singapore';
const EMPTY = '—';

/** Totals across floor summaries; occupancy = occupied / bookable. */
export function overall(summaries) {
  const sum = (key) => summaries.reduce((n, s) => n + (s?.[key] ?? 0), 0);
  const total = { bookable: sum('bookable'), available: sum('available'), booked: sum('booked'), occupied: sum('occupied') };
  return { ...total, occupancy_pct: total.bookable ? Math.round((100 * total.occupied) / total.bookable) : 0 };
}

export const nextFloorIndex = (index, count) => (count ? (index + 1) % count : 0);

/** Link name for a display: lowercase letters, digits and dashes, max 40, no dash at the ends. */
export function slugify(name) {
  const slug = String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return slug || 'display';
}

function parts(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  return Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
}

/** HH:mm:ss in Singapore time, whatever the device's time zone. */
export function sgTime(value) {
  const p = parts(value);
  return p ? `${p.hour}:${p.minute}:${p.second}` : EMPTY;
}

/** dd/MM/yyyy HH:mm:ss in Singapore time. */
export function sgDateTime(value) {
  const p = parts(value);
  return p ? `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}` : EMPTY;
}
