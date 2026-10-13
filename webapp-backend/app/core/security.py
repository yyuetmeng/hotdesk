from functools import wraps

import jwt as _pyjwt
from flask_jwt_extended import get_jwt, verify_jwt_in_request
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
