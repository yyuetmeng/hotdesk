from flask import Blueprint

# No sign-in: data for the public floor dashboard (today only, names and initials only).
public_bp = Blueprint("public", __name__, url_prefix="/api/public")

from . import routes  # noqa: E402,F401
