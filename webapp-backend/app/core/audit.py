from .auth_models import AuditLog
from .orm import orm_session


def write_audit(actor_id, action: str, target_id, details: dict | None = None) -> None:
    session = orm_session()
    session.add(AuditLog(actor_id=actor_id, action=action, target_id=target_id,
                         details=details or {}))
    session.commit()
