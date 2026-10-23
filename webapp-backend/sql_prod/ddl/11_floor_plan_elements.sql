-- floor_plan_elements: the draft's elements. A seat's id is its permanent seat id (QR links, bookings).
-- Zones may be up to 80x80 cells; other types are capped at 20 in code.
-- Final shape after sql/0001-0033 (consolidated 2026-10-21). Safe to re-run.

create table if not exists floor_plan_elements (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references floor_plans(id) on delete cascade,
  type          text not null,
  x             int  not null check (x >= 0),
  y             int  not null check (y >= 0),
  w             smallint not null check (w between 1 and 80),
  h             smallint not null check (h between 1 and 80),
  rotation      smallint not null default 0 check (rotation in (0, 90, 180, 270)),
  label         text check (label is null or length(label) <= 60),
  color         text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  config        jsonb not null default '{}'::jsonb,
  department_id uuid references departments(id) on delete set null,
  open_to_all   boolean not null default false,
  constraint floor_plan_elements_type_fkey foreign key (type)
    references floor_elements (type) on update cascade on delete restrict,
  constraint floor_plan_elements_tag_chk check (not (open_to_all and department_id is not null))
);

create index if not exists floor_plan_elements_plan_idx on floor_plan_elements (plan_id);
create index if not exists floor_plan_elements_dept_idx on floor_plan_elements (department_id) where department_id is not null;
