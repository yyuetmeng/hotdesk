-- departments: project teams. color null = automatic marker colour; seats_required null = not set; seats_planned null = as allocated; rows in data/01_departments.sql.
-- Final shape after sql/0001-0033 (consolidated 2026-10-21). Safe to re-run.

create table if not exists departments (
  id          uuid primary key default gen_random_uuid(),
  name        citext not null unique,
  description text check (description is null or length(description) <= 500),
  created_at  timestamptz not null default now(),
  color       text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  seats_required smallint check (seats_required is null or seats_required between 0 and 500),
  seats_planned  smallint check (seats_planned is null or seats_planned between 0 and 500)
);
