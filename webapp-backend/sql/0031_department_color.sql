-- Project team colour (owner request 2026-10-21): the marker colour for the team's seats in the floor plan editor.
-- Null means automatic (a stable colour worked out from the team's id, as before).
alter table departments add column if not exists color text check (color is null or color ~ '^#[0-9a-fA-F]{6}$');
