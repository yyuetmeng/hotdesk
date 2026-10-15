import datetime as dt
import uuid

from sqlalchemy import (BigInteger, Boolean, Date, DateTime, ForeignKey, PrimaryKeyConstraint,
                        SmallInteger, Text, func, text)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .orm import Base


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True,
                                          server_default=text("gen_random_uuid()"))
    name: Mapped[str] = mapped_column(Text, unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=func.now())


class UserDepartment(Base):
    __tablename__ = "user_departments"
    __table_args__ = (PrimaryKeyConstraint("user_id", "department_id"),)

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    department_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True,
                                          server_default=text("gen_random_uuid()"))
    # Database column type is citext (case-insensitive text); mapped as plain Text
    # since Postgres enforces case-insensitive comparisons regardless of the
    # Python-side type used by SQLAlchemy.
    email: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    username: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(Text, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(Text)
    role_id: Mapped[int] = mapped_column(
        SmallInteger, ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    start_date: Mapped[dt.date | None] = mapped_column(Date)
    end_date: Mapped[dt.date | None] = mapped_column(Date)
    failed_attempts: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0,
                                                 server_default=text("0"))
    # How many colleagues this user may book seats for per day (0-20; sql/0017).
    booking_allowance: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0,
                                                   server_default=text("0"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=func.now())

    role: Mapped[Role] = relationship(lazy="joined")
    departments: Mapped[list[Department]] = relationship(
        secondary=UserDepartment.__table__, lazy="joined", order_by=Department.name)


class UserToken(Base):
    __tablename__ = "user_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True,
                                          server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(Text, nullable=False)
    target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    details: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict,
                                          server_default=text("'{}'::jsonb"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=func.now())
