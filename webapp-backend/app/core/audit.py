import json

from .db import run_write


def write_audit(actor_id, action: str, target_id, details: dict | None = None) -> None:
    run_write(
        "insert into audit_logs (actor_id, action, target_id, details) "
        "values (:actor_id, :action, :target_id, cast(:details as jsonb))",
        {
            "actor_id": actor_id,
            "action": action,
            "target_id": target_id,
            "details": json.dumps(details or {}),
        },
    )
