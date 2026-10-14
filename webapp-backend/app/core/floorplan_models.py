import datetime as dt
import uuid

from sqlalchemy import (Boolean, CheckConstraint, DateTime, ForeignKey, Integer, SmallInteger, Text,
                        func, text)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .orm import Base


class FloorPlan(Base):
    __tablename__ = "floor_plans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    cols: Mapped[int] = mapped_column(Integer, nullable=False)
    rows: Mapped[int] = mapped_column(Integer, nullable=False)
    # Plain column (no ORM-level ForeignKey): "users" is owned by the raw-SQL
    # modules and is not registered in this Base's metadata. The physical FK
    # + ON DELETE SET NULL is enforced by sql/0008_floor_plans.sql.
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now())

    elements: Mapped[list["FloorPlanElement"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan",
        order_by="FloorPlanElement.y, FloorPlanElement.x")


class FloorPlanElement(Base):
    __tablename__ = "floor_plan_elements"
    __table_args__ = (CheckConstraint("rotation in (0, 90, 180, 270)", name="rotation_values"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("floor_plans.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[str] = mapped_column(
        Text, ForeignKey("floor_elements.type", onupdate="CASCADE", ondelete="RESTRICT"), nullable=False)
    x: Mapped[int] = mapped_column(Integer, nullable=False)
    y: Mapped[int] = mapped_column(Integer, nullable=False)
    w: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    h: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    rotation: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    label: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(Text)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict,
                                         server_default=text("'{}'::jsonb"))

    plan: Mapped[FloorPlan] = relationship(back_populates="elements")


class FloorElement(Base):
    """Catalog entry: one placeable element type and its defaults (sql/0012_floor_elements.sql)."""

    __tablename__ = "floor_elements"

    type: Mapped[str] = mapped_column(Text, primary_key=True)
    label: Mapped[str] = mapped_column(Text, nullable=False)
    w: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    h: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    color: Mapped[str] = mapped_column(Text, nullable=False)
    resizable: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict,
                                         server_default=text("'{}'::jsonb"))
    sort_order: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default=text("0"))
