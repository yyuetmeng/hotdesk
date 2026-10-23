-- roles: 1 = user, 2 = admin (the app refers to these ids).
-- Final rows after sql/0001-0033 (consolidated 2026-10-21). Safe to re-run.

insert into roles (id, name) values
  (1, 'user'),
  (2, 'admin')
on conflict (id) do nothing;
