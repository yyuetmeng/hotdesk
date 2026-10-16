-- Usual seat (one per person, set by admins; a label only) and the user's auto-booking switch
-- (spec 2026-10-16-usual-seat-and-auto-book-design). usual_seat_id is the permanent seat id.
alter table users add column if not exists usual_seat_id uuid;
alter table users add column if not exists auto_book boolean not null default false;
