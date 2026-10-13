import argparse
import getpass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app
from app.core.audit import write_audit
from app.core.db import run_one, run_write
from app.core.security import hash_password


def ensure_admin(email: str, username: str, full_name: str, password: str) -> str:
    existing = run_one("select id::text as id from users where email = :e", {"e": email})
    if existing:
        run_write(
            "update users set username = :u, full_name = :f, password_hash = :h, "
            "role_id = (select id from roles where name = 'admin'), "
            "is_active = true, failed_attempts = 0, updated_at = now() where id = :i",
            {"u": username, "f": full_name, "h": hash_password(password), "i": existing["id"]},
        )
        write_audit(None, "user.update", existing["id"],
                    {"fields": ["password", "role", "is_active"], "source": "create_admin"})
        return "updated"
    row = run_one(
        "insert into users (email, username, full_name, role_id, password_hash) "
        "values (:e, :u, :f, (select id from roles where name = 'admin'), :h) "
        "returning id::text as id",
        {"e": email, "u": username, "f": full_name, "h": hash_password(password)},
    )
    write_audit(None, "user.create", row["id"],
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
