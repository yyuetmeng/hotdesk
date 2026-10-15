"""Shared setup for desk (booking / check-in) tests: a published floor, users and a fixed clock."""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.db import run_one, run_write
from app.core.security import hash_password

SG = ZoneInfo("Asia/Singapore")
DAY = date(2026, 10, 16)
PW = "password1"


def sg(day, hh, mm=0):
    return datetime(day.year, day.month, day.day, hh, mm, tzinfo=SG)


def set_now(monkeypatch, at):
    monkeypatch.setattr("app.desk.rules.now", lambda: at)


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def _user(username, full_name, role_id=1, depts=(), allowance=0, active=True):
    uid = str(run_one(
        "insert into users (email, username, full_name, role_id, password_hash, booking_allowance, is_active) "
        "values (:e, :u, :n, :r, :p, :a, :act) returning id",
        {"e": f"{username}@x.com", "u": username, "n": full_name, "r": role_id,
         "p": hash_password(PW), "a": allowance, "act": active})["id"])
    for d in depts:
        run_write("insert into user_departments (user_id, department_id) values (cast(:u as uuid), cast(:d as uuid))",
                  {"u": uid, "d": d})
    return uid


def _login(client, username):
    r = client.post("/api/auth/login", json={"email_or_username": username, "password": PW})
    assert r.status_code == 200, r.get_json()
    return r.get_json()["token"]


def build_world(client, monkeypatch):
    """Eng and Ops departments; users; a published plan with seats ffa1, ffa2 (free for all),
    eng (Engineering) and untagged. The clock starts the day before DAY at 15:00."""
    set_now(monkeypatch, sg(DAY - timedelta(days=1), 15))
    eng = str(run_one("insert into departments (name) values ('Engineering') returning id")["id"])
    ops = str(run_one("insert into departments (name) values ('Ops') returning id")["id"])
    ids = {
        "root": _user("root", "Root Admin", role_id=2, depts=[eng]),
        "jane": _user("jane", "Jane Tan", depts=[eng]),
        "ali": _user("ali", "Ali Rahman", depts=[eng], allowance=1),
        "carl": _user("carl", "Carl Lim", depts=[eng]),
        "bob": _user("bob", "Bob Ong", depts=[ops]),
        "dave": _user("dave", "Dave Inactive", depts=[eng], active=False),
    }
    tok = {name: _login(client, name) for name in ("root", "jane", "ali", "carl", "bob")}
    plan = client.post("/api/admin/floor-plans", headers=hdr(tok["root"]),
                       json={"name": "Level 1", "cols": 10, "rows": 10}).get_json()
    saved = client.put(f"/api/admin/floor-plans/{plan['id']}/elements", headers=hdr(tok["root"]), json={"elements": [
        {"type": "seat", "x": 0, "y": 0, "rotation": 0, "label": "F1", "open_to_all": True},
        {"type": "seat", "x": 2, "y": 0, "rotation": 0, "label": "F2", "open_to_all": True},
        {"type": "seat", "x": 4, "y": 0, "rotation": 0, "label": "E1", "department_id": eng},
        {"type": "seat", "x": 6, "y": 0, "rotation": 0, "label": "U1"},
    ]}).get_json()
    assert client.post(f"/api/admin/floor-plans/{plan['id']}/publish", headers=hdr(tok["root"])).status_code == 200
    seats = {el["label"]: el["id"] for el in saved["elements"]}
    return {"plan": plan["id"], "seats": seats, "users": ids, "tok": tok, "eng": eng, "ops": ops}


def book(client, world, who, seat, preset="am", day=DAY, for_user=None):
    body = {"plan_id": world["plan"], "seat_id": world["seats"][seat], "date": day.isoformat(), "preset": preset}
    if for_user:
        body["user_id"] = world["users"][for_user]
    return client.post("/api/desk/bookings", headers=hdr(world["tok"][who]), json=body)
