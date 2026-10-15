-- Replace the project teams (departments table) with the product owner's list (2026-10-15).
-- Old teams are removed: their user memberships cascade away and seats tagged with them
-- fall back to "no project team" (on delete set null).
delete from departments
 where name not in ('External', 'Bolt On', 'eWorkplace', 'G&C', 'STREAM', 'SAP', 'ITGC', 'DDAP');

insert into departments (name) values
  ('External'), ('Bolt On'), ('eWorkplace'), ('G&C'), ('STREAM'), ('SAP'), ('ITGC'), ('DDAP')
on conflict (name) do nothing;
