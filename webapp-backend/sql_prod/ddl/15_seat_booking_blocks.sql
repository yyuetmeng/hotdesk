-- seat_booking_blocks: the 30-minute blocks an active booking holds; deleted when the booking ends.
-- The unique keys stop a seat or a person being double-booked.
-- Final shape after sql/0001-0031 (consolidated 2026-10-21). Safe to re-run.

create table if not exists seat_booking_blocks (
  booking_id  uuid not null references seat_bookings(id) on delete cascade,
  seat_id     uuid not null,
  block_start timestamptz not null,
  booked_for  uuid references users(id) on delete cascade,
  primary key (booking_id, block_start),
  unique (seat_id, block_start),
  unique (booked_for, block_start)
);
