-- Per-type element settings, e.g. {"bookable": true} for seats.
alter table floor_plan_elements
  add column if not exists config jsonb not null default '{}'::jsonb;
