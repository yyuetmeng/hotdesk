"""Print Desk Labels: which seats' QR labels have been downloaded (/api/admin/desk-labels/downloads).

The page flags a label "New" until any admin has downloaded it once.
"""
import uuid

from flask import g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from app.core.desk_models import DeskLabelDownload
from app.core.errors import error
from app.core.orm import orm_session
from app.core.security import admin_required

from . import admin_bp

MAX_SEATS = 500


@admin_bp.get("/desk-labels/downloads")
@admin_required
def label_downloads():
    g.jwt_uid = get_jwt_identity()
    ids = orm_session().scalars(select(DeskLabelDownload.seat_id)).all()
    return jsonify(seat_ids=[str(i) for i in ids])


@admin_bp.post("/desk-labels/downloads")
@admin_required
def record_label_downloads():
    actor = get_jwt_identity()
    g.jwt_uid = actor
    raw = (request.get_json(silent=True) or {}).get("seat_ids")
    if not isinstance(raw, list) or len(raw) > MAX_SEATS:
        return error("validation failed", 400, fields={"seat_ids": f"a list of up to {MAX_SEATS} seat ids"})
    try:
        seat_ids = {uuid.UUID(str(s)) for s in raw}
    except ValueError:
        return error("validation failed", 400, fields={"seat_ids": "every seat id must be a UUID"})
    if seat_ids:
        stmt = insert(DeskLabelDownload).values([{"seat_id": s, "downloaded_by": actor} for s in seat_ids])
        stmt = stmt.on_conflict_do_update(index_elements=[DeskLabelDownload.seat_id],
                                          set_={"last_downloaded_at": func.now(), "downloaded_by": actor})
        session = orm_session()
        session.execute(stmt)
        session.commit()
    return ("", 204)
