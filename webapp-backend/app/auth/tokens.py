import hashlib
import secrets
from datetime import timedelta

from sqlalchemy import func, select, update

from app.core.auth_models import UserToken
from app.core.orm import orm_session


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def issue_token(user_id: str, purpose: str, hours: int) -> str:
    raw = secrets.token_urlsafe(32)
    invalidate_tokens(user_id, purpose)
    session = orm_session()
    session.add(UserToken(user_id=user_id, token_hash=_hash(raw), purpose=purpose,
                          expires_at=func.now() + timedelta(hours=hours)))
    session.commit()
    return raw


def validate_token(raw: str, purpose: str):
    row = orm_session().execute(
        select(UserToken.user_id, UserToken.token_hash, UserToken.purpose)
        .where(UserToken.token_hash == _hash(raw), UserToken.purpose == purpose,
               UserToken.used_at.is_(None), UserToken.expires_at > func.now())
    ).mappings().first()
    if row is None:
        return None
    return {"user_id": str(row["user_id"]), "token_hash": row["token_hash"],
            "purpose": row["purpose"]}


def consume_token(token_hash: str) -> None:
    session = orm_session()
    session.execute(update(UserToken).where(UserToken.token_hash == token_hash)
                    .values(used_at=func.now()))
    session.commit()


def invalidate_tokens(user_id: str, purpose: str | None = None) -> None:
    stmt = update(UserToken).where(UserToken.user_id == user_id, UserToken.used_at.is_(None))
    if purpose:
        stmt = stmt.where(UserToken.purpose == purpose)
    session = orm_session()
    session.execute(stmt.values(used_at=func.now()))
    session.commit()
