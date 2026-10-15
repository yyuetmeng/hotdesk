import { catalogByType, isResizable, maxSizeFor, sizeOf } from './palette.js';
import { isSeat, isZone } from './selection.js';

export function cellsOf(el) {
  const { w, h } = sizeOf(el);
  const cells = [];
  for (let dx = 0; dx < w; dx += 1) for (let dy = 0; dy < h; dy += 1) cells.push([el.x + dx, el.y + dy]);
  return cells;
}

export function placementError(el, elements, cols, rows) {
  if (!el.type || !catalogByType[el.type]) return 'unknown type';
  const { w, h } = sizeOf(el);
  if (el.x < 0 || el.y < 0 || el.x + w > cols || el.y + h > rows) return 'outside the grid';
  // Zones form their own layer: they only clash with zones, other elements only with each other.
  const occupied = new Set();
  for (const other of elements) {
    if (other.id === el.id || isZone(other) !== isZone(el)) continue;
    for (const [cx, cy] of cellsOf(other)) occupied.add(`${cx},${cy}`);
  }
  for (let dx = 0; dx < w; dx += 1)
    for (let dy = 0; dy < h; dy += 1)
      if (occupied.has(`${el.x + dx},${el.y + dy}`)) return 'overlaps another element';
  return null;
}

export function addElement(elements, type, x, y, cols, rows, nextId) {
  const el = { id: nextId(), type, x, y, rotation: 0 };
  const error = placementError(el, elements, cols, rows);
  if (error) return { elements, error };
  return { elements: [...elements, el], error: null };
}

export function moveElement(elements, id, x, y, cols, rows) {
  const current = elements.find((e) => e.id === id);
  if (!current) return { elements, error: 'element not found' };
  const moved = { ...current, x, y };
  const error = placementError(moved, elements, cols, rows);
  if (error) return { elements, error };
  return { elements: elements.map((e) => (e.id === id ? moved : e)), error: null };
}

export function rotateElement(elements, id, cols, rows) {
  const current = elements.find((e) => e.id === id);
  if (!current) return { elements, error: 'element not found' };
  if (isZone(current)) return { elements, error: 'zones cannot be rotated' };
  const rotated = { ...current, rotation: ((current.rotation || 0) + 90) % 360 };
  const error = placementError(rotated, elements, cols, rows);
  if (error) return { elements, error };
  return { elements: elements.map((e) => (e.id === id ? rotated : e)), error: null };
}

/** Set an element's unrotated width/height in cells. Fixed-size types (seats) cannot be resized. */
export function resizeElement(elements, id, w, h, cols, rows) {
  const current = elements.find((e) => e.id === id);
  if (!current) return { elements, error: 'element not found' };
  if (!isResizable(current.type)) return { elements, error: `${current.type} size is fixed` };
  const max = maxSizeFor(current.type);
  if (![w, h].every((n) => Number.isInteger(n) && n >= 1 && n <= max)) {
    return { elements, error: `size must be 1 to ${max} cells` };
  }
  const resized = { ...current, w, h };
  const error = placementError(resized, elements, cols, rows);
  if (error) return { elements, error };
  return { elements: elements.map((e) => (e.id === id ? resized : e)), error: null };
}

export function removeElement(elements, id) {
  return elements.filter((e) => e.id !== id);
}

export function validateAll(elements, cols, rows) {
  const problems = [];
  const seen = new Map();
  elements.forEach((el, i) => {
    const error = placementError(el, [], cols, rows);
    if (error) { problems.push(`element ${i} (${el.type}): ${error}`); return; }
    for (const [cx, cy] of cellsOf(el)) {
      const key = `${isZone(el) ? 'z' : 'e'}${cx},${cy}`;
      if (seen.has(key)) problems.push(`element ${i} (${el.type}) overlaps element ${seen.get(key)}`);
      else seen.set(key, i);
    }
  });
  return [...new Set(problems)];
}

/** True when the toolbar's name/grid fields differ from the saved plan (not yet applied). */
export function metaChanged(meta, plan) {
  return meta.name.trim() !== plan.name || Number(meta.cols) !== plan.cols || Number(meta.rows) !== plan.rows;
}

/** A zone's display name: its label, or 'Unnamed zone' (spec 2026-10-15-floor-zones §3). */
export const zoneName = (zone) => (zone.label ?? '').trim() || 'Unnamed zone';

/** Ids of the seats whose cell lies inside the zone's rectangle. */
export function seatsInZone(elements, zone) {
  const { w, h } = sizeOf(zone);
  return elements.filter((el) => isSeat(el) && el.x >= zone.x && el.x < zone.x + w && el.y >= zone.y && el.y < zone.y + h)
    .map((el) => el.id);
}

/** Lifecycle buttons for a plan in the Manage Floor Plan list, by its publishing status. */
export function planActions(status) {
  const publish = { action: 'publish', label: status === 'changed' ? 'Publish changes' : 'Publish' };
  const unpublish = { action: 'unpublish', label: 'Unpublish' };
  return { draft: [publish], unpublished: [publish], changed: [publish, unpublish], published: [unpublish] }[status] ?? [];
}

/** The draft as staff will see it, shaped like a published floor payload for the display drawing:
 *  every tagged seat shows as available (a draft has no bookings), zones with "N of M free".
 *  `departments` maps project team id to name. */
export function previewFloor(plan, elements, catalog, departments = {}) {
  const byType = Object.fromEntries(catalog.map((c) => [c.type, c]));
  const sized = elements.filter((el) => byType[el.type]).map((el) => {
    const entry = byType[el.type];
    return { id: el.id, type: el.type, x: el.x, y: el.y,
      w: entry.resizable === false ? entry.w : (el.w ?? entry.w), h: entry.resizable === false ? entry.h : (el.h ?? entry.h),
      rotation: el.rotation || 0, label: el.label ?? null, color: el.color ?? null };
  });
  const seats = elements.filter(isSeat).map((el) => {
    const tagged = Boolean(el.open_to_all || el.department_id);
    return { id: el.id, label: (el.label ?? '').trim() || `Seat ${el.x},${el.y}`, x: el.x, y: el.y,
      state: tagged ? 'available' : 'not_bookable', open_to_all: Boolean(el.open_to_all),
      department: el.open_to_all ? 'Free for all' : (departments[el.department_id] ?? null), occupant: null, booking: null };
  });
  const usable = seats.filter((s) => s.state === 'available');
  const zones = sized.filter(isZone).sort((a, b) => zoneName(a).localeCompare(zoneName(b))).map((z) => {
    const inside = usable.filter((s) => s.x >= z.x && s.x < z.x + z.w && s.y >= z.y && s.y < z.y + z.h).length;
    return { id: z.id, name: zoneName(z), x: z.x, y: z.y, w: z.w, h: z.h, color: z.color, total: inside, free: inside };
  });
  return { id: plan.id, name: plan.name, cols: plan.cols, rows: plan.rows, elements: sized, seats, zones, catalog,
    summary: { bookable: usable.length, available: usable.length, booked: 0, occupied: 0, occupancy_pct: 0 } };
}
