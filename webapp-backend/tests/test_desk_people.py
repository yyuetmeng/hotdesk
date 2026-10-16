"""Colleague Finder: GET /api/desk/people?q= (where a colleague is now, or is booked to be)."""
from datetime import timedelta

import pytest

from desk_helpers import DAY, book, build_world, hdr, set_now, sg

URL = "/api/desk/people"


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def _find(client, world, q, who="jane", **extra):
    r = client.get(URL, query_string={"q": q, **extra}, headers=hdr(world["tok"][who]))
    assert r.status_code == 200, r.get_json()
    return r.get_json()["items"]


def test_requires_sign_in(client, world):
    assert client.get(URL, query_string={"q": "carl"}).status_code == 401


def test_empty_query_lists_everyone_active(client, world):
    names = [p["name"] for p in _find(client, world, "  ")]
    assert names == ["Ali Rahman", "Bob Ong", "Carl Lim", "Jane Tan"]       # dave is inactive; Root Admin is an admin


def test_team_filter(client, world):
    assert [p["name"] for p in _find(client, world, "", team=world["ops"])] == ["Bob Ong"]
    assert [p["name"] for p in _find(client, world, "a", team=world["eng"])] == ["Ali Rahman", "Carl Lim", "Jane Tan"]
    assert client.get(URL, query_string={"team": "nope"}, headers=hdr(world["tok"]["jane"])).status_code == 400


def test_teams_list_for_everyone(client, world):
    r = client.get("/api/desk/teams", headers=hdr(world["tok"]["jane"]))
    assert r.status_code == 200
    assert [t["name"] for t in r.get_json()["items"]] == ["Engineering", "Ops"]


def test_statuses(client, world, monkeypatch):
    assert book(client, world, "ali", "F2", "pm").status_code == 201                                   # today PM
    set_now(monkeypatch, sg(DAY, 9))
    assert book(client, world, "bob", "F1", "full", day=DAY + timedelta(days=3)).status_code == 201    # Monday: next working day
    assert client.post(f"/api/desk/seats/{world['seats']['E1']}/check-in", headers=hdr(world["tok"]["carl"])).status_code == 201
    [carl] = _find(client, world, "carl")
    assert (carl["name"], carl["status"], carl["seat"]["seat_label"], carl["seat"]["plan_name"], carl["since"]) == \
        ("Carl Lim", "checked_in", "E1", "Level 1", "09:00")
    assert carl["seat"]["seat_id"] == world["seats"]["E1"] and carl["seat"]["plan_id"] == world["plan"]
    assert carl["teams"] == ["Engineering"] and carl["initials"] == "CL"
    [ali] = _find(client, world, "ali")
    assert (ali["status"], ali["seat"]["seat_label"], ali["preset"]) == ("booked", "F2", "pm")
    [bob] = _find(client, world, "bob")
    assert (bob["status"], bob["seat"]["seat_label"], bob["date"]) == ("tomorrow", "F1", (DAY + timedelta(days=3)).isoformat())
    [jane] = _find(client, world, "jane")
    assert (jane["status"], jane["seat"]) == ("away", None)


def test_search_by_username_and_inactive_hidden(client, world):
    assert [p["name"] for p in _find(client, world, "rahman")] == ["Ali Rahman"]
    assert [p["name"] for p in _find(client, world, "carl")] == ["Carl Lim"]     # username match too
    assert _find(client, world, "dave") == []                                      # inactive


def test_results_are_sorted_by_name(client, world):
    people = _find(client, world, "an")                            # Jane Tan, Ali Rahman
    assert len(people) == 2
    assert [p["name"] for p in people] == sorted(p["name"] for p in people)


def test_administrators_are_not_listed(client, world):
    assert _find(client, world, "root") == []
    assert _find(client, world, "admin") == []
