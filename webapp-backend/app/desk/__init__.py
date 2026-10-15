from flask import Blueprint

desk_bp = Blueprint("desk", __name__, url_prefix="/api/desk")

from . import routes  # noqa: E402,F401
