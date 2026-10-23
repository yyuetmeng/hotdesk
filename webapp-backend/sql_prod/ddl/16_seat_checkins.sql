-- seat_checkins: check-ins (walk-in or from a booking). Location columns are kept for later vicinity
-- checks and are not returned by any endpoint; location_status: captured | denied | unavailable | unsupported |
-- timeout | invalid, null = the app sent nothing.
-- Final shape after sql/0001-0033 (consolidated 2026-10-21). Safe to re-run.

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
  user_department_ids uuid[] not null default '{}',
  location_lat        double precision,
  location_lng        double precision,
  location_accuracy_m real,
  location_at         timestamptz,
  location_status     text
);

-- One open check-in per seat and per person (open = not checked out yet).
create unique index if not exists seat_checkins_open_seat_idx on seat_checkins (seat_id) where checked_out_at is null;
create unique index if not exists seat_checkins_open_user_idx on seat_checkins (user_id)
  where checked_out_at is null and user_id is not null;
create index if not exists seat_checkins_seat_time_idx on seat_checkins (seat_id, checked_in_at);
create index if not exists seat_checkins_end_due_idx   on seat_checkins (ends_at) where checked_out_at is null;
create index if not exists seat_checkins_user_time_idx on seat_checkins (user_id, checked_in_at desc);
create index if not exists seat_checkins_time_idx      on seat_checkins (checked_in_at desc);
create index if not exists seat_checkins_out_idx       on seat_checkins (checked_out_at desc) where checked_out_at is not null;
create index if not exists seat_checkins_booking_idx   on seat_checkins (booking_id) where booking_id is not null;
