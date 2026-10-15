// Seat selection and department tags for the floor plan editor (pure helpers).
// Spec: docs/superpowers/specs/2026-10-15-seat-department-tags-design.md
// A tag is 'none', 'all' (free for all departments) or a department id.
import { sizeOf } from './palette.js';

export const isSeat = (el) => el.type === 'seat';

/** Ids of seats whose footprint lies fully inside the inclusive cell box (corners in any order). */
export function seatsInBox(elements, { x1, y1, x2, y2 }) {
  const [left, right] = [Math.min(x1, x2), Math.max(x1, x2)];
  const [top, bottom] = [Math.min(y1, y2), Math.max(y1, y2)];
  return elements.filter((el) => {
    if (!isSeat(el)) return false;
    const { w, h } = sizeOf(el);
    return el.x >= left && el.y >= top && el.x + w - 1 <= right && el.y + h - 1 <= bottom;
  }).map((el) => el.id);
}

/** Ctrl/Shift-click: add or remove a seat; anything else leaves the selection as it is. */
export function toggleSelection(ids, el) {
  if (!isSeat(el)) return ids;
  return ids.includes(el.id) ? ids.filter((id) => id !== el.id) : [...ids, el.id];
}

export function tagOf(el) {
  if (el.open_to_all) return 'all';
  return el.department_id || 'none';
}

/** New elements array with the tag applied to the selected seats (one undo step). */
export function setTag(elements, ids, tag) {
  const chosen = new Set(ids);
  const fields = tag === 'all' ? { department_id: null, open_to_all: true }
    : tag === 'none' ? { department_id: null, open_to_all: false }
      : { department_id: tag, open_to_all: false };
  return elements.map((el) => (chosen.has(el.id) && isSeat(el) ? { ...el, ...fields } : el));
}

/** The tag all selected seats share, or 'mixed'. */
export function sharedTag(elements, ids) {
  const chosen = new Set(ids);
  const tags = new Set(elements.filter((el) => chosen.has(el.id) && isSeat(el)).map(tagOf));
  return tags.size === 1 ? [...tags][0] : 'mixed';
}

export const countUntagged = (elements) => elements.filter((el) => isSeat(el) && tagOf(el) === 'none').length;

// Distinct from the element catalog colours, readable as a small marker on any element colour.
const DEPARTMENT_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4',
  '#f032e6', '#bfef45', '#469990', '#9a6324', '#800000', '#000075'];

/** Stable colour per department (hash of its id), so it matches across plans and sessions. */
export function departmentColor(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return DEPARTMENT_COLORS[hash % DEPARTMENT_COLORS.length];
}

/** Ctrl/Shift-click on an element: non-seats leave the selection unchanged (spec §3); a seat is
 * toggled within the seats already selected (a single selected non-seat gives way to it). */
export function ctrlClickSelection(ids, elements, el) {
  if (!isSeat(el)) return ids;
  const seatIds = ids.filter((id) => elements.some((e) => e.id === id && isSeat(e)));
  return toggleSelection(seatIds, el);
}
