import time

from flask import Flask, g, jsonify, request
from flask_cors import CORS

from .core.config import Config
from .core.db import init_db
from .core.logging import setup_logging
from .core.orm import init_orm
from .routes import api_bp


def create_app(config_class=Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_class)
    CORS(app)
    init_db(app)
    init_orm(app)
    setup_logging(app)
    _init_jwt(app)
    _register_request_logging(app)
    app.register_blueprint(api_bp, url_prefix="/api")

    from .auth import auth_bp

    app.register_blueprint(auth_bp)

    from .admin import admin_bp

    app.register_blueprint(admin_bp)

    @app.errorhandler(404)
    def not_found(err):
        return jsonify(error="not found"), 404

    return app


def _init_jwt(app):
    from flask_jwt_extended import JWTManager

    jwt_mgr = JWTManager(app)

    @jwt_mgr.unauthorized_loader
    def _unauthorized(reason):
        return jsonify(error="authentication required"), 401

    @jwt_mgr.invalid_token_loader
    def _invalid(reason):
        return jsonify(error="invalid token"), 401

    @jwt_mgr.expired_token_loader
    def _expired(hdr, claims):
        return jsonify(error="token expired"), 401


def _register_request_logging(app):
    @app.before_request
    def _start():
        g.request_started = time.perf_counter()

    @app.after_request
    def _log(resp):
        if not request.path.startswith("/api/health"):
            import logging

            started = getattr(g, "request_started", time.perf_counter())
            ms = int((time.perf_counter() - started) * 1000)
            logging.getLogger("app.request").info(
                "%s %s %s %dms user=%s", request.method, request.path, resp.status_code, ms,
                getattr(g, "jwt_uid", "-"),
            )
        return resp
