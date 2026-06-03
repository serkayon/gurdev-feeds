from __future__ import annotations

import base64
import hashlib
import os
from pathlib import Path
from sqlalchemy import select, text
from sqlalchemy.schema import CreateSchema

# Support direct execution from backend/database:
#   cd backend/database
#   python schema.py
if __package__ in (None, ""):
    import sys

    sys.path.append(str(Path(__file__).resolve().parents[1]))
    from database.connection import Base, DB_SCHEMA, SessionLocal, engine
    from database.models.plc import MachineState
    from database.models.raw_material import RawMaterialType
    from database.models.user import User, UserRole
else:
    from .connection import Base, DB_SCHEMA, SessionLocal, engine
    from .models.plc import MachineState
    from .models.raw_material import RawMaterialType
    from .models.user import User, UserRole

PIN_FIELDS = (
    "settings_pin_hash",
    "pin_rm_entry_edit_hash",
    "pin_rm_lab_edit_hash",
    "pin_dispatch_edit_hash",
    "pin_production_details_edit_hash",
    "pin_production_report_access_hash",
    "pin_recipe_access_hash",
)


def create_schema() -> None:
    from database import models  # noqa: F401

    _ensure_schema_exists()
    Base.metadata.create_all(bind=engine)
    _ensure_existing_columns()
    _seed_defaults()


def _ensure_schema_exists() -> None:
    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as conn:
        conn.execute(CreateSchema(DB_SCHEMA, if_not_exists=True))


def _ensure_existing_columns() -> None:
    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                ALTER TABLE {DB_SCHEMA}.plc_data_snapshots
                ADD COLUMN IF NOT EXISTS process_product INTEGER
                """
            )
        )


def _seed_defaults() -> None:
    with SessionLocal() as session:
        if session.execute(select(RawMaterialType).limit(1)).scalars().one_or_none() is None:
            for name in ["MAIZE", "SOYA", "DORB", "DDGS", "MDOC", "MGL"]:
                session.add(RawMaterialType(name=name))

        if session.get(MachineState, 1) is None:
            session.add(MachineState(id=1, is_running=False, active_batch_id=None))

        if session.execute(select(User).limit(1)).scalars().one_or_none() is None:
            session.add(
                User(
                    email="client@gmail.com",
                    password=_hash_password("open@123"),
                    settings_pin_hash=_hash_password("1234"),
                    pin_rm_entry_edit_hash=_hash_password("1234"),
                    pin_rm_lab_edit_hash=_hash_password("1234"),
                    pin_dispatch_edit_hash=_hash_password("1234"),
                    pin_production_details_edit_hash=_hash_password("1234"),
                    pin_production_report_access_hash=_hash_password("1234"),
                    pin_recipe_access_hash=_hash_password("1234"),
                    full_name="Client User",
                    role=UserRole.customer.value,
                    company_name="",
                    phone=None,
                    address=None,
                    logo_url=None,
                    is_active=True,
                    created_by_id=None,
                )
            )

        for user in session.execute(select(User)).scalars().all():
            for pin_field in PIN_FIELDS:
                pin_value = str(getattr(user, pin_field, "") or "").strip()
                if not pin_value:
                    setattr(user, pin_field, _hash_password("1234"))
                    continue
                if not _is_pbkdf2_hash(pin_value):
                    setattr(user, pin_field, _hash_password(pin_value))

        session.commit()


def _hash_password(password: str) -> str:
    plain = str(password or "")
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", plain.encode("utf-8"), salt, 260000)
    salt_b64 = base64.b64encode(salt).decode("utf-8")
    digest_b64 = base64.b64encode(digest).decode("utf-8")
    return f"pbkdf2_sha256$260000${salt_b64}${digest_b64}"


def _is_pbkdf2_hash(value: str) -> bool:
    return str(value or "").startswith("pbkdf2_sha256$")


if __name__ == "__main__":
    create_schema()
    print("Schema created successfully.")
