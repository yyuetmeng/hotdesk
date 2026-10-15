"""Floor zones: the zone element type, seat membership and utilisation by zone (spec 2026-10-15-floor-zones)."""
from types import SimpleNamespace

import pytest

from app.core.db import run_one
from app.core.security import hash_password
from desk_helpers import DAY, build_world, set_now, sg
from desk_helpers import hdr as dhdr

ADMIN_PW = "adminpw1"


@pytest.fixture()
def admin_token(client, db):
    run_one("insert into users (email, username, full_name, role_id, password_hash) "
            "values ('root@x.com', 'root', 'Root', 2, :p) returning id", {"p": hash_password(ADMIN_PW)})
    return client.post("/api/auth/login",
                       json={"email_or_username": "root@x.com", "password": ADMIN_PW}).get_json()["token"]


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def _url(pid, suffix=""):
    return f"/api/admin/floor-plans/{pid}{suffix}"


def _mk_plan(client, tok, cols=30, rows=30):
    return client.post("/api/admin/floor-plans", headers=hdr(tok),
                       json={"name": "Level 1", "cols": cols, "rows": rows}).get_json()


def _save(client, tok, pid, elements):
    return client.put(_url(pid, "/elements"), headers=hdr(tok), json={"elements": elements})


def _zone(x, y, w, h, label="Zone", rotation=0):
    return {"type": "zone", "x": x, "y": y, "w": w, "h": h, "rotation": rotation, "label": label}


def _problems(resp):
    return " | ".join(map(str, (resp.get_json() or {}).values()))


# --- Task 1: the zone element type and save rules ----------------------------------------------

def test_zone_in_catalog(client, admin_token):
    items = client.get("/api/admin/floor-plans/catalog", headers=hdr(admin_token)).get_json()["items"]
    zone = next(c for c in items if c["type"] == "zone")
    assert zone["resizable"] is True and zone["label"] == "Zone"


def test_zone_may_surround_seats(client, admin_token):
    plan = _mk_plan(client, admin_token)
    r = _save(client, admin_token, plan["id"], [
        _zone(0, 0, 10, 10, "AI Lab"),
        {"type": "seat", "x": 2, "y": 2, "rotation": 0},
        {"type": "table", "x": 4, "y": 4, "w": 2, "h": 1, "rotation": 0},
    ])
    assert r.status_code == 200, r.get_json()


def test_zone_larger_than_20(client, admin_token):
    plan = _mk_plan(client, admin_token)
    assert _save(client, admin_token, plan["id"], [_zone(0, 0, 30, 25)]).status_code == 200
    r = _save(client, admin_token, plan["id"], [{"type": "table", "x": 0, "y": 0, "w": 21, "h": 1, "rotation": 0}])
    assert r.status_code == 400 and "between 1 and 20" in _problems(r)


def test_zones_may_not_overlap(client, admin_token):
    plan = _mk_plan(client, admin_token)
    r = _save(client, admin_token, plan["id"], [_zone(0, 0, 5, 5), _zone(4, 4, 5, 5)])
    assert r.status_code == 400 and "(zone) overlaps element 0" in _problems(r)


def test_zone_rotation_refused(client, admin_token):
    plan = _mk_plan(client, admin_token)
    r = _save(client, admin_token, plan["id"], [_zone(0, 0, 5, 5, rotation=90)])
    assert r.status_code == 400 and "zones cannot be rotated" in _problems(r)


def test_shrinking_grid_rejects_zone_outside(client, admin_token):
    plan = _mk_plan(client, admin_token)
    assert _save(client, admin_token, plan["id"], [_zone(0, 0, 25, 5)]).status_code == 200
    r = client.patch(_url(plan["id"]), headers=hdr(admin_token), json={"cols": 20})
    assert r.status_code == 400 and "fall outside the new grid" in _problems(r)


def test_zone_snapshot_on_publish(client, admin_token):
    plan = _mk_plan(client, admin_token)
    assert _save(client, admin_token, plan["id"], [
        _zone(0, 0, 22, 6, "Digital Factory"),
        {"type": "seat", "x": 1, "y": 1, "rotation": 0, "open_to_all": True},
    ]).status_code == 200
    assert client.post(_url(plan["id"], "/publish"), headers=hdr(admin_token)).status_code == 200
    pub = client.get(_url(plan["id"], "/published"), headers=hdr(admin_token)).get_json()
    zone = next(e for e in pub["elements"] if e["type"] == "zone")
    assert (zone["label"], zone["w"], zone["h"]) == ("Digital Factory", 22, 6)


# --- Task 2: zone_summary and zones on the floor payloads --------------------------------------

def _el(type_, x, y, w=1, h=1, label=None, color=None, eid=None):
    return SimpleNamespace(type=type_, x=x, y=y, w=w, h=h, label=label, color=color, element_id=eid or f"{type_}-{x}-{y}")


def _seat(x, y, state):
    return {"id": f"s{x}{y}", "x": x, "y": y, "state": state}


def test_zone_summary_edges():
    from app.desk.zones import zone_summary
    zone = _el("zone", 2, 2, 3, 2, label="Z", color="#10b981", eid="z1")
    seats = [_seat(4, 3, "available"), _seat(2, 2, "occupied"), _seat(5, 3, "booked"), _seat(4, 4, "available")]
    rows = zone_summary([zone], seats)
    assert rows == [
        {"id": "z1", "name": "Z", "x": 2, "y": 2, "w": 3, "h": 2, "color": "#10b981",
         "total": 2, "free": 1, "occupied": 1, "booked": 0, "pct": 50},
        {"id": None, "name": "No zone", "x": None, "y": None, "w": None, "h": None, "color": None,
         "total": 2, "free": 1, "occupied": 0, "booked": 1, "pct": 50},
    ]


def test_zone_summary_not_bookable_excluded():
    from app.desk.zones import zone_summary
    rows = zone_summary([_el("zone", 0, 0, 2, 2, label="A", eid="a"), _el("zone", 5, 5, 2, 2, label="B", eid="b")],
                        [_seat(0, 0, "available"), _seat(1, 1, "not_bookable"), _seat(5, 5, "not_bookable")])
    by_name = {r["name"]: r for r in rows}
    assert (by_name["A"]["total"], by_name["A"]["pct"]) == (1, 0)
    assert (by_name["B"]["total"], by_name["B"]["pct"]) == (0, None)
    assert "No zone" not in by_name


def test_zone_summary_unnamed():
    from app.desk.zones import zone_summary
    rows = zone_summary([_el("zone", 0, 0, label=None, eid="a"), _el("zone", 3, 3, label="  ", eid="b")], [])
    assert [r["name"] for r in rows] == ["Unnamed zone", "Unnamed zone"]


def test_zone_summary_whole_floor():
    from app.desk.zones import zone_summary
    rows = zone_summary([_el("table", 0, 0, 2, 1)],
                        [_seat(0, 1, "available"), _seat(1, 1, "booked"), _seat(2, 1, "occupied"), _seat(3, 1, "not_bookable")])
    assert [(r["name"], r["id"], r["total"], r["pct"]) for r in rows] == [("Whole floor", None, 3, 67)]


def test_zone_summary_sorted_by_name():
    from app.desk.zones import zone_summary
    rows = zone_summary([_el("zone", 0, 0, label="beta", eid="b"), _el("zone", 3, 0, label="Alpha", eid="a")], [])
    assert [r["name"] for r in rows] == ["Alpha", "beta"]


def _republish_with_zone(client, world, zone, retag=None):
    """Keep the draft's seats (optionally re-tagged by label) and add `zone`, then publish."""
    tok = world["tok"]["root"]
    draft = client.get(f"/api/admin/floor-plans/{world['plan']}", headers=dhdr(tok)).get_json()["elements"]
    kept = [(retag or {}).get(e["label"], lambda x: x)(e) for e in draft if e["type"] != "zone"]
    r = client.put(f"/api/admin/floor-plans/{world['plan']}/elements", headers=dhdr(tok), json={"elements": kept + [zone]})
    assert r.status_code == 200, r.get_json()
    assert client.post(f"/api/admin/floor-plans/{world['plan']}/publish", headers=dhdr(tok)).status_code == 200


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def test_floor_payload_has_zones(client, world):
    _republish_with_zone(client, world, _zone(0, 0, 4, 1, "Z"))
    public = client.get(f"/api/public/floors/{world['plan']}").get_json()["zones"]
    assert [(z["name"], z["total"], z["free"], z["x"], z["w"]) for z in public] == [("Z", 2, 2, 0, 4)]
    desk = client.get(f"/api/desk/floors/{world['plan']}", headers=dhdr(world["tok"]["jane"])).get_json()["zones"]
    assert desk == public
