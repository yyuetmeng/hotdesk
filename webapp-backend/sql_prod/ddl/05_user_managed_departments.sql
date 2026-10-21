-- user_managed_departments: which project teams an account manager may manage accounts for.
-- Final shape after sql/0001-0031 (consolidated 2026-10-21). Safe to re-run.

create table if not exists user_managed_departments (
  user_id       uuid not null references users(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, department_id)
);
