from sqlalchemy import String, Float, DateTime, Integer, Text, ForeignKey, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime

from ..db import Base
from ..utils.timezone import app_now


# Define ProductionBatch.

class ProductionBatch(Base):
    __tablename__ = "production_batches"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    batch_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    date: Mapped[datetime] = mapped_column(DateTime)
    recipe_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    product_name: Mapped[str] = mapped_column(String(255))
    batch_size: Mapped[float] = mapped_column(Float)
    mop: Mapped[float | None] = mapped_column(Float, nullable=True)
    water: Mapped[float | None] = mapped_column(Float, nullable=True)
    num_bags: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_per_bag: Mapped[float | None] = mapped_column(Float, nullable=True)
    output: Mapped[float] = mapped_column(Float)
    hmi_duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    hmi_completed_count: Mapped[int] = mapped_column(Integer, default=0)
    hmi_status: Mapped[str] = mapped_column(String(32), default="pending")
    hmi_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    hmi_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    stock_posted: Mapped[bool] = mapped_column(Boolean, default=False)
    rm_reduced: Mapped[bool] = mapped_column(Boolean, default=False)
    rm_shortage_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    rm_shortage_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=app_now)
    last_modified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    report: Mapped["ProductionReport | None"] = relationship(
        "ProductionReport", back_populates="batch", uselist=False
    )
    materials: Mapped[list["ProductionBatchMaterial"]] = relationship(
        "ProductionBatchMaterial",
        back_populates="batch",
        cascade="all, delete-orphan",
    )


# Define ProductionBatchMaterial.

class ProductionBatchMaterial(Base):
    __tablename__ = "production_batch_materials"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("production_batches.id"))
    rm_name: Mapped[str] = mapped_column(String(255))
    quantity: Mapped[float] = mapped_column(Float)
    total_quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=app_now)

    batch: Mapped["ProductionBatch"] = relationship(
        "ProductionBatch",
        back_populates="materials",
    )


# Define ProductionReport.

class ProductionReport(Base):
    __tablename__ = "production_batch_reports"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("production_batches.id"), unique=True)
    batch: Mapped["ProductionBatch"] = relationship("ProductionBatch", back_populates="report")

    protein: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat: Mapped[float | None] = mapped_column(Float, nullable=True)
    fiber: Mapped[float | None] = mapped_column(Float, nullable=True)
    ash: Mapped[float | None] = mapped_column(Float, nullable=True)
    calcium: Mapped[float | None] = mapped_column(Float, nullable=True)
    phosphorus: Mapped[float | None] = mapped_column(Float, nullable=True)
    salt: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Physical
    hm_retention: Mapped[float | None] = mapped_column(Float, nullable=True)
    mixer_moisture: Mapped[float | None] = mapped_column(Float, nullable=True)
    conditioner_moisture: Mapped[float | None] = mapped_column(Float, nullable=True)
    moisture_addition: Mapped[float | None] = mapped_column(Float, nullable=True)
    final_feed_moisture: Mapped[float | None] = mapped_column(Float, nullable=True)
    water_activity: Mapped[float | None] = mapped_column(Float, nullable=True)
    hardness: Mapped[float | None] = mapped_column(Float, nullable=True)
    pellet_diameter: Mapped[float | None] = mapped_column(Float, nullable=True)
    fines: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=app_now)
