create table if not exists audit_logs (
  id         bigint generated always as identity primary key,
  actor_id   uuid references users(id) on delete set null,
  action     text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  target_id  uuid,
  details    jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_target_idx on audit_logs (target_id, created_at desc);
create index if not exists audit_logs_actor_idx  on audit_logs (actor_id, created_at desc);
create index if not exists audit_logs_action_idx on audit_logs (action, created_at desc);
