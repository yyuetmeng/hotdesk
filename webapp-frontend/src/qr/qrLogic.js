// Pure helpers for the seat QR code page: one row per published seat, filters, and file names.
// Filters: floor id | 'all'; zone name | 'none' | 'all'; team name | 'open' (free for all) | 'none' | 'all'.

const FREE_FOR_ALL = 'Free for all';  // what GET /api/public/floors/<id> puts in seat.department

const inside = (zone, seat) => seat.x >= zone.x && seat.x < zone.x + zone.w && seat.y >= zone.y && seat.y < zone.y + zone.h;

/** Rows for a published floor payload (public floor endpoint). */
export function seatRows(floor) {
  return floor.seats.map((seat) => ({
    id: seat.id, label: seat.label, floorId: floor.id, floorName: floor.name,
    zone: (floor.zones ?? []).find((z) => inside(z, seat))?.name ?? null,
    team: seat.department ?? null,
  }));
}

const sorted = (values) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

export const zoneOptions = (rows) => sorted(rows.map((r) => r.zone).filter(Boolean));
export const teamOptions = (rows) => sorted(rows.map((r) => r.team).filter((t) => t && t !== FREE_FOR_ALL));

// label: 'all' | 'new' (never downloaded) | 'downloaded'; `downloaded` is the set of downloaded seat ids (null while loading).
export function filterRows(rows, { floor, zone, team, q, label = 'all' }, downloaded = null) {
  const needle = (q ?? '').trim().toLowerCase();
  const labelOk = (r) => label === 'all' || (Boolean(downloaded) && (label === 'new') !== downloaded.has(r.id));
  return rows.filter((r) => labelOk(r) && (floor === 'all' || r.floorId === floor)
    && (zone === 'all' || (zone === 'none' ? r.zone === null : r.zone === zone))
    && (team === 'all' || (team === 'none' ? r.team === null : team === 'open' ? r.team === FREE_FOR_ALL : r.team === team))
    && (!needle || r.label.toLowerCase().includes(needle)));
}

const safe = (text) => String(text).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'seat';

/** "<floor>_<seat>.png" for each row, with -2, -3… added so names are unique inside one zip. */
export function labelFileNames(rows) {
  const used = new Map();
  return rows.map((r) => {
    const base = `${safe(r.floorName)}_${safe(r.label)}`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return `${base}${n > 1 ? `-${n}` : ''}.png`;
  });
}

/** Labels grouped by floor, then zone (by name, "No zone" last), floors in the order given (owner 2026-10-16). */
export function groupByZone(rows) {
  const floors = [], byKey = new Map();
  rows.forEach((r) => {
    if (!floors.includes(r.floorId)) floors.push(r.floorId);
    const key = `${r.floorId}|${r.zone ?? ''}`;
    if (!byKey.has(key)) byKey.set(key, { key, floorId: r.floorId, floorName: r.floorName, zone: r.zone, rows: [] });
    byKey.get(key).rows.push(r);
  });
  const rank = (g) => [floors.indexOf(g.floorId), g.zone === null ? 1 : 0];
  return [...byKey.values()].sort((a, b) => {
    const [fa, na] = rank(a), [fb, nb] = rank(b);
    return fa - fb || na - nb || (a.zone ?? '').localeCompare(b.zone ?? '');
  });
}

/** ZIP paths: "<floor>/<zone or No-zone>/<floor>_<seat>.png", with -2, -3… so names are unique in each folder. */
export function labelZipPaths(rows) {
  const used = new Map();
  return rows.map((r) => {
    const base = `${safe(r.floorName)}/${safe(r.zone ?? 'No zone')}/${safe(r.floorName)}_${safe(r.label)}`;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return `${base}${n > 1 ? `-${n}` : ''}.png`;
  });
}

/** "New" until any admin has downloaded the label; while the list is still loading (null) show nothing. */
export const isNewLabel = (downloaded, seatId) => Boolean(downloaded) && !downloaded.has(seatId);

/** A new set with these seats marked downloaded (leaves the original untouched). */
export const withDownloaded = (downloaded, seatIds) => new Set([...(downloaded ?? []), ...seatIds]);
