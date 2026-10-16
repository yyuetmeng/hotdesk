from .auth_models import AuditLog, User
from .orm import orm_session


def audit_row(actor_id, action: str, target_id, details: dict | None = None) -> AuditLog:
    """An audit entry added to the current session (committed with the change it describes).
    The actor's name is stored too, so the entry stays readable after the user is deleted."""
    session = orm_session()
    actor = session.get(User, actor_id) if actor_id else None
    row = AuditLog(actor_id=actor_id, actor_name=actor.full_name if actor else None, action=action,
                   target_id=target_id, details=details or {})
    session.add(row)
    return row


def write_audit(actor_id, action: str, target_id, details: dict | None = None) -> None:
    audit_row(actor_id, action, target_id, details)
    orm_session().commit()
