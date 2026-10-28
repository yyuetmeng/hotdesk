"""Clearing the audit log by hand (owner 2026-10-16): no automatic deletion; admins clear old entries by
period and category, and the page says when entries are older than a month."""
from datetime import timedelta

import pytest

from app.core.db import run_query, run_write
from app.desk import rules
from desk_helpers import DAY, build_world, hdr

URL = "/api/admin/audit"


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def _today():
    return rules.local_today(rules.now())


def _old(action, days):
    # Back-dated from the app clock that build_world pins, not the database's now(): the server measures age
    # from the app clock, and the two drift apart as real days pass.
    run_write("insert into audit_logs (action, details, created_at) values (:a, '{}', :at)",
              {"a": action, "at": rules.now() - timedelta(days=days)})


def _count(action):
    return run_query("select count(*) as n from audit_logs where action = :a", {"a": action})[0]["n"]


def _clear(client, world, who="root", **body):
    return client.post(f"{URL}/clear", json=body, headers=hdr(world["tok"][who]))


def test_reading_the_log_does_not_delete_old_entries(client, world):
    _old("auth.login_failed", 400)
    body = client.get(URL, headers=hdr(world["tok"]["root"])).get_json()
    assert _count("auth.login_failed") == 1
    assert body["old"]["count"] == 1 and body["old"]["oldest"] < (_today() - timedelta(days=399)).isoformat()


def test_old_indicator_counts_entries_older_than_a_month(client, world):
    _old("auth.login_failed", 40)
    _old("auth.login_failed", 10)
    old = client.get(URL, headers=hdr(world["tok"]["root"])).get_json()["old"]
    assert old["count"] == 1
    _clear(client, world, older_than_days=30)
    assert client.get(URL, headers=hdr(world["tok"]["root"])).get_json()["old"] == {"count": 0, "oldest": None}


def test_preview_then_clear_by_period_and_category(client, world):
    _old("auth.login_failed", 40)
    _old("booking.create", 40)
    _old("auth.login_success", 10)
    before = _count("auth.login_success")
    r = _clear(client, world, older_than_days=30, categories=["security"], dry_run=True)
    assert r.status_code == 200 and r.get_json() == {"count": 1}
    assert _count("auth.login_failed") == 1                                  # a preview deletes nothing
    r = _clear(client, world, older_than_days=30, categories=["security"])
    assert r.status_code == 200 and r.get_json()["deleted"] == 1
    assert (_count("auth.login_failed"), _count("booking.create"), _count("auth.login_success")) == (0, 1, before)
    [entry] = client.get(URL, query_string={"q": "audit.cleared"}, headers=hdr(world["tok"]["root"])).get_json()["items"]
    assert entry["category"] == "security" and entry["summary"].startswith("Root Admin cleared 1 audit entry older than")
    assert entry["details"]["categories"] == ["security"]


def test_clear_all_categories_before_a_date(client, world):
    _old("booking.create", 90)
    _old("floorplan.update", 90)
    _old("display.update", 45)
    r = _clear(client, world, before=(_today() - timedelta(days=60)).isoformat())
    assert r.status_code == 200 and r.get_json()["deleted"] == 2
    assert (_count("booking.create"), _count("floorplan.update"), _count("display.update")) == (0, 0, 1)


@pytest.mark.parametrize("body", [{"older_than_days": 7}, {"before": (DAY - timedelta(days=5)).isoformat()},
                                  {}, {"older_than_days": "x"}, {"before": "soon"},
                                  {"older_than_days": 30, "categories": ["nope"]}])
def test_recent_entries_and_bad_options_are_refused(client, world, body):
    _old("auth.login_failed", 10)
    assert _clear(client, world, **body).status_code == 400
    assert _count("auth.login_failed") == 1


def test_admins_only(client, world):
    assert _clear(client, world, who="jane", older_than_days=30).status_code == 403


def test_the_record_of_earlier_clears_is_kept(client, world):
    _old("audit.cleared", 400)
    _old("auth.login_failed", 400)
    assert _clear(client, world, older_than_days=30).get_json()["deleted"] == 1
    assert _count("audit.cleared") == 2                                      # the old one and this one
