-- Planned seats per project team (owner request 2026-10-23): the Try number on the Insights team seat planning widget,
-- saved so it is still there next time and the same for every admin. A plan only: no seat moves.
-- Null = same as the seats the team has now.
alter table departments add column if not exists seats_planned smallint
  check (seats_planned is null or seats_planned between 0 and 500);
