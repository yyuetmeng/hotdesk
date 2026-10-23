-- floor_plan_version_elements: a published version's elements; element_id is the draft element's id,
-- so a seat keeps one identity across versions.
-- Final shape after sql/0001-0033 (consolidated 2026-10-21). Safe to re-run.

create table if not exists floor_plan_version_elements (
  version_id    uuid not null references floor_plan_versions(id) on delete cascade,
  element_id    uuid not null,
  type          text not null references floor_elements(type) on update cascade,
  x             int not null,
  y             int not null,
  w             smallint not null,
  h             smallint not null,
  rotation      smallint not null,
  label         text,
  color         text,
  config        jsonb not null default '{}'::jsonb,
  department_id uuid references departments(id) on delete set null,
  open_to_all   boolean not null default false,
  primary key (version_id, element_id),
  constraint floor_plan_version_elements_tag_chk check (not (open_to_all and department_id is not null))
);

create index if not exists floor_plan_version_elements_dept_idx on floor_plan_version_elements (department_id)
  where department_id is not null;
