# Bug fixes

## 2026-10-20 · A reservation kept its desk blocked after the person checked out

**When and how it was found.** On 20 October 2026 (about 15:00 Singapore time), while recording the demo
video with `npm run demo:video` on branch `2026-10-20-Demo`. To redo the booking scene, desk L1-DF-07, which
had been reserved for the morning and then checked in to, was checked out so it could be booked again. The
booking page still showed it as *Reserved* for the morning and would not take a new reservation. The
recording script waited for the desk to come free, and it never did until the slot ended.

**Cause.** Checking in on a reservation marks it `checked-in`, and a `checked-in` reservation still counts as
holding its desk for the slot. Checking out (and every other way a desk is released: the check-in expiring,
the person moving to another desk, an automatic release) cleared the desk but left the reservation
`checked-in` until the slot ended.

**Effect.** Nobody else could reserve the desk for the rest of the slot (up to six hours for a full day), even
though the floor plan showed it free. Walk-in check-ins by QR code still worked. Present since reservations
were added on 8 October 2026 (commit `56a5149`).

**Fix.** When a person's desk is released, their `checked-in` reservation for that desk is marked
`completed` (with `endedAt`), so the rest of the slot can be reserved again. It still counts toward the
5-reservations-a-week limit. Change: `#release()` in `src/occupancy.js`.

**Test.** `test/reservations.test.js` › *checking out ends the reservation: the rest of the slot can be
reserved again*. It fails without the fix (the reservation stays `checked-in`) and passes with it.

**Branches.** `2026-10-20-Demo` (commit `e7ac9ad`, 20 Oct 2026) and `revamped-hotdesk` (21 Oct 2026). `prod-hotdesk`
(the Python/PostgreSQL app) was checked and is not affected; a regression test was added there.
