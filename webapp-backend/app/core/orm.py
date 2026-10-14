from flask import g
from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase, Session

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def orm_session() -> Session:
    _commit_legacy_work()
    if "orm_session" not in g:
        g.orm_session = Session(_get_engine(), expire_on_commit=False)
    return g.orm_session


def _commit_legacy_work() -> None:
    # Legacy run_one/run_query never commit, and the ORM uses its own connection,
    # so commit pending raw-SQL work first or the ORM cannot see it.
    conn = g.get("db_session")
    if conn is not None and conn.in_transaction():
        conn.commit()


def _get_engine():
    from .db import get_engine

    return get_engine()


def _close_orm_session(exc=None):
    session = g.pop("orm_session", None)
    if session is not None:
        session.close()


def init_orm(app):
    from . import auth_models, floorplan_models  # noqa: F401  (registers all mappers on Base)

    # Per request (no stale identity map when an app context spans several requests)
    # and per app context (scripts / code outside requests).
    app.teardown_request(_close_orm_session)
    app.teardown_appcontext(_close_orm_session)
