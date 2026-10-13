from flask import current_app, g
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

_engines = {}


def get_engine() -> Engine:
    uri = current_app.config["SQLALCHEMY_DATABASE_URI"]
    options = current_app.config.get("SQLALCHEMY_ENGINE_OPTIONS", {})
    key = uri
    if key not in _engines:
        _engines[key] = create_engine(uri, **options)
    return _engines[key]


def get_session():
    if "db_session" not in g:
        g.db_session = get_engine().connect()
    return g.db_session


def run_query(sql: str, params: dict | None = None):
    session = get_session()
    return session.execute(text(sql), params or {}).mappings().all()


def init_db(app):
    @app.teardown_appcontext
    def close_session(exc):
        session = g.pop("db_session", None)
        if session is not None:
            session.close()
