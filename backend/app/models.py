from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    alert_id: Mapped[str] = mapped_column(String(64), index=True)
    region_id: Mapped[str] = mapped_column(String(64), index=True)
    signal: Mapped[str] = mapped_column(String(64), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    # User labels
    label: Mapped[str] = mapped_column(String(32))  # "true_positive" | "false_positive" | "investigating"
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RegionThreshold(Base):
    __tablename__ = "region_thresholds"

    region_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # Higher means stricter (fewer alerts)
    min_confidence: Mapped[float] = mapped_column(Float, default=0.65)
    # If feedback indicates many false positives, we increase this automatically
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

