"""Password policy and changing your own password (owner 2026-10-16): at least 8 characters with letters and
numbers, not a well-known password. Well-known passwords exist only as SHA-256 hashes in the database, so these
tests add a made-up "well-known" word of their own instead of naming real ones."""
import pytest

from app.core.db import run_query, run_write
from app.core.passwords import common_forms, password_problem
from desk_helpers import PW, build_world, hdr

URL = "/api/auth/change-password"
MADE_UP = "Zebra2026x"          # not a real well-known password; added to the list by `listed`


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


@pytest.fixture()
def listed(world):
    for h in common_forms(MADE_UP):
        run_write("insert into common_password_hashes (sha256) values (:h) on conflict do nothing", {"h": h})
    yield
    for h in common_forms(MADE_UP):
        run_write("delete from common_password_hashes where sha256 = :h", {"h": h})


def test_the_list_holds_only_hashes(world):
    rows = run_query("select sha256 from common_password_hashes")
    assert len(rows) >= 100 and all(len(r["sha256"]) == 64 for r in rows)


@pytest.mark.parametrize("pw, ok", [("abcd7351x", True), ("Welcome#2026q", True), ("short1", False),
                                     ("lettersonly", False), ("1234567890", False), ("", False)])
def test_length_letters_and_numbers(world, pw, ok):
    assert (password_problem(pw) is None) is ok


def test_listed_passwords_are_refused_in_any_case_and_with_symbol_swaps(listed):
    assert "well-known" in password_problem(MADE_UP)
    assert password_problem(MADE_UP.upper()) is not None
    assert password_problem("Z3bra2026x") is not None                                 # 3 read as e
    assert password_problem("Zebra2027x") is None


def test_browser_gets_the_hashes_not_the_words(client, listed):
    body = client.get("/api/auth/common-password-hashes").get_json()
    assert set(common_forms(MADE_UP)) <= set(body["hashes"]) and MADE_UP.lower() not in str(body)


def test_password_may_not_be_the_username(world):
    assert password_problem("jane2026", username="jane2026") is not None


def _change(client, world, current, new, who="jane"):
    return client.post(URL, json={"current_password": current, "new_password": new}, headers=hdr(world["tok"][who]))


def test_change_my_password(client, world, listed):
    assert _change(client, world, "wrong-one1", "Fresh2026x").status_code == 400            # current must be right
    r = _change(client, world, PW, MADE_UP)
    assert r.status_code == 400 and "well-known" in r.get_json()["fields"]["new_password"]
    assert _change(client, world, PW, PW).status_code == 400                               # must be a new one
    assert _change(client, world, PW, "Fresh2026x").status_code == 204
    assert client.post("/api/auth/login", json={"email_or_username": "jane", "password": "Fresh2026x"}).status_code == 200
    assert client.post("/api/auth/login", json={"email_or_username": "jane", "password": PW}).status_code == 401
    assert client.post(URL, json={"current_password": PW, "new_password": "x"}).status_code == 401   # signed in only


def test_policy_applies_when_an_admin_sets_a_password(client, world):
    r = client.post(f"/api/admin/users/{world['users']['jane']}/password", json={"password": "lettersonly"},
                    headers=hdr(world["tok"]["root"]))
    assert r.status_code == 400 and "letters and numbers" in r.get_json()["fields"]["password"]
