"""Toilet gender setting: All-gender / Male / Female (owner request 2026-10-16)."""
import pytest

from test_floor_zones import _mk_plan, _save, _url, admin_token, hdr   # noqa: F401


def test_catalog_default_is_all_gender(client, admin_token):
    items = client.get("/api/admin/floor-plans/catalog", headers=hdr(admin_token)).get_json()["items"]
    assert next(c for c in items if c["type"] == "toilet")["config"] == {"gender": "unisex"}


def test_gender_is_saved_and_published(client, admin_token):
    plan = _mk_plan(client, admin_token)
    toilets = [{"type": "toilet", "x": 0, "y": 0, "rotation": 0, "config": {"gender": "female"}},
               {"type": "toilet", "x": 4, "y": 0, "rotation": 0}]                     # no setting: all-gender
    assert _save(client, admin_token, plan["id"], toilets).status_code == 200
    draft = client.get(_url(plan["id"]), headers=hdr(admin_token)).get_json()["elements"]
    assert sorted(e["config"]["gender"] for e in draft) == ["female", "unisex"]
    assert client.post(_url(plan["id"], "/publish"), headers=hdr(admin_token)).status_code == 200
    pub = client.get(_url(plan["id"], "/published"), headers=hdr(admin_token)).get_json()["elements"]
    assert sorted(e["config"]["gender"] for e in pub) == ["female", "unisex"]


@pytest.mark.parametrize("value", ["other", "MALE", ""])
def test_unknown_gender_is_refused(client, admin_token, value):
    plan = _mk_plan(client, admin_token)
    r = _save(client, admin_token, plan["id"], [{"type": "toilet", "x": 0, "y": 0, "rotation": 0, "config": {"gender": value}}])
    assert r.status_code == 400 and "gender must be one of unisex, male, female" in str(r.get_json())
