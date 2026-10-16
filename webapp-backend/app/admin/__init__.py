from flask import Blueprint

admin_bp = Blueprint("admin", __name__, url_prefix="/api/admin")

from . import users, departments, floorplans, floorplan_publishing, displays, insights, desk_labels, occupancy, team_insights  # noqa: E402,F401
