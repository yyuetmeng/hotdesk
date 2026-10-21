-- Project teams (departments), with the same ids as the old database: seats are tagged by team id.
-- Exported from the live database on 2026-10-21 17:51 (SGT).
-- Run after ddl/ and dml/. Safe to re-run (existing ids are left alone).

insert into departments (id, name, description, color, created_at) values
  ('d64906f9-c962-41a7-b006-18acbc4c03af', 'Bolt On', null, null, '2026-10-15T08:35:36.722025+00:00'::timestamptz),
  ('d68d42c3-9921-4881-8a1e-7898c76f5420', 'DDAP', null, null, '2026-10-15T08:35:36.722025+00:00'::timestamptz),
  ('58474a39-3307-4e46-b0a4-716dd669c16d', 'eWorkplace', null, null, '2026-10-15T08:35:36.722025+00:00'::timestamptz),
  ('fe8f7292-e82e-45d9-8a8b-d62360fd53c5', 'External', null, '#fcfe6c', '2026-10-15T08:35:36.722025+00:00'::timestamptz),
  ('574155cd-531f-4244-93ab-6f432f9da6e4', 'G&C', null, '#bababa', '2026-10-15T08:35:36.722025+00:00'::timestamptz),
  ('020a4fad-e684-482c-b763-29bb68a620a4', 'ITGC', null, null, '2026-10-15T08:35:36.722025+00:00'::timestamptz),
  ('21206114-ba24-48fc-8138-b7fe2a3f546d', 'SAP', null, '#ffc800', '2026-10-15T08:35:36.722025+00:00'::timestamptz),
  ('4fdd992e-eef6-4b8b-a299-d4bdeb2df4fa', 'STREAM', null, null, '2026-10-15T08:35:36.722025+00:00'::timestamptz)
on conflict (id) do nothing;
