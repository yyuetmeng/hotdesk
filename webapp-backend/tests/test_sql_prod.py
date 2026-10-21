"""sql_prod/ (consolidated per-table DDL and DML for a new database) must build exactly what sql/0001-... builds.
If this fails after a new migration, add the change to the matching sql_prod/ddl or dml file too."""
import re
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event, text

from conftest import BASE_URI, TEST_SCHEMA

PROD_DIR = Path(__file__).resolve().parents[1] / "sql_prod"
PROD_SCHEMA = f"{TEST_SCHEMA}_sqlprod"


@pytest.fixture(scope="module")
def prod_conn(admin_conn):
    """A schema built from sql_prod ddl + dml + data, next to the migrated test schema."""
    engine = create_engine(BASE_URI, isolation_level="autocommit")

    @event.listens_for(engine, "connect")
    def _path(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute(f"set search_path to {PROD_SCHEMA}, public, extensions")
        cur.close()

    with engine.connect() as conn:
        conn.execute(text(f"drop schema if exists {PROD_SCHEMA} cascade"))
        conn.execute(text(f"create schema {PROD_SCHEMA}"))
        for folder in ("ddl", "dml"):
            for script in sorted((PROD_DIR / folder).glob("*.sql")):
                conn.execute(text(script.read_text(encoding="utf-8")))
        yield conn
        conn.execute(text(f"drop schema {PROD_SCHEMA} cascade"))
    engine.dispose()


def shape(conn, schema):
    """Every column, constraint and index of a schema, with the schema name taken out of definitions."""
    unqualify = lambda s: re.sub(rf"\b{re.escape(schema)}\.", "", s or "")
    columns = conn.execute(text(
        "select table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default, is_identity "
        "from information_schema.columns where table_schema = :s order by 1, 3"), {"s": schema}).all()
    constraints = conn.execute(text(
        "select t.relname, c.conname, pg_get_constraintdef(c.oid) from pg_constraint c "
        "join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace "
        "where n.nspname = :s order by 1, 2"), {"s": schema}).all()
    indexes = conn.execute(text("select tablename, indexname, indexdef from pg_indexes where schemaname = :s order by 1, 2"),
                           {"s": schema}).all()
    return {"columns": [tuple(unqualify(str(v)) for v in r) for r in columns],
            "constraints": [(r[0], r[1], unqualify(r[2])) for r in constraints],
            "indexes": [(r[0], r[1], unqualify(r[2])) for r in indexes]}


@pytest.mark.parametrize("part", ["columns", "constraints", "indexes"])
def test_same_tables_as_the_migrations(admin_conn, prod_conn, part):
    with admin_conn.connect() as migrated:
        want = shape(migrated, TEST_SCHEMA)[part]
    got = shape(prod_conn, PROD_SCHEMA)[part]
    assert len(want) > 50, "the migrated schema should have plenty to compare"
    assert [r for r in want if r not in got] == [], "missing from sql_prod"
    assert [r for r in got if r not in want] == [], "in sql_prod but not in the migrations"


@pytest.mark.parametrize("table, order", [("roles", "id"), ("floor_elements", "type"), ("common_password_hashes", "sha256")])
def test_same_seed_rows_as_the_migrations(admin_conn, prod_conn, table, order):
    query = text(f"select * from {table} order by {order}")
    with admin_conn.connect() as migrated:
        want = migrated.execute(query).all()
    assert prod_conn.execute(query).all() == want and want


def test_exported_data_loads_and_rerun_changes_nothing(prod_conn):
    for _ in range(2):                                          # every file is safe to run twice
        for script in sorted((PROD_DIR / "data").glob("*.sql")):
            prod_conn.execute(text(script.read_text(encoding="utf-8")))
    counts = prod_conn.execute(text(
        "select (select count(*) from floor_plans where published_version_id is null) as unpublished, "
        "       (select count(*) from floor_plan_elements) as draft, (select count(*) from floor_plan_version_elements) as live, "
        "       (select count(*) from floor_plan_versions where version <> 1) as renumbered")).one()
    assert counts.unpublished == 0 and counts.renumbered == 0 and counts.draft == counts.live > 0
    # each draft matches its published version, element for element
    assert prod_conn.execute(text(
        "select count(*) from floor_plan_elements e join floor_plans p on p.id = e.plan_id "
        "left join floor_plan_version_elements v on v.version_id = p.published_version_id and v.element_id = e.id "
        "where v.element_id is null or (e.type, e.x, e.y, e.w, e.h, e.rotation, e.label, e.color, e.config, e.department_id, e.open_to_all) "
        "  is distinct from (v.type, v.x, v.y, v.w, v.h, v.rotation, v.label, v.color, v.config, v.department_id, v.open_to_all)")).scalar() == 0
