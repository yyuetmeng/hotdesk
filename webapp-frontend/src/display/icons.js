// Line icons on a 24x24 box (stroke-based, one consistent style; no icon dependency).
// Chosen in brainstorming as drawing style "E" (spec 2026-10-15-floor-dashboard §2).
export const ICONS = {
  seat: 'M7 18v3M17 18v3M6 12h12v6H6zM8 12V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v7',
  table: 'M3 9h18M5 9v11M19 9v11M3 9l2-4h14l2 4',
  sofa: 'M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3M3 11h18v5H3zM5 16v2M19 16v2',
  locker: 'M6 3h12v18H6zM12 3v18M9 10h1M14 10h1',
  door: 'M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M4 21h16M14 12h.01',
  window: 'M4 4h16v16H4zM12 4v16M4 12h16',
  toilet: 'M7 3h6v6H7zM5 9h12a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4zM8 13l-1 8h8l-1-8',
  stairs: 'M3 20h5v-5h5v-5h5V5h3',
  elevator: 'M5 3h14v18H5zM9 10l3-3 3 3M9 14l3 3 3-3',
  pantry: 'M4 8h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 4h-2M8 2v3M12 2v3',
  plant: 'M12 21v-9M12 12c0-4 3-7 7-7 0 4-3 7-7 7zM12 15c0-3-2-5-5-5 0 3 2 5 5 5zM8 21h8',
  corridor: 'M4 12h14M14 8l4 4-4 4',
  wall: 'M3 5h18v14H3zM3 12h18M9 5v7M15 12v7',
};

/** SVG group drawing icon `name` centred at (cx, cy) with the given size and colour. */
export function iconPath(name) {
  return ICONS[name] ?? null;
}
