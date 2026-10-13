create table if not exists roles (
  id   smallint primary key,
  name text not null unique check (name ~ '^[a-z][a-z0-9_]{1,49}$')
);
