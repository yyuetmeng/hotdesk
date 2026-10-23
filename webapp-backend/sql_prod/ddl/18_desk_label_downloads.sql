-- desk_label_downloads: seats whose QR label has been downloaded, so new seats show as "New".
-- Final shape after sql/0001-0033 (consolidated 2026-10-21). Safe to re-run.

create table if not exists desk_label_downloads (
  seat_id             uuid primary key,
  first_downloaded_at timestamptz not null default now(),
  last_downloaded_at  timestamptz not null default now(),
  downloaded_by       uuid references users(id) on delete set null
);
