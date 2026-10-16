from sqlalchemy import or_, select

from .auth_models import User
from .orm import orm_session


def public_user(user: User) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role.name,
        "is_active": user.is_active,
        "start_date": user.start_date.isoformat() if user.start_date else None,
        "end_date": user.end_date.isoformat() if user.end_date else None,
        "departments": [{"id": str(d.id), "name": d.name} for d in user.departments],
        "status": "pending_activation" if user.password_hash is None else "active",
        "booking_allowance": user.booking_allowance,
        "usual_seat_id": str(user.usual_seat_id) if user.usual_seat_id else None,
    }


def fetch_user(user_id: str):
    user = orm_session().get(User, user_id)
    return public_user(user) if user else None


def find_user_by_identity(identity: str):
    return orm_session().scalars(
        select(User).where(or_(User.email == identity, User.username == identity))
    ).unique().first()


def _exists(column, value: str, exclude_id: str | None) -> bool:
    stmt = select(User.id).where(column == value)
    if exclude_id is not None:
        stmt = stmt.where(User.id != exclude_id)
    return orm_session().scalar(stmt) is not None


def email_exists(email: str, exclude_id: str | None = None) -> bool:
    return _exists(User.email, email, exclude_id)


def username_exists(username: str, exclude_id: str | None = None) -> bool:
    return _exists(User.username, username, exclude_id)
