-- users: accounts. usual_seat_id is a permanent seat id (floor plan element id), not a foreign key.
-- Final shape after sql/0001-0031 (consolidated 2026-10-21). Safe to re-run.

create table if not exists users (
  id                uuid primary key default gen_random_uuid(),
  email             citext not null unique,
  username          citext not null unique,
  full_name         text not null check (length(full_name) between 1 and 200),
  password_hash     text,
  role_id           smallint not null references roles(id) on delete restrict,
  is_active         boolean not null default true,
  start_date        date,
  end_date          date,
  failed_attempts   smallint not null default 0 check (failed_attempts between 0 and 5),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  booking_allowance smallint not null default 0 check (booking_allowance between 0 and 20),
  usual_seat_id     uuid,
  auto_book         boolean not null default false,
  constraint users_date_range_chk check (start_date is null or end_date is null or start_date <= end_date)
);

create index if not exists users_role_id_idx        on users (role_id);
create index if not exists users_is_active_idx      on users (is_active);
create index if not exists users_email_trgm_idx     on users using gin (email gin_trgm_ops);
create index if not exists users_username_trgm_idx  on users using gin (username gin_trgm_ops);
create index if not exists users_full_name_trgm_idx on users using gin (full_name gin_trgm_ops);
