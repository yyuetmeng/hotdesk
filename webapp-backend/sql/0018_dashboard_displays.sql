-- Public floor displays for wall-mounted TVs (docs/superpowers/specs/2026-10-15-floor-dashboard-design.md §4).
create table if not exists dashboard_displays (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  name           text not null check (length(name) between 1 and 80),
  plan_ids       uuid[] not null default '{}',
  show_overall   boolean not null default true,
  layout         text not null default 'rotate' check (layout in ('rotate', 'grid')),
  rotate_seconds smallint not null default 20 check (rotate_seconds between 10 and 120),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
