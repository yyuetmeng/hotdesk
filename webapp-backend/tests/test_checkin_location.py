"""Check-in records the device location when the browser gives one (owner 2026-10-16), for later vicinity
checks. Nothing is enforced yet; a missing, refused or malformed location never blocks a check-in."""
import pytest

from app.core.db import run_query
from desk_helpers import DAY, build_world, hdr, set_now, sg


@pytest.fixture()
def world(client, db, monkeypatch):
    w = build_world(client, monkeypatch)
    set_now(monkeypatch, sg(DAY, 9))
    return w


def _check_in(client, world, body=None):
    return client.post(f"/api/desk/seats/{world['seats']['E1']}/check-in", json=body, headers=hdr(world["tok"]["dina"]))


def _row():
    [row] = run_query("select location_lat, location_lng, location_accuracy_m, location_status, location_at from seat_checkins")
    return row


def _audit_details():
    [row] = run_query("select details from audit_logs where action = 'checkin.start'")
    return row["details"]


def test_location_is_stored_with_the_check_in(client, world):
    r = _check_in(client, world, {"location": {"lat": 1.29655, "lng": 103.85201, "accuracy": 25.4}})
    assert r.status_code == 201
    row = _row()
    assert (row["location_lat"], row["location_lng"], row["location_status"]) == (1.29655, 103.85201, "captured")
    assert round(row["location_accuracy_m"]) == 25 and row["location_at"] is not None
    assert "location_lat" not in r.get_json() and "lat" not in str(r.get_json())     # not sent back to anyone
    details = _audit_details()
    assert details["location_status"] == "captured" and details["location_accuracy_m"] == 25
    assert "lat" not in details and "location_lat" not in details                    # coordinates stay out of the audit log


@pytest.mark.parametrize("status", ["denied", "unavailable", "unsupported", "timeout"])
def test_a_refused_or_failed_location_is_recorded_as_such(client, world, status):
    assert _check_in(client, world, {"location_status": status}).status_code == 201
    row = _row()
    assert (row["location_lat"], row["location_lng"], row["location_status"]) == (None, None, status)


def test_no_location_sent(client, world):
    assert _check_in(client, world).status_code == 201
    assert _row()["location_status"] is None


@pytest.mark.parametrize("location", [{"lat": 200, "lng": 103.8, "accuracy": 10}, {"lat": "x", "lng": 1, "accuracy": 1},
                                      {"lat": 1.3, "lng": 103.8, "accuracy": -5}, "here"])
def test_a_malformed_location_does_not_block_the_check_in(client, world, location):
    assert _check_in(client, world, {"location": location}).status_code == 201
    row = _row()
    assert (row["location_lat"], row["location_status"]) == (None, "invalid")


def test_an_unknown_status_is_stored_as_invalid(client, world):
    assert _check_in(client, world, {"location_status": "<script>"}).status_code == 201
    assert _row()["location_status"] == "invalid"
