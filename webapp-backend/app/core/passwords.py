"""Password policy (owner 2026-10-16), kept simple: at least 8 characters, with letters and numbers, and not a
well-known password. Used wherever a password is set (sign-up and reset links, change password, admin-set, upload
default). The browser shows the same rules as you type (webapp-frontend/src/passwordPolicy.js).

Well-known passwords are never written in code or config: the database holds only SHA-256 hashes of them
(table common_password_hashes, sql/0027). A password is checked by hashing its forms the same way and looking up.
"""
import hashlib
import re

from sqlalchemy import text

from .orm import orm_session

MIN_LENGTH = 8
SWAPS = str.maketrans({"@": "a", "0": "o", "1": "l", "3": "e", "$": "s", "5": "s", "!": "i"})


def common_forms(password: str) -> set[str]:
    """SHA-256 hex of the forms looked up: the lowercase password, and that with symbols read as letters (p@ss -> pass)."""
    low = (password or "").lower()
    return {hashlib.sha256(form.encode()).hexdigest() for form in (low, low.translate(SWAPS))}


def is_common(password: str) -> bool:
    found = orm_session().execute(text("select 1 from common_password_hashes where sha256 = any(:h) limit 1"),
                                  {"h": sorted(common_forms(password))}).first()
    return found is not None


def common_hashes() -> list[str]:
    return list(orm_session().execute(text("select sha256 from common_password_hashes order by sha256")).scalars())


def password_problem(password: str, username: str | None = None, email: str | None = None) -> str | None:
    """Why `password` is not allowed, or None when it is fine."""
    password = password or ""
    if len(password) < MIN_LENGTH:
        return f"Use at least {MIN_LENGTH} characters."
    if not (re.search(r"[A-Za-z]", password) and re.search(r"\d", password)):
        return "Use both letters and numbers."
    if is_common(password):
        return "That is a well-known password; choose something less easy to guess."
    names = {n.lower() for n in (username, (email or "").split("@")[0]) if n}
    if password.lower() in names:
        return "Do not use your username or email as the password."
    return None
