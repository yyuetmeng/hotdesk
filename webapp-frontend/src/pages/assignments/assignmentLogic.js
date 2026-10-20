// Pure helpers for seat assignments (admin page, Insights card, floor plates).
export const STATUS_TEXT = { assigned: 'Assigned', leaving_soon: 'Leaving soon', left: 'Left' };
const TONE = { assigned: 'ok', leaving_soon: 'soon', left: 'left' };
const RANK = { left: 0, leaving_soon: 1, assigned: 2 };

// First word of the name, at most 10 characters (9 plus an ellipsis when cut).
export function plateName(fullName) {
  const first = String(fullName ?? '').trim().split(/\s+/)[0] ?? '';
  return first.length > 10 ? `${first.slice(0, 9)}…` : first;
}

// 'yyyy-mm-dd' -> 'dd/MM'
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}` : '';
}

function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export function seatNotes(items) {
  const out = {};
  for (const it of items ?? []) {
    if (it.seat_removed) continue;
    out[it.seat_id] = {
      name: plateName(it.person_name),
      date: shortDate(it.end_date),
      tone: TONE[it.status] ?? 'ok',
      tip: [`${it.seat_label} · ${it.person_name}`, it.end_date ? `Until ${longDate(it.end_date)}` : 'No end date'],
    };
  }
  return out;
}

const byLabel = (a, b) => String(a.seat_label).localeCompare(String(b.seat_label), undefined, { numeric: true });

export function sortRows(rows, key) {
  const rank = (r) => (r.assignment ? RANK[r.assignment.status] ?? 2 : 3);
  const date = (r) => r.assignment?.end_date || '9999-99-99';   // no date goes last
  const pick = key === 'end_date' ? date : rank;
  return [...rows].sort((a, b) => {
    const x = pick(a), y = pick(b);
    return (x < y ? -1 : x > y ? 1 : 0) || byLabel(a, b);
  });
}

export function tableRows(seats, items, assignedOnly) {
  const bySeat = Object.fromEntries((items ?? []).filter((i) => !i.seat_removed).map((i) => [i.seat_id, i]));
  const rows = [...(seats ?? [])]
    .map((s) => ({ seat_id: s.id, seat_label: s.label, assignment: bySeat[s.id] ?? null }))
    .sort(byLabel);
  const removed = (items ?? []).filter((i) => i.seat_removed)
    .map((i) => ({ seat_id: i.seat_id, seat_label: i.seat_label, assignment: i }))
    .sort(byLabel);
  return [...(assignedOnly ? rows.filter((r) => r.assignment) : rows), ...removed];
}

export const moveQuestion = (fullName, from, to) => `Move ${fullName} from ${from} to ${to}?`;
export const replaceQuestion = (oldName, newName, label) => `Replace ${oldName} with ${newName} on ${label}?`;

export function cardRows(items) {
  return (items ?? []).map((it) => ({
    id: it.id, seat_id: it.seat_id, plan_id: it.plan_id, person_name: it.person_name, seat_label: it.seat_label,
    plan_name: it.plan_name, end_date: it.end_date, status: it.status,
    link: it.seat_removed || !it.plan_id
      ? `/seat-assignments?assignment=${it.id}`
      : `/seat-assignments?floor=${it.plan_id}&seat=${it.seat_id}`,
  }));
}
