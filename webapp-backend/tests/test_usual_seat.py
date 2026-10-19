"""Usual seat and auto-booking (spec 2026-10-16-usual-seat-and-auto-book-design)."""
from datetime import timedelta

import pytest

from creds import sign_in
from desk_helpers import DAY, book, build_world, hdr, set_now, sg

THU = DAY - timedelta(days=1)   # build_world's clock starts Thursday 15 Oct 2026, 15:00


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def _set_usual(client, world, who, seat):
    r = client.patch(f"/api/admin/users/{world['users'][who]}", headers=hdr(world["tok"]["root"]),
                     json={"usual_seat_id": world["seats"][seat] if seat else None})
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def _auto_on(client, world, who):
    r = client.patch("/api/desk/me", headers=hdr(world["tok"][who]), json={"auto_book": True})
    assert r.status_code == 200, r.get_json()


def _dash(client, world, who):
    return client.get("/api/desk/dashboard", headers=hdr(world["tok"][who])).get_json()


# --- usual seat (admins) -----------------------------------------------------------------------

def test_admin_sets_and_clears_usual_seat(client, world):
    assert _set_usual(client, world, "jane", "F1")["usual_seat_id"] == world["seats"]["F1"]
    assert _set_usual(client, world, "jane", None)["usual_seat_id"] is None


def test_usual_seat_must_be_published(client, world):
    r = client.patch(f"/api/admin/users/{world['users']['jane']}", headers=hdr(world["tok"]["root"]),
                     json={"usual_seat_id": "6f1d5c1e-0000-4000-8000-000000000000"})
    assert r.status_code == 400 and r.get_json()["fields"]["usual_seat_id"] == "choose a seat on a published floor plan"


def test_me_shows_usual_seat_and_auto_book(client, world):
    _set_usual(client, world, "jane", "F1")
    me = client.get("/api/desk/me", headers=hdr(world["tok"]["jane"])).get_json()
    assert me["auto_book"] is False
    assert (me["usual_seat"]["seat_label"], me["usual_seat"]["plan_name"], me["usual_seat"]["bookable"]) == ("F1", "Level 1", True)
    _auto_on(client, world, "jane")
    assert client.get("/api/desk/me", headers=hdr(world["tok"]["jane"])).get_json()["auto_book"] is True
    assert client.patch("/api/desk/me", headers=hdr(world["tok"]["jane"]), json={"auto_book": "yes"}).status_code == 400


def test_team_seat_is_not_bookable(client, world):
    _set_usual(client, world, "dina", "E1")
    assert client.get("/api/desk/me", headers=hdr(world["tok"]["dina"])).get_json()["usual_seat"]["bookable"] is False


# --- where it shows ---------------------------------------------------------------------------

def test_finder_and_dashboard_show_usual_seat(client, world):
    _set_usual(client, world, "dina", "E1")
    [dina] = client.get("/api/desk/people", query_string={"q": "dina"}, headers=hdr(world["tok"]["jane"])).get_json()["items"]
    assert (dina["status"], dina["usual_seat"]["seat_label"], dina["usual_seat"]["plan_id"]) == ("away", "E1", world["plan"])
    assert _dash(client, world, "dina")["usual_seat"]["seat_label"] == "E1"
    [bob] = client.get("/api/desk/people", query_string={"q": "bob"}, headers=hdr(world["tok"]["jane"])).get_json()["items"]
    assert bob["usual_seat"] is None


# --- auto-booking -----------------------------------------------------------------------------

def test_auto_book_today_and_tomorrow_once(client, world):
    _set_usual(client, world, "jane", "F1")
    _auto_on(client, world, "jane")
    notes = _dash(client, world, "jane")["auto_book"]
    assert [(n["date"], n["seat_label"], n["ok"]) for n in notes] == [(THU.isoformat(), "F1", True), (DAY.isoformat(), "F1", True)]
    body = _dash(client, world, "jane")
    assert body["auto_book"] == []                                                       # already booked: nothing new
    assert [(u["date"], u["seat_label"], u["preset"]) for u in body["upcoming"]] == [(THU.isoformat(), "F1", "full"), (DAY.isoformat(), "F1", "full")]


def test_auto_book_off_or_team_seat_does_nothing(client, world):
    _set_usual(client, world, "jane", "F1")
    assert _dash(client, world, "jane")["auto_book"] == []                                # switch off
    _set_usual(client, world, "dina", "E1")
    _auto_on(client, world, "dina")
    assert _dash(client, world, "dina")["auto_book"] == []                                # team seat: no booking needed


def test_auto_book_reports_a_taken_seat(client, world):
    assert book(client, world, "ali", "F1", "full").status_code == 201                  # ali has F1 on Friday
    _set_usual(client, world, "jane", "F1")
    _auto_on(client, world, "jane")
    notes = {n["date"]: n for n in _dash(client, world, "jane")["auto_book"]}
    assert notes[THU.isoformat()]["ok"] is True
    assert notes[DAY.isoformat()]["ok"] is False and notes[DAY.isoformat()]["message"]


def test_auto_book_skips_weekends(client, world, monkeypatch):
    _set_usual(client, world, "jane", "F1")
    _auto_on(client, world, "jane")
    set_now(monkeypatch, sg(DAY + timedelta(days=1), 9))                                 # Saturday: next working day is Monday
    notes = _dash(client, world, "jane")["auto_book"]
    assert [(n["date"], n["ok"]) for n in notes] == [((DAY + timedelta(days=3)).isoformat(), True)]


def test_auto_book_on_sign_in(client, world):
    _set_usual(client, world, "jane", "F1")
    _auto_on(client, world, "jane")
    r = sign_in(client, "jane")
    assert r.status_code == 200
    mine = client.get("/api/desk/bookings/mine", headers=hdr(world["tok"]["jane"])).get_json()["items"]
    assert sorted(b["date"] for b in mine) == [THU.isoformat(), DAY.isoformat()]
