"""Admin-configured public displays and floor capacity (spec 2026-10-15-floor-dashboard §3-5)."""
import pytest

from app.core.db import run_one
from desk_helpers import DAY, book, build_world, hdr, set_now, sg


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def _create(client, world, **over):
    body = {"name": "Office A lobby", "slug": "office-a", "plan_ids": [world["plan"]],
            "show_overall": True, "layout": "rotate", "rotate_seconds": 20, **over}
    return client.post("/api/admin/displays", headers=hdr(world["tok"]["root"]), json=body)


def test_admin_crud_and_audit(client, world):
    root = hdr(world["tok"]["root"])
    r = _create(client, world)
    assert r.status_code == 201, r.get_json()
    d = r.get_json()
    assert d["slug"] == "office-a" and d["floors"] == [{"id": world["plan"], "name": "Level 1", "published": True}]
    assert client.get("/api/admin/displays", headers=root).get_json()["items"][0]["id"] == d["id"]
    r = client.patch(f"/api/admin/displays/{d['id']}", headers=root, json={"layout": "grid", "name": "Lobby"})
    assert r.status_code == 200 and r.get_json()["layout"] == "grid" and r.get_json()["name"] == "Lobby"
    assert client.delete(f"/api/admin/displays/{d['id']}", headers=root).status_code == 204
    for action in ("display.create", "display.update", "display.delete"):
        assert run_one("select 1 from audit_logs where action = :a", {"a": action})
    assert client.get("/api/admin/displays", headers=hdr(world["tok"]["jane"])).status_code == 403


def test_validation(client, world):
    assert _create(client, world).status_code == 201
    cases = [({"slug": "Office A"}, "slug"), ({"slug": "-a"}, "slug"), ({"rotate_seconds": 5}, "rotate_seconds"),
             ({"layout": "carousel"}, "layout"), ({"name": ""}, "name"),
             ({"plan_ids": ["00000000-0000-0000-0000-000000000001"]}, "plan_ids"), ({"plan_ids": "x"}, "plan_ids")]
    for over, field in cases:
        r = _create(client, world, **{"slug": "other", **over})
        assert r.status_code == 400 and field in r.get_json()["fields"], (over, r.get_json())
    dup = _create(client, world, name="Again")
    assert dup.status_code == 409


def test_public_display_lists_floors_in_order(client, world):
    root = hdr(world["tok"]["root"])
    draft = client.post("/api/admin/floor-plans", headers=root, json={"name": "Level 2", "cols": 10, "rows": 10}).get_json()
    gone = client.post("/api/admin/floor-plans", headers=root, json={"name": "Old", "cols": 10, "rows": 10}).get_json()
    assert _create(client, world, plan_ids=[draft["id"], world["plan"], gone["id"]]).status_code == 201
    client.delete(f"/api/admin/floor-plans/{gone['id']}", headers=root)
    d = client.get("/api/public/displays/office-a").get_json()
    assert d["name"] == "Office A lobby"
    assert [(f["name"], f["published"]) for f in d["floors"]] == [("Level 2", False), ("Level 1", True)]
    assert client.get("/api/public/displays/nope").status_code == 404


def test_public_floor_summary_and_department_names(client, world, monkeypatch):
    set_now(monkeypatch, sg(DAY, 9))
    assert book(client, world, "carl", "F2").status_code == 201                       # booked now
    assert client.post(f"/api/desk/seats/{world['seats']['E1']}/check-in", headers=hdr(world["tok"]["dina"])).status_code == 201
    floor = client.get(f"/api/public/floors/{world['plan']}").get_json()
    assert floor["summary"] == {"bookable": 3, "available": 1, "booked": 1, "occupied": 1, "occupancy_pct": 33}
    names = {s["label"]: s["department"] for s in floor["seats"]}
    assert names == {"F1": "Free for all", "F2": "Free for all", "E1": "Design", "U1": None}


def test_floors_carry_each_seats_team_colour(client, world):
    """Seat maps fill available chairs with the project team's colour; null means use the automatic one."""
    run_one("update departments set color = '#123abc' where id = cast(:d as uuid) returning id", {"d": world["design"]})
    public = client.get(f"/api/public/floors/{world['plan']}").get_json()["seats"]
    desk = client.get(f"/api/desk/floors/{world['plan']}", headers=hdr(world["tok"]["dina"])).get_json()["seats"]
    for seats in (public, desk):
        assert {s["label"]: s["team_color"] for s in seats} == {"F1": None, "F2": None, "E1": "#123abc", "U1": None}


def test_signed_in_users_can_list_displays_for_the_floor_overview(client, world):
    """Floor overview (owner 2026-10-16) shows what a display shows; anyone signed in can pick one."""
    assert _create(client, world, name="Office B", slug="office-b").status_code == 201
    assert _create(client, world).status_code == 201
    r = client.get("/api/desk/displays", headers=hdr(world["tok"]["jane"]))
    assert r.status_code == 200
    assert r.get_json()["items"] == [{"name": "Office A lobby", "slug": "office-a"}, {"name": "Office B", "slug": "office-b"}]
    assert client.get("/api/desk/displays").status_code == 401


def test_overview_lists_only_displays_that_show_a_published_floor(client, world):
    root = hdr(world["tok"]["root"])
    draft = client.post("/api/admin/floor-plans", headers=root, json={"name": "Draft floor", "cols": 5, "rows": 5}).get_json()
    assert _create(client, world).status_code == 201                                            # Level 1 (published)
    assert _create(client, world, name="Draft only", slug="draft-only", plan_ids=[draft["id"]]).status_code == 201
    items = client.get("/api/desk/displays", headers=hdr(world["tok"]["jane"])).get_json()["items"]
    assert [i["slug"] for i in items] == ["office-a"]
