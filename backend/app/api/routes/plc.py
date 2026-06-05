# PLC monitoring and machine control routes.

from datetime import timedelta

from ..fastapi_compat import Blueprint, jsonify, request
from sqlalchemy import case, func, select

from ..common import db_session, dt, error, serialize_batch
from app.config import get_settings
from app.models.plc import PLCDataSnapshot
from app.models.production import ProductionBatch, ProductionBatchMaterial, ProductionReport
from ...services.plc_state import (
    get_or_create_machine_state,
    set_machine_running)
from ...services.production_runtime import (
    RUN_STATUS_COMPLETED,
    RUN_STATUS_RUNNING,
    RUN_STATUS_STOPPED,
    normalize_batch_count,
    sync_active_batch_progress)
from ...services.stock import collect_rm_shortages, format_rm_shortage_message
from ...utils.timezone import app_now

plc_bp = Blueprint("plc", __name__, url_prefix="/api/plc")
settings = get_settings()

# Serialize the latest PLC snapshot into API payload form.

def _serialize_plc_row(row: PLCDataSnapshot | None, running_status: bool) -> dict:
    resolved_status = int(row.process_status) if row and row.process_status is not None else (100 if running_status else 0)
    return {
        "id": row.id if row else None,
        "running_status": running_status,
        "status": resolved_status,
        "process_status": resolved_status,
        "process_product": row.process_product if row else None,
        "ambient_temp": row.ambient_temp if row else None,
        "humidity": row.humidity if row else None,
        "pressure_before": row.pressure_before if row else None,
        "pressure_after": row.pressure_after if row else None,
        "conditioner_temp": row.conditioner_temp if row else None,
        "bagging_temp": row.bagging_temp if row else None,
        "motor_temp": row.motor_temp if row else None,
        "motor_rpm": row.motor_rpm if row else None,
        "pellet_feeder_speed": row.pellet_feeder_speed if row else None,
        "pellet_motor_load": row.pellet_motor_load if row else None,
        "recorded_at": dt(row.recorded_at) if row else None,
    }

# Return the PLC status value with a running-state fallback.

def _resolved_status(row: PLCDataSnapshot) -> int:
    if row.process_status is not None:
        return int(row.process_status)
    return 100 if bool(row.running_status) else 0

# Serialize a historical PLC snapshot row.

def _serialize_plc_history_row(row: PLCDataSnapshot) -> dict:
    resolved_status = _resolved_status(row)
    return {
        "recorded_at": dt(row.recorded_at),
        "status": resolved_status,
        "process_status": resolved_status,
        "process_product": row.process_product,
        "ambient_temp": row.ambient_temp,
        "humidity": row.humidity,
        "pressure_before": row.pressure_before,
        "pressure_after": row.pressure_after,
        "conditioner_temp": row.conditioner_temp,
        "bagging_temp": row.bagging_temp,
        "pellet_feeder_speed": row.pellet_feeder_speed,
        "pellet_motor_load": row.pellet_motor_load,
    }

# Parse a query-string boolean flag.

def _as_bool_arg(raw_value) -> bool:
    return str(raw_value or "").strip().lower() in {"1", "true", "yes", "on"}

# Build the SQL expression used to filter running PLC rows.

def _process_status_expr():
    return func.coalesce(
        PLCDataSnapshot.process_status,
        case((PLCDataSnapshot.running_status.is_(True), 100), else_=0))

# Return the payload for the currently active batch, if any.

def _active_batch_payload(db, machine_state) -> dict | None:
    if not machine_state.active_batch_id:
        return None

    batch = (
        db.execute(
            select(ProductionBatch).where(
                ProductionBatch.id == machine_state.active_batch_id)
        )
        .scalars()
        .one_or_none()
    )
    if not batch:
        return None

    has_report = (
        db.execute(select(ProductionReport.id).where(ProductionReport.batch_id == batch.id))
        .scalars()
        .one_or_none()
        is not None
    )
    payload = serialize_batch(
        batch,
        has_report=has_report,
        is_active=bool(machine_state.is_running and machine_state.active_batch_id == batch.id))
    payload["materials"] = [
        {
            "id": row.id,
            "rm_name": row.rm_name,
            "quantity": row.quantity,
            "total_quantity": row.total_quantity,
        }
        for row in db.execute(
            select(ProductionBatchMaterial)
            .where(ProductionBatchMaterial.batch_id == batch.id)
            .order_by(ProductionBatchMaterial.id.asc())
        )
        .scalars()
        .all()
    ]
    return payload

# Serialize the overall machine status response.

def _machine_status_payload(machine_state, latest_row: PLCDataSnapshot | None, active_batch: dict | None) -> dict:
    resolved_status = (
        int(latest_row.process_status)
        if latest_row and latest_row.process_status is not None
        else (100 if machine_state.is_running else 0)
    )
    return {
        "is_running": bool(machine_state.is_running),
        "status": resolved_status,
        "process_status": resolved_status,
        "process_product": latest_row.process_product if latest_row else None,
        "active_batch_id": machine_state.active_batch_id,
        "active_batch": active_batch,
        "idle_timeout_minutes": settings.n720_idle_timeout_minutes,
        "updated_at": dt(machine_state.updated_at),
        "last_snapshot_at": dt(latest_row.recorded_at) if latest_row else None,
    }

# Return the latest PLC snapshot.

@plc_bp.get("/latest")
def plc_latest():
    with db_session() as db:
        machine_state = get_or_create_machine_state(db)
        sync_active_batch_progress(db, machine_state=machine_state)
        row = db.execute(
            select(PLCDataSnapshot).order_by(PLCDataSnapshot.recorded_at.desc()).limit(1)
        ).scalars().first()
        return jsonify(_serialize_plc_row(row=row, running_status=bool(machine_state.is_running)))

# Return PLC history for a duration or the current running window.

@plc_bp.get("/history")
def plc_history():
    try:
        minutes = int(request.args.get("minutes", 60))
    except ValueError:
        return error("minutes must be an integer")
    if minutes <= 0:
        return error("minutes must be greater than 0")
    current_process_only = _as_bool_arg(request.args.get("current_process_only"))

    with db_session() as db:
        machine_state = get_or_create_machine_state(db)
        sync_active_batch_progress(db, machine_state=machine_state)
        if current_process_only:
            latest_row = (
                db.execute(
                    select(PLCDataSnapshot).order_by(PLCDataSnapshot.recorded_at.desc()).limit(1)
                )
                .scalars()
                .one_or_none()
            )
            if latest_row is None or _resolved_status(latest_row) != 100:
                return jsonify([])

            run_end = latest_row.recorded_at
            run_window_start = run_end - timedelta(minutes=minutes)
            status_expr = _process_status_expr()

            latest_non_running = (
                db.execute(
                    select(PLCDataSnapshot.recorded_at)
                    .where(
                        PLCDataSnapshot.recorded_at < run_end,
                        status_expr != 100)
                    .order_by(PLCDataSnapshot.recorded_at.desc())
                    .limit(1)
                )
                .first()
            )
            latest_non_running_at = latest_non_running[0] if latest_non_running else None

            query = (
                select(PLCDataSnapshot)
                .where(
                    PLCDataSnapshot.recorded_at >= run_window_start,
                    PLCDataSnapshot.recorded_at <= run_end,
                    status_expr == 100)
                .order_by(PLCDataSnapshot.recorded_at.asc())
            )
            if latest_non_running_at is not None:
                query = query.where(PLCDataSnapshot.recorded_at > latest_non_running_at)

            rows = db.execute(query).scalars().all()
        else:
            since = app_now() - timedelta(minutes=minutes)
            rows = (
                db.execute(
                    select(PLCDataSnapshot)
                    .where(PLCDataSnapshot.recorded_at >= since)
                    .order_by(PLCDataSnapshot.recorded_at.asc())
                )
                .scalars()
                .all()
            )

    if not rows:
        return jsonify([])

    return jsonify([_serialize_plc_history_row(row) for row in rows])

# Return the current machine state and active batch payload.

@plc_bp.get("/machine/status")
def machine_status():
    with db_session() as db:
        machine_state = get_or_create_machine_state(db)
        sync_active_batch_progress(db, machine_state=machine_state)
        latest_row = db.execute(
            select(PLCDataSnapshot).order_by(PLCDataSnapshot.recorded_at.desc()).limit(1)
        ).scalars().one_or_none()
        active_batch = _active_batch_payload(db, machine_state)
        return jsonify(_machine_status_payload(machine_state, latest_row, active_batch))

# Start the machine and optionally attach an active batch.

@plc_bp.post("/machine/start")
def machine_start():
    payload = request.get_json(silent=True) or {}
    batch_id_raw = payload.get("batch_id")
    batch_id: int | None = None
    if batch_id_raw not in (None, ""):
        try:
            batch_id = int(batch_id_raw)
        except (TypeError, ValueError):
            return error("batch_id must be an integer")

    with db_session() as db:
        machine_state = get_or_create_machine_state(db)
        sync_active_batch_progress(db, machine_state=machine_state)

        if batch_id is not None:
            if machine_state.active_batch_id and machine_state.active_batch_id != batch_id:
                return error("Another batch is already active. Stop it before starting a new one.")
            batch = (
                db.execute(
                    select(ProductionBatch).where(
                        ProductionBatch.id == batch_id)
                )
                .scalars()
                .one_or_none()
            )
            if batch is None:
                return error("Batch not found", 404)

            batch_status = (batch.hmi_status or "").lower()
            if batch_status in {RUN_STATUS_COMPLETED, RUN_STATUS_STOPPED}:
                return error("Stopped/completed batches cannot be restarted. Create a new batch.")

            planned_count = normalize_batch_count(batch.batch_size)
            if planned_count <= 0:
                return error("Batch count is invalid for this batch.")

            duration = float(batch.hmi_duration_seconds or 0)
            if duration <= 0:
                return error("Duration per count is missing for this batch.")

            completed_count = max(0, int(batch.hmi_completed_count or 0))
            if completed_count > 0:
                return error("Partially run batches cannot be restarted. Create a new batch.")

            material_rows = (
                db.execute(
                    select(ProductionBatchMaterial)
                    .where(ProductionBatchMaterial.batch_id == batch.id)
                    .order_by(ProductionBatchMaterial.id.asc())
                )
                .scalars()
                .all()
            )
            shortages = collect_rm_shortages(
                db=db,
                date=batch.date,
                materials=[
                    {"rm_name": row.rm_name, "quantity": row.quantity}
                    for row in material_rows
                ],
                batch_run_count=planned_count)
            if shortages:
                batch.rm_shortage_flag = True
                batch.rm_shortage_detail = format_rm_shortage_message(
                    shortages,
                    heading=(
                        "Batch is running but projected raw material is insufficient "
                        f"for assigned count ({planned_count})"
                    ))
            else:
                batch.rm_shortage_flag = False
                batch.rm_shortage_detail = None

            if batch.hmi_started_at is None:
                batch.hmi_started_at = app_now()
            batch.hmi_status = RUN_STATUS_RUNNING
            batch.hmi_completed_at = None
            batch.last_modified_at = app_now()

        machine_state = set_machine_running(
            db,
            running=True,
            active_batch_id=batch_id if batch_id is not None else machine_state.active_batch_id)
        sync_active_batch_progress(db, machine_state=machine_state)
        latest_row = db.execute(
            select(PLCDataSnapshot).order_by(PLCDataSnapshot.recorded_at.desc()).limit(1)
        ).scalars().one_or_none()
        active_batch = _active_batch_payload(db, machine_state)
        return jsonify(_machine_status_payload(machine_state, latest_row, active_batch))

# Stop the machine and clear the active batch.

@plc_bp.post("/machine/stop")
def machine_stop():
    with db_session() as db:
        machine_state = get_or_create_machine_state(db)
        sync_active_batch_progress(db, machine_state=machine_state)
        if machine_state.active_batch_id:
            active_batch = db.get(ProductionBatch, machine_state.active_batch_id)
            if active_batch and (active_batch.hmi_status or "").lower() != RUN_STATUS_COMPLETED:
                now = app_now()
                if active_batch.hmi_started_at is None:
                    active_batch.hmi_started_at = now
                active_batch.hmi_status = RUN_STATUS_STOPPED
                active_batch.hmi_completed_at = now
                active_batch.last_modified_at = now

        machine_state = set_machine_running(db, running=False, active_batch_id=None)
        latest_row = db.execute(
            select(PLCDataSnapshot).order_by(PLCDataSnapshot.recorded_at.desc()).limit(1)
        ).scalars().one_or_none()
        return jsonify(_machine_status_payload(machine_state, latest_row, None))

