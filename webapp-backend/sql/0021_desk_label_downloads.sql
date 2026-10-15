-- Print Desk Labels: which seats have had their QR label downloaded, so new seats can be flagged "New".
-- One row per seat (permanent seat id = floor plan element id); shared by all admins.
create table if not exists desk_label_downloads (
  seat_id             uuid primary key,
  first_downloaded_at timestamptz not null default now(),
  last_downloaded_at  timestamptz not null default now(),
  downloaded_by       uuid references users(id) on delete set null
);
