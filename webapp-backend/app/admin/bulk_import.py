"""Bulk loading of users from an Excel template (owner 2026-10-16), for the initial mass load.

GET  /api/admin/users/import-template.xlsx   Users sheet (headers + a sample row: Andy Lau, which upload ignores)
                                             and an Instructions sheet (rules, existing project teams)
POST /api/admin/users/import         multipart: file (.xlsx or .csv); form: dry_run, create_teams, send_invitations,
                                     default_password (optional: every new user's starting password; the password policy applies)

Each row gets a status: create / skip (email already exists, or the template's sample row) / error (with
messages). A dry run changes nothing; an import creates the valid rows and leaves the rest, so re-uploading a fixed
file is safe. Users are tagged to project teams from their "Project teams" column. Uploads create normal users
only (no Role column; an older file's Role column is ignored) - admins are made one at a time in Manage Users.
"""
import csv
import datetime as dt
import io
import re

from flask import Response, g, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func, select

from app.core.audit import audit_row
from app.core.auth_models import Department, Role, User
from app.core.errors import error
from app.core.orm import orm_session
from app.core.passwords import password_problem
from app.core.security import admin_required, hash_password
from app.core.xlsx import write_xlsx
from app.core.xlsx_read import read_xlsx

from . import admin_bp
from .users import _send_invitation, _valid_email

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 2000
USER_COLUMNS = ["Full name", "Email", "Username", "Project teams", "Booking allowance", "Access from", "Access until"]
SAMPLE = {"Full name": "Andy Lau", "Email": "andy.lau@gmail.com", "Username": "andylau"}   # row 2 of the template
SPLIT = re.compile(r"[;,\n]")
EXCEL_EPOCH = dt.date(1899, 12, 30)


class ImportFileError(ValueError):
    """The upload as a whole cannot be read; the message is shown to the admin."""


def _flag(name: str) -> bool:
    return (request.form.get(name) or "").lower() in ("1", "true", "yes", "on")


def _text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _date(value):
    """An Excel date serial or YYYY-MM-DD text -> date; '' -> None; anything else raises ValueError."""
    if value in (None, ""):
        return None
    if isinstance(value, float):
        return EXCEL_EPOCH + dt.timedelta(days=int(value))
    return dt.date.fromisoformat(str(value).strip()[:10])


def _read_upload(columns: list[str]) -> list[tuple[int, dict]]:
    """(Excel row number, {column: value}) for every filled row; the header row must name every column."""
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        raise ImportFileError("choose a file to upload")
    data = upload.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ImportFileError("the file is larger than 5 MB")
    if upload.filename.lower().endswith(".csv"):
        text = data.decode("utf-8-sig", errors="replace")
        rows = [(i + 1, r) for i, r in enumerate(csv.reader(io.StringIO(text))) if any(c.strip() for c in r)]
    else:
        try:
            rows = read_xlsx(data, numbered=True)
        except ValueError as exc:
            raise ImportFileError(f"{exc}; download the template and fill it in")
    if not rows:
        raise ImportFileError("the file is empty")
    _, head = rows[0]
    names = [_text(h).rstrip("*").strip().lower() for h in head]
    missing = [c for c in columns if c.lower() not in names]
    if missing:
        raise ImportFileError(f"this is not the template: missing column(s) {', '.join(missing)}")
    index = {c: names.index(c.lower()) for c in columns}
    body = rows[1:]
    if len(body) > MAX_ROWS:
        raise ImportFileError(f"at most {MAX_ROWS} rows per file")
    return [(n, {c: (cells[i] if i < len(cells) else None) for c, i in index.items()}) for n, cells in body]


def _summary(rows: list[dict]) -> dict:
    return {k: sum(1 for r in rows if r["status"] == k) for k in ("create", "skip", "error")}


def _sample_row() -> list:
    """Row 2 of the template: a made-up person showing how to fill a row in (the first project team, if any)."""
    teams = _team_names()
    return [SAMPLE["Full name"], SAMPLE["Email"], SAMPLE["Username"], teams[0] if teams else None, 0, None, None]


def _template(sheet: str, columns: list[str], instructions: list[list], example: list | None) -> Response:
    stamp = dt.date.today().isoformat()
    data = write_xlsx([(sheet, [columns] + ([example] if example else [])), ("Instructions", instructions)])
    name = "users-template"
    return Response(data, mimetype=XLSX, headers={"Content-Disposition": f'attachment; filename="{name}-{stamp}.xlsx"'})


def _team_names() -> list[str]:
    return list(orm_session().scalars(select(Department.name).order_by(Department.name)))


@admin_bp.get("/users/import-template.xlsx")
@admin_required
def users_template():
    g.jwt_uid = get_jwt_identity()
    rules = [["Column", "Required", "What to enter"],
             ["Full name", "Yes", "The person's name, e.g. Tan Mei Ling"],
             ["Email", "Yes", "Their work email; it is also how they sign in. Rows whose email already exists are skipped."],
             ["Username", "No", "Letters, digits or _ (at least 2). Left empty: made from the email, e.g. mei.tan@x.com -> meitan"],
             ["Project teams", "No", "One or more project team names, separated by ; (e.g. Bolt On; DDAP). Names must match an existing team, unless you tick 'Create missing project teams' when uploading."],
             ["Booking allowance", "No", "How many colleagues they may book for per day (0 if empty)"],
             ["Access from", "No", "First day they can sign in, YYYY-MM-DD (empty = straight away)"],
             ["Access until", "No", "Last day they can sign in, YYYY-MM-DD (empty = no end)"],
             [], ["Row 2 of the Users sheet (Andy Lau) is a sample showing how to fill a row in. "
                  "You can leave it or delete it; it is ignored when you upload."],
             ["Everyone uploaded is a normal user. To make someone an admin, edit them in Manage Users afterwards."],
             [], ["Existing project teams"]] + [[n] for n in _team_names()]
    return _template("Users", USER_COLUMNS, rules, _sample_row())


def _username_from(email: str) -> str:
    base = re.sub(r"[^a-z0-9_]", "", email.split("@")[0].lower())
    return base if len(base) >= 2 else f"user{base}"


def _check_users(rows, create_teams: bool) -> list[dict]:
    session = orm_session()
    emails = set(session.scalars(select(func.lower(User.email))))
    usernames = set(session.scalars(select(func.lower(User.username))))
    teams = {n.lower(): n for n in _team_names()}
    seen_emails, out = {}, []
    for number, r in rows:
        problems, notes = [], []
        name, email = _text(r["Full name"]), _text(r["Email"]).lower()
        if email == SAMPLE["Email"]:
            out.append({"row": number, "status": "skip", "full_name": name, "email": email, "username": _text(r["Username"]).lower(),
                        "teams": [], "messages": ["This is the template's sample row (Andy Lau): ignored."],
                        "_allowance": 0, "_start": None, "_end": None})
            continue
        if not name:
            problems.append("Full name is required.")
        if not _valid_email(email):
            problems.append("A valid email is required.")
        elif email in seen_emails:
            problems.append(f"Same email as row {seen_emails[email]}.")
        username = _text(r["Username"]).lower()
        if username:
            if len(username) < 2 or not username.replace("_", "").isalnum():
                problems.append("Username: letters, digits or _ only, at least 2.")
            elif username in usernames:
                problems.append(f"Username {username} is already taken.")
        elif _valid_email(email):
            base, username, n = _username_from(email), _username_from(email), 1
            while username in usernames:
                n += 1
                username = f"{base}{n}"
        picked = []
        for part in (p.strip() for p in SPLIT.split(_text(r["Project teams"]))):
            if not part:
                continue
            if part.lower() in teams:
                picked.append(teams[part.lower()])
            elif create_teams:
                picked.append(part)
                notes.append(f"Creates project team {part}.")
            else:
                problems.append(f"Unknown project team: {part}.")
        allowance = _text(r["Booking allowance"]) or "0"
        if not allowance.isdigit():
            problems.append("Booking allowance must be 0 or a whole number.")
        try:
            start, end = _date(r["Access from"]), _date(r["Access until"])
            if start and end and start > end:
                problems.append("Access until must be on or after Access from.")
        except (ValueError, TypeError):
            start = end = None
            problems.append("Dates must be YYYY-MM-DD.")
        exists = _valid_email(email) and email in emails and email not in seen_emails
        if exists:                                   # already loaded (e.g. a re-upload): skip, whatever else the row says
            status, problems, notes = "skip", [f"A user with email {email} already exists; skipped."], []
        else:
            status = "error" if problems else "create"
        if _valid_email(email):
            seen_emails.setdefault(email, number)
        if status == "create":
            usernames.add(username)
        out.append({"row": number, "status": status, "full_name": name, "email": email, "username": username,
                    "teams": list(dict.fromkeys(picked)), "messages": problems or notes,
                    "_allowance": int(allowance) if allowance.isdigit() else 0, "_start": start, "_end": end})
    return out


def _public(rows):
    return [{k: v for k, v in r.items() if not k.startswith("_")} for r in rows]


@admin_bp.post("/users/import")
@admin_required
def import_users():
    actor = get_jwt_identity()
    g.jwt_uid = actor
    password = request.form.get("default_password") or ""
    problem = password_problem(password) if password else None
    if problem:
        return error(f"Default password: {problem}", 400)
    try:
        rows = _check_users(_read_upload(USER_COLUMNS), _flag("create_teams"))
    except ImportFileError as exc:
        return error(str(exc), 400)
    if _flag("dry_run"):
        return jsonify(rows=_public(rows), summary=_summary(rows), imported=0)
    session = orm_session()
    teams = {d.name.lower(): d for d in session.scalars(select(Department))}
    roles = dict(session.execute(select(Role.name, Role.id)).all())
    password_hash = hash_password(password) if password else None   # hashed once; the same start for everyone
    created = []
    for r in (r for r in rows if r["status"] == "create"):
        for name in r["teams"]:
            if name.lower() not in teams:
                teams[name.lower()] = Department(name=name)
                session.add(teams[name.lower()])
                session.flush()
                audit_row(actor, "department.create", None, {"name": name, "department_id": str(teams[name.lower()].id), "source": "import"})
        user = User(email=r["email"], username=r["username"], full_name=r["full_name"], role_id=roles["user"],
                    booking_allowance=r["_allowance"], start_date=r["_start"], end_date=r["_end"], password_hash=password_hash)
        user.departments = [teams[n.lower()] for n in r["teams"]]
        session.add(user)
        session.flush()
        audit_row(actor, "user.create", str(user.id), {"email": r["email"], "username": r["username"], "role": "user", "source": "import",
                                                     "default_password": bool(password)})
        created.append((user, r))
    session.commit()
    if _flag("send_invitations"):
        for user, r in created:
            _send_invitation(str(user.id), r["email"], r["full_name"], r["username"])
    return jsonify(rows=_public(rows), summary=_summary(rows), imported=len(created))
