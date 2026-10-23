-- seat_bookings: bookings in 30-minute blocks; rows are never deleted (statistics). Deleting a user or
-- plan keeps the row with the reference set null and the name/label snapshots intact.
-- Final shape after sql/0001-0033 (consolidated 2026-10-21). Safe to re-run.

create table if not exists seat_bookings (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid references floor_plans(id) on delete set null,
  version_id      uuid references floor_plan_versions(id) on delete set null,
  seat_id         uuid not null,
  seat_label      text,
  booking_date    date not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  preset          text check (preset in ('am', 'pm', 'full')),
  booked_for      uuid references users(id) on delete set null,
  booked_for_name text not null,
  booked_by       uuid references users(id) on delete set null,
  booked_by_name  text,
  created_at      timestamptz not null default now(),
  release_at      timestamptz not null,
  ended_at        timestamptz,
  end_reason      text check (end_reason in ('checked_in', 'cancelled', 'released', 'plan_changed')),
  cancelled_by    uuid references users(id) on delete set null,
  check (starts_at < ends_at)
);

create index if not exists seat_bookings_seat_day_idx      on seat_bookings (seat_id, booking_date);
create index if not exists seat_bookings_for_day_idx       on seat_bookings (booked_for, booking_date);
create index if not exists seat_bookings_release_due_idx   on seat_bookings (release_at) where end_reason is null;
create index if not exists seat_bookings_plan_day_idx      on seat_bookings (plan_id, booking_date);
create index if not exists seat_bookings_day_idx           on seat_bookings (booking_date);
