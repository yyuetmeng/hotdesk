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
