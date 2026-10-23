"""Insights team seat planning: seats required (saved per team), allocated, and utilisation (most in at once)."""
from datetime import datetime

import pytest

from app.admin.team_seat_plan import peak_at_once
from desk_helpers import DAY, build_world, hdr, set_now, sg

URL = "/api/admin/insights/team-seats"


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def _in(client, world, who, seat):
    assert client.post(f"/api/desk/seats/{world['seats'][seat]}/check-in", headers=hdr(world["tok"][who])).status_code == 201


def _day(client, world, monkeypatch):
    """Engineering: Jane 08:10-08:40, Carl 08:20 on (two at once, twice). Dina (Engineering and Design) 09:00 on."""
    for hh, mm, action in ((8, 10, lambda: _in(client, world, "jane", "F1")),
                           (8, 20, lambda: _in(client, world, "carl", "F2")),
                           (8, 40, lambda: client.post(f"/api/desk/seats/{world['seats']['F1']}/give-up",
                                                       headers=hdr(world["tok"]["jane"]))),
                           (9, 0, lambda: _in(client, world, "dina", "E1"))):
        set_now(monkeypatch, sg(DAY, hh, mm))
        action()
    set_now(monkeypatch, sg(DAY, 10))


def test_peak_at_once():
    t = lambda h, m=0: datetime(2026, 10, 16, h, m)
    assert peak_at_once([]) == 0
    assert peak_at_once([(t(8), t(9)), (t(8, 30), t(10)), (t(9, 30), t(11))]) == 2
    assert peak_at_once([(t(8), t(9)), (t(9), t(10))]) == 1                  # one leaves as the other arrives
    assert peak_at_once([(t(8), t(12)), (t(9), t(10)), (t(9, 30), t(11))]) == 3


def test_admins_only_and_days_checked(client, world):
    assert client.get(URL, headers=hdr(world["tok"]["jane"])).status_code == 403
    for bad in ("5", "abc", "0"):
        r = client.get(URL, query_string={"days": bad}, headers=hdr(world["tok"]["root"]))
        assert r.status_code == 400 and "days" in r.get_json()["fields"]


def test_required_allocated_and_utilisation(client, world, monkeypatch):
    _day(client, world, monkeypatch)
    root = hdr(world["tok"]["root"])
    assert client.patch(f"/api/admin/departments/{world['eng']}", headers=root, json={"seats_required": 3}).status_code == 200
    body = client.get(URL, query_string={"days": 7}, headers=root).get_json()
    assert (body["days"], body["since"]) == (7, "2026-10-10")
    teams = {t["name"]: (t["required"], t["allocated"], t["utilisation"]) for t in body["teams"]}
    assert teams == {"Design": (None, 1, 1), "Engineering": (3, 0, 2), "Ops": (None, 0, 0)}
    assert client.get(URL, headers=root).get_json()["days"] == 30                        # the default


def test_seats_required_is_saved_cleared_and_checked(client, world):
    root, url = hdr(world["tok"]["root"]), f"/api/admin/departments/{world['ops']}"
    seats = lambda: next(t["required"] for t in client.get(URL, headers=root).get_json()["teams"] if t["name"] == "Ops")
    assert client.patch(url, headers=root, json={"seats_required": 12}).status_code == 200 and seats() == 12
    assert client.patch(url, headers=root, json={"seats_required": None}).status_code == 200 and seats() is None
    for bad in (-1, 501, 2.5, "4", True):
        r = client.patch(url, headers=root, json={"seats_required": bad})
        assert r.status_code == 400 and "seats_required" in r.get_json()["fields"], bad
    assert client.patch(url, headers=hdr(world["tok"]["jane"]), json={"seats_required": 1}).status_code == 403


PLAN = URL + "/plan"


def test_plan_is_saved_and_shown(client, world):
    root = hdr(world["tok"]["root"])
    planned = lambda: {t["name"]: t["planned"] for t in client.get(URL, headers=root).get_json()["teams"]}
    assert planned() == {"Design": None, "Engineering": None, "Ops": None}
    r = client.put(PLAN, headers=root, json={"plan": {world["eng"]: 3, world["ops"]: 0}})
    assert r.status_code == 200 and r.get_json() == {"saved": 2}
    assert planned() == {"Design": None, "Engineering": 3, "Ops": 0}
    assert client.put(PLAN, headers=root, json={"plan": {world["eng"]: None}}).status_code == 200
    assert planned() == {"Design": None, "Engineering": None, "Ops": 0}         # teams not sent are left alone


def test_plan_is_checked(client, world):
    root = hdr(world["tok"]["root"])
    assert client.put(PLAN, headers=hdr(world["tok"]["jane"]), json={"plan": {}}).status_code == 403
    for bad in (None, [], {world["eng"]: -1}, {world["eng"]: 501}, {world["eng"]: 2.5}, {world["eng"]: True},
                {"00000000-0000-0000-0000-000000000000": 1}, {"abc": 1}):
        r = client.put(PLAN, headers=root, json={"plan": bad})
        assert r.status_code == 400 and "plan" in r.get_json()["fields"], bad
    assert client.put(PLAN, headers=root, json={"plan": {}}).get_json() == {"saved": 0}
