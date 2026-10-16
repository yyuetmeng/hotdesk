"""Query budgets per page (2026-10-16 database review): each database call costs a network round trip
(~160 ms to the hosted database), so busy pages must not grow back into many small queries."""
import pytest
from sqlalchemy import event

from app.core.db import get_engine
from desk_helpers import build_world, hdr


@pytest.fixture()
def world(client, db, monkeypatch):
    return build_world(client, monkeypatch)


def _count(app, client, path, token):
    with app.app_context():
        engine = get_engine()
    seen = []
    listener = lambda *a, **k: seen.append(1)   # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    try:
        r = client.get(path, headers=hdr(token))
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    assert r.status_code == 200, r.get_json()
    return len(seen)


@pytest.mark.parametrize("path, budget", [
    ("/api/desk/floors/{plan}", 7),     # was 10
    ("/api/public/floors/{plan}", 7),   # was 9
    ("/api/desk/me", 5),                # was 7
    ("/api/admin/insights/zones", 6),   # was 8
    ("/api/admin/insights/teams", 7),
    ("/api/desk/dashboard", 16),
])
def test_page_query_budget(app, client, world, path, budget):
    used = _count(app, client, path.format(plan=world["plan"]), world["tok"]["root"])
    assert used <= budget, f"{path}: {used} queries (budget {budget})"
