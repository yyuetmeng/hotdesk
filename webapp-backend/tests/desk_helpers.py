"""Shared setup for desk (booking / check-in) tests: a published floor, users and a fixed clock."""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from app.core.db import run_one, run_write
from creds import SECRET, hashed, sign_in

SG = ZoneInfo("Asia/Singapore")
DAY = date(2026, 10, 16)


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
         "p": hashed(SECRET), "a": allowance, "act": active})["id"])
    for d in depts:
        run_write("insert into user_departments (user_id, department_id) values (cast(:u as uuid), cast(:d as uuid))",
                  {"u": uid, "d": d})
    return uid


def _login(client, username):
    r = sign_in(client, username)
    assert r.status_code == 200, r.get_json()
    return r.get_json()["token"]


def build_world(client, monkeypatch):
    """Eng, Ops and Design departments; users (dina is in Eng and Design); a published plan with seats ffa1, ffa2 (free for all),
    E1 (Design) and untagged. The clock starts the day before DAY at 15:00."""
    set_now(monkeypatch, sg(DAY - timedelta(days=1), 15))
    eng = str(run_one("insert into departments (name) values ('Engineering') returning id")["id"])
    ops = str(run_one("insert into departments (name) values ('Ops') returning id")["id"])
    design = str(run_one("insert into departments (name) values ('Design') returning id")["id"])
    ids = {
        "root": _user("root", "Root Admin", role_id=2, depts=[eng]),
        "jane": _user("jane", "Jane Tan", depts=[eng]),
        "ali": _user("ali", "Ali Rahman", depts=[eng], allowance=1),
        "carl": _user("carl", "Carl Lim", depts=[eng]),
        "bob": _user("bob", "Bob Ong", depts=[ops]),
        "dina": _user("dina", "Dina Koh", depts=[eng, design], allowance=1),
        "dave": _user("dave", "Dave Inactive", depts=[eng], active=False),
    }
    tok = {name: _login(client, name) for name in ("root", "jane", "ali", "carl", "bob", "dina")}
    plan = client.post("/api/admin/floor-plans", headers=hdr(tok["root"]),
                       json={"name": "Level 1", "cols": 10, "rows": 10}).get_json()
    saved = client.put(f"/api/admin/floor-plans/{plan['id']}/elements", headers=hdr(tok["root"]), json={"elements": [
        {"type": "seat", "x": 0, "y": 0, "rotation": 0, "label": "F1", "open_to_all": True},
        {"type": "seat", "x": 2, "y": 0, "rotation": 0, "label": "F2", "open_to_all": True},
        {"type": "seat", "x": 4, "y": 0, "rotation": 0, "label": "E1", "department_id": design},
        {"type": "seat", "x": 6, "y": 0, "rotation": 0, "label": "U1"},
    ]}).get_json()
    assert client.post(f"/api/admin/floor-plans/{plan['id']}/publish", headers=hdr(tok["root"])).status_code == 200
    seats = {el["label"]: el["id"] for el in saved["elements"]}
    return {"plan": plan["id"], "seats": seats, "users": ids, "tok": tok, "eng": eng, "ops": ops, "design": design,
            "seat_plan": {label: plan["id"] for label in seats}}


def add_floor(client, world, name, seats, zones=()):
    """Create and publish another floor; seats are {label, x, y, department_id?, open_to_all?}, zones {label, x, y, w, h}.
    Records the seats in world['seats'] / world['seat_plan'] and the plan in world['plans'][name]; returns the plan id."""
    h = hdr(world["tok"]["root"])
    plan = client.post("/api/admin/floor-plans", headers=h, json={"name": name, "cols": 10, "rows": 10}).get_json()
    elements = [{"type": "seat", "rotation": 0, **s} for s in seats] + [{"type": "zone", "rotation": 0, **z} for z in zones]
    saved = client.put(f"/api/admin/floor-plans/{plan['id']}/elements", headers=h, json={"elements": elements}).get_json()
    assert client.post(f"/api/admin/floor-plans/{plan['id']}/publish", headers=h).status_code == 200
    for el in saved["elements"]:
        if el["type"] == "seat":
            world["seats"][el["label"]] = el["id"]
            world["seat_plan"][el["label"]] = plan["id"]
    world.setdefault("plans", {})[name] = plan["id"]
    return plan["id"]


def book(client, world, who, seat, preset="am", day=DAY, for_user=None):
    body = {"plan_id": world["seat_plan"].get(seat, world["plan"]), "seat_id": world["seats"][seat], "date": day.isoformat(), "preset": preset}
    if for_user:
        body["user_id"] = world["users"][for_user]
    return client.post("/api/desk/bookings", headers=hdr(world["tok"][who]), json=body)
