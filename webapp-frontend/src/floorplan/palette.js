// Element catalog. Source of truth is the floor_elements table, served by
// GET /api/admin/floor-plans/catalog; the editor calls setCatalog() before rendering.
// These are live bindings: importers always see the latest catalog.
export let CATALOG = [];
export let catalogByType = {};

export function setCatalog(items) {
  CATALOG = items;
  catalogByType = Object.fromEntries(items.map((c) => [c.type, c]));
}

export const MAX_ELEMENT_SIZE = 20;

export const isResizable = (type) => catalogByType[type]?.resizable !== false;

export function effectiveSize(type, rotation) {
  const { w, h } = catalogByType[type];
  return rotation === 90 || rotation === 270 ? { w: h, h: w } : { w, h };
}

/** Unrotated size of a placed element: its own w/h, or the catalog default (always for fixed types). */
export function baseSize(el) {
  const entry = catalogByType[el.type];
  if (!isResizable(el.type)) return { w: entry.w, h: entry.h };
  return { w: el.w ?? entry.w, h: el.h ?? entry.h };
}

/** Footprint of a placed element on the grid, with rotation applied. */
export function sizeOf(el) {
  const { w, h } = baseSize(el);
  return el.rotation === 90 || el.rotation === 270 ? { w: h, h: w } : { w, h };
}
