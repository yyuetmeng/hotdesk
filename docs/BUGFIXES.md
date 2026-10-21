# Bug fixes and checks

## 2026-10-20 · Checked-in booking blocking its seat after give-up: checked, not affected

**When and how it was found.** On 20 October 2026 (about 15:00 Singapore time), while recording the demo
video of the Node prototype (`npm run demo:video`, branch `2026-10-20-Demo`). After someone checked in on a
morning reservation and then checked out, the desk could not be reserved again for the rest of the morning:
the prototype kept the reservation `checked-in`, which still held the desk until the slot ended. Fixed in the
prototype on `2026-10-20-Demo` (commit `e7ac9ad`) and on `revamped-hotdesk`.

**This app (`webapp-backend`).** Not affected. A booking ends (`end_reason = 'checked_in'`) when its person
checks in, and the 30-minute blocks it holds (`seat_booking_blocks`) are deleted when the check-in ends:
`give_up()` and the automatic end in `settle()` both call `_free_booking_blocks()`. So the rest of the slot
is free again straight away.

**Regression test added.** `tests/test_desk_checkins.py` › `test_give_up_frees_the_rest_of_a_booked_slot`:
Jane books a morning, checks in at 08:00 and gives up at 09:30; no booking blocks are left, Carl can book the
rest of the morning and check in on that booking. It passes on the current code, and fails (10 blocks still
held) if `give_up()` stops freeing the blocks, so the bug cannot come back unnoticed. Full suite: 399 passed
(local PostgreSQL 16, time zone Asia/Singapore).
