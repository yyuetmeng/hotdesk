-- floor_elements: the element catalog (one row per type with its defaults); rows in dml/02.
-- config holds the default per-element settings: its keys are the settings an element of this type may carry,
-- and each value's JSON type is the allowed type.
-- Final shape after sql/0001-0031 (consolidated 2026-10-21). Safe to re-run.

create table if not exists floor_elements (
  type       text primary key check (type ~ '^[a-z][a-z0-9_]{0,39}$'),
  label      text not null check (length(label) between 1 and 60),
  w          smallint not null check (w between 1 and 20),
  h          smallint not null check (h between 1 and 20),
  color      text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  resizable  boolean not null default true,
  config     jsonb not null default '{}'::jsonb,
  sort_order smallint not null default 0
);
