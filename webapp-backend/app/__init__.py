from flask import Flask, jsonify
from flask_cors import CORS

from .config import Config
from .db import init_db
from .routes import api_bp


def create_app(config_class=Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_class)
    CORS(app)
    init_db(app)
    app.register_blueprint(api_bp, url_prefix="/api")

    @app.errorhandler(404)
    def not_found(err):
        return jsonify(error="not found"), 404

    return app
