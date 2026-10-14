import argparse
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func, select

from app import create_app
from app.core.audit import write_audit
from app.core.auth_models import Role, User
from app.core.orm import orm_session
from app.core.security import hash_password


def ensure_admin(email: str, username: str, full_name: str, password: str) -> str:
    session = orm_session()
    role_id = session.scalar(select(Role.id).where(Role.name == "admin"))
    existing = session.scalars(
        select(User).where(User.email == email).execution_options(populate_existing=True)
    ).unique().first()
    if existing:
        existing.username = username
        existing.full_name = full_name
        existing.password_hash = hash_password(password)
        existing.role_id = role_id
        existing.is_active = True
        existing.failed_attempts = 0
        existing.updated_at = func.now()
        session.commit()
        write_audit(None, "user.update", str(existing.id),
                    {"fields": ["password", "role", "is_active"], "source": "create_admin"})
        return "updated"
    user = User(email=email, username=username, full_name=full_name,
                password_hash=hash_password(password), role_id=role_id)
    session.add(user)
    session.commit()
    write_audit(None, "user.create", str(user.id),
                {"email": email, "username": username, "role": "admin", "source": "create_admin"})
    return "created"


def main() -> int:
    parser = argparse.ArgumentParser(description="Create or repair the bootstrap admin account")
    parser.add_argument("--email")
    parser.add_argument("--username")
    parser.add_argument("--full-name", dest="full_name")
    args = parser.parse_args()
    email = args.email or os.getenv("BOOTSTRAP_ADMIN_EMAIL")
    username = args.username or os.getenv("BOOTSTRAP_ADMIN_USERNAME")
    full_name = args.full_name or os.getenv("BOOTSTRAP_ADMIN_FULL_NAME", "Administrator")
    password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD") or getpass.getpass("Admin password: ")
    if not email or not username or len(password) < 8:
        print("error: email, username and a password of >= 8 characters are required",
              file=sys.stderr)
        return 1
    app = create_app()
    with app.app_context():
        ensure_admin(email, username, full_name, password)
    print(f"admin {email} ready")
    return 0


if __name__ == "__main__":
    sys.exit(main())
