"""Insights occupancy chart: GET /api/admin/insights/occupancy?range= (seats in use over time)."""
import pytest

from desk_helpers import DAY, build_world, hdr, set_now, sg

URL = "/api/admin/insights/occupancy"


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def _occ(client, world, rng):
    r = client.get(URL, query_string={"range": rng}, headers=hdr(world["tok"]["root"]))
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def _carl_in_at_nine(client, world, monkeypatch):
    set_now(monkeypatch, sg(DAY, 9))
    assert client.post(f"/api/desk/seats/{world['seats']['E1']}/check-in", headers=hdr(world["tok"]["dina"])).status_code == 201
    set_now(monkeypatch, sg(DAY, 10))


def test_admins_only_and_range_checked(client, world):
    assert client.get(URL, query_string={"range": "24h"}, headers=hdr(world["tok"]["jane"])).status_code == 403
    assert client.get(URL, query_string={"range": "2y"}, headers=hdr(world["tok"]["root"])).status_code == 400


def test_one_hour_samples_every_five_minutes(client, world, monkeypatch):
    _carl_in_at_nine(client, world, monkeypatch)
    body = _occ(client, world, "1h")
    assert body["capacity"] == 3 and body["aggregate"] == "sample"                 # F1, F2 (free for all), E1 (team); U1 untagged
    assert len(body["points"]) == 13                                               # 09:00 .. 10:00 every 5 minutes
    assert all(p["pct"] == 33.3 and p["peak"] is None for p in body["points"])
    assert body["points"][0]["t"].startswith("2026-10-16T09:00") or body["points"][0]["t"].startswith("2026-10-16T01:00")


def test_six_hours_shows_before_and_after(client, world, monkeypatch):
    _carl_in_at_nine(client, world, monkeypatch)
    pts = _occ(client, world, "6h")["points"]                                      # 04:00 .. 10:00 every 15 minutes
    assert len(pts) == 25
    assert [p["pct"] for p in pts[:20]] == [0.0] * 20 and [p["pct"] for p in pts[20:]] == [33.3] * 5


def test_seven_days_hourly_average_and_peak(client, world, monkeypatch):
    _carl_in_at_nine(client, world, monkeypatch)
    body = _occ(client, world, "7d")
    assert body["aggregate"] == "hourly"
    busy = [p for p in body["points"] if p["pct"] > 0]                             # 09:00 hour and the current 10:00 hour
    assert len(body["points"]) == 168 and len(busy) == 2
    assert (busy[0]["pct"], busy[0]["peak"]) == (33.3, 33.3)


def test_thirty_days_daily(client, world, monkeypatch):
    _carl_in_at_nine(client, world, monkeypatch)
    body = _occ(client, world, "30d")
    assert body["aggregate"] == "daily" and len(body["points"]) == 30
    today = body["points"][-1]
    assert today["peak"] == 33.3 and 0 < today["pct"] < 33.3                      # in use for part of the day only
