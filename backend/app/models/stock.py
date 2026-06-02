from sqlalchemy import String, Float, DateTime, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from datetime import datetime

from ..db import Base


# Define RMStockLedger.

class RMStockLedger(Base):
    __tablename__ = "raw_material_ledger"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    date: Mapped[datetime] = mapped_column(DateTime)
    rm_name: Mapped[str] = mapped_column(String(100))
    opening_stock: Mapped[float] = mapped_column(Float, default=0)
    received: Mapped[float] = mapped_column(Float, default=0)
    consumption: Mapped[float] = mapped_column(Float, default=0)
    closing_stock: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# Define RawMaterialStock.

class RawMaterialStock(Base):
    __tablename__ = "raw_material_stock"
    __table_args__ = (
        UniqueConstraint("rm_name", name="uq_raw_material_stock_rm"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    rm_name: Mapped[str] = mapped_column(String(100), index=True)
    quantity: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_modified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# Define FeedStock.

class FeedStock(Base):
    __tablename__ = "feed_stock_ledger"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    date: Mapped[datetime] = mapped_column(DateTime)
    feed_type: Mapped[str] = mapped_column(String(100))
    # Bag size bucket key in grams (e.g. 25000 for 25kg bag).
    # Keeps 25kg and 50kg stock as separate ledgers for the same product.
    bag_weight_grams: Mapped[int | None] = mapped_column(Integer, nullable=True)
    opening_stock: Mapped[float] = mapped_column(Float, default=0)
    produced: Mapped[float] = mapped_column(Float, default=0)
    dispatched: Mapped[float] = mapped_column(Float, default=0)
    closing_stock: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# Define FeedStockCurrent.

class FeedStockCurrent(Base):
    __tablename__ = "feed_stock"
    __table_args__ = (
        UniqueConstraint(
            "feed_type",
            "bag_weight_grams",
            name="uq_feed_stock_feed_variant",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    feed_type: Mapped[str] = mapped_column(String(100), index=True)
    bag_weight_grams: Mapped[int | None] = mapped_column(Integer, nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_modified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
