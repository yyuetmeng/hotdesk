-- roles: user (1) and admin (2); rows in dml/01_roles.sql.
-- Final shape after sql/0001-0031 (consolidated 2026-10-21). Safe to re-run.

create table if not exists roles (
  id   smallint primary key,
  name text not null unique check (name ~ '^[a-z][a-z0-9_]{1,49}$')
);
