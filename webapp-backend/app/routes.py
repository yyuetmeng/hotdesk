from flask import Blueprint, current_app, jsonify

from .db import get_engine

api_bp = Blueprint("api", __name__)


@api_bp.get("/health")
def health():
    return jsonify(status="ok")


@api_bp.get("/health/db")
def health_db():
    try:
        with get_engine().connect() as conn:
            conn.exec_driver_sql("SELECT 1")
        return jsonify(status="ok", database="connected")
    except Exception as exc:
        current_app.logger.error("DB health check failed: %s", exc)
        return jsonify(status="error", database=str(exc)), 503
