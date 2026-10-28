import pytest

from app.auth.routes import MAX_FAILED_ATTEMPTS
from app.core.db import run_one
from creds import SECRET, hashed, new_secret, secret_body, sign_in


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


# --- Task 2: holder guard, list, view, edit, on/off, resend within scope ---------------------------------------------

@pytest.fixture()
def held(client, world):
    grant(client, world["root_tok"], world["hana"], [world["eng"]])
    return world


def ids_listed(client, tok, query=""):
    return {u["id"] for u in client.get(f"/api/admin/users?page_size=100{query}", headers=hdr(tok)).get_json()["items"]}


def test_holder_lists_only_manageable_people(client, held):
    assert ids_listed(client, held["hana_tok"]) == {held["eve"], held["dan"]}   # not ada (admin), hana, oli, root


def test_holder_without_permission_gets_403(client, world):
    grant(client, world["root_tok"], world["hana"], [])
    assert client.get("/api/admin/users", headers=hdr(world["hana_tok"])).status_code == 403


def test_holder_manages_a_team_they_are_not_in(client, world):
    grant(client, world["root_tok"], world["hana"], [world["ops"]])
    assert ids_listed(client, world["hana_tok"]) == {world["oli"]}


def test_out_of_scope_is_403_for_view_edit_resend_password_and_unknown_ids(client, held):
    tok = held["hana_tok"]
    for uid in (held["oli"], held["ada"], held["hana"], "00000000-0000-0000-0000-000000000000"):
        for r in (client.get(f"/api/admin/users/{uid}", headers=hdr(tok)),
                  client.patch(f"/api/admin/users/{uid}", headers=hdr(tok), json={"full_name": "X"}),
                  client.post(f"/api/admin/users/{uid}/resend-invitation", headers=hdr(tok)),
                  client.post(f"/api/admin/users/{uid}/password", headers=hdr(tok), json=secret_body(new_secret()))):
            assert (r.status_code, r.get_json()["error"]) == (403, "You can only manage accounts in your project teams.")


def test_holder_allowed_edits_work_and_are_audited_as_holder(client, held):
    r = client.patch(f"/api/admin/users/{held['eve']}", headers=hdr(held["hana_tok"]),
                     json={"full_name": "Eve Ng", "start_date": "2026-11-01", "end_date": "2026-12-31",
                           "booking_allowance": 3, "is_active": False})
    assert r.status_code == 200 and r.get_json()["full_name"] == "Eve Ng"
    assert run_one("select actor_id::text as a from audit_logs where action = 'user.disable'")["a"] == held["hana"]


@pytest.mark.parametrize("field,value", [("email", "new@x.com"), ("username", "newname"), ("role", "admin"),
                                         ("department_ids", []), ("manages_department_ids", ["ENG"])])
def test_changed_refused_field_refuses_whole_save(client, held, field, value):
    if value == ["ENG"]:
        value = [held["eng"]]
    before = run_one("select full_name from users where id = :i", {"i": held["eve"]})["full_name"]
    r = client.patch(f"/api/admin/users/{held['eve']}", headers=hdr(held["hana_tok"]),
                     json={"full_name": "Changed", field: value})
    assert (r.status_code, r.get_json()["error"]) == (403, "Only an administrator can change this.")
    assert run_one("select full_name from users where id = :i", {"i": held["eve"]})["full_name"] == before


def test_unchanged_refused_fields_are_ignored(client, held):
    eve = client.get(f"/api/admin/users/{held['eve']}", headers=hdr(held["hana_tok"])).get_json()
    r = client.patch(f"/api/admin/users/{held['eve']}", headers=hdr(held["hana_tok"]),
                     json={"full_name": "Eve Two", "email": eve["email"], "username": eve["username"], "role": "user",
                           "department_ids": [d["id"] for d in eve["departments"]][::-1],
                           "manages_department_ids": []})
    assert r.status_code == 200 and r.get_json()["full_name"] == "Eve Two"


def test_holder_cannot_grant_permission_to_anyone(client, held):
    r = grant(client, held["hana_tok"], held["eve"], [held["eng"]])
    assert r.status_code == 403 and run_one("select count(*) as n from user_managed_departments")["n"] == 1


def test_removal_takes_effect_on_next_request(client, held):
    tok = held["hana_tok"]
    assert client.get(f"/api/admin/users/{held['eve']}", headers=hdr(tok)).status_code == 200
    grant(client, held["root_tok"], held["hana"], [])
    assert client.get(f"/api/admin/users/{held['eve']}", headers=hdr(tok)).status_code == 403


def test_deleting_the_team_refuses_the_holder_next_request(client, held):
    tok = held["hana_tok"]
    client.delete(f"/api/admin/departments/{held['eng']}", headers=hdr(held["root_tok"]))
    assert client.get("/api/admin/users", headers=hdr(tok)).status_code == 403


def test_disabled_holder_refused_with_old_token(client, held):
    tok = held["hana_tok"]
    assert client.get("/api/admin/users", headers=hdr(tok)).status_code == 200
    client.patch(f"/api/admin/users/{held['hana']}", headers=hdr(held["root_tok"]), json={"is_active": False})
    r = client.get("/api/admin/users", headers=hdr(tok))
    assert (r.status_code, r.get_json()["error"]) == (403, "admin required")


@pytest.mark.parametrize("column,value", [("end_date", "2000-01-01"), ("start_date", "2999-01-01")])
def test_holder_outside_access_dates_refused_with_old_token(client, held, column, value):
    run_one(f"update users set {column} = :d where id = :i returning id", {"d": value, "i": held["hana"]})
    r = client.get("/api/admin/users", headers=hdr(held["hana_tok"]))
    assert (r.status_code, r.get_json()["error"]) == (403, "admin required")


def test_holder_still_blocked_from_admin_only_endpoints(client, held):
    tok, eve = held["hana_tok"], held["eve"]
    assert client.delete(f"/api/admin/users/{eve}", headers=hdr(tok)).status_code == 403
    assert client.post("/api/admin/users/bulk-delete", headers=hdr(tok), json={"ids": [eve]}).status_code == 403
    assert client.post("/api/admin/departments", headers=hdr(tok), json={"name": "Z"}).status_code == 403
    assert client.get("/api/admin/audit", headers=hdr(tok)).status_code == 403
    assert client.get("/api/admin/audit/security-summary", headers=hdr(tok)).status_code == 403


def test_holder_resend_invitation_in_scope(client, held, stub_email):
    run_one("update users set password_hash = null where id = :i returning id", {"i": held["eve"]})
    r = client.post(f"/api/admin/users/{held['eve']}/resend-invitation", headers=hdr(held["hana_tok"]))
    assert r.status_code == 204 and len(stub_email) == 1


def test_holder_sets_password_in_scope(client, held):
    run_one("update users set is_active = false, failed_attempts = :n where id = :i returning id",
            {"i": held["eve"], "n": MAX_FAILED_ATTEMPTS})     # disabled and locked out
    value = new_secret()
    r = client.post(f"/api/admin/users/{held['eve']}/password", headers=hdr(held["hana_tok"]), json=secret_body(value))
    assert r.status_code == 204
    assert sign_in(client, "eve@x.com", value).status_code == 200      # enabled and unlocked, as when an admin does it
    assert run_one("select actor_id::text as a from audit_logs where action = 'user.password_reset'")["a"] == held["hana"]


def test_holder_set_password_checks_the_policy(client, held):
    r = client.post(f"/api/admin/users/{held['eve']}/password", headers=hdr(held["hana_tok"]), json=secret_body("short"))
    assert r.status_code == 400 and "password" in r.get_json()["fields"]


# ---- holder create and upload ------------------------------------------------------------------------------------

import io
import re
import zipfile

from app.core.xlsx import write_xlsx

UPLOAD_HEAD = ["Full name", "Email", "Username", "Project teams", "Booking allowance", "Access from", "Access until"]


@pytest.fixture()
def hana_manages_eng(client, world):
    grant(client, world["root_tok"], world["hana"], [world["eng"]])
    return world


def upload(client, tok, rows, **form):
    data = {"file": (io.BytesIO(write_xlsx([("Sheet1", [UPLOAD_HEAD] + rows)])), "people.xlsx"), **form}
    return client.post("/api/admin/users/import", data=data, content_type="multipart/form-data", headers=hdr(tok))


def test_holder_creates_user_in_managed_team(client, hana_manages_eng, stub_email):
    world = hana_manages_eng
    r = client.post("/api/admin/users", headers=hdr(world["hana_tok"]),
                    json={"email": "neo@x.com", "username": "neo", "full_name": "Neo", "department_ids": [world["eng"]]})
    assert r.status_code == 201 and r.get_json()["role"] == "user" and r.get_json()["invitation_sent"]
    assert stub_email[-1][0] == "neo@x.com"
    assert run_one("select actor_id::text as a from audit_logs where action = 'user.create'")["a"] == world["hana"]


@pytest.mark.parametrize("extra,status,message", [
    ({"department_ids": []}, 400, None),
    ({"department_ids": ["<eng>", "<ops>"]}, 403, "You can only add people to the teams you manage."),
    ({"department_ids": ["<eng>"], "role": "admin"}, 403, "Only an administrator can change this."),
])
def test_holder_create_refusals(client, hana_manages_eng, extra, status, message):
    world = hana_manages_eng
    body = {"email": "neo@x.com", "username": "neo", "full_name": "Neo", "role": "user",
            **{k: [world[x.strip("<>")] for x in v] if k == "department_ids" else v for k, v in extra.items()}}
    r = client.post("/api/admin/users", headers=hdr(world["hana_tok"]), json=body)
    assert r.status_code == status and (message is None or r.get_json()["error"] == message)
    assert not run_one("select 1 as x from users where email = 'neo@x.com'")


def test_holder_create_taken_email_uses_admin_message(client, hana_manages_eng):
    world = hana_manages_eng
    r = client.post("/api/admin/users", headers=hdr(world["hana_tok"]),
                    json={"email": "oli@x.com", "username": "neo", "full_name": "Neo", "department_ids": [world["eng"]]})
    assert (r.status_code, r.get_json()["error"]) == (409, "email already exists")


def test_holder_upload_rows(client, hana_manages_eng, stub_email):
    world = hana_manages_eng
    rows = [["Ann", "ann@x.com", "", "Eng", "", "", ""], ["Ben", "ben@x.com", "", "", "", "", ""],
            ["Cat", "cat@x.com", "", "Eng; Ops", "", "", ""]]
    body = upload(client, world["hana_tok"], rows).get_json()
    assert [r["status"] for r in body["rows"]] == ["create", "error", "error"]
    assert body["rows"][1]["messages"] == ["You can only add people to the teams you manage."]
    assert body["rows"][2]["messages"] == ["You can only add people to the teams you manage."]
    assert body["imported"] == 1 and [c[0] for c in stub_email] == ["ann@x.com"]   # invited without asking


@pytest.mark.parametrize("form", [{"create_teams": "1"}, {"default_password": "<new>"}])
def test_holder_upload_admin_only_options_refused(client, hana_manages_eng, form):
    world = hana_manages_eng
    form = {k: new_secret() if v == "<new>" else v for k, v in form.items()}
    r = upload(client, world["hana_tok"], [["Ann", "ann@x.com", "", "Eng", "", "", ""]], **form)
    assert (r.status_code, r.get_json()["error"]) == (403, "Only an administrator can change this.")


def test_holder_template_lists_only_managed_teams(client, hana_manages_eng):
    world = hana_manages_eng
    r = client.get("/api/admin/users/import-template.xlsx", headers=hdr(world["hana_tok"]))
    z = zipfile.ZipFile(io.BytesIO(r.data))
    cells = lambda part: re.findall(r"<t[^>]*>([^<]*)</t>", z.read(part).decode())   # read_xlsx reads only sheet 1
    instructions, users = cells("xl/worksheets/sheet2.xml"), cells("xl/worksheets/sheet1.xml")
    assert r.status_code == 200 and instructions[-1] == "Eng" and "Ops" not in instructions and "Design" not in instructions
    assert "Eng" in users and "Ops" not in users
    teams_row = instructions[instructions.index("Project teams"):][:3]
    assert teams_row == ["Project teams", "Yes", "One or more of the teams you manage, separated by ; (e.g. Eng; Design)."]
    assert not any("Create missing project teams" in t or "make someone an admin" in t for t in instructions)


def test_admin_template_keeps_admin_instructions(client, world):
    r = client.get("/api/admin/users/import-template.xlsx", headers=hdr(world["root_tok"]))
    text = " ".join(re.findall(r"<t[^>]*>([^<]*)</t>", zipfile.ZipFile(io.BytesIO(r.data)).read("xl/worksheets/sheet2.xml").decode()))
    assert "Create missing project teams" in text and "make someone an admin" in text
