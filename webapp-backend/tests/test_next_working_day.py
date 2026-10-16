"""On a Friday the next bookable day is Monday (owner 2026-10-16): the API says which two days are bookable."""
from datetime import timedelta

import pytest

from desk_helpers import DAY, book, build_world, hdr, set_now, sg

MONDAY = DAY + timedelta(days=3)    # DAY is Friday 16 Oct 2026


@pytest.fixture()
def world(client, db, monkeypatch):
    w = build_world(client, monkeypatch)
    set_now(monkeypatch, sg(DAY, 9))
    return w


def test_floors_list_names_the_bookable_days(client, world):
    body = client.get("/api/desk/floors", headers=hdr(world["tok"]["jane"])).get_json()
    assert body["days"] == [DAY.isoformat(), MONDAY.isoformat()]


def test_friday_shows_and_books_monday_not_saturday(client, world):
    jane = hdr(world["tok"]["jane"])
    assert client.get(f"/api/desk/floors/{world['plan']}?date={MONDAY.isoformat()}", headers=jane).status_code == 200
    r = client.get(f"/api/desk/floors/{world['plan']}?date={(DAY + timedelta(days=1)).isoformat()}", headers=jane)
    assert r.status_code == 400 and "next working day" in r.get_json()["error"]
    assert book(client, world, "jane", "F1", "am", day=MONDAY).status_code == 201
    mine = client.get("/api/desk/bookings/mine", headers=jane).get_json()["items"]
    assert [b["date"] for b in mine] == [MONDAY.isoformat()]
