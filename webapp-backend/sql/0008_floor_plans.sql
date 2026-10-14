create table if not exists floor_plans (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(name) between 1 and 120),
  cols       int  not null check (cols between 5 and 80),
  rows       int  not null check (rows between 5 and 80),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists floor_plan_elements (
  id       uuid primary key default gen_random_uuid(),
  plan_id  uuid not null references floor_plans(id) on delete cascade,
  type     text not null,
  x        int  not null check (x >= 0),
  y        int  not null check (y >= 0),
  w        smallint not null check (w between 1 and 20),
  h        smallint not null check (h between 1 and 20),
  rotation smallint not null default 0 check (rotation in (0, 90, 180, 270)),
  label    text check (label is null or length(label) <= 60),
  color    text check (color is null or color ~ '^#[0-9a-fA-F]{6}$')
);

create index if not exists floor_plan_elements_plan_idx on floor_plan_elements (plan_id);
