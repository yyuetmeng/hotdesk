"""Colleague Finder: GET /api/desk/people?q= (where a colleague is now, or is booked to be)."""
from datetime import timedelta

import pytest

from desk_helpers import DAY, book, build_world, hdr, set_now, sg

URL = "/api/desk/people"


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def _find(client, world, q, who="jane"):
    r = client.get(URL, query_string={"q": q}, headers=hdr(world["tok"][who]))
    assert r.status_code == 200, r.get_json()
    return r.get_json()["items"]


def test_requires_sign_in(client, world):
    assert client.get(URL, query_string={"q": "carl"}).status_code == 401


def test_short_query_returns_nothing(client, world):
    assert _find(client, world, "c") == []
    assert _find(client, world, "  ") == []


def test_statuses(client, world, monkeypatch):
    assert book(client, world, "ali", "F2", "pm").status_code == 201                                   # today PM
    set_now(monkeypatch, sg(DAY, 9))
    assert book(client, world, "root", "F1", "full", day=DAY + timedelta(days=1)).status_code == 201   # tomorrow
    assert client.post(f"/api/desk/seats/{world['seats']['E1']}/check-in", headers=hdr(world["tok"]["carl"])).status_code == 201
    [carl] = _find(client, world, "carl")
    assert (carl["name"], carl["status"], carl["seat"]["seat_label"], carl["seat"]["plan_name"], carl["since"]) == \
        ("Carl Lim", "checked_in", "E1", "Level 1", "09:00")
    assert carl["seat"]["seat_id"] == world["seats"]["E1"] and carl["seat"]["plan_id"] == world["plan"]
    assert carl["teams"] == ["Engineering"] and carl["initials"] == "CL"
    [ali] = _find(client, world, "ali")
    assert (ali["status"], ali["seat"]["seat_label"], ali["preset"]) == ("booked", "F2", "pm")
    [root] = _find(client, world, "root")
    assert (root["status"], root["seat"]["seat_label"], root["date"]) == ("tomorrow", "F1", (DAY + timedelta(days=1)).isoformat())
    [bob] = _find(client, world, "bob")
    assert (bob["status"], bob["seat"]) == ("away", None)


def test_search_by_username_and_inactive_hidden(client, world):
    assert [p["name"] for p in _find(client, world, "rahman")] == ["Ali Rahman"]
    assert [p["name"] for p in _find(client, world, "carl")] == ["Carl Lim"]     # username match too
    assert _find(client, world, "dave") == []                                      # inactive


def test_results_are_sorted_by_name(client, world):
    people = _find(client, world, "an")                            # Jane Tan, Ali Rahman
    assert len(people) == 2
    assert [p["name"] for p in people] == sorted(p["name"] for p in people)
