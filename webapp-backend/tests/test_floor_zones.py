"""Floor zones: the zone element type, seat membership and utilisation by zone (spec 2026-10-15-floor-zones)."""
import pytest

from app.core.db import run_one
from app.core.security import hash_password

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
