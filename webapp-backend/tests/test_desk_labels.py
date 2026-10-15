"""Print Desk Labels: which seats' QR labels have been downloaded (for the "New" badge)."""
import uuid

import pytest

from desk_helpers import build_world, hdr

URL = "/api/admin/desk-labels/downloads"


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def test_nothing_downloaded_yet(client, world):
    assert client.get(URL, headers=hdr(world["tok"]["root"])).get_json() == {"seat_ids": []}


def test_record_downloads_once_per_seat(client, world):
    tok = world["tok"]["root"]
    f1, f2 = world["seats"]["F1"], world["seats"]["F2"]
    assert client.post(URL, headers=hdr(tok), json={"seat_ids": [f1, f2]}).status_code == 204
    assert client.post(URL, headers=hdr(tok), json={"seat_ids": [f1]}).status_code == 204     # again: no duplicate
    assert sorted(client.get(URL, headers=hdr(tok)).get_json()["seat_ids"]) == sorted([f1, f2])


def test_bad_input_refused(client, world):
    tok = world["tok"]["root"]
    assert client.post(URL, headers=hdr(tok), json={"seat_ids": "nope"}).status_code == 400
    assert client.post(URL, headers=hdr(tok), json={"seat_ids": ["not-a-uuid"]}).status_code == 400
    assert client.post(URL, headers=hdr(tok), json={"seat_ids": [str(uuid.uuid4())] * 501}).status_code == 400


def test_admins_only(client, world):
    assert client.get(URL, headers=hdr(world["tok"]["jane"])).status_code == 403
    assert client.post(URL, headers=hdr(world["tok"]["jane"]), json={"seat_ids": []}).status_code == 403
