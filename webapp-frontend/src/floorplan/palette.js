export const CATALOG = [
  { type: 'wall', label: 'Wall', w: 1, h: 1, color: '#64748b' },
  { type: 'seat', label: 'Seat', w: 1, h: 1, color: '#16a34a' },
  { type: 'toilet', label: 'Toilet', w: 2, h: 2, color: '#0d9488' },
  { type: 'elevator', label: 'Elevator', w: 2, h: 2, color: '#7c3aed' },
  { type: 'door', label: 'Door', w: 1, h: 1, color: '#b45309' },
  { type: 'meeting_room', label: 'Meeting room', w: 3, h: 2, color: '#2563eb' },
  { type: 'kitchen', label: 'Kitchen', w: 2, h: 2, color: '#db2777' },
  { type: 'plant', label: 'Plant', w: 1, h: 1, color: '#15803d' },
  { type: 'corridor', label: 'Corridor', w: 1, h: 1, color: '#94a3b8' },
];

export const catalogByType = Object.fromEntries(CATALOG.map((c) => [c.type, c]));

export function effectiveSize(type, rotation) {
  const { w, h } = catalogByType[type];
  return rotation === 90 || rotation === 270 ? { w: h, h: w } : { w, h };
}
