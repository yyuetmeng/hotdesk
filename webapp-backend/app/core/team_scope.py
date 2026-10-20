"""Which accounts a team account manager may manage (spec 2026-10-19-team-account-management).

An admin grants a user a list of project teams. That user may then manage every non-admin account in any of those
teams, except their own. Admins manage everyone and hold no grants."""
import uuid

from sqlalchemy import select

from app.core.auth_models import Department, Role, User, UserDepartment, UserManagedDepartment
from app.core.orm import orm_session


def managed_departments(user_id: str) -> list[dict]:
    rows = orm_session().execute(
        select(Department.id, Department.name)
        .join(UserManagedDepartment, UserManagedDepartment.department_id == Department.id)
        .where(UserManagedDepartment.user_id == user_id).order_by(Department.name)).all()
    return [{"id": str(i), "name": n} for i, n in rows]


def managed_ids(user_id: str) -> set[uuid.UUID]:
    return set(orm_session().scalars(
        select(UserManagedDepartment.department_id).where(UserManagedDepartment.user_id == user_id)).all())


def set_managed(user: User, department_ids: list[str]) -> None:
    """Replace the user's grants. The caller commits."""
    session = orm_session()
    wanted = {uuid.UUID(d) for d in department_ids}
    for row in session.scalars(select(UserManagedDepartment).where(UserManagedDepartment.user_id == user.id)).all():
        if row.department_id in wanted:
            wanted.discard(row.department_id)
        else:
            session.delete(row)
    for d in wanted:
        session.add(UserManagedDepartment(user_id=user.id, department_id=d))


def manageable_clause(actor_id: str, department_ids: set[uuid.UUID]):
    """For select(User).join(Role): people in one of the teams, never an admin, never the actor."""
    in_team = select(UserDepartment.user_id).where(
        UserDepartment.user_id == User.id, UserDepartment.department_id.in_(department_ids)).exists()
    return in_team & (Role.name != "admin") & (User.id != actor_id)


def can_manage(actor_id: str, department_ids: set[uuid.UUID], target: User | None) -> bool:
    if target is None or str(target.id) == str(actor_id) or target.role.name == "admin":
        return False
    return any(d.id in department_ids for d in target.departments)
