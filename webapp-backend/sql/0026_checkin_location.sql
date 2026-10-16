-- Device location at check-in (owner request 2026-10-16), kept for later vicinity checks; nothing is enforced yet.
-- location_status: captured | denied | unavailable | unsupported | timeout | invalid; null = the app sent nothing.
-- Coordinates are stored only here (not in audit_logs) and are not returned by any endpoint.
alter table seat_checkins
  add column if not exists location_lat double precision,
  add column if not exists location_lng double precision,
  add column if not exists location_accuracy_m real,
  add column if not exists location_at timestamptz,
  add column if not exists location_status text;
