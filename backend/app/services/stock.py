from collections import defaultdict
from datetime import datetime, timedelta
from math import floor
from typing import Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.dispatch import DispatchEntry, DispatchProduct
from app.models.production import ProductionBatch, ProductionBatchMaterial
from app.models.raw_material import RawMaterialEntry
from app.models.stock import FeedStock, FeedStockCurrent, RMStockLedger, RawMaterialStock

IST_OFFSET = timedelta(hours=5, minutes=30)


# Start of day.

def _start_of_day(dt: datetime) -> datetime:
    # Persist one ledger row per type, per day.
    return dt.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)


# Normalize bag weight grams.

def _normalize_bag_weight_grams(weight_per_bag: float | int | None) -> int | None:
    if weight_per_bag in (None, ""):
        return None
    try:
        parsed = float(weight_per_bag)
    except (TypeError, ValueError):
        return None
    if parsed <= 0:
        return None
    return int(round(parsed * 1000))


# Handle bag weight label.

def _bag_weight_label(bag_weight_grams: int | None) -> str:
    if bag_weight_grams in (None, 0):
        return ""
    kg = bag_weight_grams / 1000.0
    return f"{kg:g}kg/bag"


# Handle feed variant label.

def _feed_variant_label(feed_type: str, bag_weight_grams: int | None) -> str:
    label = _bag_weight_label(bag_weight_grams)
    if not label:
        return feed_type
    return f"{feed_type} ({label})"


# Normalize feed type.

def _normalize_feed_type(feed_type: str | None) -> str:
    return str(feed_type or "").strip()


# Normalize bag weight key.

def _normalize_bag_weight_key(bag_weight_grams: int | None) -> int | None:
    if bag_weight_grams in (None, 0):
        return None
    try:
        parsed = int(bag_weight_grams)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


# Normalize rm name.

def _normalize_rm_name(rm_name: str | None) -> str:
    return str(rm_name or "").strip()


# Normalize batch run count.

def _normalize_batch_run_count(value: float | int | None) -> float:
    try:
        count = float(value or 0)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, count)


# Handle calculate rm consumption quantity.

def calculate_rm_consumption_quantity(
    per_batch_quantity: float | int | None,
    batch_run_count: float | int | None) -> float:
    try:
        quantity = float(per_batch_quantity or 0)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, quantity) * _normalize_batch_run_count(batch_run_count)


# Return actual utilized batch count for RM consumption calculations.
# Priority:
# 1) hmi_completed_count when present (>0) for completed batches
# 2) legacy fallback: if status is completed and completed_count is 0, use planned batch_size
# 3) otherwise 0

def resolve_effective_batch_run_count(
    *,
    batch_size: float | int | None,
    hmi_completed_count: float | int | None,
    hmi_status: str | None,
    rm_shortage_flag: bool | None = None) -> float:
    if bool(rm_shortage_flag):
        return 0.0

    status = str(hmi_status or "").strip().lower()
    if status != "completed":
        return 0.0

    planned_count = _normalize_batch_run_count(batch_size)
    completed_count = _normalize_batch_run_count(hmi_completed_count)
    if completed_count > 0:
        if planned_count > 0:
            return min(completed_count, planned_count)
        return completed_count

    # Legacy fallback for older completed rows that do not have completed_count populated.
    return planned_count


# Get rm available stock.

def get_rm_available_stock(
    db: Session,
    *,
    rm_name: str,
    date: datetime) -> float:
    normalized_rm_name = _normalize_rm_name(rm_name)
    if not normalized_rm_name:
        return 0.0

    day = _start_of_day(date)
    today = _start_of_day(datetime.utcnow())
    if day >= today:
        current_row = db.execute(
            select(RawMaterialStock).where(
                RawMaterialStock.rm_name == normalized_rm_name)
        ).scalars().one_or_none()
        if current_row is not None:
            return float(current_row.quantity or 0)

    row = (
        db.execute(
            select(RMStockLedger).where(
                RMStockLedger.rm_name == normalized_rm_name,
                RMStockLedger.date == day)
            .order_by(RMStockLedger.id.desc())
            .limit(1)
        )
        .scalars()
        .one_or_none()
    )

    if row:
        return (
            float(row.opening_stock or 0)
            + float(row.received or 0)
            - float(row.consumption or 0)
        )

    return _latest_rm_closing(db=db, rm_name=normalized_rm_name, day=day)


# Collect rm shortages.

def collect_rm_shortages(
    db: Session,
    *,
    date: datetime,
    materials: Sequence[Mapping[str, object]],
    batch_run_count: float | int | None) -> list[dict]:
    required_by_rm: dict[str, float] = {}

    for material in materials:
        rm_name = str(material.get("rm_name") or "").strip()
        if not rm_name:
            continue
        required_quantity = calculate_rm_consumption_quantity(
            per_batch_quantity=material.get("quantity"),
            batch_run_count=batch_run_count)
        if required_quantity <= 0:
            continue
        required_by_rm[rm_name] = required_by_rm.get(rm_name, 0.0) + float(required_quantity)

    shortages: list[dict] = []
    for rm_name in sorted(required_by_rm):
        required_quantity = required_by_rm[rm_name]
        available_quantity = get_rm_available_stock(
            db=db,
            rm_name=rm_name,
            date=date)
        if required_quantity <= available_quantity:
            continue
        shortages.append(
            {
                "rm_name": rm_name,
                "required_quantity": required_quantity,
                "available_quantity": available_quantity,
                "shortage_quantity": required_quantity - available_quantity,
            }
        )
    return shortages


# Handle calculate max supported batch count.

def calculate_max_supported_batch_count(
    db: Session,
    *,
    date: datetime,
    materials: Sequence[Mapping[str, object]],
    requested_batch_count: float | int | None) -> int:
    try:
        requested = max(0.0, float(requested_batch_count or 0))
    except (TypeError, ValueError):
        return 0

    if requested <= 0:
        return 0

    per_batch_by_rm: dict[str, float] = {}
    for material in materials:
        rm_name = str(material.get("rm_name") or "").strip()
        if not rm_name:
            continue
        try:
            qty = float(material.get("quantity") or 0)
        except (TypeError, ValueError):
            continue
        if qty <= 0:
            continue
        per_batch_by_rm[rm_name] = per_batch_by_rm.get(rm_name, 0.0) + qty

    if not per_batch_by_rm:
        return int(floor(requested))

    supported = requested
    for rm_name, per_batch_qty in per_batch_by_rm.items():
        available = get_rm_available_stock(
            db=db,
            rm_name=rm_name,
            date=date)
        if per_batch_qty <= 0:
            continue
        supported = min(supported, max(0.0, available / per_batch_qty))

    return max(0, int(floor(supported + 1e-9)))


# Format rm shortage message.

def format_rm_shortage_message(
    shortages: Sequence[Mapping[str, object]],
    *,
    heading: str = "Insufficient raw material stock") -> str:
    if not shortages:
        return heading

    lines = [f"{heading}:"]
    for item in shortages:
        rm_name = str(item.get("rm_name") or "").strip() or "Unknown RM"
        try:
            required_quantity = float(item.get("required_quantity") or 0)
        except (TypeError, ValueError):
            required_quantity = 0.0
        try:
            available_quantity = float(item.get("available_quantity") or 0)
        except (TypeError, ValueError):
            available_quantity = 0.0
        try:
            shortage_quantity = float(item.get("shortage_quantity") or 0)
        except (TypeError, ValueError):
            shortage_quantity = 0.0

        lines.append(
            (
                f"- {rm_name} "
                f"(required: {required_quantity:.3f} kg, "
                f"available: {available_quantity:.3f} kg, "
                f"shortage: {shortage_quantity:.3f} kg)"
            )
        )
    return "\n".join(lines)


# Handle latest rm closing.

def _latest_rm_closing(
    db: Session,
    rm_name: str,
    day: datetime) -> float:
    latest = db.execute(
        select(RMStockLedger)
        .where(
            RMStockLedger.rm_name == _normalize_rm_name(rm_name),
            RMStockLedger.date < day)
        .order_by(RMStockLedger.date.desc(), RMStockLedger.id.desc())
        .limit(1)
    ).scalars().one_or_none()
    return float(latest.closing_stock if latest else 0)


# Handle latest rm closing any.

def _latest_rm_closing_any(
    db: Session,
    rm_name: str) -> float:
    latest = db.execute(
        select(RMStockLedger)
        .where(
            RMStockLedger.rm_name == rm_name)
        .order_by(RMStockLedger.date.desc(), RMStockLedger.id.desc())
        .limit(1)
    ).scalars().one_or_none()
    return float(latest.closing_stock if latest else 0)


# Handle latest feed closing.

def _latest_feed_closing(
    db: Session,
    feed_type: str,
    day: datetime,
    bag_weight_grams: int | None = None) -> float:
    normalized_feed_type = _normalize_feed_type(feed_type)
    if not normalized_feed_type:
        return 0.0
    query = select(FeedStock).where(
        FeedStock.feed_type == normalized_feed_type,
        FeedStock.date < day)
    if bag_weight_grams is None:
        query = query.where(FeedStock.bag_weight_grams.is_(None))
    else:
        query = query.where(FeedStock.bag_weight_grams == bag_weight_grams)
    latest = (
        db.execute(query.order_by(FeedStock.date.desc(), FeedStock.id.desc()).limit(1))
        .scalars()
        .one_or_none()
    )
    return float(latest.closing_stock if latest else 0)


# Handle latest feed closing any.

def _latest_feed_closing_any(
    db: Session,
    feed_type: str,
    bag_weight_grams: int | None) -> float:
    normalized_feed_type = _normalize_feed_type(feed_type)
    if not normalized_feed_type:
        return 0.0

    query = select(FeedStock).where(
        FeedStock.feed_type == normalized_feed_type)
    normalized_bag_weight = _normalize_bag_weight_key(bag_weight_grams)
    if normalized_bag_weight is None:
        query = query.where(FeedStock.bag_weight_grams.is_(None))
    else:
        query = query.where(FeedStock.bag_weight_grams == normalized_bag_weight)

    latest = (
        db.execute(query.order_by(FeedStock.date.desc(), FeedStock.id.desc()).limit(1))
        .scalars()
        .one_or_none()
    )
    return float(latest.closing_stock if latest else 0)


# Get or create rm row.

def _get_or_create_rm_row(
    db: Session,
    rm_name: str,
    date: datetime) -> RMStockLedger:
    day = _start_of_day(date)
    row = (
        db.execute(
            select(RMStockLedger).where(
                RMStockLedger.rm_name == rm_name,
                RMStockLedger.date == day)
            .order_by(RMStockLedger.id.desc())
            .limit(1)
        )
        .scalars()
        .one_or_none()
    )
    if row:
        return row

    opening = _latest_rm_closing(db=db, rm_name=rm_name, day=day)
    row = RMStockLedger(
        date=day,
        rm_name=rm_name,
        opening_stock=opening,
        received=0,
        consumption=0,
        closing_stock=opening)
    db.add(row)
    db.flush()
    return row


# Get or create rm stock row.

def _get_or_create_rm_stock_row(
    db: Session,
    rm_name: str) -> RawMaterialStock:
    normalized_rm_name = _normalize_rm_name(rm_name)
    if not normalized_rm_name:
        raise ValueError("rm_name is required")

    row = db.execute(
        select(RawMaterialStock).where(
            RawMaterialStock.rm_name == normalized_rm_name)
    ).scalars().one_or_none()
    if row:
        return row

    opening = _latest_rm_closing_any(
        db=db,
        rm_name=normalized_rm_name)
    row = RawMaterialStock(
        rm_name=normalized_rm_name,
        quantity=opening,
        last_modified_at=datetime.utcnow())
    db.add(row)
    db.flush()
    return row


# Get or create feed row.

def _get_or_create_feed_row(
    db: Session,
    feed_type: str,
    date: datetime,
    bag_weight_grams: int | None = None) -> FeedStock:
    normalized_feed_type = _normalize_feed_type(feed_type)
    if not normalized_feed_type:
        raise ValueError("feed_type is required")

    day = _start_of_day(date)
    query = select(FeedStock).where(
        FeedStock.feed_type == normalized_feed_type,
        FeedStock.date == day)
    if bag_weight_grams is None:
        query = query.where(FeedStock.bag_weight_grams.is_(None))
    else:
        query = query.where(FeedStock.bag_weight_grams == bag_weight_grams)

    row = db.execute(query.order_by(FeedStock.id.desc()).limit(1)).scalars().one_or_none()
    if row:
        return row

    opening = _latest_feed_closing(
        db=db,
        feed_type=normalized_feed_type,
        day=day,
        bag_weight_grams=bag_weight_grams)
    row = FeedStock(
        date=day,
        feed_type=normalized_feed_type,
        bag_weight_grams=bag_weight_grams,
        opening_stock=opening,
        produced=0,
        dispatched=0,
        closing_stock=opening)
    db.add(row)
    db.flush()
    return row


# Get or create feed current row.

def _get_or_create_feed_current_row(
    db: Session,
    feed_type: str,
    bag_weight_grams: int | None = None) -> FeedStockCurrent:
    normalized_feed_type = _normalize_feed_type(feed_type)
    if not normalized_feed_type:
        raise ValueError("feed_type is required")

    normalized_bag_weight = _normalize_bag_weight_key(bag_weight_grams)
    query = select(FeedStockCurrent).where(
        FeedStockCurrent.feed_type == normalized_feed_type)
    if normalized_bag_weight is None:
        query = query.where(FeedStockCurrent.bag_weight_grams.is_(None))
    else:
        query = query.where(FeedStockCurrent.bag_weight_grams == normalized_bag_weight)

    row = (
        db.execute(query.order_by(FeedStockCurrent.id.desc()).limit(1))
        .scalars()
        .one_or_none()
    )
    if row:
        return row

    opening = _latest_feed_closing_any(
        db=db,
        feed_type=normalized_feed_type,
        bag_weight_grams=normalized_bag_weight)
    row = FeedStockCurrent(
        feed_type=normalized_feed_type,
        bag_weight_grams=normalized_bag_weight,
        quantity=opening,
        last_modified_at=datetime.utcnow())
    db.add(row)
    db.flush()
    return row


# Add rm received.

def add_rm_received(
    db: Session,
    rm_name: str,
    quantity: float,
    date: datetime,
    update_snapshot: bool = True) -> None:
    normalized_rm_name = _normalize_rm_name(rm_name)
    if not normalized_rm_name:
        raise ValueError("rm_name is required")

    row = _get_or_create_rm_row(
        db=db,
        rm_name=normalized_rm_name,
        date=date)
    row.received = float(row.received or 0) + float(quantity)
    row.closing_stock = (
        float(row.opening_stock or 0)
        + float(row.received or 0)
        - float(row.consumption or 0)
    )

    if update_snapshot:
        current_row = _get_or_create_rm_stock_row(
            db=db,
            rm_name=normalized_rm_name)
        current_row.quantity = float(row.closing_stock or 0)
        current_row.last_modified_at = datetime.utcnow()


# Add rm consumption.

def add_rm_consumption(
    db: Session,
    rm_name: str,
    quantity: float,
    date: datetime,
    update_snapshot: bool = True) -> None:
    qty = float(quantity)
    if qty <= 0:
        raise ValueError(f"Consumption quantity for {rm_name} must be greater than 0")

    normalized_rm_name = _normalize_rm_name(rm_name)
    if not normalized_rm_name:
        raise ValueError("rm_name is required")

    row = _get_or_create_rm_row(
        db=db,
        rm_name=normalized_rm_name,
        date=date)
    current_row = None
    available = None
    if update_snapshot:
        current_row = _get_or_create_rm_stock_row(
            db=db,
            rm_name=normalized_rm_name)
        available = float(current_row.quantity or 0)
        if qty > available:
            raise ValueError(
                f"Insufficient raw material stock for {normalized_rm_name}. Available: {available}"
            )

    row.consumption = float(row.consumption or 0) + qty
    row.closing_stock = (
        float(row.opening_stock or 0)
        + float(row.received or 0)
        - float(row.consumption or 0)
    )

    if update_snapshot and current_row is not None:
        current_row.quantity = float(row.closing_stock or 0)
        current_row.last_modified_at = datetime.utcnow()


# Add feed produced.

def add_feed_produced(
    db: Session,
    feed_type: str,
    quantity: float,
    date: datetime,
    weight_per_bag: float | int | None = None) -> None:
    normalized_feed_type = _normalize_feed_type(feed_type)
    if not normalized_feed_type:
        raise ValueError("feed_type is required")
    bag_weight_grams = _normalize_bag_weight_grams(weight_per_bag)
    row = _get_or_create_feed_row(
        db=db,
        feed_type=normalized_feed_type,
        date=date,
        bag_weight_grams=bag_weight_grams)
    row.produced = float(row.produced or 0) + float(quantity)
    row.closing_stock = (
        float(row.opening_stock or 0)
        + float(row.produced or 0)
        - float(row.dispatched or 0)
    )

    current_row = _get_or_create_feed_current_row(
        db=db,
        feed_type=normalized_feed_type,
        bag_weight_grams=bag_weight_grams)
    current_row.quantity = float(row.closing_stock or 0)
    current_row.last_modified_at = datetime.utcnow()


# Add feed dispatched.

def add_feed_dispatched(
    db: Session,
    feed_type: str,
    quantity: float,
    date: datetime,
    weight_per_bag: float | int | None = None) -> None:
    qty = float(quantity)
    normalized_feed_type = _normalize_feed_type(feed_type)
    if not normalized_feed_type:
        raise ValueError("feed_type is required")
    bag_weight_grams = _normalize_bag_weight_grams(weight_per_bag)
    variant_label = _feed_variant_label(normalized_feed_type, bag_weight_grams)
    if qty <= 0:
        raise ValueError(f"Dispatch quantity for {variant_label} must be greater than 0")

    row = _get_or_create_feed_row(
        db=db,
        feed_type=normalized_feed_type,
        date=date,
        bag_weight_grams=bag_weight_grams)
    current_row = _get_or_create_feed_current_row(
        db=db,
        feed_type=normalized_feed_type,
        bag_weight_grams=bag_weight_grams)
    available = float(current_row.quantity or 0)
    if qty > available:
        raise ValueError(
            f"Insufficient stock for {variant_label}. Available: {available}"
        )

    row.dispatched = float(row.dispatched or 0) + qty
    row.closing_stock = (
        float(row.opening_stock or 0)
        + float(row.produced or 0)
        - float(row.dispatched or 0)
    )

    current_row.quantity = float(row.closing_stock or 0)
    current_row.last_modified_at = datetime.utcnow()


# Rebuild rm stock ledger.

def rebuild_rm_stock_ledger(db: Session) -> None:
    # Rebuild complete RM ledger from RM inward entries + production consumption.
    existing_rows = (
        db.execute(select(RMStockLedger).order_by(RMStockLedger.id.asc()))
        .scalars()
        .all()
    )
    existing_by_key: dict[tuple[datetime, str], RMStockLedger] = {}
    duplicate_rows: list[RMStockLedger] = []
    for row in existing_rows:
        rm_name = _normalize_rm_name(row.rm_name)
        if not rm_name:
            duplicate_rows.append(row)
            continue
        day = _start_of_day(row.date)
        key = (day, rm_name)
        if key in existing_by_key:
            duplicate_rows.append(row)
            continue
        row.date = day
        row.rm_name = rm_name
        existing_by_key[key] = row

    rm_entries = (
        db.execute(
            select(
                RawMaterialEntry.date,
                RawMaterialEntry.rm_type,
                RawMaterialEntry.total_weight)
            
            .order_by(RawMaterialEntry.date.asc(), RawMaterialEntry.id.asc())
        )
        .all()
    )
    received_by_key: dict[tuple[datetime, str], float] = defaultdict(float)
    for date, rm_type, total_weight in rm_entries:
        rm_name = _normalize_rm_name(rm_type)
        if not rm_name:
            continue
        key = (_start_of_day(date), rm_name)
        received_by_key[key] += float(total_weight or 0)

    consumption_rows = (
        db.execute(
            select(
                ProductionBatch.date,
                ProductionBatchMaterial.rm_name,
                ProductionBatchMaterial.quantity,
                ProductionBatch.batch_size,
                ProductionBatch.hmi_completed_count,
                ProductionBatch.hmi_status,
                ProductionBatch.rm_shortage_flag,
                ProductionBatch.rm_reduced)
            .join(ProductionBatch, ProductionBatch.id == ProductionBatchMaterial.batch_id)
            .where(ProductionBatch.rm_reduced.is_(True))
            .order_by(
                ProductionBatch.date.asc(),
                ProductionBatch.id.asc(),
                ProductionBatchMaterial.id.asc())
        )
        .all()
    )
    consumption_by_key: dict[tuple[datetime, str], float] = defaultdict(float)
    for (
        date,
        rm_name,
        quantity,
        batch_size,
        hmi_completed_count,
        hmi_status,
        rm_shortage_flag,
        rm_reduced) in consumption_rows:
        if not bool(rm_reduced):
            continue
        effective_count = resolve_effective_batch_run_count(
            batch_size=batch_size,
            hmi_completed_count=hmi_completed_count,
            hmi_status=hmi_status,
            rm_shortage_flag=rm_shortage_flag)
        consumption_quantity = calculate_rm_consumption_quantity(
            per_batch_quantity=quantity,
            batch_run_count=effective_count)
        if consumption_quantity <= 0:
            continue
        normalized_rm_name = _normalize_rm_name(rm_name)
        if not normalized_rm_name:
            continue
        key = (_start_of_day(date), normalized_rm_name)
        consumption_by_key[key] += float(consumption_quantity)

    all_keys = sorted(
        set(received_by_key.keys()) | set(consumption_by_key.keys()),
        key=lambda item: (item[0], item[1]),
    )

    final_by_key: dict[tuple[datetime, str], tuple[float, float, float, float]] = {}
    latest_closing_by_name: dict[str, float] = {}
    for day, rm_name in all_keys:
        opening = float(latest_closing_by_name.get(rm_name, 0.0))
        received = float(received_by_key.get((day, rm_name), 0.0))
        consumption = float(consumption_by_key.get((day, rm_name), 0.0))
        closing = opening + received - consumption
        final_by_key[(day, rm_name)] = (opening, received, consumption, closing)
        latest_closing_by_name[rm_name] = closing

    for key, (opening, received, consumption, closing) in final_by_key.items():
        row = existing_by_key.pop(key, None)
        if row is None:
            db.add(
                RMStockLedger(
                    date=key[0],
                    rm_name=key[1],
                    opening_stock=opening,
                    received=received,
                    consumption=consumption,
                    closing_stock=closing,
                )
            )
            continue
        row.opening_stock = opening
        row.received = received
        row.consumption = consumption
        row.closing_stock = closing

    for row in existing_by_key.values():
        db.delete(row)
    for row in duplicate_rows:
        db.delete(row)
    db.flush()

    # Rebuild the snapshot from the final ledger state so the current table
    # always matches the authoritative closing balances exactly.
    rebuild_rm_stock_snapshot(db=db)


# Synchronize current RM stock rows with the latest ledger balances.

def rebuild_rm_stock_snapshot(db: Session) -> None:
    latest_rows = (
        db.execute(
            select(RMStockLedger)
            
            .order_by(
                RMStockLedger.rm_name.asc(),
                RMStockLedger.date.desc(),
                RMStockLedger.id.desc())
        )
        .scalars()
        .all()
    )

    latest_by_name: dict[str, float] = {}
    for row in latest_rows:
        rm_name = _normalize_rm_name(row.rm_name)
        if not rm_name or rm_name in latest_by_name:
            continue
        latest_by_name[rm_name] = float(row.closing_stock or 0)

    existing_rows = (
        db.execute(select(RawMaterialStock))
        .scalars()
        .all()
    )
    existing_by_name: dict[str, RawMaterialStock] = {}
    for row in existing_rows:
        rm_name = _normalize_rm_name(row.rm_name)
        if not rm_name or rm_name in existing_by_name:
            continue
        existing_by_name[rm_name] = row

    now = datetime.utcnow()
    for rm_name, quantity in latest_by_name.items():
        row = existing_by_name.get(rm_name)
        if row is None:
            db.add(
                RawMaterialStock(
                    rm_name=rm_name,
                    quantity=quantity,
                    created_at=now,
                    last_modified_at=now)
            )
            continue
        row.quantity = quantity
        row.last_modified_at = now

    for rm_name, row in existing_by_name.items():
        if rm_name in latest_by_name:
            continue
        row.quantity = 0
        row.last_modified_at = now

    db.flush()


# Rebuild feed stock ledger.

def rebuild_feed_stock_ledger(db: Session) -> None:
    # Rebuild complete feed ledger from production output + dispatch entries.
    existing_rows = (
        db.execute(select(FeedStock).order_by(FeedStock.id.asc()))
        .scalars()
        .all()
    )
    existing_by_key: dict[tuple[datetime, str, int | None], FeedStock] = {}
    duplicate_rows: list[FeedStock] = []
    for row in existing_rows:
        feed_type = _normalize_feed_type(row.feed_type)
        if not feed_type:
            duplicate_rows.append(row)
            continue
        day = _start_of_day(row.date)
        bag_weight_grams = _normalize_bag_weight_key(row.bag_weight_grams)
        key = (day, feed_type, bag_weight_grams)
        if key in existing_by_key:
            duplicate_rows.append(row)
            continue
        row.date = day
        row.feed_type = feed_type
        row.bag_weight_grams = bag_weight_grams
        existing_by_key[key] = row

    current_rows = (
        db.execute(select(FeedStockCurrent))
        .scalars()
        .all()
    )
    for row in current_rows:
        row.quantity = 0
        row.last_modified_at = datetime.utcnow()
    db.flush()

    produced_rows = (
        db.execute(
            select(
                ProductionBatch.date,
                ProductionBatch.product_name,
                ProductionBatch.weight_per_bag,
                ProductionBatch.output)
            .where(
                ProductionBatch.stock_posted.is_(True))
            .order_by(ProductionBatch.date.asc(), ProductionBatch.id.asc())
        )
        .all()
    )
    produced_by_key: dict[tuple[datetime, str, int | None], float] = defaultdict(float)
    for date, product_name, weight_per_bag, output in produced_rows:
        feed_type = _normalize_feed_type(product_name)
        if not feed_type:
            continue
        bag_weight_grams = _normalize_bag_weight_grams(weight_per_bag)
        key = (_start_of_day(date), feed_type, bag_weight_grams)
        produced_by_key[key] += float(output or 0)

    dispatch_rows = (
        db.execute(
            select(
                DispatchEntry.date,
                DispatchProduct.product_type,
                DispatchProduct.weight_per_bag,
                DispatchProduct.total_weight)
            .join(DispatchProduct, DispatchProduct.dispatch_code == DispatchEntry.dispatch_code)
            
            .order_by(DispatchEntry.date.asc(), DispatchEntry.id.asc())
        )
        .all()
    )
    dispatched_by_key: dict[tuple[datetime, str, int | None], float] = defaultdict(float)
    for date, product_type, weight_per_bag, total_weight in dispatch_rows:
        # Dispatch entries are stored in UTC-naive form after API parsing.
        # Shift to IST wall clock before daily ledger bucketing.
        feed_type = _normalize_feed_type(product_type)
        if not feed_type:
            continue
        bag_weight_grams = _normalize_bag_weight_grams(weight_per_bag)
        ledger_date = _start_of_day(date + IST_OFFSET)
        key = (ledger_date, feed_type, bag_weight_grams)
        dispatched_by_key[key] += float(total_weight or 0)

    all_keys = sorted(
        set(produced_by_key.keys()) | set(dispatched_by_key.keys()),
        key=lambda item: (item[0], item[1], -1 if item[2] is None else item[2]),
    )

    final_by_key: dict[
        tuple[datetime, str, int | None],
        tuple[float, float, float, float],
    ] = {}
    latest_closing_by_variant: dict[tuple[str, int | None], float] = {}
    for day, feed_type, bag_weight_grams in all_keys:
        variant_key = (feed_type, bag_weight_grams)
        opening = float(latest_closing_by_variant.get(variant_key, 0.0))
        produced = float(produced_by_key.get((day, feed_type, bag_weight_grams), 0.0))
        dispatched = float(dispatched_by_key.get((day, feed_type, bag_weight_grams), 0.0))
        closing = opening + produced - dispatched
        final_by_key[(day, feed_type, bag_weight_grams)] = (
            opening,
            produced,
            dispatched,
            closing,
        )
        latest_closing_by_variant[variant_key] = closing

    for key, (opening, produced, dispatched, closing) in final_by_key.items():
        row = existing_by_key.pop(key, None)
        if row is None:
            db.add(
                FeedStock(
                    date=key[0],
                    feed_type=key[1],
                    bag_weight_grams=key[2],
                    opening_stock=opening,
                    produced=produced,
                    dispatched=dispatched,
                    closing_stock=closing,
                )
            )
            continue
        row.opening_stock = opening
        row.produced = produced
        row.dispatched = dispatched
        row.closing_stock = closing

    for row in existing_by_key.values():
        db.delete(row)
    for row in duplicate_rows:
        db.delete(row)
    db.flush()

    rebuild_feed_stock_snapshot(db=db)


# Rebuild current feed stock rows from the latest feed ledger balances.

def rebuild_feed_stock_snapshot(db: Session) -> None:
    existing_rows = (
        db.execute(select(FeedStockCurrent))
        .scalars()
        .all()
    )
    latest_rows = (
        db.execute(
            select(FeedStock)
            
            .order_by(
                FeedStock.feed_type.asc(),
                FeedStock.bag_weight_grams.asc(),
                FeedStock.date.desc(),
                FeedStock.id.desc())
        )
        .scalars()
        .all()
    )

    existing_by_key: dict[tuple[str, int | None], FeedStockCurrent] = {}
    for row in existing_rows:
        feed_type = _normalize_feed_type(row.feed_type)
        bag_weight_grams = _normalize_bag_weight_key(row.bag_weight_grams)
        if not feed_type:
            continue
        existing_by_key[(feed_type, bag_weight_grams)] = row

    latest_by_key: dict[tuple[str, int | None], float] = {}
    now = datetime.utcnow()
    for row in latest_rows:
        feed_type = _normalize_feed_type(row.feed_type)
        bag_weight_grams = _normalize_bag_weight_key(row.bag_weight_grams)
        if not feed_type:
            continue
        key = (feed_type, bag_weight_grams)
        if key in latest_by_key:
            continue
        latest_by_key[key] = float(row.closing_stock or 0)

    for key, quantity in latest_by_key.items():
        row = existing_by_key.get(key)
        if row is None:
            db.add(
                FeedStockCurrent(
                    feed_type=key[0],
                    bag_weight_grams=key[1],
                    quantity=quantity,
                    created_at=now,
                    last_modified_at=now)
            )
            continue
        row.quantity = quantity
        row.last_modified_at = now

    for key, row in existing_by_key.items():
        if key in latest_by_key:
            continue
        row.quantity = 0
        row.last_modified_at = now

    db.flush()

