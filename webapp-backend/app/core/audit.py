import uuid

from .auth_models import AuditLog, User
from .orm import orm_session


def audit_row(actor_id, action: str, target_id, details: dict | None = None) -> AuditLog:
    """An audit entry added to the current session (committed with the change it describes).
    The actor's name is stored too, so the entry stays readable after the user is deleted."""
    session = orm_session()
    if actor_id and not isinstance(actor_id, uuid.UUID):
        actor_id = uuid.UUID(str(actor_id))     # JWT ids are strings; the identity map is keyed by UUID
    # Keep the actors of this session's audit rows referenced, so each person is read at most once per
    # request (e.g. one admin and many cancelled bookings after a floor plan change).
    actors = session.info.setdefault("audit_actors", {})
    actor = actors.get(actor_id) if actor_id else None
    if actor_id and actor is None:
        actor = actors[actor_id] = session.get(User, actor_id)
    row = AuditLog(actor_id=actor_id, actor_name=actor.full_name if actor else None, action=action,
                   target_id=target_id, details=details or {})
    session.add(row)
    return row


def write_audit(actor_id, action: str, target_id, details: dict | None = None) -> None:
    audit_row(actor_id, action, target_id, details)
    orm_session().commit()
