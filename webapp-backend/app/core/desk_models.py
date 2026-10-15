"""Seat booking and check-in models (sql/0017_seat_booking.sql).

Spec: docs/superpowers/specs/2026-10-15-seat-booking-and-checkin-design.md §4.
"""
import datetime as dt
import uuid

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, SmallInteger, Text, func, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .orm import Base


class SeatBooking(Base):
    __tablename__ = "seat_bookings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("floor_plans.id", ondelete="SET NULL"))
    version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("floor_plan_versions.id", ondelete="SET NULL"))
    seat_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    seat_label: Mapped[str | None] = mapped_column(Text)
    booking_date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    starts_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    preset: Mapped[str | None] = mapped_column(Text)
    booked_for: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    booked_for_name: Mapped[str] = mapped_column(Text, nullable=False)
    booked_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    booked_by_name: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now())
    release_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    end_reason: Mapped[str | None] = mapped_column(Text)
    cancelled_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))

    blocks: Mapped[list["SeatBookingBlock"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True, order_by="SeatBookingBlock.block_start")


class SeatBookingBlock(Base):
    """A 30-minute block held by an active booking; unique per seat and per person."""

    __tablename__ = "seat_booking_blocks"

    booking_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("seat_bookings.id", ondelete="CASCADE"), primary_key=True)
    block_start: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    seat_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    booked_for: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))


class SeatCheckin(Base):
    __tablename__ = "seat_checkins"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("floor_plans.id", ondelete="SET NULL"))
    version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("floor_plan_versions.id", ondelete="SET NULL"))
    seat_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    seat_label: Mapped[str | None] = mapped_column(Text)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"))
    user_name: Mapped[str] = mapped_column(Text, nullable=False)
    checked_in_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now())
    ends_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    checked_out_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    end_reason: Mapped[str | None] = mapped_column(Text)
    booking_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("seat_bookings.id", ondelete="SET NULL"))
    method: Mapped[str] = mapped_column(Text, nullable=False)
    seat_department_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("departments.id", ondelete="SET NULL"))
    seat_open_to_all: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False,
                                                   server_default=text("false"))
    user_department_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, default=list, server_default=text("'{}'"))


class DashboardDisplay(Base):
    """A public TV display: which floors to show and how (sql/0018_dashboard_displays.sql)."""

    __tablename__ = "dashboard_displays"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    plan_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, default=list, server_default=text("'{}'"))
    show_overall: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("true"))
    layout: Mapped[str] = mapped_column(Text, nullable=False, default="rotate", server_default=text("'rotate'"))
    rotate_seconds: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=20, server_default=text("20"))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now())
