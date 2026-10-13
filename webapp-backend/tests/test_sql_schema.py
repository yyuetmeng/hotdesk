import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


def test_citext_email_unique_case_insensitive(db):
    with db.connect() as conn:
        conn.execute(text(
            "insert into users (email, username, full_name, role_id) "
            "values ('a@b.com', 'aaa', 'A', 1)"))
        with pytest.raises(IntegrityError):
            conn.execute(text(
                "insert into users (email, username, full_name, role_id) "
                "values ('A@B.COM', 'bbb', 'B', 1)"))


def test_username_unique(db):
    with db.connect() as conn:
        conn.execute(text(
            "insert into users (email, username, full_name, role_id) "
            "values ('a@b.com', 'same', 'A', 1)"))
        with pytest.raises(IntegrityError):
            conn.execute(text(
                "insert into users (email, username, full_name, role_id) "
                "values ('c@d.com', 'SAME', 'B', 1)"))


def test_date_range_check(db):
    with db.connect() as conn:
        with pytest.raises(IntegrityError):
            conn.execute(text(
                "insert into users (email, username, full_name, role_id, start_date, end_date) "
                "values ('c@d.com', 'ccc', 'C', 1, '2026-01-10', '2026-01-01')"))


def test_department_delete_cascades_membership(db):
    with db.connect() as conn:
        uid = conn.execute(text(
            "insert into users (email, username, full_name, role_id) "
            "values ('d@e.com', 'ddd', 'D', 1) returning id")).scalar_one()
        did = conn.execute(text("insert into departments (name) values ('Eng') returning id")).scalar_one()
        conn.execute(text("insert into user_departments (user_id, department_id) values (:u, :d)"),
                     {"u": uid, "d": did})
        conn.execute(text("delete from departments where id = :d"), {"d": did})
        n = conn.execute(text("select count(*) from user_departments where user_id = :u"),
                         {"u": uid}).scalar_one()
        assert n == 0


def test_audit_actor_set_null_when_user_deleted(db):
    with db.connect() as conn:
        uid = conn.execute(text(
            "insert into users (email, username, full_name, role_id) "
            "values ('e@f.com', 'eee', 'E', 1) returning id")).scalar_one()
        conn.execute(text(
            "insert into audit_logs (actor_id, action, target_id) values (:a, 'user.create', :t)"),
            {"a": uid, "t": uid})
        conn.execute(text("delete from users where id = :u"), {"u": uid})
        actor = conn.execute(text("select actor_id from audit_logs where action = 'user.create'")).scalar_one()
        assert actor is None
