-- Seat booking and check-in (docs/superpowers/specs/2026-10-15-seat-booking-and-checkin-design.md §4).
-- Bookings hold 30-minute blocks; rows are never deleted (statistics). Deleting a user or plan
-- keeps the rows with the reference set null and name/label snapshots intact.

alter table users
  add column if not exists booking_allowance smallint not null default 0
    check (booking_allowance between 0 and 20);

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
create index if not exists seat_bookings_seat_day_idx on seat_bookings (seat_id, booking_date);
create index if not exists seat_bookings_for_day_idx on seat_bookings (booked_for, booking_date);

-- The 30-minute blocks an active booking holds; deleted when the booking ends.
create table if not exists seat_booking_blocks (
  booking_id  uuid not null references seat_bookings(id) on delete cascade,
  seat_id     uuid not null,
  block_start timestamptz not null,
  booked_for  uuid references users(id) on delete cascade,
  primary key (booking_id, block_start),
  unique (seat_id, block_start),
  unique (booked_for, block_start)
);

create table if not exists seat_checkins (
  id                  uuid primary key default gen_random_uuid(),
  plan_id             uuid references floor_plans(id) on delete set null,
  version_id          uuid references floor_plan_versions(id) on delete set null,
  seat_id             uuid not null,
  seat_label          text,
  user_id             uuid references users(id) on delete set null,
  user_name           text not null,
  checked_in_at       timestamptz not null default now(),
  ends_at             timestamptz not null,
  checked_out_at      timestamptz,
  end_reason          text check (end_reason in ('given_up', 'auto', 'plan_changed')),
  booking_id          uuid references seat_bookings(id) on delete set null,
  method              text not null check (method in ('walk_in', 'booking')),
  seat_department_id  uuid references departments(id) on delete set null,
  seat_open_to_all    boolean not null default false,
  user_department_ids uuid[] not null default '{}'
);
-- One open check-in per seat and per person (open = not checked out yet).
create unique index if not exists seat_checkins_open_seat_idx on seat_checkins (seat_id) where checked_out_at is null;
create unique index if not exists seat_checkins_open_user_idx on seat_checkins (user_id)
  where checked_out_at is null and user_id is not null;
create index if not exists seat_checkins_seat_time_idx on seat_checkins (seat_id, checked_in_at);
