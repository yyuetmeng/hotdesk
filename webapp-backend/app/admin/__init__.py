from flask import Blueprint

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")

from . import users, departments, floorplans, floorplan_publishing  # noqa: E402,F401
