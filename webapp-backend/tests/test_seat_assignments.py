"""Seat assignments: who is assigned to which seat, with an end date (spec 2026-10-19-seat-assignments)."""
from datetime import date

import pytest

from app.admin.seat_assignments import status_of
from app.core.db import run_one, run_query, run_write
from desk_helpers import build_world, hdr


def put(client, w, seat, who, **body):
    return client.put(f"/api/admin/seat-assignments/seats/{w['seats'][seat]}", headers=hdr(w["tok"]["root"]),
                      json={"user_id": w["users"][who], **body})


def current_rows():
    return run_query("select * from seat_assignments where closed_at is null")


def test_status_boundaries():
    today = date(2026, 10, 15)
    assert status_of(None, today) == "assigned"
    assert status_of(date(2026, 10, 29), today) == "leaving_soon"     # today + 14
    assert status_of(date(2026, 10, 30), today) == "assigned"         # today + 15
    assert status_of(date(2026, 10, 15), today) == "leaving_soon"     # last day is today
    assert status_of(date(2026, 10, 14), today) == "left"


def test_assign_lists_with_label_and_status(client, monkeypatch, db):
    w = build_world(client, monkeypatch)
    r = put(client, w, "E1", "jane", end_date="2026-10-20", note="Contract ends")
    assert r.status_code == 200
    item = client.get(f"/api/admin/seat-assignments?plan_id={w['plan']}", headers=hdr(w["tok"]["root"])).get_json()["items"][0]
    assert (item["seat_label"], item["person_name"], item["status"], item["seat_removed"]) == ("E1", "Jane Tan", "leaving_soon", False)


def test_change_end_date_keeps_one_row_and_audits_change(client, monkeypatch, db):
    w = build_world(client, monkeypatch); put(client, w, "E1", "jane")
    assert put(client, w, "E1", "jane", end_date="2026-12-31").status_code == 200
    assert len(current_rows()) == 1
    assert [r["action"] for r in run_query("select action from audit_logs where action like 'seat_assignment.%' order by id")] \
        == ["seat_assignment.create", "seat_assignment.change"]


def test_person_with_a_seat_needs_move_then_moves_keeping_history(client, monkeypatch, db):
    w = build_world(client, monkeypatch); put(client, w, "E1", "jane")
    r = put(client, w, "U1", "jane")
    assert r.status_code == 409 and r.get_json() == {"error": "Jane Tan already has seat E1.", "needs_move": True, "current_seat_label": "E1"}
    assert put(client, w, "U1", "jane", move=True).status_code == 200
    rows = run_query("select seat_label, closed_reason from seat_assignments order by created_at")
    assert [(r["seat_label"], r["closed_reason"]) for r in rows] == [("E1", "moved"), ("U1", None)]


def test_reassign_seat_closes_previous_person(client, monkeypatch, db):
    w = build_world(client, monkeypatch); put(client, w, "E1", "jane")
    assert put(client, w, "E1", "ali").status_code == 200
    assert run_one("select closed_reason from seat_assignments where person_name = 'Jane Tan'")["closed_reason"] == "reassigned"


def test_clear_keeps_history(client, monkeypatch, db):
    w = build_world(client, monkeypatch); a = put(client, w, "E1", "jane").get_json()
    assert client.delete(f"/api/admin/seat-assignments/{a['id']}", headers=hdr(w["tok"]["root"])).status_code == 204
    row = run_one("select closed_reason, closed_by::text as by from seat_assignments")
    assert row == {"closed_reason": "cleared", "by": w["users"]["root"]}
    assert client.delete(f"/api/admin/seat-assignments/{a['id']}", headers=hdr(w["tok"]["root"])).status_code == 404


def test_database_refuses_two_current_rows_for_one_person_or_seat(client, monkeypatch, db):
    w = build_world(client, monkeypatch); put(client, w, "E1", "jane")
    with pytest.raises(Exception):
        run_write("insert into seat_assignments (seat_id, user_id, person_name) values (cast(:s as uuid), cast(:u as uuid), 'x')",
                  {"s": w["seats"]["U1"], "u": w["users"]["jane"]})
    with pytest.raises(Exception):
        run_write("insert into seat_assignments (seat_id, user_id, person_name) values (cast(:s as uuid), cast(:u as uuid), 'x')",
                  {"s": w["seats"]["E1"], "u": w["users"]["ali"]})


@pytest.mark.parametrize("seat,who,body,field", [
    ("nope", "jane", {}, "seat_id"), ("E1", "dave", {}, "user_id"),
    ("E1", "jane", {"end_date": "15/10/2026"}, "end_date"), ("E1", "jane", {"note": "x" * 201}, "note")])
def test_validation(client, monkeypatch, db, seat, who, body, field):
    w = build_world(client, monkeypatch)
    w["seats"]["nope"] = "00000000-0000-0000-0000-000000000000"
    r = put(client, w, seat, who, **body)
    assert r.status_code == 400 and field in r.get_json()["fields"]


def test_non_admin_403_everywhere(client, monkeypatch, db):
    w = build_world(client, monkeypatch); h = hdr(w["tok"]["jane"]); sid = w["seats"]["E1"]
    assert client.get(f"/api/admin/seat-assignments?plan_id={w['plan']}", headers=h).status_code == 403
    assert client.put(f"/api/admin/seat-assignments/seats/{sid}", headers=h, json={"user_id": w["users"]["jane"]}).status_code == 403
    assert client.delete(f"/api/admin/seat-assignments/{sid}", headers=h).status_code == 403


def test_deactivated_person_keeps_their_seat_editable_but_cannot_get_a_new_one(client, monkeypatch, db):
    w = build_world(client, monkeypatch); put(client, w, "E1", "jane")
    run_write("update users set is_active = false where username = 'jane'")
    assert put(client, w, "E1", "jane", end_date="2026-11-30").status_code == 200
    assert str(current_rows()[0]["end_date"]) == "2026-11-30"
    r = put(client, w, "U1", "jane", move=True)
    assert r.status_code == 400 and "user_id" in r.get_json()["fields"]


def _closed_while_waiting(admin_conn, row_id, do_request):
    """Hold the row's lock, start a request that must wait for it, close the row, release; return the response."""
    import threading
    from sqlalchemy import text
    result = {}
    with admin_conn.connect() as conn:
        conn.execute(text("begin"))
        conn.execute(text("select 1 from seat_assignments where id = cast(:i as uuid) for update"), {"i": row_id})
        t = threading.Thread(target=lambda: result.update(r=do_request()))
        t.start()
        t.join(1.5)
        assert t.is_alive(), "the request did not wait for the row lock"
        conn.execute(text("update seat_assignments set closed_at = now(), closed_reason = 'moved' where id = cast(:i as uuid)"), {"i": row_id})
        conn.execute(text("commit"))
        t.join(10)
    return result["r"]


def test_clear_of_a_row_closed_meanwhile_is_404_and_keeps_the_first_close(client, monkeypatch, db, admin_conn, app):
    w = build_world(client, monkeypatch); a = put(client, w, "E1", "jane").get_json()
    h = hdr(w["tok"]["root"])
    r = _closed_while_waiting(admin_conn, a["id"], lambda: app.test_client().delete(f"/api/admin/seat-assignments/{a['id']}", headers=h))
    assert r.status_code == 404
    assert run_one("select closed_reason from seat_assignments")["closed_reason"] == "moved"


def test_change_of_a_row_closed_meanwhile_does_not_touch_the_closed_row(client, monkeypatch, db, admin_conn, app):
    w = build_world(client, monkeypatch); a = put(client, w, "E1", "jane", end_date="2026-11-01").get_json()
    h = hdr(w["tok"]["root"])
    r = _closed_while_waiting(admin_conn, a["id"], lambda: app.test_client().put(
        f"/api/admin/seat-assignments/seats/{w['seats']['E1']}", headers=h, json={"user_id": w["users"]["jane"], "end_date": "2026-12-31"}))
    assert r.status_code == 200
    old = run_one("select end_date::text as d, closed_reason from seat_assignments where id = cast(:i as uuid)", {"i": a["id"]})
    assert old == {"d": "2026-11-01", "closed_reason": "moved"}
