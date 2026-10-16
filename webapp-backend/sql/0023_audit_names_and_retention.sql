-- Audit views groundwork (spec 2026-10-16-audit-views §0): keep the actor's name on every entry so it stays
-- readable after the user is deleted, and index for the Audit log page filters.
alter table audit_logs add column if not exists actor_name text;
update audit_logs a set actor_name = u.full_name from users u where a.actor_id = u.id and a.actor_name is null;
create index if not exists audit_logs_created_idx on audit_logs (created_at desc);
create index if not exists audit_logs_actor_name_idx on audit_logs (lower(actor_name));
