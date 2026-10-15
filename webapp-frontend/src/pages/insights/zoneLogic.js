// Pure helpers for the "Utilisation by zone" card (spec 2026-10-15-floor-zones §6).

const share = (part, total) => `${total ? Number(((100 * part) / total).toFixed(2)) : 0}%`;

/** Widths of the occupied and booked bar segments, as CSS percentages of the zone's usable seats. */
export const barWidths = (row) => ({ occupied: share(row.occupied, row.total), booked: share(row.booked, row.total) });

/** The in-use percentage, or a dash for a zone without usable seats. */
export const pctText = (row) => (row.pct === null || row.pct === undefined ? '—' : `${row.pct}%`);

/** True when no published floor has a zone yet: show the "No zones yet" hint instead of rows (spec §6). */
export const showNoZones = (data) => !data.has_zones;
