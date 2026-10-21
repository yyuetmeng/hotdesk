# Database setup for a new environment

The 31 migrations in `../sql/` (0001–0031), folded into one file per table. Use this folder to build a **new, empty**
database, for example production. An existing database that already has the migrations keeps using `../sql/`.

Run the files in this order. Each folder is numbered, and every file is safe to run again.

1. **`ddl/`**: the final shape of each table, with its columns, constraints and indexes. `00_extensions.sql` comes first.
2. **`dml/`**: fixed rows the app needs:
   - `01_roles.sql`: user and admin;
   - `02_floor_elements.sql`: the floor plan element catalog;
   - `03_common_password_hashes.sql`: the well-known-password check.
3. **`data/`**: exported from the old live database on 2026-10-21:
   - `01_departments.sql`: all 8 project teams, keeping their ids and colours;
   - `02_published_floor_plans.sql`: each floor's published layout. That's DIC Annex Level 2 (82 seats) and
     Level 3. Each floor becomes version 1, and its draft is the same layout.

   Seat ids are kept, so desk QR labels already printed still work. Seats keep their project team tags.

With `psql`, from this folder:

```
for f in ddl/*.sql dml/*.sql data/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

In the Supabase SQL editor, paste and run each file in the same order.

Then create the first admin. Either:

- run `data/03_root_admin.sql`, which creates `root_admin` / `root@x.com`. The file is kept out of git, so it exists
  only on the machine where it was made. Change that password after the first sign-in.
- or run `python scripts/create_admin.py` from `webapp-backend/`, with `.env` pointing at the new database.

**Not copied from the old database:** users, bookings, check-ins, seat assignments, desk label downloads, floor
displays and the audit log. Recreate users (Manage Users → Upload Users) and floor displays in the new environment.

**Keeping this folder in step:** when you add a migration to `../sql/`, make the same change in the matching file here.
`tests/test_sql_prod.py` builds a schema from this folder and fails if any table, column, constraint, index or fixed
row differs from what the migrations build.
