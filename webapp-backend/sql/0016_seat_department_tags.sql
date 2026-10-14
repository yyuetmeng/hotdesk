-- Seat department tags: one department/group, free for all, or none (untagged = not bookable).
-- Spec: docs/superpowers/specs/2026-10-15-seat-department-tags-design.md
alter table floor_plan_elements
  add column if not exists department_id uuid references departments(id) on delete set null,
  add column if not exists open_to_all boolean not null default false;

alter table floor_plan_version_elements
  add column if not exists department_id uuid references departments(id) on delete set null,
  add column if not exists open_to_all boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'floor_plan_elements_tag_chk'
                   and conrelid = 'floor_plan_elements'::regclass) then
    alter table floor_plan_elements add constraint floor_plan_elements_tag_chk
      check (not (open_to_all and department_id is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'floor_plan_version_elements_tag_chk'
                   and conrelid = 'floor_plan_version_elements'::regclass) then
    alter table floor_plan_version_elements add constraint floor_plan_version_elements_tag_chk
      check (not (open_to_all and department_id is not null));
  end if;
end $$;

-- "Allow booking" is replaced by the tag: drop the seat's bookable setting.
update floor_elements set config = config - 'bookable' where type = 'seat';
update floor_plan_elements set config = config - 'bookable' where config ? 'bookable';
