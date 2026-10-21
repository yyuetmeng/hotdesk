"""Door swing setting: which way a door opens and where its hinge is (owner request 2026-10-21)."""
import pytest

from test_floor_zones import _mk_plan, _save, _url, admin_token, hdr   # noqa: F401


def test_catalog_default_is_up_left(client, admin_token):
    items = client.get("/api/admin/floor-plans/catalog", headers=hdr(admin_token)).get_json()["items"]
    assert next(c for c in items if c["type"] == "door")["config"] == {"swing": "up-left"}


def test_swing_is_saved_and_published(client, admin_token):
    plan = _mk_plan(client, admin_token)
    doors = [{"type": "door", "x": 0, "y": 0, "rotation": 0, "config": {"swing": "right-bottom"}},
             {"type": "door", "x": 4, "y": 0, "rotation": 0}]                     # no setting: the old drawing
    assert _save(client, admin_token, plan["id"], doors).status_code == 200
    draft = client.get(_url(plan["id"]), headers=hdr(admin_token)).get_json()["elements"]
    assert sorted(e["config"]["swing"] for e in draft) == ["right-bottom", "up-left"]
    assert client.post(_url(plan["id"], "/publish"), headers=hdr(admin_token)).status_code == 200
    pub = client.get(_url(plan["id"], "/published"), headers=hdr(admin_token)).get_json()["elements"]
    assert sorted(e["config"]["swing"] for e in pub) == ["right-bottom", "up-left"]


@pytest.mark.parametrize("value", ["up", "UP-LEFT", "left-left", ""])
def test_unknown_swing_is_refused(client, admin_token, value):
    plan = _mk_plan(client, admin_token)
    r = _save(client, admin_token, plan["id"], [{"type": "door", "x": 0, "y": 0, "rotation": 0, "config": {"swing": value}}])
    assert r.status_code == 400 and "swing must be one of" in str(r.get_json())
