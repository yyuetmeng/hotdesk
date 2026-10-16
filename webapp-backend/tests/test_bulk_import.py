"""Bulk loading of users and project teams from Excel templates (owner 2026-10-16).

Template download -> fill in Excel -> upload for a preview (dry run, per-row status) -> import. Valid rows are
created, invalid ones are reported and skipped; existing emails are skipped, so re-uploading a fixed file is safe.
Users are tagged to project teams from the "Project teams" column; the teams file adds members to teams."""
import io
import zipfile

import pytest

from app.core.db import run_query
from app.core.xlsx import write_xlsx
from app.core.xlsx_read import read_xlsx
from desk_helpers import build_world, hdr

USERS = "/api/admin/users/import"
TEAMS = "/api/admin/departments/import"
HEAD = ["Full name", "Email", "Username", "Role", "Project teams", "Booking allowance", "Access from", "Access until"]


@pytest.fixture()
def world(client, db, monkeypatch):
    sent = []
    monkeypatch.setattr("app.admin.users.send_email", lambda to, subject, html: sent.append(to))
    w = build_world(client, monkeypatch)
    w["sent"] = sent
    return w


def _upload(client, world, url, rows, head=HEAD, who="root", **form):
    data = {"file": (io.BytesIO(write_xlsx([("Sheet1", [head] + rows)])), "people.xlsx"), **form}
    return client.post(url, data=data, content_type="multipart/form-data", headers=hdr(world["tok"][who]))


def _names():
    return {r["full_name"] for r in run_query("select full_name from users")}


def test_templates_download_as_excel_with_the_expected_columns(client, world):
    root = hdr(world["tok"]["root"])
    r = client.get("/api/admin/users/import-template.xlsx", headers=root)
    assert r.status_code == 200 and "users-template" in r.headers["Content-Disposition"]
    sheets = zipfile.ZipFile(io.BytesIO(r.data)).namelist()
    assert "xl/worksheets/sheet2.xml" in sheets                                  # an Instructions sheet
    assert read_xlsx(r.data)[0] == HEAD
    t = client.get("/api/admin/departments/import-template.xlsx", headers=root)
    assert t.status_code == 200 and read_xlsx(t.data)[0] == ["Project team", "Description", "Members"]
    assert client.get("/api/admin/users/import-template.xlsx", headers=hdr(world["tok"]["jane"])).status_code == 403


def test_preview_reports_each_row_and_changes_nothing(client, world):
    rows = [["Mei Ling", "mei@x.com", "", "", "Engineering; Ops", 2, "", ""],
            ["", "nobody@x.com", "", "", "", "", "", ""],                         # no name
            ["Jane Again", "jane@x.com", "", "", "", "", "", ""],                 # email already exists
            ["Bad Team", "bt@x.com", "", "", "Nope", "", "", ""]]                 # unknown team, not created
    body = _upload(client, world, USERS, rows, dry_run="1").get_json()
    assert [(r["row"], r["status"]) for r in body["rows"]] == [(2, "create"), (3, "error"), (4, "skip"), (5, "error")]
    assert body["rows"][0]["username"] == "mei" and body["rows"][0]["teams"] == ["Engineering", "Ops"]
    assert "Full name is required" in body["rows"][1]["messages"][0]
    assert "already exists" in body["rows"][2]["messages"][0]
    assert "Nope" in body["rows"][3]["messages"][0]
    assert body["summary"] == {"create": 1, "skip": 1, "error": 2}
    assert "Mei Ling" not in _names()                                             # a preview writes nothing


def test_import_creates_valid_rows_tags_teams_and_skips_the_rest(client, world):
    rows = [["Mei Ling", "Mei@X.com", "", "Admin", "engineering", 2, "2026-10-01", "2027-03-31"],
            ["Tan Ah Kow", "tak@x.com", "takow", "user", "New Team, Ops", "", "", ""],
            ["", "nobody@x.com", "", "", "", "", "", ""]]
    r = _upload(client, world, USERS, rows, create_teams="1")
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["summary"] == {"create": 2, "skip": 0, "error": 1} and body["imported"] == 2
    [mei] = run_query("select u.email, u.username, r.name as role, u.booking_allowance, u.start_date, u.end_date "
                      "from users u join roles r on r.id = u.role_id where u.full_name = 'Mei Ling'")
    assert (mei["email"], mei["username"], mei["role"], mei["booking_allowance"]) == ("mei@x.com", "mei", "admin", 2)
    assert str(mei["start_date"]) == "2026-10-01" and str(mei["end_date"]) == "2027-03-31"
    teams = {(r["full_name"], r["name"]) for r in run_query(
        "select u.full_name, d.name from user_departments ud join users u on u.id = ud.user_id "
        "join departments d on d.id = ud.department_id where u.full_name in ('Mei Ling', 'Tan Ah Kow')")}
    assert teams == {("Mei Ling", "Engineering"), ("Tan Ah Kow", "New Team"), ("Tan Ah Kow", "Ops")}
    assert world["sent"] == []                                                    # no emails unless asked
    assert len(run_query("select 1 from audit_logs where action = 'user.create'")) == 2
    again = _upload(client, world, USERS, rows[:2], create_teams="1").get_json()   # re-upload: nothing doubles
    assert again["summary"]["skip"] == 2 and again["imported"] == 0


def test_invitations_are_sent_only_when_asked(client, world):
    _upload(client, world, USERS, [["Mei Ling", "mei@x.com", "", "", "", "", "", ""]], send_invitations="1")
    assert world["sent"] == ["mei@x.com"]


def test_usernames_are_made_unique_and_rows_checked_against_each_other(client, world):
    rows = [["Jane Two", "jane@other.com", "", "", "", "", "", ""],               # "jane" is taken -> jane2
            ["Dup One", "dup@x.com", "", "", "", "", "", ""],
            ["Dup Two", "DUP@x.com", "", "", "", "", "", ""],                       # same email twice in the file
            ["Bad Role", "br@x.com", "", "boss", "", "", "", ""],
            ["Bad Date", "bd@x.com", "", "", "", "", "31/12/2026", ""],
            ["Bad Num", "bn@x.com", "", "", "", "-1", "", ""]]
    body = _upload(client, world, USERS, rows, dry_run="1").get_json()
    assert body["rows"][0]["username"] == "jane2"
    assert [r["status"] for r in body["rows"]] == ["create", "create", "error", "error", "error", "error"]


def test_a_file_that_is_not_the_template_is_refused(client, world):
    assert _upload(client, world, USERS, [["x"]], head=["Name"]).status_code == 400
    r = client.post(USERS, data={"file": (io.BytesIO(b"not excel"), "x.xlsx")}, content_type="multipart/form-data",
                    headers=hdr(world["tok"]["root"]))
    assert r.status_code == 400
    assert client.post(USERS, data={}, content_type="multipart/form-data", headers=hdr(world["tok"]["root"])).status_code == 400


def test_teams_file_creates_teams_and_adds_members_by_email_or_username(client, world):
    head = ["Project team", "Description", "Members"]
    rows = [["AI Lab", "Machine learning", "jane@x.com; carl"],
            ["Engineering", "", "bob"],                                            # existing team: add Bob
            ["Ghosts", "", "nobody@x.com"],                                        # unknown member
            ["", "", "jane"]]
    preview = _upload(client, world, TEAMS, rows, head=head, dry_run="1").get_json()
    assert [(r["team"], r["status"]) for r in preview["rows"]] == [("AI Lab", "create"), ("Engineering", "update"),
                                                                     ("Ghosts", "error"), ("", "error")]
    assert preview["rows"][0]["members"] == ["Jane Tan", "Carl Lim"]
    body = _upload(client, world, TEAMS, rows, head=head).get_json()
    assert body["imported"] == 2
    members = {(r["name"], r["full_name"]) for r in run_query(
        "select d.name, u.full_name from user_departments ud join users u on u.id = ud.user_id "
        "join departments d on d.id = ud.department_id where d.name in ('AI Lab', 'Engineering')")}
    assert {("AI Lab", "Jane Tan"), ("AI Lab", "Carl Lim"), ("Engineering", "Bob Ong"), ("Engineering", "Jane Tan")} <= members
    [lab] = run_query("select description from departments where name = 'AI Lab'")
    assert lab["description"] == "Machine learning"


def test_reader_handles_shared_strings_numbers_and_dates_as_excel_saves_them():
    """Excel itself writes shared strings and date serials (write_xlsx writes inline strings)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                   '<sheet name="Users" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/sharedStrings.xml", '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                   '<si><t>Name</t></si><si><r><t>Mei </t></r><r><t>Ling</t></r></si></sst>')
        z.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
                   '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>When</t></is></c></row>'
                   '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3"><v>2</v></c><c r="C3"><v>46296</v></c></row>'
                   '</sheetData></worksheet>')
    rows = read_xlsx(buf.getvalue())
    assert rows == [["Name", None, "When"], ["Mei Ling", 2.0, 46296.0]]          # blank row 2 dropped, gaps kept
