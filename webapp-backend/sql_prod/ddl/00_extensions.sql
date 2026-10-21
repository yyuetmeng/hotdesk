-- Extensions: citext (case-insensitive email, username, team name) and pg_trgm (user search).
-- Final shape after sql/0001-0031 (consolidated 2026-10-21). Safe to re-run.

create schema if not exists extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;
