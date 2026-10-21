-- floor_plan_versions: each publish snapshots the draft into an immutable numbered version.
-- Final shape after sql/0001-0031 (consolidated 2026-10-21). Safe to re-run.

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

-- The floor's live version (floor_plans was created before this table existed).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'floor_plans_published_version_id_fkey'
                   and conrelid = 'floor_plans'::regclass) then
    alter table floor_plans add constraint floor_plans_published_version_id_fkey
      foreign key (published_version_id) references floor_plan_versions(id) on delete set null;
  end if;
end $$;

create index if not exists floor_plans_published_idx on floor_plans (published_version_id) where published_version_id is not null;
