-- Team account managers (spec 2026-10-19-team-account-management): which project teams a user may manage accounts for.
create table if not exists user_managed_departments (
  user_id       uuid not null references users(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, department_id)
);
