// Pure helpers for the Insights occupancy chart (GET /api/admin/insights/occupancy).

const TZ = 'Asia/Singapore';
const fmt = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...opts });
const time = (iso) => fmt({ hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
const weekday = (iso) => fmt({ weekday: 'short' }).format(new Date(iso));
const monthDay = (iso) => fmt({ month: 'short', day: 'numeric' }).format(new Date(iso));

export const RANGES = ['1h', '6h', '24h', '7d', '30d'];

/** SVG path for percentages (0-100) across `width`, with 100% at the top of `height`. */
export function chartPath(values, width, height) {
  if (!values.length) return '';
  const y = (v) => Math.round((height - (height * v) / 100) * 100) / 100;
  if (values.length === 1) return `M0,${y(values[0])} L${width},${y(values[0])}`;
  const step = width / (values.length - 1);
  return values.map((v, i) => `${i ? 'L' : 'M'}${Math.round(i * step * 100) / 100},${y(v)}`).join(' ');
}

/** Up to `count` evenly spread indexes, always including the first and the last point. */
export function tickIndexes(length, count) {
  if (length <= count) return Array.from({ length }, (_, i) => i);
  return Array.from({ length: count }, (_, i) => Math.round((i * (length - 1)) / (count - 1)));
}

export function tickLabel(iso, range) {
  if (range === '30d') return monthDay(iso);
  if (range === '7d') return `${weekday(iso)} ${time(iso)}`;
  return time(iso);
}

const SPAN = { '1h': 'last hour', '6h': 'last 6 hours', '24h': 'last 24 hours', '7d': 'last 7 days', '30d': 'last 30 days' };

export function rangeSubtitle({ range, since }) {
  if (range === '7d') return `Seats in use, ${SPAN[range]} (hourly average; dashed line: peak) · since ${monthDay(since)}, ${time(since)}`;
  if (range === '30d') return `Seats in use, ${SPAN[range]} (daily average 08:00–19:00; dashed line: peak) · since ${monthDay(since)}`;
  return `Seats in use, ${SPAN[range]} · since ${time(since)}`;
}
