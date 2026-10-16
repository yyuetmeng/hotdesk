// Scan QR code (owner 2026-10-16): desk labels encode <site>/checkin/<seat id> (Print Desk Labels). Only the seat
// id is used, and the app opens its own check-in page for it — never the scanned site — so a label printed from
// another address still works and a foreign QR code cannot send anyone elsewhere.
const SEAT = /\/checkin\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i;

/** The seat id in a scanned QR code, or null when it is not a Hot Desk seat label. */
export function seatFromCode(text) {
  const match = SEAT.exec(String(text ?? '').trim());
  return match ? match[1].toLowerCase() : null;
}
