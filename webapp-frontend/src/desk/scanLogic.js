// Scan QR code (owner 2026-10-16): desk labels encode <site>/checkin/<seat id> (Print Desk Labels). Only the seat
// id is used, and the app opens its own check-in page for it — never the scanned site — so a label printed from
// another address still works and a foreign QR code cannot send anyone elsewhere.
const SEAT = /\/checkin\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;

/** Checking in needs a scan (owner 2026-10-23): a seat page checks in only when it was opened by scanning its QR code,
 * either with the phone's camera (the page loads fresh, so the router location key is 'default') or with the in-app
 * scanner / sign-in on the way back from a scan (state.scanned). Links inside the app only show the seat. */
export const openedByScan = (location) => location?.state?.scanned === true || location?.key === 'default';

/** The seat id in a scanned QR code, or null when it is not a Hot Desk seat label. */
export function seatFromCode(text) {
  const match = SEAT.exec(String(text ?? '').trim());
  return match ? match[1].toLowerCase() : null;
}

/** Which result screen the check-in page shows (owner 2026-10-16): { kind: 'ok' | 'bad' | 'done', ... } or null.
 * `result` is what just happened here: { kind: 'checked_in', checkin, warning } | { kind: 'gave_up' } | { kind: 'error', text, suggestion }.
 * A 'bad' outcome carries `suggestion` (a free team seat to go to instead) or null. */
export function checkInOutcome({ seat, result }) {
  if (result?.kind === 'checked_in') return { kind: 'ok', title: "You're checked in", checkin: result.checkin, note: result.warning ?? null };
  if (result?.kind === 'gave_up') return { kind: 'done', title: 'Seat given up', note: 'Thanks for freeing it up.' };
  if (result?.kind === 'error') return { kind: 'bad', title: 'Could not check in', reason: result.text, suggestion: result.suggestion ?? null };
  if (seat?.my_checkin) return { kind: 'ok', title: "You're checked in here", checkin: seat.my_checkin, note: null };
  if (seat && !seat.can_check_in && !seat.can_give_up && seat.reason) return { kind: 'bad', title: 'Could not check in', reason: seat.reason, suggestion: seat.suggestion ?? null };
  return null;
}
