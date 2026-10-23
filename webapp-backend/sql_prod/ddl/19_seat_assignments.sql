-- seat_assignments: who is assigned to which seat, until when. A row is current while closed_at is null.
-- Booking and check-in never read it.
-- Final shape after sql/0001-0033 (consolidated 2026-10-21). Safe to re-run.

create table if not exists seat_assignments (
  id            uuid primary key default gen_random_uuid(),
  seat_id       uuid not null,
  user_id       uuid references users(id) on delete set null,
  person_name   text not null,
  seat_label    text,
  plan_name     text,
  end_date      date,
  note          text check (note is null or length(note) <= 200),
  created_at    timestamptz not null default now(),
  created_by    uuid references users(id) on delete set null,
  closed_at     timestamptz,
  closed_by     uuid,
  closed_reason text check (closed_reason is null or closed_reason in ('cleared', 'moved', 'reassigned'))
);

create unique index if not exists seat_assignments_one_per_seat on seat_assignments (seat_id) where closed_at is null;
create unique index if not exists seat_assignments_one_per_user on seat_assignments (user_id) where closed_at is null;
