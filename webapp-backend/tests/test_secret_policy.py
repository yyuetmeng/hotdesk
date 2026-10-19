"""Sign-in secret policy and changing your own (owner 2026-10-16): at least 8 characters with letters and numbers,
not a well-known word. Well-known words exist only as SHA-256 hashes in the database, so these tests add a made-up
"well-known" word of their own (generated each run) instead of naming real ones."""
import pytest

from app.core.db import run_query, run_write
from creds import (SECRET, change_body, digits, e_as_3, letters, new_secret, policy_problem, secret_body, sign_in,
                   too_short, well_known_forms, word_with_e)
from desk_helpers import build_world, hdr

URL = "/api/auth/change-password"
MADE_UP = word_with_e()          # added to the well-known list by `listed`


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


@pytest.fixture()
def listed(world):
    for h in well_known_forms(MADE_UP):
        run_write("insert into common_password_hashes (sha256) values (:h) on conflict do nothing", {"h": h})
    yield
    for h in well_known_forms(MADE_UP):
        run_write("delete from common_password_hashes where sha256 = :h", {"h": h})


def test_the_list_holds_only_hashes(world):
    rows = run_query("select sha256 from common_password_hashes")
    assert len(rows) >= 100 and all(len(r["sha256"]) == 64 for r in rows)


@pytest.mark.parametrize("value, ok", [(letters(6) + digits(3), True), (f"W{letters(6)}#{digits(4)}q", True),
                                       (too_short(), False), (letters(11), False), (digits(10), False), ("", False)])
def test_length_letters_and_numbers(world, value, ok):
    assert (policy_problem(value) is None) is ok


def test_listed_words_are_refused_in_any_case_and_with_symbol_swaps(listed):
    assert "well-known" in policy_problem(MADE_UP)
    assert policy_problem(MADE_UP.upper()) is not None
    assert policy_problem(e_as_3(MADE_UP)) is not None                              # 3 read as e
    assert policy_problem(MADE_UP[:-1] + "q") is None                               # one letter off is fine


def test_browser_gets_the_hashes_not_the_words(client, listed):
    body = client.get("/api/auth/common-password-hashes").get_json()
    assert set(well_known_forms(MADE_UP)) <= set(body["hashes"]) and MADE_UP.lower() not in str(body)


def test_secret_may_not_be_the_username(world):
    name = letters(4) + digits(4)
    assert policy_problem(name, username=name) is not None


def _change(client, world, current, new, who="jane"):
    return client.post(URL, json=change_body(current, new), headers=hdr(world["tok"][who]))


def test_change_my_secret(client, world, listed):
    fresh = new_secret()
    assert _change(client, world, new_secret(), fresh).status_code == 400             # current must be right
    r = _change(client, world, SECRET, MADE_UP)
    assert r.status_code == 400 and "well-known" in r.get_json()["fields"]["new_password"]
    assert _change(client, world, SECRET, SECRET).status_code == 400                   # must be a new one
    assert _change(client, world, SECRET, fresh).status_code == 204
    assert sign_in(client, "jane", fresh).status_code == 200
    assert sign_in(client, "jane").status_code == 401
    assert client.post(URL, json=change_body(SECRET, letters(1))).status_code == 401   # signed in only


def test_policy_applies_when_an_admin_sets_one(client, world):
    r = client.post(f"/api/admin/users/{world['users']['jane']}/password", json=secret_body(letters(11)),
                    headers=hdr(world["tok"]["root"]))
    assert r.status_code == 400 and "letters and numbers" in r.get_json()["fields"]["password"]
