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
/** Floor overview: a display config over published floors (GET /api/public/floors), side by side — all of them
 * ("All floors") or a single floor. */
export const overviewConfig = (floors, name = 'All floors') => ({
  name, slug: '', show_overall: true, layout: 'grid', rotate_seconds: 20, plan_ids: floors.map((f) => f.id),
  floors: floors.map((f) => ({ id: f.id, name: f.name, published: true })),
});


/** Floor overview picker (owner 2026-10-16): All floors, the displays, then each floor; published only (server-side). */
export const overviewOptions = (displays, floors) => ({
  all: { value: '*all', label: 'All floors' },
  displays: displays.map((d) => ({ value: `d:${d.slug}`, label: d.name })),
  floors: floors.map((f) => ({ value: `f:${f.id}`, label: f.name })),
});

/** The saved choice if it is still offered, else the first display, else All floors. */
export function resolvePick(saved, options) {
  const all = [options.all, ...options.displays, ...options.floors].map((o) => o.value);
  if (all.includes(saved)) return saved;
  return options.displays[0]?.value ?? options.all.value;
}

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

/** A wall or window as a thin bar of `t` units along its long side, centred across its cells. */
export function thinBar(x, y, W, H, t) {
  return W >= H ? { x, y: y + (H - t) / 2, width: W, height: t } : { x: x + (W - t) / 2, y, width: t, height: H };
}

/** Monitor marks on a table: one per grid cell along its long side (offsets from the table's start). */
export function monitorMarks(x, y, W, H, cell) {
  const vertical = H > W;
  const count = Math.max(Math.round((vertical ? H : W) / cell), 1);
  return { vertical, at: Array.from({ length: count }, (_, i) => i * cell + cell / 2) };
}

/** A table's label fitted to its long side (`length` drawing units, 9px text ≈ 5.2 units a character):
 * the whole label, or cut with "…"; '' for no label or no room. */
export function tableLabel(label, length) {
  const text = String(label ?? '').trim();
  const room = Math.floor((length - 10) / 5.2);
  if (!text || room < 2) return '';
  return text.length <= room ? text : `${text.slice(0, room - 1).trimEnd()}…`;
}

/** A plant's outer radius: 36% of its element's smaller side, so the flower never spills out of it. */
export const plantRadius = (W, H) => Math.round(Math.min(W, H) * 0.36 * 100) / 100;

/** A plant w x h cells big is a row / block of plants, one in the middle of each cell (owner 2026-10-21). */
export function plantSpots(x, y, w, h, cell) {
  const spots = [];
  for (let r = 0; r < h; r += 1) for (let c = 0; c < w; c += 1) spots.push([x + (c + 0.5) * cell, y + (r + 0.5) * cell]);
  return spots;
}

/** Door swing settings (editor dropdown): the side the door opens towards, then the end its hinge is on. */
export const DOOR_SWINGS = [['up-left', 'Opens up, hinge left'], ['up-right', 'Opens up, hinge right'],
  ['down-left', 'Opens down, hinge left'], ['down-right', 'Opens down, hinge right'],
  ['left-top', 'Opens left, hinge top'], ['left-bottom', 'Opens left, hinge bottom'],
  ['right-top', 'Opens right, hinge top'], ['right-bottom', 'Opens right, hinge bottom']];

/** How to draw a door in the box (x, y, W, H): each leaf stands open from its hinge, with the dashed arc its edge
 * travels to the closed position along the doorway (the side opposite the way it opens). A doorway at least twice as
 * long as the door is deep (e.g. a 2-wide door) is a double door: a leaf from each end, meeting in the middle, so the
 * swing stays inside the box; the hinge setting then doesn't matter. Unknown settings draw as 'up-left'. */
export function doorSwing(el, x, y, W, H) {
  const swing = DOOR_SWINGS.some(([v]) => v === el?.config?.swing) ? el.config.swing : 'up-left';
  const [opens, hinge] = swing.split('-');
  const vertical = opens === 'up' || opens === 'down';
  const l = x + 1, t = y + 1, r = x + W - 1, b = y + H - 1;
  const doorway = (vertical ? W : H) - 2, depth = (vertical ? H : W) - 2;
  const double = doorway >= depth * 2;
  const len = Math.min(double ? doorway / 2 : doorway, depth);
  const towards = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[opens];
  const leaf = (start) => {   // start: hinge at the left / top end of the doorway
    const hx = vertical ? (start ? l : r) : (opens === 'left' ? r : l);
    const hy = vertical ? (opens === 'up' ? b : t) : (start ? t : b);
    const along = vertical ? [start ? 1 : -1, 0] : [0, start ? 1 : -1];   // from the hinge along the doorway
    return { hinge: [hx, hy], open: [hx + towards[0] * len, hy + towards[1] * len],
      shut: [hx + along[0] * len, hy + along[1] * len], sweep: towards[0] * along[1] - towards[1] * along[0] > 0 ? 1 : 0 };
  };
  return { swing, radius: len, leaves: double ? [leaf(true), leaf(false)] : [leaf(hinge === 'left' || hinge === 'top')] };
}

/** A toilet's gender setting (editor: All-gender / Male / Female); anything else counts as all-gender. */
export function toiletGender(el) {
  const g = el?.config?.gender;
  return g === 'male' || g === 'female' ? g : 'unisex';
}

const hhmm = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/** Grid cells ("x,y") covered by the given seat footprints {x, y, w, h}. */
export function seatCells(rects) {
  const cells = new Set();
  for (const r of rects) for (let dx = 0; dx < r.w; dx += 1) for (let dy = 0; dy < r.h; dy += 1) cells.add(`${r.x + dx},${r.y + dy}`);
  return cells;
}

/** Where a seat's assignment plate goes (seat assignments page), chosen from the element grid: the right-hand cell,
 * else the left-hand one, else (a crowded row) below the chair, else above it. A cell is free when it is inside the
 * floor and holds no seat; `rect` is the seat's footprint {x, y, w, h}. */
export function plateSide(rect, cells, cols, rows) {
  const free = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && !cells.has(`${x},${y}`);
  if (free(rect.x + rect.w, rect.y)) return 'right';
  if (free(rect.x - 1, rect.y)) return 'left';
  if (rect.y + rect.h < rows) return 'below';
  return 'above';
}

/** Two short lines for a seat's hover tip (owner 2026-10-16): seat number and team, then who and when. */
export function seatTip(seat) {
  const head = [seat.label || 'Seat', seat.department].filter(Boolean).join(' · ');
  if (seat.state === 'occupied' && seat.occupant) {
    const o = seat.occupant;
    return [head, `${o.name}${o.since ? ` · in since ${hhmm(o.since)}` : ''}${o.until ? `, until ${hhmm(o.until)}` : ''}`];
  }
  if (seat.state === 'booked' && seat.booking) {
    const b = seat.booking;
    return [head, `Booked for ${b.booked_for?.name ?? 'someone'} · ${hhmm(b.starts_at)}–${hhmm(b.ends_at)}`];
  }
  if (seat.state === 'neutral') return [head, 'Not assigned'];   // Seat assignments page: no live use shown
  return [head, seat.state === 'not_bookable' ? 'Not set up for booking' : 'Available'];
}
