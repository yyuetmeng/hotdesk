create table if not exists departments (
  id          uuid primary key default gen_random_uuid(),
  name        citext not null unique,
  description text check (description is null or length(description) <= 500),
  created_at  timestamptz not null default now()
);

create table if not exists user_departments (
  user_id       uuid not null references users(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, department_id)
);

create index if not exists user_departments_dept_idx on user_departments (department_id);
