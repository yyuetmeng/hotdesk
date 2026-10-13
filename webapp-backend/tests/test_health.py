def test_health_ok(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.get_json() == {"status": "ok"}


def test_create_app_registers_blueprints(app):
    rules = {r.rule for r in app.url_map.iter_rules()}
    assert "/api/health" in rules
