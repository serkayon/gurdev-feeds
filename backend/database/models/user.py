from sqlalchemy import String, Boolean, DateTime, Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from datetime import datetime
import base64
import enum
import hashlib
import os

from ..connection import Base
from ..timezone import app_now


# Define UserRole.

class UserRole(str, enum.Enum):
    vendor = "vendor"
    customer = "customer"


def _default_pin_hash() -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", b"1234", salt, 260000)
    salt_b64 = base64.b64encode(salt).decode("utf-8")
    digest_b64 = base64.b64encode(digest).decode("utf-8")
    return f"pbkdf2_sha256$260000${salt_b64}${digest_b64}"


# Define User.

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password: Mapped[str] = mapped_column(String(255))
    settings_pin_hash: Mapped[str] = mapped_column(String(255), default=_default_pin_hash)
    pin_rm_entry_edit_hash: Mapped[str] = mapped_column(String(255), default=_default_pin_hash)
    pin_rm_lab_edit_hash: Mapped[str] = mapped_column(String(255), default=_default_pin_hash)
    pin_dispatch_edit_hash: Mapped[str] = mapped_column(String(255), default=_default_pin_hash)
    pin_production_details_edit_hash: Mapped[str] = mapped_column(String(255), default=_default_pin_hash)
    pin_production_report_access_hash: Mapped[str] = mapped_column(String(255), default=_default_pin_hash)
    pin_recipe_access_hash: Mapped[str] = mapped_column(String(255), default=_default_pin_hash)
    full_name: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20))  # vendor | customer
    company_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by_id: Mapped[int | None] = mapped_column(nullable=True)  # vendor who created this customer
    created_at: Mapped[datetime] = mapped_column(DateTime, default=app_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=app_now, onupdate=app_now)
