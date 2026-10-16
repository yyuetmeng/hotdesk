-- Indexes for the queries the app runs on every request or page, so they stay fast as data grows
-- (2026-10-16 database review). Every statement is safe to re-run.

-- settle(): bookings due for release, check-ins due to end (runs on every desk request)
create index if not exists seat_bookings_release_due_idx on seat_bookings (release_at) where end_reason is null;
create index if not exists seat_checkins_end_due_idx on seat_checkins (ends_at) where checked_out_at is null;

-- check-ins by person and by time: dashboard trend/history, Insights today/activity/occupancy
create index if not exists seat_checkins_user_time_idx on seat_checkins (user_id, checked_in_at desc);
create index if not exists seat_checkins_time_idx on seat_checkins (checked_in_at desc);
create index if not exists seat_checkins_out_idx on seat_checkins (checked_out_at desc) where checked_out_at is not null;
create index if not exists seat_checkins_booking_idx on seat_checkins (booking_id) where booking_id is not null;

-- bookings per floor and per day: plan-change cancellations, Insights funnel
create index if not exists seat_bookings_plan_day_idx on seat_bookings (plan_id, booking_date);
create index if not exists seat_bookings_day_idx on seat_bookings (booking_date);

-- project team links on seats (deleting a team sets these to null)
create index if not exists floor_plan_elements_dept_idx on floor_plan_elements (department_id) where department_id is not null;
create index if not exists floor_plan_version_elements_dept_idx on floor_plan_version_elements (department_id) where department_id is not null;

-- published floors
create index if not exists floor_plans_published_idx on floor_plans (published_version_id) where published_version_id is not null;
