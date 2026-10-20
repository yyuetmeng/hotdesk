import uuid
from functools import wraps

import jwt as _pyjwt
from flask import g
from flask_jwt_extended import get_jwt, get_jwt_identity, verify_jwt_in_request
from passlib.context import CryptContext

from .errors import error

_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return _ctx.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _ctx.verify(plain, hashed)
    except ValueError:
        return False


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            verify_jwt_in_request()
        except _pyjwt.ExpiredSignatureError:
            return error("token expired", 401)
        except _pyjwt.PyJWTError:
            return error("invalid token", 401)
        claims = get_jwt()
        if claims.get("role") != "admin":
            return error("admin required", 403)
        return fn(*args, **kwargs)

    return wrapper


def _may_sign_in_today(user_id: str) -> bool:
    """The holder's account is active and today is within its access dates (null = open). Checked on every request,
    so disabling a holder or ending their access takes effect before their token expires."""
    from app.core.auth_models import User   # imported here: the models import security
    from app.core.orm import orm_session
    from app.desk import rules
    try:
        user = orm_session().get(User, uuid.UUID(str(user_id)))
    except ValueError:
        return False
    if user is None or not user.is_active:
        return False
    today = rules.local_today(rules.now())
    return (user.start_date is None or user.start_date <= today) and (user.end_date is None or today <= user.end_date)


def account_manager_required(fn):
    """Admins (no limit) or a user an admin has let manage accounts for some teams. Sets g.team_scope to None for an
    admin, else the set of team ids the holder manages, read from the database on every request."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        from app.core.team_scope import managed_ids   # imported here: team_scope pulls in models that import security
        try:
            verify_jwt_in_request()
        except _pyjwt.ExpiredSignatureError:
            return error("token expired", 401)
        except _pyjwt.PyJWTError:
            return error("invalid token", 401)
        if get_jwt().get("role") == "admin":
            g.team_scope = None
        else:
            if not _may_sign_in_today(get_jwt_identity()):
                return error("admin required", 403)
            g.team_scope = managed_ids(get_jwt_identity())
            if not g.team_scope:
                return error("admin required", 403)
        return fn(*args, **kwargs)

    return wrapper
