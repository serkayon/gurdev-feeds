# Runtime helpers for production batches and stock posting.


from __future__ import annotations

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.plc import MachineState
from app.models.production import ProductionBatch, ProductionBatchMaterial
from app.utils.timezone import app_now
from .stock import (
    add_feed_produced,
    collect_rm_shortages,
    format_rm_shortage_message,
    rebuild_rm_stock_ledger)


RUN_STATUS_PENDING = "pending"
RUN_STATUS_RUNNING = "running"
RUN_STATUS_STOPPED = "stopped"
RUN_STATUS_COMPLETED = "completed"


# Convert batch count input into a non-negative integer.

def normalize_batch_count(value: float | int | None) -> int:
    try:
        count = int(float(value or 0))
    except (TypeError, ValueError):
        return 0
    return max(0, count)


# Return the configured batch duration in seconds.

def _duration_seconds(batch: ProductionBatch) -> float:
    try:
        seconds = float(batch.hmi_duration_seconds or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, seconds)


# Check whether the batch has enough data to post feed stock.

def _is_batch_ready_for_stock(batch: ProductionBatch) -> bool:
    if bool(batch.stock_posted):
        return False
    if (batch.hmi_status or "").lower() != RUN_STATUS_COMPLETED:
        return False

    product_name = (batch.product_name or "").strip()
    if not product_name:
        return False

    try:
        num_bags = float(batch.num_bags or 0)
        weight_per_bag = float(batch.weight_per_bag or 0)
        output = float(batch.output or 0)
    except (TypeError, ValueError):
        return False

    return num_bags > 0 and weight_per_bag > 0 and output > 0


# Post feed stock once the batch is complete and all required details are available.

def try_post_batch_stock(db: Session, *, batch: ProductionBatch) -> bool:
    if not _is_batch_ready_for_stock(batch):
        return False

    add_feed_produced(
        db=db,
        feed_type=(batch.product_name or "").strip(),
        quantity=float(batch.output),
        date=batch.date,
        weight_per_bag=batch.weight_per_bag)
    batch.stock_posted = True
    batch.last_modified_at = app_now()
    # Session is configured with autoflush=False; force persistence so
    # subsequent ledger rebuild queries see stock_posted=True immediately.
    db.flush()
    return True


# Load batch material rows into a lightweight payload.

def _batch_material_payload(db: Session, *, batch_id: int) -> list[dict]:
    rows = (
        db.execute(
            select(ProductionBatchMaterial)
            .where(ProductionBatchMaterial.batch_id == batch_id)
            .order_by(ProductionBatchMaterial.id.asc())
        )
        .scalars()
        .all()
    )
    return [{"rm_name": row.rm_name, "quantity": row.quantity} for row in rows]


# Check whether the batch can complete without raw material shortages.

def evaluate_mark_complete_eligibility(
    db: Session,
    *,
    batch: ProductionBatch) -> tuple[bool, str | None]:
    assigned_count = normalize_batch_count(batch.batch_size)
    if assigned_count <= 0:
        return False, "Assigned batch count is invalid for this batch."

    materials = _batch_material_payload(db, batch_id=batch.id)
    shortages = collect_rm_shortages(
        db=db,
        date=batch.date,
        materials=materials,
        batch_run_count=assigned_count)
    if not shortages:
        return True, None

    detail = format_rm_shortage_message(
        shortages,
        heading=(
            "Cannot mark batch as complete until raw material stock is available "
            f"for assigned count ({assigned_count})"
        ))
    return False, detail


# Finalize the batch count and refresh shortage state.

def finalize_batch_consumption_state(
    db: Session,
    *,
    batch: ProductionBatch) -> str | None:
    planned_count = normalize_batch_count(batch.batch_size)
    target_count = max(0, int(batch.hmi_completed_count or 0))
    if planned_count > 0:
        target_count = min(target_count, planned_count)
    batch.hmi_completed_count = target_count

    materials = _batch_material_payload(db, batch_id=batch.id)
    shortages = collect_rm_shortages(
        db=db,
        date=batch.date,
        materials=materials,
        batch_run_count=target_count)
    if not shortages:
        batch.rm_shortage_flag = False
        batch.rm_shortage_detail = None
        return None

    batch.hmi_status = RUN_STATUS_STOPPED
    detail = (
        f"Assigned count: {planned_count}, utilized count: {target_count}.\n"
        + format_rm_shortage_message(
            shortages,
            heading="Raw material shortage detected for this batch")
    )
    batch.rm_shortage_flag = True
    batch.rm_shortage_detail = detail
    return detail


# Finalize runtime state and rebuild raw material balances when needed.

def finalize_batch_runtime_state(
    db: Session,
    *,
    batch: ProductionBatch) -> str | None:
    warning_detail = finalize_batch_consumption_state(
        db=db,
        batch=batch)
    batch.rm_reduced = warning_detail is None
    # Session is configured with autoflush=False; flush runtime flags before
    # rebuilding ledgers that query ProductionBatch rows.
    db.flush()
    try:
        rebuild_rm_stock_ledger(db=db)
    except ValueError as exc:
        batch.hmi_status = RUN_STATUS_STOPPED
        batch.rm_reduced = False
        batch.rm_shortage_flag = True
        if warning_detail:
            batch.rm_shortage_detail = f"{warning_detail}\n{exc}"
        else:
            batch.rm_shortage_detail = str(exc)
        return batch.rm_shortage_detail
    return warning_detail


# Advance the active batch counter and stop it when the run is finished.

def sync_active_batch_progress(
    db: Session,
    *,
    machine_state: MachineState) -> ProductionBatch | None:
    if not machine_state.is_running or not machine_state.active_batch_id:
        return None

    batch = db.get(ProductionBatch, machine_state.active_batch_id)
    if not batch:
        machine_state.active_batch_id = None
        machine_state.updated_at = app_now()
        return None

    total_count = normalize_batch_count(batch.batch_size)
    duration = _duration_seconds(batch)

    # Real PLC/N720 mode: when duration is not configured (<= 0),
    # do not auto-increment or auto-stop the batch here.
    # The external machine feed owns hmi_completed_count and stop transitions.
    if duration <= 0:
        batch.hmi_status = RUN_STATUS_RUNNING
        if batch.hmi_started_at is None:
            batch.hmi_started_at = app_now()
        batch.last_modified_at = app_now()
        return batch

    if total_count <= 0:
        batch.hmi_status = RUN_STATUS_RUNNING
        if batch.hmi_started_at is None:
            batch.hmi_started_at = app_now()
        batch.last_modified_at = app_now()
        return batch

    if batch.hmi_started_at is None:
        completed = max(0, int(batch.hmi_completed_count or 0))
        if duration > 0 and completed > 0:
            batch.hmi_started_at = app_now() - timedelta(
                seconds=(completed - 1) * duration
            )
        else:
            batch.hmi_started_at = app_now()

    now = app_now()
    elapsed_seconds = max(0.0, (now - batch.hmi_started_at).total_seconds())

    if duration > 0:
        display_count = min(total_count, max(1, int(elapsed_seconds // duration) + 1))
    else:
        display_count = total_count

    batch.hmi_completed_count = display_count
    batch.hmi_status = RUN_STATUS_RUNNING
    batch.last_modified_at = now

    is_finished = elapsed_seconds >= (total_count * duration)
    if is_finished:
        batch.hmi_completed_count = total_count
        batch.hmi_status = RUN_STATUS_STOPPED
        batch.hmi_completed_at = now
        machine_state.active_batch_id = None
        machine_state.updated_at = now

    return batch

