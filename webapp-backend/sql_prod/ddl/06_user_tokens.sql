-- user_tokens: invitation (activate) and password reset links, stored as hashes.
-- Final shape after sql/0001-0031 (consolidated 2026-10-21). Safe to re-run.

create table if not exists user_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  purpose    text not null check (purpose in ('activate', 'reset')),
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists user_tokens_user_purpose_idx on user_tokens (user_id, purpose, used_at);
create index if not exists user_tokens_expires_idx      on user_tokens (expires_at);
