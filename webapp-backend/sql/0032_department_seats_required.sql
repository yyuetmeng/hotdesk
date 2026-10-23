-- Seats a project team needs (owner request 2026-10-22), set by admins on the Insights team seat planning widget.
-- Null = not set yet.
alter table departments add column if not exists seats_required smallint
  check (seats_required is null or seats_required between 0 and 500);
