from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from ..db import Base
from ..utils.timezone import app_now


# Real-time PLC data (Modbus) - written by cloud/Modbus team; we only read via API.

class PLCDataSnapshot(Base):
    __tablename__ = "plc_data_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    running_status: Mapped[bool] = mapped_column(Boolean, default=False)
    process_status: Mapped[int] = mapped_column(Integer, default=0)
    process_product: Mapped[int | None] = mapped_column(Integer, nullable=True)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("production_batches.id"), nullable=True)
    ambient_temp: Mapped[float | None] = mapped_column(Float, nullable=True)
    humidity: Mapped[float | None] = mapped_column(Float, nullable=True)
    pressure_before: Mapped[float | None] = mapped_column(Float, nullable=True)
    pressure_after: Mapped[float | None] = mapped_column(Float, nullable=True)
    conditioner_temp: Mapped[float | None] = mapped_column(Float, nullable=True)
    bagging_temp: Mapped[float | None] = mapped_column(Float, nullable=True)
    motor_temp: Mapped[float | None] = mapped_column(Float, nullable=True)
    motor_rpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    pellet_feeder_speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    pellet_motor_load: Mapped[float | None] = mapped_column(Float, nullable=True)

    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=app_now)


# Single-row machine state controlled by HMI.

class MachineState(Base):

    __tablename__ = "machine_state"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False, default=1)
    is_running: Mapped[bool] = mapped_column(Boolean, default=False)
    active_batch_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=app_now,
        onupdate=app_now,
    )
