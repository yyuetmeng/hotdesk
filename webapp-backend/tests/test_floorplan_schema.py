import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


def test_plan_bounds_checks(db):
    with db.connect() as conn:
        with pytest.raises(IntegrityError):
            conn.execute(text("insert into floor_plans (name, cols, rows) values ('x', 2, 10)"))
        with pytest.raises(IntegrityError):
            conn.execute(text("insert into floor_plans (name, cols, rows) values ('x', 10, 2)"))
        with pytest.raises(IntegrityError):
            conn.execute(text("insert into floor_plans (name, cols, rows) values ('x', 81, 10)"))
        with pytest.raises(IntegrityError):
            conn.execute(text("insert into floor_plans (name, cols, rows) values ('x', 10, 81)"))


def test_element_rotation_and_color_checks(db):
    with db.connect() as conn:
        pid = conn.execute(text(
            "insert into floor_plans (name, cols, rows) values ('p', 10, 10) returning id")).scalar_one()
        with pytest.raises(IntegrityError):
            conn.execute(text("insert into floor_plan_elements (plan_id, type, x, y, w, h, rotation) "
                              "values (:p, 'wall', 0, 0, 1, 1, 45)"), {"p": pid})
        with pytest.raises(IntegrityError):
            conn.execute(text("insert into floor_plan_elements (plan_id, type, x, y, w, h, color) "
                              "values (:p, 'wall', 0, 0, 1, 1, 'red')"), {"p": pid})


def test_elements_cascade_with_plan(db):
    with db.connect() as conn:
        pid = conn.execute(text(
            "insert into floor_plans (name, cols, rows) values ('p2', 10, 10) returning id")).scalar_one()
        conn.execute(text("insert into floor_plan_elements (plan_id, type, x, y, w, h) "
                          "values (:p, 'seat', 1, 1, 1, 1)"), {"p": pid})
        conn.execute(text("delete from floor_plans where id = :p"), {"p": pid})
        n = conn.execute(text("select count(*) from floor_plan_elements")).scalar_one()
        assert n == 0


def test_orm_insert_select(app, db):
    from app.core.floorplan_models import FloorPlan
    from app.core.orm import orm_session

    plan = FloorPlan(name="ORM check", cols=10, rows=8)
    session = orm_session()
    session.add(plan)
    session.commit()
    loaded = session.get(FloorPlan, plan.id)
    assert loaded.name == "ORM check" and loaded.cols == 10 and loaded.rows == 8


def test_version_tables_roundtrip(app, db):
    from app.core.floorplan_models import (FloorPlan, FloorPlanElement, FloorPlanVersion,
                                           FloorPlanVersionElement)
    from app.core.orm import orm_session

    session = orm_session()
    plan = FloorPlan(name="Versioned", cols=10, rows=8)
    draft_el = FloorPlanElement(type="seat", x=1, y=1, w=1, h=1, rotation=0)
    plan.elements.append(draft_el)
    session.add(plan)
    session.commit()

    version = FloorPlanVersion(plan_id=plan.id, version=1, name=plan.name, cols=10, rows=8)
    version.elements.append(FloorPlanVersionElement(
        element_id=draft_el.id, type="seat", x=1, y=1, w=1, h=1, rotation=0))
    session.add(version)
    session.flush()
    plan.published_version_id = version.id
    session.commit()

    session.expire_all()
    loaded = session.get(FloorPlan, plan.id)
    assert loaded.published_version.version == 1
    assert loaded.published_version.elements[0].element_id == draft_el.id

    session.delete(loaded)
    session.commit()
    with db.connect() as conn:
        assert conn.execute(text("select count(*) from floor_plan_versions")).scalar_one() == 0
        assert conn.execute(text("select count(*) from floor_plan_version_elements")).scalar_one() == 0


def _plan_with_seat(conn, department_id=None):
    pid = conn.execute(text("insert into floor_plans (name, cols, rows) values ('T', 10, 10) returning id")).scalar_one()
    eid = conn.execute(text(
        "insert into floor_plan_elements (plan_id, type, x, y, w, h, rotation, department_id) "
        "values (:p, 'seat', 0, 0, 1, 1, 0, :d) returning id"), {"p": pid, "d": department_id}).scalar_one()
    return pid, eid


def test_department_tag_columns_and_constraint(db):
    with db.connect() as conn:
        dept = conn.execute(text("insert into departments (name) values ('Eng') returning id")).scalar_one()
        pid, _ = _plan_with_seat(conn, dept)
        with pytest.raises(IntegrityError):
            conn.execute(text(
                "insert into floor_plan_elements (plan_id, type, x, y, w, h, rotation, department_id, open_to_all) "
                "values (:p, 'seat', 2, 0, 1, 1, 0, :d, true)"), {"p": pid, "d": dept})


def test_deleting_department_untags_seats(db):
    with db.connect() as conn:
        dept = conn.execute(text("insert into departments (name) values ('Ops') returning id")).scalar_one()
        pid, eid = _plan_with_seat(conn, dept)
        vid = conn.execute(text(
            "insert into floor_plan_versions (plan_id, version, name, cols, rows) "
            "values (:p, 1, 'T', 10, 10) returning id"), {"p": pid}).scalar_one()
        conn.execute(text(
            "insert into floor_plan_version_elements (version_id, element_id, type, x, y, w, h, rotation, department_id) "
            "values (:v, :e, 'seat', 0, 0, 1, 1, 0, :d)"), {"v": vid, "e": eid, "d": dept})
        conn.execute(text("delete from departments where id = :d"), {"d": dept})
        assert conn.execute(text("select department_id from floor_plan_elements where id = :e"),
                            {"e": eid}).scalar_one() is None
        assert conn.execute(text("select department_id from floor_plan_version_elements where element_id = :e"),
                            {"e": eid}).scalar_one() is None


def test_seat_catalog_has_no_bookable(db):
    with db.connect() as conn:
        assert conn.execute(text("select config from floor_elements where type = 'seat'")).scalar_one() == {}
