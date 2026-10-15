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

/** Only the settings the rotation timer depends on (a new display object on every poll must not reset it). */
export const rotationKey = (display) => (display ? `${display.layout}:${display.rotate_seconds}` : '');

export const initialDisplayState = {
  display: null, floors: [], updatedAt: null, loaded: false, offline: false, missing: false, unreachable: false,
};

/**
 * Next TV state after a refresh (spec §3 "Errors"):
 * - {type: 'ok', display, floors: Promise.allSettled results, at}: floors that 404 (unpublished since)
 *   are skipped; any other failed floor keeps the previous data and marks the TV offline.
 * - {type: 'error', status}: 404 → the display was deleted or renamed ("Display not found", even
 *   after a good load); anything else keeps the last data offline (or "unreachable" before any load).
 */
export function reduceRefresh(state, outcome) {
  if (outcome.type === 'error') {
    if (outcome.status === 404) return { ...state, missing: true };
    return state.loaded ? { ...state, offline: true } : { ...state, unreachable: true };
  }
  const failed = outcome.floors.filter((r) => r.status === 'rejected' && r.reason?.status !== 404);
  if (failed.length) return state.loaded ? { ...state, offline: true } : { ...state, unreachable: true };
  return {
    display: outcome.display,
    floors: outcome.floors.filter((r) => r.status === 'fulfilled').map((r) => r.value),
    updatedAt: outcome.at, loaded: true, offline: false, missing: false, unreachable: false,
  };
}

/** The unsaved Manage Floor Display form as the config the TV reads (GET /api/public/displays/<slug>),
 *  so the preview shows exactly what will be saved. Deleted plans are dropped, drafts flagged. */
export function previewConfig(form, plans) {
  const byId = Object.fromEntries(plans.map((p) => [p.id, p]));
  const seconds = Number.parseInt(form.rotate_seconds, 10);
  return {
    name: form.name.trim() || 'Display preview', slug: form.slug, show_overall: Boolean(form.show_overall),
    layout: form.layout, rotate_seconds: Number.isFinite(seconds) ? Math.min(Math.max(seconds, 10), 120) : 20,
    plan_ids: form.plan_ids,
    floors: form.plan_ids.filter((id) => byId[id]).map((id) => ({ id, name: byId[id].name, published: byId[id].published_version != null })),
  };
}
