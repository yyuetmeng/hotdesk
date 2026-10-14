-- Floor plan publishing: each publish snapshots the draft (floor_plans + floor_plan_elements)
-- into an immutable numbered version. element_id keeps the draft element's id, so a seat
-- keeps one identity across versions.
create table if not exists floor_plan_versions (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references floor_plans(id) on delete cascade,
  version      int  not null,
  name         text not null,
  cols         int  not null,
  rows         int  not null,
  published_at timestamptz not null default now(),
  published_by uuid references users(id) on delete set null,
  unique (plan_id, version)
);

create table if not exists floor_plan_version_elements (
  version_id uuid not null references floor_plan_versions(id) on delete cascade,
  element_id uuid not null,
  type       text not null references floor_elements(type) on update cascade,
  x int not null, y int not null, w smallint not null, h smallint not null,
  rotation smallint not null, label text, color text,
  config jsonb not null default '{}'::jsonb,
  primary key (version_id, element_id)
);

alter table floor_plans add column if not exists published_version_id uuid
  references floor_plan_versions(id) on delete set null;
alter table floor_plans add column if not exists draft_changed_at timestamptz;
alter table floor_plans add column if not exists unpublished_at timestamptz;
