import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


def _user(conn, name="Jane Tan", email="jane@x.com", username="jane"):
    return conn.execute(text(
        "insert into users (email, username, full_name, role_id) values (:e, :u, :n, 1) returning id"),
        {"e": email, "u": username, "n": name}).scalar_one()


def _booking(conn, user_id, seat_id):
    return conn.execute(text(
        "insert into seat_bookings (seat_id, seat_label, booking_date, starts_at, ends_at, preset, "
        "booked_for, booked_for_name, release_at) values (:s, 'A1', date '2026-10-16', "
        "timestamptz '2026-10-16 08:00+08', timestamptz '2026-10-16 13:00+08', 'am', :u, 'Jane Tan', "
        "timestamptz '2026-10-16 08:30+08') returning id"), {"s": seat_id, "u": user_id}).scalar_one()


SEAT = "11111111-1111-1111-1111-111111111111"


def test_booking_blocks_unique_per_seat_and_person(db):
    with db.connect() as conn:
        jane = _user(conn)
        ali = _user(conn, "Ali Rahman", "ali@x.com", "ali")
        b1 = _booking(conn, jane, SEAT)
        b2 = _booking(conn, ali, "22222222-2222-2222-2222-222222222222")
        block = "timestamptz '2026-10-16 08:00+08'"
        conn.execute(text(f"insert into seat_booking_blocks (booking_id, seat_id, block_start, booked_for) "
                          f"values (:b, :s, {block}, :u)"), {"b": b1, "s": SEAT, "u": jane})
        with pytest.raises(IntegrityError):  # same seat, same block
            conn.execute(text(f"insert into seat_booking_blocks (booking_id, seat_id, block_start, booked_for) "
                              f"values (:b, :s, {block}, :u)"), {"b": b2, "s": SEAT, "u": ali})
        with pytest.raises(IntegrityError):  # same person, same block, other seat
            conn.execute(text(f"insert into seat_booking_blocks (booking_id, seat_id, block_start, booked_for) "
                              f"values (:b, :s, {block}, :u)"),
                         {"b": b2, "s": "22222222-2222-2222-2222-222222222222", "u": jane})


def test_booking_allowance_range(db):
    with db.connect() as conn:
        uid = _user(conn)
        assert conn.execute(text("select booking_allowance from users where id = :u"), {"u": uid}).scalar_one() == 0
        with pytest.raises(IntegrityError):
            conn.execute(text("update users set booking_allowance = 21 where id = :u"), {"u": uid})


def test_deleting_user_keeps_booking_and_checkin_rows(db):
    with db.connect() as conn:
        uid = _user(conn)
        bid = _booking(conn, uid, SEAT)
        conn.execute(text(
            "insert into seat_checkins (seat_id, seat_label, user_id, user_name, ends_at, method, booking_id) "
            "values (:s, 'A1', :u, 'Jane Tan', now() + interval '1 hour', 'booking', :b)"),
            {"s": SEAT, "u": uid, "b": bid})
        conn.execute(text("delete from users where id = :u"), {"u": uid})
        booking = conn.execute(text("select booked_for, booked_for_name from seat_bookings where id = :b"),
                               {"b": bid}).one()
        assert booking.booked_for is None and booking.booked_for_name == "Jane Tan"
        checkin = conn.execute(text("select user_id, user_name from seat_checkins where booking_id = :b"),
                               {"b": bid}).one()
        assert checkin.user_id is None and checkin.user_name == "Jane Tan"


def test_display_slug_and_layout_constraints(db):
    with db.connect() as conn:
        conn.execute(text("insert into dashboard_displays (slug, name) values ('office-a', 'Office A')"))
        for slug, layout in (("Office A", "rotate"), ("-a", "rotate"), ("office-b", "carousel"), ("office-a", "grid")):
            with pytest.raises(IntegrityError):
                conn.execute(text("insert into dashboard_displays (slug, name, layout) values (:s, 'X', :l)"),
                             {"s": slug, "l": layout})
        row = conn.execute(text("select layout, rotate_seconds, show_overall from dashboard_displays")).one()
        assert (row.layout, row.rotate_seconds, row.show_overall) == ("rotate", 20, True)
