-- common_password_hashes: SHA-256 of well-known passwords (never the text); rows in dml/03.
-- Final shape after sql/0001-0031 (consolidated 2026-10-21). Safe to re-run.

create table if not exists common_password_hashes (
  sha256 text primary key check (sha256 ~ '^[0-9a-f]{64}$')
);
