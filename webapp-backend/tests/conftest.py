import os
from pathlib import Path

import pytest
from dotenv import load_dotenv
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url

from app import create_app

SQL_DIR = Path(__file__).resolve().parents[1] / "sql"
# TEST_SCHEMA lets two test runs share the local database without clashing (each drops/creates its own schema).
TEST_SCHEMA = os.environ.get("TEST_SCHEMA", "hotdesk_test")
# Tests run only against a local PostgreSQL, never the Supabase app database. The connection
# string comes from TEST_DATABASE_URI in webapp-backend/.env (see .env.example).
load_dotenv()
BASE_URI = os.getenv("TEST_DATABASE_URI")
if not BASE_URI:
    raise RuntimeError("Set TEST_DATABASE_URI in webapp-backend/.env to a local PostgreSQL "
                       "(e.g. postgresql://postgres:<password>@localhost:5432/postgres)")
if make_url(BASE_URI).host not in ("localhost", "127.0.0.1", "::1"):
    raise RuntimeError(f"TEST_DATABASE_URI must point at a local PostgreSQL, got host {make_url(BASE_URI).host!r}")


@pytest.fixture(scope="session")
def admin_conn():
    engine = create_engine(BASE_URI, isolation_level="autocommit")

    @event.listens_for(engine, "connect")
    def _set_search_path(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute(f"set search_path to {TEST_SCHEMA}, public, extensions")
        cur.close()
        dbapi_conn.commit()

    with engine.connect() as conn:
        conn.execute(text(f"drop schema if exists {TEST_SCHEMA} cascade"))
        conn.execute(text(f"create schema {TEST_SCHEMA}"))
        for script in sorted(SQL_DIR.glob("*.sql")):
            conn.execute(text(script.read_text(encoding="utf-8")))
    yield engine
    engine.dispose()


@pytest.fixture()
def app(admin_conn):
    application = create_app()
    application.config.update(
        TESTING=True,
        SQLALCHEMY_DATABASE_URI=BASE_URI,
        SQL_SEARCH_PATH=TEST_SCHEMA,
        JWT_SECRET_KEY="**",
        JWT_ACCESS_TOKEN_EXPIRES=3600,
    )
    return application


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def db(app, admin_conn):
    ctx = app.app_context()
    ctx.push()
    try:
        with admin_conn.connect() as conn:
            conn.execute(text(
                "truncate users, departments, user_departments, user_tokens, audit_logs, "
                "floor_plan_elements, floor_plans, dashboard_displays "
                "restart identity cascade"))
            conn.execute(text(
                "insert into roles (id, name) values (1, 'user'), (2, 'admin') "
                "on conflict (id) do nothing"))
        yield admin_conn
    finally:
        ctx.pop()
