-- Project teams (departments), with the same ids as the old database: seats are tagged by team id.
-- Exported from the live database on 2026-11-02 15:07 (SGT).
-- Run after ddl/ and dml/. Safe to re-run (existing ids are left alone).

insert into departments (id, name, description, color, seats_required, seats_planned, created_at) values
  ('5e1ef275-7b7e-425a-be5e-057808c3a9f8', 'Bolt-On', null, null, 32, 22, '2026-10-28T07:17:26.773391+00:00'::timestamptz),
  ('d68d42c3-9921-4881-8a1e-7898c76f5420', 'DDAP', null, null, 8, null, '2026-10-15T08:35:36.722025+00:00'::timestamptz),
  ('7daf7e46-0f9c-46b2-a871-5b1dcfa21913', 'DEA PLATFORM', null, null, 6, 4, '2026-10-28T07:17:26.773391+00:00'::timestamptz),
  ('ca419c3f-b065-4152-a626-899af7b87f52', 'DLS', null, null, 2, null, '2026-10-28T06:05:43.496593+00:00'::timestamptz),
  ('58474a39-3307-4e46-b0a4-716dd669c16d', 'eWorkplace', null, null, 10, 24, '2026-10-15T08:35:36.722025+00:00'::timestamptz),
  ('fe8f7292-e82e-45d9-8a8b-d62360fd53c5', 'External', null, '#fcfe6c', 6, null, '2026-10-15T08:35:36.722025+00:00'::timestamptz),
  ('574155cd-531f-4244-93ab-6f432f9da6e4', 'G&C', null, '#bababa', 9, null, '2026-10-15T08:35:36.722025+00:00'::timestamptz),
  ('020a4fad-e684-482c-b763-29bb68a620a4', 'ITGC', null, null, 8, null, '2026-10-15T08:35:36.722025+00:00'::timestamptz),
  ('21206114-ba24-48fc-8138-b7fe2a3f546d', 'SAP', null, '#ffc800', 25, 19, '2026-10-15T08:35:36.722025+00:00'::timestamptz),
  ('4fdd992e-eef6-4b8b-a299-d4bdeb2df4fa', 'STREAM', null, null, 8, null, '2026-10-15T08:35:36.722025+00:00'::timestamptz),
  ('64c5f6ed-e79c-4533-9583-006abbf4948d', 'TOA', null, null, 6, null, '2026-10-28T06:05:36.749298+00:00'::timestamptz)
on conflict (id) do nothing;
