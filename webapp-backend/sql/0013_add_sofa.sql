-- New catalog element: sofa (lounge furniture, not bookable).
insert into floor_elements (type, label, w, h, color, resizable, config, sort_order)
values ('sofa', 'Sofa', 2, 1, '#4f46e5', true, '{}', 35)
on conflict (type) do nothing;
