-- floor_plans: one row per floor (the draft). published_version_id gets its foreign key in
-- 12_floor_plan_versions.sql, because the versions table refers back to this one.
-- Final shape after sql/0001-0031 (consolidated 2026-10-21). Safe to re-run.

create table if not exists floor_plans (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (length(name) between 1 and 120),
  cols                 int  not null check (cols between 5 and 80),
  rows                 int  not null check (rows between 5 and 80),
  created_by           uuid references users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  published_version_id uuid,
  draft_changed_at     timestamptz,
  unpublished_at       timestamptz
);
