-- floor_elements: the element catalog. config = the settings each type may carry, with defaults
-- (toilet gender: unisex | male | female; door swing: up-left ... right-bottom). Re-running resets the catalog.
-- Final rows after sql/0001-0033 (consolidated 2026-10-21). Safe to re-run.

insert into floor_elements (type, label, w, h, color, resizable, config, sort_order) values
  ('wall', 'Wall', 1, 1, '#64748b', true, '{}', 10),
  ('seat', 'Seat', 1, 1, '#16a34a', false, '{}', 20),
  ('table', 'Table', 2, 1, '#ca8a04', true, '{}', 30),
  ('sofa', 'Sofa', 2, 1, '#4f46e5', true, '{}', 35),
  ('locker', 'Locker', 1, 1, '#0e7490', true, '{}', 37),
  ('toilet', 'Toilet', 2, 2, '#0d9488', true, '{"gender": "unisex"}', 40),
  ('elevator', 'Elevator', 2, 2, '#7c3aed', true, '{}', 50),
  ('stairs', 'Stairs', 2, 2, '#ea580c', true, '{}', 60),
  ('door', 'Door', 1, 1, '#b45309', true, '{"swing": "up-left"}', 70),
  ('window', 'Window', 1, 1, '#7dd3fc', true, '{}', 80),
  ('pantry', 'Pantry', 2, 2, '#db2777', true, '{}', 90),
  ('plant', 'Plant', 1, 1, '#15803d', true, '{}', 100),
  ('corridor', 'Corridor', 1, 1, '#94a3b8', true, '{}', 110),
  ('zone', 'Zone', 6, 4, '#3b82f6', true, '{}', 120)
on conflict (type) do update set label = excluded.label, w = excluded.w, h = excluded.h, color = excluded.color,
  resizable = excluded.resizable, config = excluded.config, sort_order = excluded.sort_order;
