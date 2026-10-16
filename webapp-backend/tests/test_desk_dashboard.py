"""Workspace dashboard: GET /api/desk/dashboard (spec 2026-10-16-workspace-dashboard-design §3)."""
from datetime import timedelta

import pytest

from desk_helpers import DAY, book, build_world, hdr, set_now, sg

URL = "/api/desk/dashboard"


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def _dash(client, world, who):
    r = client.get(URL, headers=hdr(world["tok"][who]))
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def _check_in(client, world, who, seat):
    r = client.post(f"/api/desk/seats/{world['seats'][seat]}/check-in", headers=hdr(world["tok"][who]))
    assert r.status_code == 201, r.get_json()


def _give_up(client, world, who, seat):
    r = client.post(f"/api/desk/seats/{world['seats'][seat]}/give-up", headers=hdr(world["tok"][who]))
    assert r.status_code in (200, 204), r.status_code


def test_dashboard_requires_sign_in(client, world):
    assert client.get(URL).status_code == 401


def test_current_and_upcoming(client, world, monkeypatch):
    assert book(client, world, "jane", "F1", "am").status_code == 201
    body = _dash(client, world, "jane")
    assert body["me"]["name"] == "Jane Tan" and [t["name"] for t in body["me"]["teams"]] == ["Engineering"]
    assert body["current"] is None
    assert [(u["seat_label"], u["plan_name"], u["date"], u["preset"], u["zone"]) for u in body["upcoming"]] == \
        [("F1", "Level 1", DAY.isoformat(), "am", None)]
    set_now(monkeypatch, sg(DAY, 8, 10))
    _check_in(client, world, "jane", "F1")
    body = _dash(client, world, "jane")
    assert (body["current"]["seat_label"], body["current"]["plan_name"]) == ("F1", "Level 1")
    assert body["upcoming"] == []          # the booking became a check-in


def test_upcoming_shows_who_booked_for_me(client, world):
    assert book(client, world, "ali", "F2", "pm", for_user="jane").status_code == 201
    [b] = _dash(client, world, "jane")["upcoming"]
    assert b["booked_by_name"] == "Ali Rahman"


def test_team_today_and_tomorrow(client, world, monkeypatch):
    assert book(client, world, "ali", "F2", "pm").status_code == 201                       # ali: today (DAY) PM
    assert book(client, world, "bob", "F1", "pm").status_code == 201                       # bob is in Ops: not shown
    set_now(monkeypatch, sg(DAY, 9))
    _check_in(client, world, "carl", "E1")
    assert book(client, world, "root", "F1", "full", day=DAY + timedelta(days=3)).status_code == 201  # root: Monday (next working day)
    [team] = _dash(client, world, "jane")["team"]
    assert (team["team_name"], team["size"]) == ("Engineering", 4)                         # dave is inactive
    assert [(m["name"], (m["today"] or {}).get("state"), bool(m["tomorrow"])) for m in team["members"]] == [
        ("Carl Lim", "checked_in", False), ("Ali Rahman", "booked", False), ("Root Admin", None, True)]
    assert team["members"][0]["today"]["seat_label"] == "E1" and team["members"][0]["initials"] == "CL"


def test_no_team(client, world):
    from app.core.db import run_write
    run_write("delete from user_departments where user_id = cast(:u as uuid)", {"u": world["users"]["jane"]})
    assert _dash(client, world, "jane")["team"] == []


def test_trend_and_history(client, world, monkeypatch):
    mon, tue = DAY - timedelta(days=4), DAY - timedelta(days=3)   # DAY is Friday 16 Oct 2026
    set_now(monkeypatch, sg(mon, 9)); _check_in(client, world, "carl", "E1")
    set_now(monkeypatch, sg(mon, 17, 30)); _give_up(client, world, "carl", "E1")
    set_now(monkeypatch, sg(tue, 8, 50)); _check_in(client, world, "carl", "E1")
    set_now(monkeypatch, sg(DAY, 9)); _check_in(client, world, "carl", "E1")   # Tuesday's ended automatically
    trend = _dash(client, world, "carl")["trend"]
    assert len(trend["days"]) == 10 and trend["days"][-1]["date"] == DAY.isoformat()
    assert all(d["weekday"] not in ("Sat", "Sun") for d in trend["days"])
    by_day = {d["date"]: d for d in trend["days"]}
    assert (by_day[mon.isoformat()]["check_in"], by_day[mon.isoformat()]["check_out"]) == ("09:00", "17:30")
    assert by_day[tue.isoformat()]["check_in"] == "08:50" and by_day[tue.isoformat()]["check_out"]
    assert trend["days_in_office"] == 3 and trend["usual_arrival"] == "09:00"
    history = _dash(client, world, "carl")["history"]
    assert [(h["date"], h["kind"], h["outcome"]) for h in history[:3]] == [
        (DAY.isoformat(), "walk_in", "checked_in"), (tue.isoformat(), "walk_in", "checked_in"), (mon.isoformat(), "walk_in", "checked_in")]
    assert (history[2]["from"], history[2]["to"]) == ("09:00", "17:30")


def test_history_booking_outcomes(client, world, monkeypatch):
    cancelled = book(client, world, "jane", "F2", "pm").get_json()["id"]
    assert client.delete(f"/api/desk/bookings/{cancelled}", headers=hdr(world["tok"]["jane"])).status_code == 204
    assert book(client, world, "jane", "F1", "am").status_code == 201
    set_now(monkeypatch, sg(DAY, 9))                                   # AM booking released at 08:30, no check-in
    outcomes = sorted(h["outcome"] for h in _dash(client, world, "jane")["history"])
    assert outcomes == ["cancelled", "released"]


def test_favourites(client, world, monkeypatch):
    assert book(client, world, "jane", "F1", "am").status_code == 201
    gone = book(client, world, "jane", "F2", "pm").get_json()["id"]
    assert client.delete(f"/api/desk/bookings/{gone}", headers=hdr(world["tok"]["jane"])).status_code == 204
    set_now(monkeypatch, sg(DAY, 8, 10)); _check_in(client, world, "jane", "F1")   # booking -> check-in: one use
    fav = _dash(client, world, "jane")["favourites"]
    assert [(f["seat_label"], f["count"], f["plan_name"]) for f in fav] == [("F1", 1, "Level 1")]   # cancelled F2 not counted
    assert fav[0]["seat_id"] == world["seats"]["F1"] and fav[0]["plan_id"] == world["plan"]


# --- review fixes -------------------------------------------------------------------------------

def test_today_is_the_calendar_day_even_at_weekends(client, world, monkeypatch):
    saturday = DAY + timedelta(days=1)
    set_now(monkeypatch, sg(saturday, 9))
    body = _dash(client, world, "jane")
    assert body["today"] == saturday.isoformat()
    assert body["trend"]["days"][-1]["date"] == DAY.isoformat()     # trend still ends on the last working day


def _republish_with_zone(client, world, zone):
    tok = world["tok"]["root"]
    draft = client.get(f"/api/admin/floor-plans/{world['plan']}", headers=hdr(tok)).get_json()["elements"]
    assert client.put(f"/api/admin/floor-plans/{world['plan']}/elements", headers=hdr(tok),
                      json={"elements": draft + [zone]}).status_code == 200
    assert client.post(f"/api/admin/floor-plans/{world['plan']}/publish", headers=hdr(tok)).status_code == 200


def test_zone_of_a_seat_is_shown(client, world):
    _republish_with_zone(client, world, {"type": "zone", "x": 0, "y": 0, "w": 2, "h": 1, "rotation": 0, "label": "Quiet Zone"})
    assert book(client, world, "jane", "F1", "am").status_code == 201
    assert book(client, world, "ali", "F2", "am").status_code == 201
    body = _dash(client, world, "jane")
    assert [(u["seat_label"], u["zone"]) for u in body["upcoming"]] == [("F1", "Quiet Zone")]   # F1 at x0: inside
    assert [(f["seat_label"], f["zone"]) for f in body["favourites"]] == [("F1", "Quiet Zone")]
    assert _dash(client, world, "ali")["upcoming"][0]["zone"] is None                            # F2 at x2: outside


def test_seats_no_longer_published_leave_favourites(client, world, monkeypatch):
    assert book(client, world, "jane", "F1", "am").status_code == 201
    set_now(monkeypatch, sg(DAY, 8, 10))
    _check_in(client, world, "jane", "F1")
    assert [f["seat_label"] for f in _dash(client, world, "jane")["favourites"]] == ["F1"]
    assert client.post(f"/api/admin/floor-plans/{world['plan']}/unpublish", headers=hdr(world["tok"]["root"])).status_code == 200
    assert _dash(client, world, "jane")["favourites"] == []


def test_team_only_shows_people_sharing_a_team(client, world):
    from app.core.db import run_write
    run_write("insert into user_departments (user_id, department_id) values (cast(:u as uuid), cast(:d as uuid))",
              {"u": world["users"]["ali"], "d": world["ops"]})                     # ali: Engineering and Ops
    assert book(client, world, "ali", "F2", "pm").status_code == 201
    assert book(client, world, "jane", "F1", "pm").status_code == 201              # jane: Engineering only
    [ops] = _dash(client, world, "bob")["team"]                                    # bob: Ops only
    assert ops["team_name"] == "Ops" and [m["name"] for m in ops["members"]] == ["Ali Rahman"]
    teams = _dash(client, world, "ali")["team"]
    assert [t["team_name"] for t in teams] == ["Engineering", "Ops"]
    assert [m["name"] for m in teams[0]["members"]] == ["Jane Tan"] and teams[1]["members"] == []
