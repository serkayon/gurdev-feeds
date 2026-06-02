# Production batch, HMI, and report routes.

import re
from datetime import datetime, timedelta
import math
from ..fastapi_compat import Blueprint, Response, jsonify, request
from sqlalchemy import select

from ..common import (
        db_session,
    error,
    json_body,
    parse_datetime,
    parse_float,
    resolve_period_range,
    required,
    serialize_batch,
    serialize_batch_material,
    serialize_report)
from app.models.config import ProductType, Recipe
from app.models.plc import PLCDataSnapshot
from app.models.production import ProductionBatch, ProductionBatchMaterial, ProductionReport
from ...services.plc_state import get_or_create_machine_state
from ...services.production_runtime import (
    evaluate_mark_complete_eligibility,
    RUN_STATUS_COMPLETED,
    RUN_STATUS_PENDING,
    RUN_STATUS_RUNNING,
    RUN_STATUS_STOPPED,
    finalize_batch_runtime_state,
    normalize_batch_count,
    sync_active_batch_progress,
    try_post_batch_stock)
from ...services.stock import (
    calculate_rm_consumption_quantity,
    collect_rm_shortages,
    format_rm_shortage_message,
    rebuild_feed_stock_ledger,
    rebuild_rm_stock_ledger,
    resolve_effective_batch_run_count)
from ...utils.export import (
    export_batch_consumption_report_excel,
    export_batch_consumption_report_pdf,
    export_batch_report_excel,
    export_batch_report_pdf,
    export_production_report_excel,
    export_production_report_pdf,
    export_table_to_csv)

production_bp = Blueprint("production", __name__, url_prefix="/api/production")

_DATE_ONLY_INPUT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_MIDNIGHT_DATETIME_INPUT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?$")

# Detects whether incoming date payload is date-only (no time component).

def _is_date_only_payload(raw_value: object) -> bool:
    if not isinstance(raw_value, str):
        return False
    value = raw_value.strip()
    if not value:
        return False
    return bool(
        _DATE_ONLY_INPUT_RE.fullmatch(value)
        or _MIDNIGHT_DATETIME_INPUT_RE.fullmatch(value)
    )

# Parses and normalizes batch number values with fallback behavior.

def _parse_batch_no(raw_value: object, fallback: str | None = None) -> str:
    if raw_value in (None, ""):
        return fallback or ""
    value = str(raw_value).strip()
    if not value:
        return fallback or ""
    if len(value) > 64:
        raise ValueError("batch_no must be 64 characters or fewer")
    return value

# Returns display-friendly batch number string for UI/API.

def _display_batch_no(batch: ProductionBatch) -> str:
    return _parse_batch_no(batch.batch_no, fallback=str(batch.id))

# Computes PLC time window boundaries corresponding to a batch run.

def _resolve_batch_plc_window(batch: ProductionBatch) -> tuple[datetime, datetime]:
    start = batch.hmi_started_at or batch.date or batch.created_at or datetime.utcnow()
    status = (batch.hmi_status or "").strip().lower()

    if batch.hmi_completed_at is not None:
        end = batch.hmi_completed_at
    elif status in (RUN_STATUS_COMPLETED, RUN_STATUS_STOPPED):
        end = batch.last_modified_at or start
    else:
        end = datetime.utcnow()

    if end < start:
        end = start
    return start, end

# Calculates resolved utilized count value for a production batch.

def _resolved_batch_utilized_count(batch: ProductionBatch) -> float:
    return resolve_effective_batch_run_count(
        batch_size=batch.batch_size,
        hmi_completed_count=batch.hmi_completed_count,
        hmi_status=batch.hmi_status,
        rm_shortage_flag=batch.rm_shortage_flag)

# Recomputes and persists total material quantity for a batch.

def _refresh_material_total_quantity(db, *, batch: ProductionBatch) -> None:
    utilized_count = _resolved_batch_utilized_count(batch)
    material_rows = (
        db.execute(
            select(ProductionBatchMaterial)
            .where(ProductionBatchMaterial.batch_id == batch.id)
            .order_by(ProductionBatchMaterial.id.asc())
        )
        .scalars()
        .all()
    )
    for material in material_rows:
        if utilized_count > 0:
            material.total_quantity = calculate_rm_consumption_quantity(
                material.quantity,
                utilized_count)
        else:
            material.total_quantity = None

# Validates and normalizes production material list payload rows.

def _parse_materials(raw_materials: object) -> list[dict]:
    if not isinstance(raw_materials, list) or len(raw_materials) == 0:
        raise ValueError("materials is required and must be a non-empty list")

    parsed: list[dict] = []
    for index, item in enumerate(raw_materials, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"materials[{index}] must be an object")

        raw_id = item.get("id")
        material_id: int | None = None
        if raw_id not in (None, ""):
            try:
                material_id = int(raw_id)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"materials[{index}].id must be an integer") from exc
            if material_id <= 0:
                raise ValueError(f"materials[{index}].id must be greater than 0")

        rm_name = str(item.get("rm_name") or "").strip()
        if not rm_name:
            raise ValueError(f"materials[{index}].rm_name is required")

        try:
            quantity = float(item.get("quantity"))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"materials[{index}].quantity must be a number") from exc
        if quantity <= 0:
            raise ValueError(f"materials[{index}].quantity must be greater than 0")

        parsed.append({"id": material_id, "rm_name": rm_name, "quantity": quantity})
    return parsed

# Parses output bag metrics and validates required output fields.

def _parse_bag_output_fields(payload: dict, *, required_fields: bool) -> tuple[float, float, float]:
    num_bags = parse_float(payload, "num_bags", required_field=required_fields)
    weight_per_bag = parse_float(payload, "weight_per_bag", required_field=required_fields)

    if num_bags is None or weight_per_bag is None:
        raise ValueError("num_bags and weight_per_bag are required")
    if num_bags <= 0:
        raise ValueError("num_bags must be greater than 0")
    if weight_per_bag <= 0:
        raise ValueError("weight_per_bag must be greater than 0")

    output_value = num_bags * weight_per_bag
    if output_value <= 0:
        raise ValueError("output must be greater than 0")
    return num_bags, weight_per_bag, output_value

# Parses HMI batch count input into valid integer.

def _parse_hmi_batch_count(raw_value: object) -> int:
    try:
        value = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError("batch_count must be an integer") from exc
    if value <= 0:
        raise ValueError("batch_count must be greater than 0")
    return value

# Parses HMI batch duration input into valid numeric duration.

def _parse_hmi_duration(raw_value: object) -> float:
    try:
        value = float(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError("duration_per_count_seconds must be a number") from exc
    if value <= 0:
        raise ValueError("duration_per_count_seconds must be greater than 0")
    return value

# Checks whether a batch number already exists under configured scope constraints.

def _batch_no_exists(
    db,
    batch_no: str,
    *,
    exclude_batch_id: int | None = None) -> bool:
    normalized = str(batch_no or "").strip()
    if not normalized:
        return False

    query = select(ProductionBatch.id).where(
        ProductionBatch.batch_no.is_not(None),
        ProductionBatch.batch_no.ilike(normalized))
    if exclude_batch_id is not None:
        query = query.where(ProductionBatch.id != exclude_batch_id)
    return db.execute(query.limit(1)).first() is not None

# Generates the next suggested batch number for HMI flow.

def _suggest_next_hmi_batch_no(db) -> str:
    pattern = re.compile(r"^BATCH(\d+)$", re.IGNORECASE)
    rows = db.execute(
        select(ProductionBatch.batch_no).where(
            ProductionBatch.batch_no.is_not(None))
    ).all()

    max_sequence = 0
    for (batch_no) in rows:
        if not isinstance(batch_no, str):
            continue
        match = pattern.match(batch_no.strip())
        if not match:
            continue
        try:
            seq = int(match.group(1))
        except ValueError:
            continue
        if seq > max_sequence:
            max_sequence = seq
    return f"BATCH{max_sequence + 1:05d}"

# Normalizes list filter tokens for period/product filtering.

def _normalize_filter_token(raw_value: str | None) -> str | None:
    value = str(raw_value or "").strip()
    if not value:
        return None
    if value.lower() in {"all", "any", "*", "none", "null"}:
        return None
    return value

# Parses recipe id from HMI payload with validation.

def _parse_hmi_recipe_id(raw_value: object) -> int:
    try:
        value = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise ValueError("recipe_id must be an integer") from exc
    if value <= 0:
        raise ValueError("recipe_id must be greater than 0")
    return value

# Resolves product type input to canonical product type name.

def _resolve_product_type_name(db, raw_value: object, *, required_field: bool) -> str:
    product_name = str(raw_value or "").strip()
    if not product_name:
        if required_field:
            raise ValueError("product_name is required")
        return ""
    product_type = (
        db.execute(select(ProductType).where(ProductType.name == product_name))
        .scalars()
        .one_or_none()
    )
    if product_type is None:
        raise ValueError("Invalid product_name. Select a valid product type.")
    return str(product_type.name or "").strip()

# Resolve HMI recipe selection and return the recipe type/name to persist.
# If recipe master row is missing, still allow batch start using a stable
# fallback product name so HMI remains single-direction and resilient.

def _resolve_hmi_recipe_identity(db, recipe_id: int) -> tuple[Recipe | None, str]:
    recipe = db.get(Recipe, recipe_id)
    if recipe is not None:
        recipe_name = str(recipe.name or "").strip()
        return recipe, (recipe_name or f"Recipe {recipe_id}")
    return None, f"Recipe {recipe_id}"

# Finds canonical product type name that matches a candidate string.

def _resolve_matching_product_type_name(db, candidate_name: str) -> str:
    normalized_name = str(candidate_name or "").strip()
    if not normalized_name:
        return ""

    product_type = (
        db.execute(select(ProductType).where(ProductType.name == normalized_name))
        .scalars()
        .one_or_none()
    )
    if product_type is None:
        return ""
    return str(product_type.name or "").strip()

# Converts recipe materials into batch material payload structure.

def _collect_recipe_material_payload(recipe: Recipe | None) -> list[dict]:
    if recipe is None:
        return []

    rows: list[dict] = []
    for material in (recipe.materials or []):
        rm_name = str(material.rm_name or "").strip()
        if not rm_name:
            continue
        try:
            qty = float(material.quantity)
        except (TypeError, ValueError):
            continue
        if qty <= 0:
            continue
        rows.append({"rm_name": rm_name, "quantity": qty})
    return rows

# Returns next suggested HMI batch number.

@production_bp.get("/hmi/batch-no/suggest")
def suggest_hmi_batch_no():
    with db_session() as db:
        return jsonify({"batch_no": _suggest_next_hmi_batch_no(db)})

# Lists production batches with current filters/sorting behavior.

@production_bp.get("/batches")
def list_batches():
    try:
        date = parse_datetime(request.args.get("date"), "date")
        from_date = parse_datetime(request.args.get("from_date"), "from_date")
        to_date = parse_datetime(request.args.get("to_date"), "to_date")
    except ValueError as exc:
        return error(str(exc))
    product_name = request.args.get("product_name")

    with db_session() as db:
        machine_state = get_or_create_machine_state(db)
        sync_active_batch_progress(db, machine_state=machine_state)
        active_batch_id = machine_state.active_batch_id

        query = select(ProductionBatch)
        if date:
            start = date.replace(hour=0, minute=0, second=0, microsecond=0)
            end = start + timedelta(days=1)
            query = query.where(ProductionBatch.date >= start, ProductionBatch.date < end)
        if from_date:
            query = query.where(ProductionBatch.date >= from_date)
        if to_date:
            query = query.where(ProductionBatch.date <= to_date)
        if product_name:
            query = query.where(ProductionBatch.product_name == product_name)
        query = query.order_by(ProductionBatch.date.desc())

        batches = db.execute(query).scalars().all()
        out = []
        for batch in batches:
            has_report = (
                db.execute(select(ProductionReport).where(ProductionReport.batch_id == batch.id))
                .scalars()
                .one_or_none()
                is not None
            )
            out.append(
                serialize_batch(
                    batch,
                    has_report=has_report,
                    is_active=batch.id == active_batch_id)
            )
    return jsonify(out)

# Lists batches filtered by period and product.

@production_bp.get("/batches/filtered/<period>/<path:product_name>")
def list_batches_by_period(period: str, product_name: str):
    try:
        from_date, to_date = resolve_period_range(
            period,
            from_date_raw=request.args.get("from_date"),
            to_date_raw=request.args.get("to_date"))
    except ValueError as exc:
        return error(str(exc))
    normalized_product_name = _normalize_filter_token(product_name)

    with db_session() as db:
        machine_state = get_or_create_machine_state(db)
        sync_active_batch_progress(db, machine_state=machine_state)
        active_batch_id = machine_state.active_batch_id

        query = select(ProductionBatch)
        query = query.where(ProductionBatch.date >= from_date)
        query = query.where(ProductionBatch.date <= to_date)
        if normalized_product_name:
            query = query.where(ProductionBatch.product_name == normalized_product_name)
        query = query.order_by(ProductionBatch.date.desc())

        batches = db.execute(query).scalars().all()
        out = []
        for batch in batches:
            has_report = (
                db.execute(select(ProductionReport).where(ProductionReport.batch_id == batch.id))
                .scalars()
                .one_or_none()
                is not None
            )
            out.append(
                serialize_batch(
                    batch,
                    has_report=has_report,
                    is_active=batch.id == active_batch_id)
            )
    return jsonify(out)

# Returns aggregate production summary for period/product filters.

@production_bp.get("/batches/summary/<period>/<path:product_name>")
def summarize_batches_by_period(period: str, product_name: str):
    try:
        from_date, to_date = resolve_period_range(
            period,
            from_date_raw=request.args.get("from_date"),
            to_date_raw=request.args.get("to_date"))
    except ValueError as exc:
        return error(str(exc))
    normalized_product_name = _normalize_filter_token(product_name)

    with db_session() as db:
        machine_state = get_or_create_machine_state(db)
        sync_active_batch_progress(db, machine_state=machine_state)

        query = select(ProductionBatch)
        query = query.where(ProductionBatch.date >= from_date)
        query = query.where(ProductionBatch.date <= to_date)
        if normalized_product_name:
            query = query.where(ProductionBatch.product_name == normalized_product_name)

        rows = db.execute(query).scalars().all()
        total_batches = len(rows)
        total_production_kg = sum(float(row.output or 0) for row in rows)

    return jsonify(
        {
            "period": str(period),
            "product_name": normalized_product_name or "all",
            "from_date": from_date.isoformat() + "Z",
            "to_date": to_date.isoformat() + "Z",
            "total_batches": total_batches,
            "total_production_kg": total_production_kg,
        }
    )

# Creates a standard production batch and related material mappings.

@production_bp.post("/batches")
def create_batch():
    return error(
        "Batch creation from backend is disabled. Create batches from N720 ingestion flow.",
        410,
    )

# Creates a production batch from HMI-oriented payload workflow.

@production_bp.post("/hmi/batches")
def create_hmi_batch():
    return error(
        "HMI batch creation from backend is disabled. Create batches from N720 ingestion flow.",
        410,
    )

# Starts selected HMI batch and transitions machine/runtime state.

@production_bp.post("/hmi/start-batch")
def start_hmi_batch():
    return error(
        "Backend start-batch creation flow is disabled. Start flow from N720 ingestion only.",
        410,
    )

# Stops the currently active HMI batch and updates runtime status.

@production_bp.post("/hmi/stop-active-batch")
def stop_hmi_active_batch():
    return error(
        "Backend stop-active-batch flow is disabled. Batch run control is handled by N720 ingestion.",
        410,
    )

# Marks a batch complete with eligibility and quantity checks.

@production_bp.post("/batches/<int:batch_id>/mark-complete")
def mark_batch_complete(batch_id: int):
    with db_session() as db:
        machine_state = get_or_create_machine_state(db)
        sync_active_batch_progress(db, machine_state=machine_state)

        batch = (
            db.execute(
                select(ProductionBatch).where(
                    ProductionBatch.id == batch_id)
            )
            .scalars()
            .one_or_none()
        )
        if not batch:
            return error("Batch not found", 404)

        if machine_state.active_batch_id == batch.id:
            return error("Active running batch cannot be marked complete. Stop it first.")

        status = (batch.hmi_status or "").strip().lower()
        if status in {RUN_STATUS_PENDING, RUN_STATUS_STOPPED}:
            eligible, detail = evaluate_mark_complete_eligibility(
                db=db,
                batch=batch)
            if not eligible:
                batch.rm_shortage_flag = True
                batch.rm_shortage_detail = detail
                return error(detail or "Insufficient raw material stock for completion.")
            batch.rm_shortage_flag = False
            batch.rm_shortage_detail = None

        if status != RUN_STATUS_COMPLETED:
            now = datetime.utcnow()
            planned_count = normalize_batch_count(batch.batch_size)
            completed_count = max(0, int(batch.hmi_completed_count or 0))
            if planned_count > 0:
                completed_count = min(completed_count, planned_count)
            batch.hmi_completed_count = completed_count
            if batch.hmi_started_at is None:
                batch.hmi_started_at = now
            if batch.hmi_completed_at is None:
                batch.hmi_completed_at = now
            batch.hmi_status = RUN_STATUS_COMPLETED
            batch.last_modified_at = now

        warning_detail = finalize_batch_runtime_state(
            db=db,
            batch=batch)

        posted_now = try_post_batch_stock(db, batch=batch)
        if posted_now:
            rebuild_feed_stock_ledger(db=db)
        _refresh_material_total_quantity(db, batch=batch)
        has_report = (
            db.execute(select(ProductionReport).where(ProductionReport.batch_id == batch.id))
            .scalars()
            .one_or_none()
            is not None
        )
        db.flush()
        response_payload = {
            "batch": serialize_batch(
                batch,
                has_report=has_report,
                is_active=batch.id == machine_state.active_batch_id)
        }
        if warning_detail:
            response_payload["warning"] = (
                "Batch finalized with stock warning. "
                f"{warning_detail}"
            )
        return jsonify(response_payload)


# Returns whether a batch can be marked complete and why.

@production_bp.get("/batches/<int:batch_id>/mark-complete-eligibility")
def get_mark_complete_eligibility(batch_id: int):
    with db_session() as db:
        machine_state = get_or_create_machine_state(db)
        sync_active_batch_progress(db, machine_state=machine_state)

        batch = (
            db.execute(
                select(ProductionBatch).where(
                    ProductionBatch.id == batch_id)
            )
            .scalars()
            .one_or_none()
        )
        if not batch:
            return error("Batch not found", 404)

        if machine_state.active_batch_id == batch.id:
            return jsonify(
                {
                    "allowed": False,
                    "detail": "Active running batch cannot be marked complete. Stop it first.",
                }
            )

        status = (batch.hmi_status or "").strip().lower()
        if status not in {RUN_STATUS_PENDING, RUN_STATUS_STOPPED}:
            return jsonify(
                {
                    "allowed": False,
                    "detail": "Only pending/stopped batches can be marked complete.",
                }
            )

        eligible, detail = evaluate_mark_complete_eligibility(
            db=db,
            batch=batch)
        return jsonify({"allowed": eligible, "detail": detail})

# Returns full details for one production batch.

@production_bp.get("/batches/<int:batch_id>")
def get_batch(batch_id: int):
    with db_session() as db:
        machine_state = get_or_create_machine_state(db)
        sync_active_batch_progress(db, machine_state=machine_state)
        batch = (
            db.execute(
                select(ProductionBatch).where(
                    ProductionBatch.id == batch_id)
            )
            .scalars()
            .one_or_none()
        )
        if not batch:
            return error("Batch not found", 404)

        report = (
            db.execute(select(ProductionReport).where(ProductionReport.batch_id == batch_id))
            .scalars()
            .one_or_none()
        )
        return jsonify(
            {
                "batch": serialize_batch(
                    batch,
                    has_report=report is not None,
                    is_active=batch.id == machine_state.active_batch_id),
                "report": serialize_report(report),
                "materials": [
                    serialize_batch_material(row)
                    for row in db.execute(
                        select(ProductionBatchMaterial)
                        .where(ProductionBatchMaterial.batch_id == batch_id)
                        .order_by(ProductionBatchMaterial.id.asc())
                    )
                    .scalars()
                    .all()
                ],
            }
        )

# Updates editable batch detail fields and dependent values.

@production_bp.put("/batches/<int:batch_id>/details")
def update_batch_details(batch_id: int):
    try:
        payload = json_body()
    except ValueError as exc:
        return error(str(exc))

    try:
        with db_session() as db:
            batch = (
                db.execute(
                    select(ProductionBatch).where(
                        ProductionBatch.id == batch_id)
                )
                .scalars()
                .one_or_none()
            )
            if not batch:
                return error("Batch not found", 404)

            batch_updated = False
            rm_stock_rebuild_required = False
            feed_stock_rebuild_required = False

            if "date" in payload:
                try:
                    raw_date = payload.get("date")
                    parsed_date = parse_datetime(raw_date, "date")
                except ValueError as exc:
                    return error(str(exc))
                if parsed_date is None:
                    return error("date is required")
                # Date-only edits from UI should keep the original UTC time-of-day.
                if _is_date_only_payload(raw_date) and batch.date is not None:
                    parsed_date = datetime.combine(
                        parsed_date.date(),
                        batch.date.time())
                batch.date = parsed_date
                batch_updated = True
                rm_stock_rebuild_required = True
                feed_stock_rebuild_required = bool(batch.stock_posted)

            if "batch_no" in payload:
                try:
                    parsed_batch_no = _parse_batch_no(payload.get("batch_no"), fallback=str(batch.id))
                except ValueError as exc:
                    return error(str(exc))
                if _batch_no_exists(db, parsed_batch_no, exclude_batch_id=batch.id):
                    return error("batch_no already exists. Use a unique batch number.")
                batch.batch_no = parsed_batch_no
                batch_updated = True

            selected_recipe_materials: list[dict] | None = None
            if "product_name" in payload:
                product_name = str(payload.get("product_name") or "").strip()
                try:
                    product_name = _resolve_product_type_name(
                        db,
                        product_name,
                        required_field=True)
                except ValueError as exc:
                    return error(str(exc))
                batch.product_name = product_name
                batch_updated = True
                feed_stock_rebuild_required = bool(batch.stock_posted)

            if "recipe_id" in payload:
                recipe_id_raw = payload.get("recipe_id")
                if recipe_id_raw in (None, ""):
                    batch.recipe_type = None
                else:
                    try:
                        recipe_id = _parse_hmi_recipe_id(recipe_id_raw)
                    except ValueError as exc:
                        return error(str(exc))
                    selected_recipe = db.get(Recipe, recipe_id)
                    if selected_recipe is None:
                        return error("Recipe not found")
                    batch.recipe_type = str(selected_recipe.name or "").strip() or f"Recipe {selected_recipe.id}"
                    selected_recipe_materials = [
                        {
                            "rm_name": item.rm_name,
                            "quantity": float(item.quantity),
                        }
                        for item in selected_recipe.materials
                    ]
                batch_updated = True

            parsed_materials: list[dict] | None = None
            if "materials" in payload:
                try:
                    parsed_materials = _parse_materials(payload.get("materials"))
                except ValueError as exc:
                    return error(str(exc))
            elif selected_recipe_materials is not None:
                parsed_materials = selected_recipe_materials

            if "batch_size" in payload:
                try:
                    batch_size_value = parse_float(payload, "batch_size")
                except ValueError as exc:
                    return error(str(exc))
                if batch_size_value is None or batch_size_value <= 0:
                    return error("batch_size must be greater than 0")
                batch.batch_size = batch_size_value
                batch_updated = True
                rm_stock_rebuild_required = True

            if "mop" in payload:
                try:
                    batch.mop = parse_float(payload, "mop")
                except ValueError as exc:
                    return error(str(exc))
                batch_updated = True

            if "water" in payload:
                try:
                    batch.water = parse_float(payload, "water")
                except ValueError as exc:
                    return error(str(exc))
                batch_updated = True

            if "num_bags" in payload or "weight_per_bag" in payload:
                utilized_count = max(0, int(batch.hmi_completed_count or 0))
                if normalize_batch_count(batch.batch_size) > 0 and utilized_count <= 0:
                    return error("Bag details can be entered only after utilized batch count is greater than 0.")
                candidate_num_bags = (
                    parse_float(payload, "num_bags")
                    if "num_bags" in payload
                    else float(batch.num_bags or 0)
                )
                candidate_weight_per_bag = (
                    parse_float(payload, "weight_per_bag")
                    if "weight_per_bag" in payload
                    else float(batch.weight_per_bag or 0)
                )
                if candidate_num_bags is None or candidate_num_bags <= 0:
                    return error("num_bags must be greater than 0")
                if candidate_weight_per_bag is None or candidate_weight_per_bag <= 0:
                    return error("weight_per_bag must be greater than 0")
                batch.num_bags = candidate_num_bags
                batch.weight_per_bag = candidate_weight_per_bag
                batch.output = candidate_num_bags * candidate_weight_per_bag
                batch_updated = True
                feed_stock_rebuild_required = bool(batch.stock_posted)

            if "output" in payload:
                if "num_bags" not in payload and "weight_per_bag" not in payload:
                    try:
                        output_value = parse_float(payload, "output")
                    except ValueError as exc:
                        return error(str(exc))
                    if output_value is None or output_value <= 0:
                        return error("output must be greater than 0")
                    batch.output = output_value
                    batch_updated = True
                    feed_stock_rebuild_required = bool(batch.stock_posted)

            if parsed_materials is not None:
                existing_rows = (
                    db.execute(select(ProductionBatchMaterial).where(ProductionBatchMaterial.batch_id == batch.id))
                    .scalars()
                    .all()
                )
                existing_rows = sorted(existing_rows, key=lambda row: row.id)
                existing_by_id = {row.id: row for row in existing_rows}
                used_existing_ids: set[int] = set()

                for item in parsed_materials:
                    target_row: ProductionBatchMaterial | None = None
                    incoming_id = item.get("id")
                    if isinstance(incoming_id, int):
                        candidate = existing_by_id.get(incoming_id)
                        if candidate is not None and candidate.id not in used_existing_ids:
                            target_row = candidate

                    if target_row is None and len(used_existing_ids) < len(existing_rows):
                        # Fallback when client does not send IDs: preserve IDs by row order.
                        for candidate in existing_rows:
                            if candidate.id in used_existing_ids:
                                continue
                            target_row = candidate
                            break

                    if target_row is None:
                        target_row = ProductionBatchMaterial(batch_id=batch.id)
                        db.add(target_row)
                    else:
                        used_existing_ids.add(target_row.id)

                    target_row.rm_name = item["rm_name"]
                    target_row.quantity = item["quantity"]
                    target_row.total_quantity = None

                for row in existing_rows:
                    if row.id in used_existing_ids:
                        continue
                    db.delete(row)
                db.flush()
                rm_stock_rebuild_required = True
                batch_updated = True

            if rm_stock_rebuild_required:
                # Session is configured with autoflush=False; flush model edits
                # before rebuilding ledger queries from batch/material tables.
                db.flush()
                rebuild_rm_stock_ledger(db=db)

            if batch_updated:
                batch.last_modified_at = datetime.utcnow()

            posted_now = try_post_batch_stock(db, batch=batch)
            if posted_now:
                feed_stock_rebuild_required = True
            if feed_stock_rebuild_required:
                # Ensure modified batch fields (date/product/output/stock_posted)
                # are visible to rebuild queries in this same transaction.
                db.flush()
                rebuild_feed_stock_ledger(db=db)
            _refresh_material_total_quantity(db, batch=batch)
            machine_state = get_or_create_machine_state(db)
            has_report = (
                db.execute(select(ProductionReport).where(ProductionReport.batch_id == batch.id))
                .scalars()
                .one_or_none()
                is not None
            )
            db.flush()
            return jsonify(
                {
                    "batch": serialize_batch(
                        batch,
                        has_report=has_report,
                        is_active=batch.id == machine_state.active_batch_id),
                    "materials": [
                        serialize_batch_material(row)
                        for row in db.execute(
                            select(ProductionBatchMaterial)
                            .where(ProductionBatchMaterial.batch_id == batch.id)
                            .order_by(ProductionBatchMaterial.id.asc())
                        )
                        .scalars()
                        .all()
                    ],
                    "stock_posted": bool(batch.stock_posted),
                    "rm_reduced": bool(batch.rm_reduced),
                }
            )
    except ValueError as exc:
        return error(str(exc))

# Submits/records production report data for a batch or period.

@production_bp.post("/report")
def submit_production_report():
    try:
        payload = json_body()
        batch_id = int(required(payload, "batch_id"))
    except (ValueError, TypeError) as exc:
        return error(str(exc))

    try:
        with db_session() as db:
            batch = db.get(ProductionBatch, batch_id)
            if not batch:
                return error("Batch not found", 404)

            report = (
                db.execute(select(ProductionReport).where(ProductionReport.batch_id == batch_id))
                .scalars()
                .one_or_none()
            )
            if not report:
                report = ProductionReport(batch_id=batch_id)
                db.add(report)

            report_fields = [
                "protein",
                "fat",
                "fiber",
                "ash",
                "calcium",
                "phosphorus",
                "salt",
                "hm_retention",
                "mixer_moisture",
                "conditioner_moisture",
                "moisture_addition",
                "final_feed_moisture",
                "water_activity",
                "hardness",
                "pellet_diameter",
                "fines",
            ]
            for field in report_fields:
                if field in payload:
                    setattr(report, field, parse_float(payload, field))

            db.flush()
            return jsonify(
                {
                    "id": report.id,
                    "batch_id": batch_id,
                    "stock_posted": bool(batch.stock_posted),
                    "rm_reduced": bool(batch.rm_reduced),
                }
            )
    except ValueError as exc:
        return error(str(exc))

# Returns material consumption report data for analysis/export.

@production_bp.get("/consumption")
def consumption_report():
    try:
        from_date = parse_datetime(request.args.get("from_date"), "from_date")
        to_date = parse_datetime(request.args.get("to_date"), "to_date")
    except ValueError as exc:
        return error(str(exc))

    with db_session() as db:
        query = (
            select(ProductionBatch)
            
            .order_by(ProductionBatch.date.desc(), ProductionBatch.id.desc())
        )
        if from_date:
            query = query.where(ProductionBatch.date >= from_date)
        if to_date:
            query = query.where(ProductionBatch.date <= to_date)
        batches = db.execute(query).scalars().all()

        rows: list[dict] = []
        for batch in batches:
            total_batch = resolve_effective_batch_run_count(
                batch_size=batch.batch_size,
                hmi_completed_count=batch.hmi_completed_count,
                hmi_status=batch.hmi_status,
                rm_shortage_flag=batch.rm_shortage_flag)
            batch_rows = (
                db.execute(
                    select(ProductionBatchMaterial)
                    .where(ProductionBatchMaterial.batch_id == batch.id)
                    .order_by(ProductionBatchMaterial.id.asc())
                )
                .scalars()
                .all()
            )

            batch_weight_per_run = 0.0
            batch_total_weight = 0.0
            for material in batch_rows:
                weight_per_batch = float(material.quantity or 0)
                if material.total_quantity is not None:
                    total_weight = float(material.total_quantity or 0)
                else:
                    total_weight = calculate_rm_consumption_quantity(
                        weight_per_batch,
                        total_batch)
                batch_weight_per_run += weight_per_batch
                batch_total_weight += total_weight
                rows.append(
                    {
                        "batch_id": batch.id,
                        "batch_no": _display_batch_no(batch),
                        "date": batch.date.strftime("%Y-%m-%d"),
                        "product_name": batch.product_name,
                        "rm_name": material.rm_name,
                        "weight_per_batch": weight_per_batch,
                        "total_batch": total_batch,
                        "total_weight": total_weight,
                        "is_total": False,
                    }
                )

            rows.append(
                {
                    "batch_id": batch.id,
                    "batch_no": _display_batch_no(batch),
                    "date": batch.date.strftime("%Y-%m-%d"),
                    "product_name": batch.product_name,
                    "rm_name": "TOTAL",
                    "weight_per_batch": batch_weight_per_run,
                    "total_batch": total_batch,
                    "total_weight": batch_total_weight,
                    "is_total": True,
                }
            )

    return jsonify(rows)

# Exports production list/report data in downloadable format.

@production_bp.get("/download")
def download_production():
    try:
        from_date = parse_datetime(request.args.get("from_date"), "from_date")
        to_date = parse_datetime(request.args.get("to_date"), "to_date")
    except ValueError as exc:
        return error(str(exc))
    file_format = request.args.get("format", "pdf").lower()

    with db_session() as db:
        query = (
            select(ProductionBatch, ProductionReport)
            .outerjoin(ProductionReport, ProductionBatch.id == ProductionReport.batch_id)
            
            .order_by(ProductionBatch.date.desc())
        )
        if from_date:
            query = query.where(ProductionBatch.date >= from_date)
        if to_date:
            query = query.where(ProductionBatch.date <= to_date)
        rows = db.execute(query).all()

    headers = [
        "Date",
        "Batch No",
        "Product",
        "Batch Size",
        "MOP",
        "Water",
        "No. of Bags",
        "Weight/Bag",
        "Output",
    ]
    data_rows = [
        (
            batch.date.strftime("%Y-%m-%d"),
            _display_batch_no(batch),
            batch.product_name,
            batch.batch_size,
            batch.mop or "",
            batch.water or "",
            batch.num_bags or "",
            batch.weight_per_bag or "",
            batch.output)
        for batch, report in rows
    ]

    if file_format == "csv":
        return Response(
            export_table_to_csv(headers, data_rows),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=production_report.csv"})
    if file_format in ("excel", "xlsx"):
        return Response(
            export_production_report_excel(headers, data_rows),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=production_report.xlsx"})
    return Response(
        export_production_report_pdf(headers, data_rows),
        mimetype="application/pdf",
        headers={"Content-Disposition": "attachment; filename=production_report.pdf"})

# Download single batch report
# Exports a single batch production report.

@production_bp.get("/<int:batch_id>/download")
def download_single_batch(batch_id: int):
    file_format = request.args.get("format", "pdf").lower()

    with db_session() as db:
        row = (
            db.execute(
                select(ProductionBatch, ProductionReport)
                .outerjoin(
                    ProductionReport,
                    ProductionBatch.id == ProductionReport.batch_id)
                .where(
                    ProductionBatch.id == batch_id)
            )
            .first()
        )

        if not row:
            return error("Batch not found", 404)

        batch, report = row
        batch_start, batch_end = _resolve_batch_plc_window(batch)

        window_seconds = max(1, int((batch_end - batch_start).total_seconds()))
        window_minutes = max(1, int((window_seconds + 59) // 60))

        if not report:
            return error("Report not available for this batch", 404)

        materials = (
            db.execute(
                select(ProductionBatchMaterial)
                .where(ProductionBatchMaterial.batch_id == batch_id)
                .order_by(ProductionBatchMaterial.id.asc())
            )
            .scalars()
            .all()
        )
        total_batch = _resolved_batch_utilized_count(batch)
        for material in materials:
            if material.total_quantity is not None:
                display_quantity = float(material.total_quantity or 0)
            else:
                display_quantity = calculate_rm_consumption_quantity(
                    material.quantity,
                    total_batch)
            setattr(material, "_report_quantity", display_quantity)

        plc_rows = (
            db.execute(
                select(PLCDataSnapshot)
                .where(
                    PLCDataSnapshot.recorded_at >= batch_start,
                    PLCDataSnapshot.recorded_at <= batch_end)
                .order_by(PLCDataSnapshot.recorded_at.asc())
            )
            .scalars()
            .all()
        )

        # ? ?? Dynamic Sampling using CEIL
        TARGET_ROWS = 500

        total_rows = len(plc_rows)

        if total_rows > TARGET_ROWS:
            step = math.ceil(total_rows / TARGET_ROWS)
            plc_rows = plc_rows[::step]

    headers = [
        "Date",
        "Batch No",
        "Product",
        "Batch Size",
        "MOP",
        "Water",
        "No. of Bags",
        "Weight/Bag",
        "Output",
        "Protein",
        "Fat",
        "Fiber",
        "Ash",
        "Calcium",
        "Phosphorus",
        "Salt",
        "Hardness",
        "Fines",
    ]

    data_rows = [(
        batch.date.strftime("%Y-%m-%d"),
        _display_batch_no(batch),
        batch.product_name,
        batch.batch_size,
        batch.mop or "",
        batch.water or "",
        batch.num_bags or "",
        batch.weight_per_bag or "",
        batch.output,
        report.protein or "",
        report.fat or "",
        report.fiber or "",
        report.ash or "",
        report.calcium or "",
        report.phosphorus or "",
        report.salt or "",
        report.hardness or "",
        report.fines or "")]

    filename = f"batch_{batch_id}_report"

    if file_format == "csv":
        return Response(
            export_table_to_csv(headers, data_rows),
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}.csv"})

    if file_format in ("excel", "xlsx"):
        return Response(
            export_batch_report_excel(headers, data_rows),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}.xlsx"})

    return Response(
        export_batch_report_pdf(
            batch,
            report,
            materials,
            plc_rows=plc_rows,  # ? Now optimized
            plc_start=batch_start,
            plc_end=batch_end),
        mimetype="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}.pdf"})

# Exports consumption report for one batch.

@production_bp.get("/<int:batch_id>/consumption/download")
def download_batch_consumption_report(batch_id: int):
    file_format = request.args.get("format", "pdf").lower()

    with db_session() as db:
        batch = (
            db.execute(
                select(ProductionBatch).where(
                    ProductionBatch.id == batch_id)
            )
            .scalars()
            .one_or_none()
        )
        if not batch:
            return error("Batch not found", 404)

        materials = (
            db.execute(
                select(ProductionBatchMaterial)
                .where(ProductionBatchMaterial.batch_id == batch_id)
                .order_by(ProductionBatchMaterial.id.asc())
            )
            .scalars()
            .all()
        )

    total_batch = resolve_effective_batch_run_count(
        batch_size=batch.batch_size,
        hmi_completed_count=batch.hmi_completed_count,
        hmi_status=batch.hmi_status,
        rm_shortage_flag=batch.rm_shortage_flag)
    consumption_rows: list[tuple] = []
    total_weight_per_batch = 0.0
    total_weight = 0.0

    for material in materials:
        weight_per_batch = float(material.quantity or 0)
        if material.total_quantity is not None:
            material_total_weight = float(material.total_quantity or 0)
        else:
            material_total_weight = calculate_rm_consumption_quantity(
                weight_per_batch,
                total_batch)
        total_weight_per_batch += weight_per_batch
        total_weight += material_total_weight
        consumption_rows.append(
            (
                material.rm_name,
                weight_per_batch,
                total_batch,
                material_total_weight)
        )

    consumption_rows.append(
        (
            "TOTAL",
            total_weight_per_batch,
            total_batch,
            total_weight)
    )

    batch_rows = [
        ("Date", batch.date.strftime("%Y-%m-%d") if batch.date else ""),
        ("Batch No", _display_batch_no(batch)),
        ("Product", batch.product_name or ""),
        ("Batch Count", total_batch),
        ("MOP", batch.mop if batch.mop is not None else ""),
        ("Water", batch.water if batch.water is not None else ""),
        ("No. of Bags", batch.num_bags if batch.num_bags is not None else ""),
        ("Weight/Bag (kg)", batch.weight_per_bag if batch.weight_per_bag is not None else ""),
        ("Total Output (kg)", batch.output if batch.output is not None else ""),
    ]

    sections = [
        {
            "title": "Batch Details",
            "sheet_name": "Batch Details",
            "headers": ["Field", "Value"],
            "rows": batch_rows,
        },
        {
            "title": "Consumption Details",
            "sheet_name": "Consumption",
            "headers": ["RM Name", "Weight/Batch (kg)", "Total Batch", "Total Weight (kg)"],
            "rows": consumption_rows,
        },
    ]

    filename = f"batch_{batch_id}_consumption_report"

    if file_format in ("excel", "xlsx"):
        return Response(
            export_batch_consumption_report_excel(sections),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}.xlsx"})

    return Response(
        export_batch_consumption_report_pdf(sections),
        mimetype="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}.pdf"})


