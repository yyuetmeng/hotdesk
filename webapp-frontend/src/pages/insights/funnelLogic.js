// Pure helpers for the Insights "Bookings" card (GET /api/admin/insights/funnel).

const SEGMENTS = [['checked_in', 'Checked in'], ['released', 'No-show'], ['cancelled', 'Cancelled'],
  ['plan_changed', 'Floor plan changed'], ['active', 'Upcoming']];

/** Stacked bar segments for a day, as % of the busiest day (`max`); empty segments are left out. */
export const barSegments = (day, max) => (max ? SEGMENTS.map(([key, label]) => ({ key, label, value: day[key], pct: (100 * day[key]) / max }))
  .filter((s) => s.value > 0) : []);

/** Totals over the period, and the share of kept bookings (not cancelled, already decided) that were used. */
export function funnelTotals(days) {
  const t = { booked: 0, checked_in: 0, released: 0, cancelled: 0, plan_changed: 0, active: 0 };
  days.forEach((d) => Object.keys(t).forEach((k) => { t[k] += d[k]; }));
  const decided = t.checked_in + t.released;
  return { ...t, show_rate: decided ? Math.round((100 * t.checked_in) / decided) : 0 };
}

export const dayLabel = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`;
};

export function autoText(auto) {
  if (!auto.booked) return 'No seats were auto-booked in this period.';
  return `Auto-booked ${auto.booked} seat${auto.booked === 1 ? '' : 's'}: ${auto.used} used, ${auto.unused} not used (no-show).`;
}

export const SEGMENT_KEYS = SEGMENTS;
