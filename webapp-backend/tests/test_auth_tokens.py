from sqlalchemy import text

from app.auth.tokens import consume_token, invalidate_tokens, issue_token, validate_token


def _mk_user(db, email="t@u.com", username="tub"):
    with db.connect() as conn:
        return str(conn.execute(text(
            "insert into users (email, username, full_name, role_id) "
            "values (:e, :u, 'T', 1) returning id"), {"e": email, "u": username}).scalar_one())


def test_issue_and_validate_roundtrip(db):
    uid = _mk_user(db)
    raw = issue_token(uid, "activate", 72)
    rec = validate_token(raw, "activate")
    assert rec and rec["user_id"] == uid


def test_wrong_purpose_rejected(db):
    uid = _mk_user(db, "p@u.com", "pub")
    raw = issue_token(uid, "activate", 72)
    assert validate_token(raw, "reset") is None


def test_expired_rejected(db):
    uid = _mk_user(db, "e@u.com", "eub")
    raw = issue_token(uid, "reset", 72)
    with db.connect() as conn:
        conn.execute(text("update user_tokens set expires_at = now() - interval '1 hour'"))
    assert validate_token(raw, "reset") is None


def test_consume_then_revalidate_fails(db):
    uid = _mk_user(db, "c@u.com", "cub")
    raw = issue_token(uid, "reset", 72)
    rec = validate_token(raw, "reset")
    consume_token(rec["token_hash"])
    assert validate_token(raw, "reset") is None


def test_issue_invalidates_previous_same_purpose(db):
    uid = _mk_user(db, "i@u.com", "iub")
    first = issue_token(uid, "activate", 72)
    issue_token(uid, "activate", 72)
    assert validate_token(first, "activate") is None


def test_invalidate_all_purposes(db):
    uid = _mk_user(db, "ia@u.com", "iab")
    a = issue_token(uid, "activate", 72)
    r = issue_token(uid, "reset", 1)
    invalidate_tokens(uid)
    assert validate_token(a, "activate") is None
    assert validate_token(r, "reset") is None
