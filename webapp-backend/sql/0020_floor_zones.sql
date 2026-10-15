-- Floor zones (spec 2026-10-15-floor-zones): a resizable outline element that groups the seats
-- inside it. Zones may be up to 80x80 cells; other types stay capped at 20 in code.
insert into floor_elements (type, label, w, h, color, resizable, config, sort_order)
values ('zone', 'Zone', 6, 4, '#3b82f6', true, '{}', 120)
on conflict (type) do nothing;

alter table floor_plan_elements drop constraint if exists floor_plan_elements_w_check;
alter table floor_plan_elements add constraint floor_plan_elements_w_check check (w between 1 and 80);
alter table floor_plan_elements drop constraint if exists floor_plan_elements_h_check;
alter table floor_plan_elements add constraint floor_plan_elements_h_check check (h between 1 and 80);
