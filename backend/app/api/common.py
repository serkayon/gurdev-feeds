# Shared request/response helpers for the backend API layer.


from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, time, timedelta, timezone

from dateutil.parser import isoparse
from .fastapi_compat import jsonify, request

from app.db import SessionLocal
from app.models.dispatch import DispatchEntry
from app.models.production import ProductionBatch, ProductionBatchMaterial, ProductionReport
from app.models.raw_material import RawMaterialEntry
from app.models.user import User
from ..services.auth import create_access_token, decode_token

IST = timezone(timedelta(hours=5, minutes=30))


# Return a naive-or-aware datetime normalized to UTC.

def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


# Yield a database session with automatic commit and rollback handling.

@contextmanager
def db_session():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# Serialize a datetime to an ISO-8601 UTC string.

def dt(value: datetime | None) -> str | None:
    if value is None:
        return None
    return _as_utc(value).isoformat().replace("+00:00", "Z")


# Return a standard JSON error response.

def error(detail: str, status: int = 400):
    return jsonify({"detail": detail}), status


# Parse an incoming datetime string into a naive UTC datetime.

def parse_datetime(raw: str | None, field_name: str = "datetime") -> datetime | None:
    if raw in (None, ""):
        return None
    try:
        parsed = isoparse(raw)
        if parsed.tzinfo is not None:
            return parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except Exception as exc:
        raise ValueError(f"Invalid {field_name}: {raw}") from exc


# Resolve a dashboard/reporting period into UTC start and end bounds.

def resolve_period_range(
    period: str | None,
    *,
    from_date_raw: str | None = None,
    to_date_raw: str | None = None) -> tuple[datetime, datetime]:
    normalized = str(period or "").strip().lower()

    if normalized in {"custom"}:
        from_date = parse_datetime(from_date_raw, "from_date")
        to_date = parse_datetime(to_date_raw, "to_date")
        if from_date is None or to_date is None:
            raise ValueError("from_date and to_date are required for custom period")
        if from_date > to_date:
            raise ValueError("from_date cannot be after to_date")
        return from_date, to_date

    now_ist = datetime.now(timezone.utc).astimezone(IST)
    today_ist = now_ist.date()

    if normalized in {"today"}:
        start_day = today_ist
        end_day = today_ist
    elif normalized in {"last_7", "last7"}:
        start_day = today_ist - timedelta(days=6)
        end_day = today_ist
    elif normalized in {"last_15", "last15"}:
        start_day = today_ist - timedelta(days=14)
        end_day = today_ist
    elif normalized in {"last_30", "last30"}:
        start_day = today_ist - timedelta(days=29)
        end_day = today_ist
    elif normalized in {"this_month", "current_month", "month"}:
        start_day = today_ist.replace(day=1)
        if start_day.month == 12:
            next_month_start = date(start_day.year + 1, 1, 1)
        else:
            next_month_start = date(start_day.year, start_day.month + 1, 1)
        end_day = next_month_start - timedelta(days=1)
    else:
        raise ValueError(
            "Invalid period. Allowed: today, last_7, last_15, last_30, this_month, custom"
        )

    start_ist = datetime.combine(start_day, time(0, 0, 0), tzinfo=IST)
    end_ist = datetime.combine(end_day, time(23, 59, 59), tzinfo=IST)
    from_date = start_ist.astimezone(timezone.utc).replace(tzinfo=None)
    to_date = end_ist.astimezone(timezone.utc).replace(tzinfo=None)
    return from_date, to_date


# Return a required payload field or raise a validation error.

def required(payload: dict, field: str) -> str:
    value = payload.get(field)
    if value in (None, ""):
        raise ValueError(f"{field} is required")
    return value


# Parse a numeric payload field and optionally require it.

def parse_float(payload: dict, field: str, required_field: bool = False) -> float | None:
    value = payload.get(field)
    if value in (None, ""):
        if required_field:
            raise ValueError(f"{field} is required")
        return None
    try:
        return float(value)
    except Exception as exc:
        raise ValueError(f"{field} must be a number") from exc


# Return the parsed JSON body for the current request.

def json_body() -> dict:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object")
    return payload


# Convert a user model into a response payload.

def serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "company_name": user.company_name,
        "phone": user.phone,
        "address": user.address,
        "logo_url": user.logo_url,
        "is_active": user.is_active,
        "created_at": dt(user.created_at),
    }


# Build the login response with a bearer token and user payload.

def token_response(user: User) -> dict:
    token = create_access_token({"sub": str(user.id), "role": user.role})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": serialize_user(user),
    }


# Resolve the authenticated user from the Authorization header.

def current_user(db) -> User:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.lower().startswith("bearer "):
        raise PermissionError("Authentication required")

    token = auth_header.split(" ", 1)[1].strip()
    payload = decode_token(token)
    if not payload:
        raise PermissionError("Invalid or expired token")

    subject = payload.get("sub")
    if not subject:
        raise PermissionError("Invalid token payload")

    try:
        user_id = int(subject)
    except (TypeError, ValueError) as exc:
        raise PermissionError("Invalid token payload") from exc

    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise PermissionError("User not found or inactive")
    return user


# Serialize a raw material entry for list and detail responses.

def serialize_raw_entry(entry: RawMaterialEntry, has_lab: bool) -> dict:
    entry_code = str(getattr(entry, "entry_code", "") or "").strip()
    if not entry_code:
        entry_code = "RMX00000"
    return {
        "entry_code": entry_code,
        "date": dt(entry.date),
        "rm_type": entry.rm_type,
        "supplier": entry.supplier,
        "challan_no": entry.challan_no,
        "vehicle_no": entry.vehicle_no,
        "total_weight": entry.total_weight,
        "remarks": entry.remarks,
        "has_lab_report": has_lab,
        "created_at": dt(entry.created_at),
        "last_modified_at": dt(entry.last_modified_at),
    }


# Serialize a dispatch entry for API responses.

def serialize_dispatch(entry: DispatchEntry) -> dict:
    dispatch_code = str(getattr(entry, "dispatch_code", "") or "").strip()
    if not dispatch_code:
        dispatch_code = "DPX00000"
    return {
        "dispatch_code": dispatch_code,
        "date": dt(entry.date),
        "party_name": entry.party_name,
        "vehicle_no": entry.vehicle_no,
        "quantity": entry.quantity,
        "product_type": entry.product_type,
        "price": entry.price,
        "created_at": dt(entry.created_at),
    }


# Serialize a production batch and its runtime state.

def serialize_batch(batch: ProductionBatch, has_report: bool, is_active: bool = False) -> dict:
    batch_no = batch.batch_no.strip() if isinstance(batch.batch_no, str) else ""
    last_modified = batch.last_modified_at or batch.created_at
    planned_count = int(batch.batch_size or 0) if batch.batch_size is not None else 0
    completed_count = int(batch.hmi_completed_count or 0)
    run_status = (batch.hmi_status or "").strip().lower() or "pending"
    if is_active:
        run_status = "running"
    progress_label = f"{completed_count}/{planned_count}" if planned_count > 0 else None
    return {
        "id": batch.id,
        "batch_no": batch_no or str(batch.id),
        "date": dt(batch.date),
        "product_name": batch.product_name,
        "recipe_type": batch.recipe_type,
        "batch_size": batch.batch_size,
        "mop": batch.mop,
        "water": batch.water,
        "num_bags": batch.num_bags,
        "weight_per_bag": batch.weight_per_bag,
        "output": batch.output,
        "has_report": has_report,
        "is_active": is_active,
        "run_status": run_status,
        "planned_count": planned_count,
        "completed_count": completed_count,
        "progress_label": progress_label,
        "duration_per_count_seconds": batch.hmi_duration_seconds,
        "started_at": dt(batch.hmi_started_at),
        "completed_at": dt(batch.hmi_completed_at),
        "stock_posted": bool(batch.stock_posted),
        "rm_reduced": bool(getattr(batch, "rm_reduced", False)),
        "rm_shortage_flag": bool(batch.rm_shortage_flag),
        "rm_shortage_detail": batch.rm_shortage_detail,
        "created_at": dt(batch.created_at),
        "last_modified_at": dt(last_modified),
    }


# Serialize a batch material row.

def serialize_batch_material(material: ProductionBatchMaterial) -> dict:
    return {
        "id": material.id,
        "batch_id": material.batch_id,
        "rm_name": material.rm_name,
        "quantity": material.quantity,
        "total_quantity": material.total_quantity,
        "created_at": dt(material.created_at),
    }


# Serialize a production report when one exists.

def serialize_report(report: ProductionReport | None) -> dict | None:
    if not report:
        return None
    return {
        "id": report.id,
        "batch_id": report.batch_id,
        "protein": report.protein,
        "fat": report.fat,
        "fiber": report.fiber,
        "ash": report.ash,
        "calcium": report.calcium,
        "phosphorus": report.phosphorus,
        "salt": report.salt,
        "hm_retention": report.hm_retention,
        "mixer_moisture": report.mixer_moisture,
        "conditioner_moisture": report.conditioner_moisture,
        "moisture_addition": report.moisture_addition,
        "final_feed_moisture": report.final_feed_moisture,
        "water_activity": report.water_activity,
        "hardness": report.hardness,
        "pellet_diameter": report.pellet_diameter,
        "fines": report.fines,
        "created_at": dt(report.created_at),
    }

