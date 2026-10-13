import hashlib
import secrets

from app.core.db import run_one, run_write


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def issue_token(user_id: str, purpose: str, hours: int) -> str:
    raw = secrets.token_urlsafe(32)
    invalidate_tokens(user_id, purpose)
    run_write(
        "insert into user_tokens (user_id, token_hash, purpose, expires_at) "
        "values (:u, :h, :p, now() + make_interval(hours => :hrs))",
        {"u": user_id, "h": _hash(raw), "p": purpose, "hrs": hours},
    )
    return raw


def validate_token(raw: str, purpose: str):
    return run_one(
        "select user_id::text as user_id, token_hash, purpose from user_tokens "
        "where token_hash = :h and purpose = :p and used_at is null and expires_at > now()",
        {"h": _hash(raw), "p": purpose},
    )


def consume_token(token_hash: str) -> None:
    run_write("update user_tokens set used_at = now() where token_hash = :h", {"h": token_hash})


def invalidate_tokens(user_id: str, purpose: str | None = None) -> None:
    if purpose:
        run_write(
            "update user_tokens set used_at = now() "
            "where user_id = :u and purpose = :p and used_at is null",
            {"u": user_id, "p": purpose},
        )
    else:
        run_write(
            "update user_tokens set used_at = now() "
            "where user_id = :u and used_at is null",
            {"u": user_id},
        )
