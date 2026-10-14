import { effectiveSize } from './palette.js';

export function cellsOf(el) {
  const { w, h } = effectiveSize(el.type, el.rotation || 0);
  const cells = [];
  for (let dx = 0; dx < w; dx += 1) for (let dy = 0; dy < h; dy += 1) cells.push([el.x + dx, el.y + dy]);
  return cells;
}

export function placementError(el, elements, cols, rows) {
  if (!el.type) return 'unknown type';
  const { w, h } = effectiveSize(el.type, el.rotation || 0);
  if (el.x < 0 || el.y < 0 || el.x + w > cols || el.y + h > rows) return 'outside the grid';
  const occupied = new Set();
  for (const other of elements) {
    if (other.id === el.id) continue;
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
  const rotated = { ...current, rotation: ((current.rotation || 0) + 90) % 360 };
  const error = placementError(rotated, elements, cols, rows);
  if (error) return { elements, error };
  return { elements: elements.map((e) => (e.id === id ? rotated : e)), error: null };
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
      const key = `${cx},${cy}`;
      if (seen.has(key)) problems.push(`element ${i} (${el.type}) overlaps element ${seen.get(key)}`);
      else seen.set(key, i);
    }
  });
  return [...new Set(problems)];
}
