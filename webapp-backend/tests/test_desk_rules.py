"""Booking time rules (spec 2026-10-15-seat-booking-and-checkin §2.2-2.6). Pure: no database."""
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.desk import rules

SG = ZoneInfo("Asia/Singapore")
DAY = date(2026, 10, 16)


def sg(day, hh, mm=0):
    return datetime(day.year, day.month, day.day, hh, mm, tzinfo=SG)


def test_presets_map_to_blocks():
    before = sg(DAY - timedelta(days=1), 15)
    for preset, count in (("am", 10), ("pm", 10), ("full", 20)):
        starts, ends = rules.preset_range(DAY, preset, before)
        assert len(rules.blocks(starts, ends)) == count
    assert rules.preset_range(DAY, "am", before) == (sg(DAY, 8), sg(DAY, 13))
    assert rules.preset_range(DAY, "pm", before) == (sg(DAY, 13), sg(DAY, 18))


def test_release_times_spec_examples():
    yesterday = sg(DAY - timedelta(days=1), 17)
    assert rules.release_at(DAY, "am", yesterday) == sg(DAY, 8, 30)
    assert rules.release_at(DAY, "pm", sg(DAY, 9)) == sg(DAY, 13, 30)      # PM booked in the morning
    assert rules.release_at(DAY, "full", yesterday) == sg(DAY, 10)
    assert rules.release_at(DAY, "am", sg(DAY, 9, 30)) == sg(DAY, 10)      # AM booked at 09:30
    assert rules.release_at(DAY, "full", sg(DAY, 9)) == sg(DAY, 9, 30)     # full day booked at 09:00


def test_in_progress_preset_starts_at_next_boundary_and_closes_30_minutes_before_end():
    assert rules.preset_range(DAY, "am", sg(DAY, 12, 20)) == (sg(DAY, 12, 30), sg(DAY, 13))
    assert rules.preset_range(DAY, "am", sg(DAY, 12, 30)) == (sg(DAY, 12, 30), sg(DAY, 13))
    with pytest.raises(rules.BookingRuleError, match="too late to book AM"):
        rules.preset_range(DAY, "am", sg(DAY, 12, 45))
    with pytest.raises(rules.BookingRuleError, match="too late to book Full day"):
        rules.preset_range(DAY, "full", sg(DAY, 19))


def test_only_today_or_tomorrow():
    with pytest.raises(rules.BookingRuleError, match="today or tomorrow"):
        rules.preset_range(DAY + timedelta(days=2), "am", sg(DAY, 9))
    with pytest.raises(rules.BookingRuleError, match="today or tomorrow"):
        rules.preset_range(DAY - timedelta(days=1), "am", sg(DAY, 9))
    with pytest.raises(rules.BookingRuleError, match="unknown"):
        rules.preset_range(DAY, "night", sg(DAY, 9))


def test_singapore_midnight_boundary():
    late = sg(DAY, 23, 59)
    assert rules.bookable_days(late) == (DAY, DAY + timedelta(days=1))
    assert rules.local_today(sg(DAY + timedelta(days=1), 0, 1)) == DAY + timedelta(days=1)
    # 23:59 SG is 15:59 UTC the same calendar day: the local date must still be used.
    assert rules.local_today(late.astimezone(ZoneInfo("UTC"))) == DAY


def test_walk_in_end():
    assert rules.walk_in_ends_at(sg(DAY, 9), sg(DAY, 13)) == sg(DAY, 13)
    assert rules.walk_in_ends_at(sg(DAY, 9), None) == sg(DAY, 18)
    assert rules.walk_in_ends_at(sg(DAY, 9), sg(DAY, 20)) == sg(DAY, 18)
    assert rules.walk_in_ends_at(sg(DAY, 19), None) == sg(DAY + timedelta(days=1), 0)


def test_checkin_window_opens_30_minutes_early():
    assert rules.checkin_window_opens(sg(DAY, 8)) == sg(DAY, 7, 30)
