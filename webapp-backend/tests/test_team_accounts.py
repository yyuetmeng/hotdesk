import pytest

from app.core.db import run_one
from creds import SECRET, hashed, sign_in


@pytest.fixture(autouse=True)
def stub_email(monkeypatch):
    calls = []
    monkeypatch.setattr("app.admin.users.send_email",
                        lambda to, subject, html: calls.append((to, subject, html)))
    return calls


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


def _team(name):
    return run_one("insert into departments (name) values (:n) returning id::text as id", {"n": name})["id"]


def _user(name, role_id, *teams):
    uid = run_one("insert into users (email, username, full_name, role_id, password_hash) "
                  "values (:e, :u, :f, :r, :p) returning id::text as id",
                  {"e": f"{name}@x.com", "u": name, "f": name.title(), "r": role_id, "p": hashed(SECRET)})["id"]
    for t in teams:
        run_one("insert into user_departments (user_id, department_id) values (:u, :d) returning user_id",
                {"u": uid, "d": t})
    return uid


@pytest.fixture()
def world(client, db):
    eng, design, ops = _team("Eng"), _team("Design"), _team("Ops")
    w = {"eng": eng, "design": design, "ops": ops,
         "root": _user("root", 2),
         "hana": _user("hana", 1, eng),
         "eve": _user("eve", 1, eng),
         "dan": _user("dan", 1, eng, design),
         "oli": _user("oli", 1, ops),
         "ada": _user("ada", 2, eng)}
    w["root_tok"] = sign_in(client, "root@x.com").get_json()["token"]
    w["hana_tok"] = sign_in(client, "hana@x.com").get_json()["token"]
    return w


def grant(client, tok, uid, ids):
    return client.patch(f"/api/admin/users/{uid}", headers=hdr(tok), json={"manages_department_ids": ids})


def test_admin_grants_and_profile_lists_managed_teams(client, world):
    r = grant(client, world["root_tok"], world["hana"], [world["eng"]])
    assert r.status_code == 200 and r.get_json()["manages"] == [{"id": world["eng"], "name": "Eng"}]
    me = client.get("/api/auth/me", headers=hdr(world["hana_tok"])).get_json()
    assert me["manages"] == [{"id": world["eng"], "name": "Eng"}]
    assert sign_in(client, "hana@x.com").get_json()["user"]["manages"] == [{"id": world["eng"], "name": "Eng"}]
    assert run_one("select details from audit_logs where action = 'user.update' order by id desc limit 1")["details"] \
        == {"fields": ["manages_department_ids"]}


def test_grant_any_team_even_one_the_user_is_not_in(client, world):
    assert grant(client, world["root_tok"], world["hana"], [world["ops"]]).status_code == 200


def test_untick_all_removes_and_list_marks_holders(client, world):
    grant(client, world["root_tok"], world["hana"], [world["eng"], world["design"]])
    items = client.get("/api/admin/users?page_size=100", headers=hdr(world["root_tok"])).get_json()["items"]
    assert [d["name"] for d in next(u for u in items if u["id"] == world["hana"])["manages"]] == ["Design", "Eng"]
    grant(client, world["root_tok"], world["hana"], [])
    assert client.get("/api/auth/me", headers=hdr(world["hana_tok"])).get_json()["manages"] == []


def test_grant_refused_for_admin_target_and_unknown_team(client, world):
    r = grant(client, world["root_tok"], world["ada"], [world["eng"]])
    assert r.status_code == 400 and r.get_json()["fields"]["manages_department_ids"] == "admins already manage every account"
    r = grant(client, world["root_tok"], world["hana"], ["00000000-0000-0000-0000-000000000000"])
    assert r.status_code == 400 and "manages_department_ids" in r.get_json()["fields"]


def test_deleting_a_team_ends_the_permission(client, world):
    grant(client, world["root_tok"], world["hana"], [world["eng"]])
    client.delete(f"/api/admin/departments/{world['eng']}", headers=hdr(world["root_tok"]))
    assert client.get("/api/auth/me", headers=hdr(world["hana_tok"])).get_json()["manages"] == []


def test_promoting_to_admin_clears_the_grant(client, world):
    grant(client, world["root_tok"], world["hana"], [world["eng"]])
    r = client.patch(f"/api/admin/users/{world['hana']}", headers=hdr(world["root_tok"]), json={"role": "admin"})
    assert r.status_code == 200 and r.get_json()["manages"] == []
    assert run_one("select count(*) as n from user_managed_departments")["n"] == 0
