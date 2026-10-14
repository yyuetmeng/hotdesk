-- New catalog element: locker (storage furniture, not bookable).
insert into floor_elements (type, label, w, h, color, resizable, config, sort_order)
values ('locker', 'Locker', 1, 1, '#0e7490', true, '{}', 37)
on conflict (type) do nothing;
