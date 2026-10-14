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
    if "orm_session" not in g:
        g.orm_session = Session(_get_engine(), expire_on_commit=False)
    return g.orm_session


def _get_engine():
    from .db import get_engine

    return get_engine()


def init_orm(app):
    from . import floorplan_models  # noqa: F401  (registers all mappers on Base)

    @app.teardown_appcontext
    def _close_orm_session(exc):
        session = g.pop("orm_session", None)
        if session is not None:
            session.close()
