from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from app.core.auth_models import AuditLog, Department, Role, User, UserToken
from app.core.db import get_session, run_one
from app.core.orm import orm_session


def test_user_orm_roundtrip(app, db):
    session = orm_session()
    dept = Department(name="Eng")
    session.add(dept)
    user = User(email="m@x.com", username="mm", full_name="M M", role_id=1)
    user.departments = [dept]
    session.add(user)
    session.commit()
    loaded = session.get(User, str(user.id))
    assert loaded.id is not None and isinstance(loaded.id.hex, str)
    assert loaded.role.name == "user"
    assert [d.name for d in loaded.departments] == ["Eng"]
    assert loaded.is_active is True and loaded.failed_attempts == 0
    assert loaded.created_at is not None


def test_token_and_audit_orm(app, db):
    session = orm_session()
    uid = str(run_one("insert into users (email, username, full_name, role_id) "
                      "values ('t@x.com', 'tt', 'T', 1) returning id")["id"])
    # run_one does not commit; the ORM session below uses a separate
    # connection, so the insert must be committed to be visible to it.
    get_session().commit()
    session.add(UserToken(user_id=uid, token_hash="hash-1", purpose="reset",
                          expires_at=datetime.now(timezone.utc) + timedelta(hours=1)))
    session.add(AuditLog(actor_id=uid, action="user.create", target_id=uid, details={"role": "user"}))
    session.commit()
    assert session.scalar(select(func.count()).select_from(UserToken)) == 1
    audit = session.scalars(select(AuditLog)).one()
    assert audit.details == {"role": "user"} and str(audit.actor_id) == uid


def test_roles_seed_visible(app, db):
    names = set(orm_session().scalars(select(Role.name)).all())
    assert {"user", "admin"} <= names
