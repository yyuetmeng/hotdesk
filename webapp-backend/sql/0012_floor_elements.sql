-- Element catalog for the floor plan builder: one row per element type with its defaults.
-- config holds the default per-element settings; its keys are the settings an element of
-- this type may carry, and each value's JSON type is the allowed type.
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

insert into floor_elements (type, label, w, h, color, resizable, config, sort_order) values
  ('wall',     'Wall',     1, 1, '#64748b', true,  '{}',                  10),
  ('seat',     'Seat',     1, 1, '#16a34a', false, '{"bookable": true}',  20),
  ('table',    'Table',    2, 1, '#ca8a04', true,  '{}',                  30),
  ('toilet',   'Toilet',   2, 2, '#0d9488', true,  '{}',                  40),
  ('elevator', 'Elevator', 2, 2, '#7c3aed', true,  '{}',                  50),
  ('stairs',   'Stairs',   2, 2, '#ea580c', true,  '{}',                  60),
  ('door',     'Door',     1, 1, '#b45309', true,  '{}',                  70),
  ('window',   'Window',   1, 1, '#7dd3fc', true,  '{}',                  80),
  ('pantry',   'Pantry',   2, 2, '#db2777', true,  '{}',                  90),
  ('plant',    'Plant',    1, 1, '#15803d', true,  '{}',                 100),
  ('corridor', 'Corridor', 1, 1, '#94a3b8', true,  '{}',                 110)
on conflict (type) do nothing;

-- Placed elements must use a catalog type; renaming a type carries through.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'floor_plan_elements_type_fkey'
                   and conrelid = 'floor_plan_elements'::regclass) then
    alter table floor_plan_elements
      add constraint floor_plan_elements_type_fkey foreign key (type)
      references floor_elements (type) on update cascade on delete restrict;
  end if;
end $$;
