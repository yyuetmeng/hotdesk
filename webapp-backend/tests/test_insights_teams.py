"""Insights: project teams today (+ Excel export) and recent activity."""
import io
import zipfile

import pytest

from desk_helpers import DAY, book, build_world, hdr, set_now, sg


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def _day(client, world, monkeypatch):
    """Jane: booking F1, in 08:10, out 08:40. Carl: walk-in E1 at 09:00, still in. Clock 10:00."""
    assert book(client, world, "jane", "F1", "am").status_code == 201
    set_now(monkeypatch, sg(DAY, 8, 10))
    assert client.post(f"/api/desk/seats/{world['seats']['F1']}/check-in", headers=hdr(world["tok"]["jane"])).status_code == 201
    set_now(monkeypatch, sg(DAY, 8, 40))
    assert client.post(f"/api/desk/seats/{world['seats']['F1']}/give-up", headers=hdr(world["tok"]["jane"])).status_code in (200, 204)
    set_now(monkeypatch, sg(DAY, 9))
    assert client.post(f"/api/desk/seats/{world['seats']['E1']}/check-in", headers=hdr(world["tok"]["carl"])).status_code == 201
    set_now(monkeypatch, sg(DAY, 10))


def test_admins_only(client, world):
    for url in ("/api/admin/insights/teams", "/api/admin/insights/teams.xlsx", "/api/admin/insights/activity"):
        assert client.get(url, headers=hdr(world["tok"]["jane"])).status_code == 403


def test_teams_today(client, world, monkeypatch):
    _day(client, world, monkeypatch)
    body = client.get("/api/admin/insights/teams", headers=hdr(world["tok"]["root"])).get_json()
    rows = {r["name"]: r for r in body["rows"]}
    assert list(rows) == ["Engineering", "Ops"]
    eng = rows["Engineering"]
    assert (eng["seats"], eng["in_now"], eng["check_ins"], eng["check_outs"], eng["people"]) == (1, 1, 2, 1, ["Carl Lim", "Jane Tan"])
    assert (rows["Ops"]["seats"], rows["Ops"]["in_now"], rows["Ops"]["check_ins"], rows["Ops"]["people"]) == (0, 0, 0, [])
    assert body["total"] == {"seats": 1, "in_now": 1, "check_ins": 2, "check_outs": 1, "people": 2}   # E1 is the only team seat
    assert body["date"] == DAY.isoformat()


def test_excel_export_has_two_sheets(client, world, monkeypatch):
    _day(client, world, monkeypatch)
    r = client.get("/api/admin/insights/teams.xlsx", headers=hdr(world["tok"]["root"]))
    assert r.status_code == 200
    assert r.mimetype == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert "project-teams-2026-10-16.xlsx" in r.headers["Content-Disposition"]
    book_ = zipfile.ZipFile(io.BytesIO(r.data))
    assert book_.testzip() is None
    workbook = book_.read("xl/workbook.xml").decode()
    assert 'name="Project teams"' in workbook and 'name="Check-ins"' in workbook
    summary = book_.read("xl/worksheets/sheet1.xml").decode()
    assert "Engineering" in summary and "Total" in summary and "In now" in summary and "Total seats" in summary
    lines = book_.read("xl/worksheets/sheet2.xml").decode()
    assert lines.count("<row ") == 3                                         # header + Jane + Carl
    assert "Carl Lim" in lines and "walk-in" in lines and "Jane Tan" in lines and "08:40" in lines and "F1" in lines


def test_recent_activity_newest_first(client, world, monkeypatch):
    _day(client, world, monkeypatch)
    items = client.get("/api/admin/insights/activity", headers=hdr(world["tok"]["root"])).get_json()["items"]
    assert [(i["kind"], i["person"], i["seat_label"]) for i in items] == [
        ("check_in", "Carl Lim", "E1"), ("check_out", "Jane Tan", "F1"), ("check_in", "Jane Tan", "F1")]
    assert items[0]["teams"] == ["Engineering"] and items[0]["plan_name"] == "Level 1"
    assert items[0]["at"].startswith("2026-10-16T09:00")


def test_recent_activity_is_capped_at_five(client, world, monkeypatch):
    for minute in (0, 10, 20):   # carl in/out three times: six events
        set_now(monkeypatch, sg(DAY, 9, minute))
        assert client.post(f"/api/desk/seats/{world['seats']['E1']}/check-in", headers=hdr(world["tok"]["carl"])).status_code == 201
        set_now(monkeypatch, sg(DAY, 9, minute + 5))
        assert client.post(f"/api/desk/seats/{world['seats']['E1']}/give-up", headers=hdr(world["tok"]["carl"])).status_code in (200, 204)
    items = client.get("/api/admin/insights/activity", headers=hdr(world["tok"]["root"])).get_json()["items"]
    assert len(items) == 5 and items[0]["kind"] == "check_out"


def test_line_data_per_team(client, world, monkeypatch):
    _day(client, world, monkeypatch)
    url = "/api/admin/insights/teams/lines"
    root = hdr(world["tok"]["root"])
    lines = client.get(url, headers=root).get_json()["items"]                              # all teams
    assert [(l["person"], l["seat"], l["method"], l["checked_in"], l["checked_out"], l["ended"]) for l in lines] == [
        ("Jane Tan", "F1", "booking", "08:10", "08:40", "checked out"), ("Carl Lim", "E1", "walk-in", "09:00", "", "still in")]
    assert lines[0]["username"] == "jane" and lines[0]["teams"] == "Engineering" and lines[0]["floor"] == "Level 1"
    assert len(client.get(url, query_string={"team": world["eng"]}, headers=root).get_json()["items"]) == 2
    assert client.get(url, query_string={"team": world["ops"]}, headers=root).get_json()["items"] == []
    assert client.get(url, query_string={"team": "none"}, headers=root).get_json()["items"] == []
    assert client.get(url, query_string={"team": "nope"}, headers=root).status_code == 400
    assert client.get(url, headers=hdr(world["tok"]["jane"])).status_code == 403
