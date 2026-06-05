from sqlalchemy import String, Float, DateTime, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime

from ..connection import Base
from ..timezone import app_now


# Define DispatchEntry.

class DispatchEntry(Base):
    __tablename__ = "dispatch_entries"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    dispatch_code: Mapped[str | None] = mapped_column(String(8), unique=True, index=True, nullable=True)
    date: Mapped[datetime] = mapped_column(DateTime)
    party_name: Mapped[str] = mapped_column(String(255))
    party_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    party_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    pincode: Mapped[str | None] = mapped_column(String(10), nullable=True)
    vehicle_no: Mapped[str] = mapped_column(String(50))
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=app_now)
    last_modified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    products: Mapped[list["DispatchProduct"]] = relationship(
        "DispatchProduct",
        back_populates="dispatch_entry",
        cascade="all, delete-orphan",
    )


# Define DispatchProduct.

class DispatchProduct(Base):
    __tablename__ = "dispatch_products"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    dispatch_code: Mapped[str] = mapped_column(
        ForeignKey("dispatch_entries.dispatch_code"),
        index=True,
    )
    product_type: Mapped[str] = mapped_column(String(100))
    num_bags: Mapped[float] = mapped_column(Float)
    weight_per_bag: Mapped[float] = mapped_column(Float)
    total_weight: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=app_now)

    dispatch_entry: Mapped["DispatchEntry"] = relationship(
        "DispatchEntry", back_populates="products"
    )
