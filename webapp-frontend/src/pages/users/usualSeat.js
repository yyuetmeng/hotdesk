// Usual seat picker for Manage Users (spec 2026-10-16-usual-seat-and-auto-book §1): the seats of published
// floors (from GET /api/public/floors/<id>), grouped by floor.

const byText = (a, b) => a.localeCompare(b, undefined, { numeric: true });

/** [{ plan, seats: [{ id, text: "A1 · <project team>" }] }], floors and seats A-Z. */
export const seatGroups = (floors) => [...floors].sort((a, b) => byText(a.name, b.name)).map((f) => ({
  plan: f.name,
  seats: [...f.seats].sort((a, b) => byText(a.label, b.label))
    .map((s) => ({ id: s.id, text: `${s.label} · ${s.department ?? 'No project team'}` })),
}));

/** "A1 · Level 1" for a seat id, or null when it is not on a published floor. */
export function seatName(floors, seatId) {
  if (!seatId) return null;
  for (const f of floors) {
    const seat = f.seats.find((s) => s.id === seatId);
    if (seat) return `${seat.label} · ${f.name}`;
  }
  return null;
}
