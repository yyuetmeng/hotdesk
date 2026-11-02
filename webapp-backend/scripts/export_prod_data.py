"""Regenerate sql_prod/data/ from a database: the project teams and each floor's published layout.

Reads only (the whole export runs in a read-only transaction). By default it reads the database in
SUPABASE_CONNECTION_STRING, which is normally the live one; pass --database-url to read another.

    python scripts/export_prod_data.py
    python scripts/export_prod_data.py --database-url postgresql://... --out some/folder
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import psycopg
from dotenv import load_dotenv

DATA_DIR = Path(__file__).resolve().parent.parent / "sql_prod" / "data"
SGT = ZoneInfo("Asia/Singapore")

ELEMENT_COLUMNS = ("type", "x", "y", "w", "h", "rotation", "label", "color", "config", "department_id", "open_to_all")


def lit(value) -> str:
    """One SQL literal, written the way the data files spell it."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, datetime):
        return f"'{value.astimezone(timezone.utc).isoformat()}'::timestamptz"
    if isinstance(value, (dict, list)):
        return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"
    return "'" + str(value).replace("'", "''") + "'"


def values(rows) -> str:
    return ",\n".join("  (" + ", ".join(lit(v) for v in row) + ")" for row in rows)


def departments_sql(conn, stamp: str) -> tuple[str, int]:
    rows = conn.execute(
        "select id::text, name::text, description, color, seats_required, seats_planned, created_at "
        "from departments order by name"
    ).fetchall()
    head = (
        "-- Project teams (departments), with the same ids as the old database: seats are tagged by team id.\n"
        f"-- Exported from the live database on {stamp} (SGT).\n"
        "-- Run after ddl/ and dml/. Safe to re-run (existing ids are left alone).\n"
    )
    if not rows:
        return head, 0
    body = (
        "\ninsert into departments (id, name, description, color, seats_required, seats_planned, created_at) values\n"
        f"{values(rows)}\n"
        "on conflict (id) do nothing;\n"
    )
    return head + body, len(rows)


def floors_sql(conn, stamp: str) -> tuple[str, list[str], list[str]]:
    plans = conn.execute(
        "select p.id::text, p.name, p.cols, p.rows, p.created_at, p.updated_at, p.draft_changed_at, "
        "       v.id::text, v.version, v.name, v.cols, v.rows, v.published_at "
        "from floor_plans p join floor_plan_versions v on v.id = p.published_version_id "
        "order by p.name"
    ).fetchall()
    parts = [
        "-- Published floor plans: each floor's live published version, as version 1, with its draft set to the same\n"
        "-- layout. Element ids are kept, so seat ids (QR label links) and team tags stay valid.\n"
        f"-- Exported from the live database on {stamp} (SGT).\n"
        "-- Run after data/01_departments.sql. Safe to re-run (existing ids are left alone).\n"
    ]
    summary, warnings = [], []
    for (plan_id, name, cols, rows, created_at, updated_at, draft_changed_at,
         version_id, version, v_name, v_cols, v_rows, published_at) in plans:
        elements = conn.execute(
            f"select element_id::text, {', '.join(ELEMENT_COLUMNS[:-2])}, department_id::text, open_to_all "
            "from floor_plan_version_elements where version_id = %s order by type, y, x, element_id",
            (version_id,),
        ).fetchall()
        seats = sum(1 for e in elements if e[1] == "seat")
        line = f"{name}: {v_cols} x {v_rows}, {len(elements)} elements, {seats} seats (was version {version})"
        summary.append(line)
        if draft_changed_at and draft_changed_at > published_at:
            warnings.append(f"{name}: the draft has changes after version {version} was published; "
                            "they are not exported (publish the floor first to include them)")
        cols_sql = ", ".join(ELEMENT_COLUMNS)
        parts.append(
            f"\n-- {line}.\n"
            "insert into floor_plans (id, name, cols, rows, created_at, updated_at) values\n"
            f"{values([(plan_id, name, cols, rows, created_at, updated_at)])}\n"
            "on conflict (id) do nothing;\n"
            "insert into floor_plan_versions (id, plan_id, version, name, cols, rows, published_at) values\n"
            f"{values([(version_id, plan_id, 1, v_name, v_cols, v_rows, published_at)])}\n"
            "on conflict (id) do nothing;\n"
        )
        if elements:
            parts.append(
                f"insert into floor_plan_version_elements (version_id, element_id, {cols_sql}) values\n"
                f"{values([(version_id, *e) for e in elements])}\n"
                "on conflict do nothing;\n"
                f"insert into floor_plan_elements (id, plan_id, {cols_sql})\n"
                f"select element_id, {lit(plan_id)}, {cols_sql} from floor_plan_version_elements\n"
                f" where version_id = {lit(version_id)}\n"
                "on conflict (id) do nothing;\n"
            )
        parts.append(
            f"update floor_plans set published_version_id = {lit(version_id)} "
            f"where id = {lit(plan_id)} and published_version_id is null;\n"
        )
    return "".join(parts), summary, warnings


def main() -> int:
    parser = argparse.ArgumentParser(description="Regenerate sql_prod/data/ from a database (read-only)")
    parser.add_argument("--database-url", help="default: SUPABASE_CONNECTION_STRING from the environment or .env")
    parser.add_argument("--out", type=Path, default=DATA_DIR, help=f"output folder (default: {DATA_DIR})")
    args = parser.parse_args()
    load_dotenv()
    url = args.database_url or os.getenv("SUPABASE_CONNECTION_STRING", "")
    if not url:
        print("error: no database URL (set SUPABASE_CONNECTION_STRING or pass --database-url)", file=sys.stderr)
        return 1
    url = url.replace("postgresql+psycopg://", "postgresql://", 1)
    print(f"reading from {urlsplit(url).hostname}")
    stamp = datetime.now(SGT).strftime("%Y-%m-%d %H:%M")
    with psycopg.connect(url) as conn:
        conn.execute("set transaction read only")
        teams, team_count = departments_sql(conn, stamp)
        floors, summary, warnings = floors_sql(conn, stamp)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "01_departments.sql").write_text(teams, encoding="utf-8", newline="\n")
    (args.out / "02_published_floor_plans.sql").write_text(floors, encoding="utf-8", newline="\n")
    print(f"{team_count} project teams")
    for line in summary:
        print(line)
    for line in warnings:
        print(f"warning: {line}", file=sys.stderr)
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
