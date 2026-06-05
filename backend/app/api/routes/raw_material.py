# Raw material type, entry, lab report, and export routes.

from ..fastapi_compat import Blueprint, Response, jsonify, request
from sqlalchemy import func, or_, select

from ..common import (
        db_session,
    error,
    json_body,
    parse_datetime,
    parse_float,
    resolve_period_range,
    required,
    dt,
    serialize_raw_entry)
from app.models.config import RecipeMaterial
from app.models.production import ProductionBatchMaterial
from app.models.raw_material import RawMaterialEntry, RawMaterialLabReport, RawMaterialType
from ...services.id_codes import assign_raw_material_entry_code
from app.models.stock import RMStockLedger, RawMaterialStock
from ...services.stock import rebuild_rm_stock_ledger
from ...utils.timezone import app_now
from ...utils.export import (
    export_raw_material_entry_report_excel,
    export_raw_material_entry_report_pdf,
    export_raw_material_report_excel,
    export_raw_material_report_pdf,
    export_table_to_csv)

raw_material_bp = Blueprint("raw_material", __name__, url_prefix="/api/raw-material")

# Normalize a filter token and treat placeholders as empty.

def _normalize_filter_token(raw_value: str | None) -> str | None:
    value = str(raw_value or "").strip()
    if not value:
        return None
    if value.lower() in {"all", "any", "*", "none", "null"}:
        return None
    return value

# Normalize a raw material entry code for lookups and output.

def _normalize_entry_code(raw_value: object) -> str:
    return str(raw_value or "").strip().upper()

# Return a stable display code for a raw material entry.

def _serialize_entry_code(entry: RawMaterialEntry) -> str:
    if entry.entry_code:
        return _normalize_entry_code(entry.entry_code)
    return "RMX00000"

# Map lab report quality values to Good/Bad labels.

def _normalize_quality_grade(value: object) -> str | None:
    text = str(value or "").strip().lower()
    if not text:
        return None
    if text in {"good", "g", "1", "yes", "y", "true"}:
        return "Good"
    if text in {"bad", "b", "0", "no", "n", "false"}:
        return "Bad"
    return str(value).strip().title()

# Load a raw material entry by its display code.

def _load_raw_material_entry_by_code(db, entry_code: str) -> RawMaterialEntry | None:
    normalized_code = _normalize_entry_code(entry_code)
    return (
        db.execute(
            select(RawMaterialEntry).where(
                RawMaterialEntry.entry_code == normalized_code)
        )
        .scalars()
        .one_or_none()
    )

# Serialize a raw material lab report.

def _serialize_lab_report(report: RawMaterialLabReport) -> dict:
    entry_code = _normalize_entry_code(report.entry_code)
    return {
        "entry_code": entry_code,
        "protein": report.protein,
        "fat": report.fat,
        "fiber": report.fiber,
        "ash": report.ash,
        "calcium": report.calcium,
        "phosphorus": report.phosphorus,
        "salt": report.salt,
        "moisture": report.moisture,
        "fungus": report.fungus,
        "broke": report.broke,
        "water_damage": report.water_damage,
        "small": report.small,
        "dunkey": report.dunkey,
        "fm": report.fm,
        "maize_count": report.maize_count,
        "colour": report.colour,
        "smell": report.smell,
        "created_at": dt(report.created_at),
        "last_modified_at": dt(report.last_modified_at),
    }

# Return all raw material types.

@raw_material_bp.get("/types")
def list_rm_types():
    with db_session() as db:
        rows = (
            db.execute(select(RawMaterialType).order_by(RawMaterialType.name.asc()))
            .scalars()
            .all()
        )
    return jsonify(
        [
            {
                "id": row.id,
                "name": row.name,
                "created_at": dt(row.created_at),
                "last_modified_at": dt(row.last_modified_at),
            }
            for row in rows
        ]
    )

# Create a raw material type.

@raw_material_bp.post("/types")
def add_rm_type():
    name = request.args.get("name", "").strip()
    if not name:
        return error("RM type name is required")

    with db_session() as db:
        existing = (
            db.execute(
                select(RawMaterialType).where(func.lower(RawMaterialType.name) == name.lower())
            )
            .scalars()
            .one_or_none()
        )
        if existing:
            return error("RM type already exists")

        row = RawMaterialType(name=name)
        db.add(row)
        db.flush()
        return jsonify(
            {
                "id": row.id,
                "name": row.name,
                "created_at": dt(row.created_at),
                "last_modified_at": dt(row.last_modified_at),
            }
        )

# Rename a raw material type and cascade the name change.

@raw_material_bp.put("/types/<int:type_id>")
def update_rm_type(type_id: int):
    name = request.args.get("name", "").strip()
    if not name:
        return error("RM type name is required")

    with db_session() as db:
        row = db.get(RawMaterialType, type_id)
        if not row:
            return error("RM type not found", 404)

        existing = (
            db.execute(
                select(RawMaterialType).where(
                    func.lower(RawMaterialType.name) == name.lower(),
                    RawMaterialType.id != type_id)
            )
            .scalars()
            .one_or_none()
        )
        if existing:
            return error("RM type already exists")

        old_name = row.name
        row.name = name
        row.last_modified_at = app_now()

        recipe_rows = (
            db.execute(select(RecipeMaterial).where(func.lower(RecipeMaterial.rm_name) == old_name.lower()))
            .scalars()
            .all()
        )
        for item in recipe_rows:
            item.rm_name = name

        entry_rows = (
            db.execute(select(RawMaterialEntry).where(func.lower(RawMaterialEntry.rm_type) == old_name.lower()))
            .scalars()
            .all()
        )
        for item in entry_rows:
            item.rm_type = name

        batch_material_rows = (
            db.execute(
                select(ProductionBatchMaterial).where(
                    func.lower(ProductionBatchMaterial.rm_name) == old_name.lower()
                )
            )
            .scalars()
            .all()
        )
        for item in batch_material_rows:
            item.rm_name = name

        stock_rows = (
            db.execute(select(RMStockLedger).where(func.lower(RMStockLedger.rm_name) == old_name.lower()))
            .scalars()
            .all()
        )
        for item in stock_rows:
            item.rm_name = name

        current_stock_rows = (
            db.execute(select(RawMaterialStock).where(func.lower(RawMaterialStock.rm_name) == old_name.lower()))
            .scalars()
            .all()
        )
        for item in current_stock_rows:
            item.rm_name = name

        db.flush()
        return jsonify(
            {
                "id": row.id,
                "name": row.name,
                "created_at": dt(row.created_at),
                "last_modified_at": dt(row.last_modified_at),
            }
        )

# Delete a raw material type when it is not in use.

@raw_material_bp.delete("/types/<int:type_id>")
def delete_rm_type(type_id: int):
    with db_session() as db:
        row = db.get(RawMaterialType, type_id)
        if not row:
            return error("RM type not found", 404)

        in_use_recipe = (
            db.execute(select(RecipeMaterial).where(func.lower(RecipeMaterial.rm_name) == row.name.lower()))
            .scalars()
            .first()
            is not None
        )
        if in_use_recipe:
            return error("Cannot delete RM type because it is used in recipes. Edit recipes first.")

        db.delete(row)
        db.flush()
        return jsonify({"id": type_id, "deleted": True})

# Return raw material entries for the current client.

@raw_material_bp.get("")
def list_raw_material_entries():
    try:
        from_date = parse_datetime(request.args.get("from_date"), "from_date")
        to_date = parse_datetime(request.args.get("to_date"), "to_date")
    except ValueError as exc:
        return error(str(exc))
    rm_type = request.args.get("rm_type")

    with db_session() as db:
        query = select(RawMaterialEntry)
        if from_date:
            query = query.where(RawMaterialEntry.date >= from_date)
        if to_date:
            query = query.where(RawMaterialEntry.date <= to_date)
        if rm_type:
            query = query.where(RawMaterialEntry.rm_type == rm_type)
        query = query.order_by(RawMaterialEntry.date.desc())

        entries = db.execute(query).scalars().all()
        out = []
        for entry in entries:
            if not entry.entry_code:
                assign_raw_material_entry_code(db, entry)
            has_lab = (
                db.execute(
                    select(RawMaterialLabReport).where(RawMaterialLabReport.entry_code == _serialize_entry_code(entry))
                )
                .scalars()
                .one_or_none()
                is not None
            )
            out.append(serialize_raw_entry(entry, has_lab))
    return jsonify(out)

# Return raw material entries within a reporting period.

@raw_material_bp.get("/filtered/<period>/<path:rm_type>")
def list_raw_material_entries_by_period(period: str, rm_type: str):
    try:
        from_date, to_date = resolve_period_range(
            period,
            from_date_raw=request.args.get("from_date"),
            to_date_raw=request.args.get("to_date"))
    except ValueError as exc:
        return error(str(exc))
    normalized_rm_type = _normalize_filter_token(rm_type)

    with db_session() as db:
        query = select(RawMaterialEntry)
        query = query.where(RawMaterialEntry.date >= from_date)
        query = query.where(RawMaterialEntry.date <= to_date)
        if normalized_rm_type:
            query = query.where(RawMaterialEntry.rm_type == normalized_rm_type)
        query = query.order_by(RawMaterialEntry.date.desc())

        entries = db.execute(query).scalars().all()
        out = []
        for entry in entries:
            if not entry.entry_code:
                assign_raw_material_entry_code(db, entry)
            has_lab = (
                db.execute(
                    select(RawMaterialLabReport).where(
                        RawMaterialLabReport.entry_code == _serialize_entry_code(entry)
                    )
                )
                .scalars()
                .one_or_none()
                is not None
            )
            out.append(serialize_raw_entry(entry, has_lab))
    return jsonify(out)

# Return summary totals for raw material receipts and stock.

@raw_material_bp.get("/summary/<period>/<path:rm_type>")
def summarize_raw_material_by_period(period: str, rm_type: str):
    try:
        from_date, to_date = resolve_period_range(
            period,
            from_date_raw=request.args.get("from_date"),
            to_date_raw=request.args.get("to_date"))
    except ValueError as exc:
        return error(str(exc))
    normalized_rm_type = _normalize_filter_token(rm_type)

    with db_session() as db:
        entry_query = select(RawMaterialEntry).where(
            RawMaterialEntry.date >= from_date,
            RawMaterialEntry.date <= to_date)
        if normalized_rm_type:
            entry_query = entry_query.where(RawMaterialEntry.rm_type == normalized_rm_type)
        entry_rows = db.execute(entry_query).scalars().all()
        total_received_kg = sum(float(row.total_weight or 0) for row in entry_rows)

        stock_query = select(RawMaterialStock)
        if normalized_rm_type:
            stock_query = stock_query.where(RawMaterialStock.rm_name == normalized_rm_type)
        stock_rows = db.execute(stock_query).scalars().all()
        total_stock_kg = sum(float(row.quantity or 0) for row in stock_rows)

    return jsonify(
        {
            "period": str(period),
            "rm_type": normalized_rm_type or "all",
            "from_date": from_date.isoformat() + "Z",
            "to_date": to_date.isoformat() + "Z",
            "total_received_kg": total_received_kg,
            "total_stock_kg": total_stock_kg,
        }
    )

# Create a raw material entry and update live RM stock.

@raw_material_bp.post("")
def create_raw_material_entry():
    try:
        payload = json_body()
        date = parse_datetime(required(payload, "date"), "date")
        if date is None:
            raise ValueError("date is required")
        total_weight = parse_float(payload, "total_weight", required_field=True)
        if total_weight is None or total_weight <= 0:
            raise ValueError("total_weight must be greater than 0")
        entry = RawMaterialEntry(
            date=date,
            rm_type=required(payload, "rm_type"),
            supplier=required(payload, "supplier"),
            challan_no=required(payload, "challan_no"),
            vehicle_no=required(payload, "vehicle_no"),
            total_weight=total_weight,
            remarks=payload.get("remarks"))
    except ValueError as exc:
        return error(str(exc))

    try:
        with db_session() as db:
            db.add(entry)
            db.flush()
            assign_raw_material_entry_code(db, entry)
            db.flush()
            db.refresh(entry)
            # Rebuild after every insert so backdated entries cannot leave
            # future-day openings/current snapshot out of sync.
            rebuild_rm_stock_ledger(db=db)
            return jsonify(serialize_raw_entry(entry, has_lab=False))
    except ValueError as exc:
        return error(str(exc))

# Update a raw material entry and rebuild RM stock balances.

@raw_material_bp.put("/<entry_code>")
def update_raw_material_entry(entry_code: str):
    try:
        payload = json_body()
        date = parse_datetime(required(payload, "date"), "date")
        if date is None:
            raise ValueError("date is required")
        rm_type = required(payload, "rm_type")
        supplier = required(payload, "supplier")
        challan_no = required(payload, "challan_no")
        vehicle_no = required(payload, "vehicle_no")
        total_weight = parse_float(payload, "total_weight", required_field=True)
        if total_weight is None or total_weight <= 0:
            raise ValueError("total_weight must be greater than 0")
    except ValueError as exc:
        return error(str(exc))

    try:
        with db_session() as db:
            entry = _load_raw_material_entry_by_code(db, entry_code)
            if not entry:
                return error("Entry not found", 404)
            if not entry.entry_code:
                assign_raw_material_entry_code(db, entry)
                db.flush()

            entry.date = date
            entry.rm_type = rm_type
            entry.supplier = supplier
            entry.challan_no = challan_no
            entry.vehicle_no = vehicle_no
            entry.total_weight = total_weight
            entry.remarks = payload.get("remarks")
            entry.last_modified_at = app_now()
            db.flush()

            rebuild_rm_stock_ledger(db=db)

            has_lab = (
                db.execute(select(RawMaterialLabReport).where(RawMaterialLabReport.entry_code == _serialize_entry_code(entry)))
                .scalars()
                .one_or_none()
                is not None
            )
            return jsonify(serialize_raw_entry(entry, has_lab=has_lab))
    except ValueError as exc:
        return error(str(exc))

# Create or update a raw material lab report.

@raw_material_bp.post("/lab-report")
def submit_raw_material_lab_report():
    try:
        payload = json_body()
        entry_code = _normalize_entry_code(required(payload, "entry_code"))
    except (ValueError, TypeError) as exc:
        return error(str(exc))

    with db_session() as db:
        entry = _load_raw_material_entry_by_code(db, entry_code)
        if not entry:
            return error("Entry not found", 404)
        if not entry.entry_code:
            assign_raw_material_entry_code(db, entry)
            db.flush()

        report = (
            db.execute(select(RawMaterialLabReport).where(RawMaterialLabReport.entry_code == _serialize_entry_code(entry)))
            .scalars()
            .one_or_none()
        )
        is_new_report = report is None
        if not report:
            report = RawMaterialLabReport(entry_code=_serialize_entry_code(entry))
            db.add(report)

        report.protein = parse_float(payload, "protein")
        report.fat = parse_float(payload, "fat")
        report.fiber = parse_float(payload, "fiber")
        report.ash = parse_float(payload, "ash")
        report.calcium = parse_float(payload, "calcium")
        report.phosphorus = parse_float(payload, "phosphorus")
        report.salt = parse_float(payload, "salt")
        report.moisture = parse_float(payload, "moisture")
        report.fungus = payload.get("fungus")
        report.broke = payload.get("broke")
        report.water_damage = payload.get("water_damage")
        report.small = payload.get("small")
        report.dunkey = payload.get("dunkey")
        report.fm = payload.get("fm")
        report.maize_count = payload.get("maize_count")
        report.colour = _normalize_quality_grade(payload.get("colour"))
        report.smell = _normalize_quality_grade(payload.get("smell"))
        if not is_new_report:
            report.last_modified_at = app_now()
        db.flush()
        return jsonify({"entry_code": _serialize_entry_code(entry), "saved": True})

# Return the lab report for a raw material entry.

@raw_material_bp.get("/lab-report/<entry_code>")
def get_raw_material_lab_report(entry_code: str):
    with db_session() as db:
        entry = _load_raw_material_entry_by_code(db, entry_code)
        if not entry:
            return error("Entry not found", 404)
        if not entry.entry_code:
            assign_raw_material_entry_code(db, entry)
            db.flush()
        serialized_code = _serialize_entry_code(entry)

        report = (
            db.execute(select(RawMaterialLabReport).where(RawMaterialLabReport.entry_code == _serialize_entry_code(entry)))
            .scalars()
            .one_or_none()
        )
        if not report:
            return jsonify({"entry_code": serialized_code, "report": None})
        return jsonify({"entry_code": serialized_code, "report": _serialize_lab_report(report)})

# Download raw material entries as CSV, Excel, or PDF.

@raw_material_bp.get("/download")
def download_raw_material():
    try:
        from_date = parse_datetime(request.args.get("from_date"), "from_date")
        to_date = parse_datetime(request.args.get("to_date"), "to_date")
    except ValueError as exc:
        return error(str(exc))
    rm_type = str(request.args.get("rm_type") or "").strip()
    query_text = str(request.args.get("q") or "").strip()

    file_format = request.args.get("format", "pdf").lower()

    with db_session() as db:
        query = select(RawMaterialEntry)
        if from_date:
            query = query.where(RawMaterialEntry.date >= from_date)
        if to_date:
            query = query.where(RawMaterialEntry.date <= to_date)
        if rm_type:
            query = query.where(func.lower(RawMaterialEntry.rm_type) == rm_type.lower())
        if query_text:
            pattern = f"%{query_text}%"
            query = query.where(
                or_(
                    RawMaterialEntry.entry_code.ilike(pattern),
                    RawMaterialEntry.rm_type.ilike(pattern),
                    RawMaterialEntry.supplier.ilike(pattern),
                    RawMaterialEntry.vehicle_no.ilike(pattern),
                    RawMaterialEntry.challan_no.ilike(pattern))
            )
        query = query.order_by(RawMaterialEntry.date.desc())
        entries = db.execute(query).scalars().all()
        for row in entries:
            if not row.entry_code:
                assign_raw_material_entry_code(db, row)
        db.flush()

    headers = ["Entry Code", "Date", "RM Type", "Supplier", "Challan No", "Vehicle No", "Total Weight", "Remarks"]
    rows = [
        (
            _serialize_entry_code(row),
            row.date.strftime("%Y-%m-%d"),
            row.rm_type,
            row.supplier,
            row.challan_no,
            row.vehicle_no,
            row.total_weight,
            row.remarks or "")
        for row in entries
    ]

    if file_format == "csv":
        return Response(
            export_table_to_csv(headers, rows),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=raw_material_report.csv"})
    if file_format in ("excel", "xlsx"):
        return Response(
            export_raw_material_report_excel(headers, rows),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=raw_material_report.xlsx"})
    return Response(
        export_raw_material_report_pdf(headers, rows, date_column_index=1),
        mimetype="application/pdf",
        headers={"Content-Disposition": "attachment; filename=raw_material_report.pdf"})

# Download a single raw material entry report.

@raw_material_bp.get("/<entry_code>/download")
def download_raw_material_entry(entry_code: str):
    file_format = request.args.get("format", "pdf").lower()
    if file_format not in ("pdf", "excel", "xlsx"):
        return error("format must be one of: pdf, excel, xlsx")

    with db_session() as db:
        entry = _load_raw_material_entry_by_code(db, entry_code)
        if not entry:
            return error("Entry not found", 404)
        if not entry.entry_code:
            assign_raw_material_entry_code(db, entry)
            db.flush()
        serialized_code = _serialize_entry_code(entry)

        report = (
            db.execute(select(RawMaterialLabReport).where(RawMaterialLabReport.entry_code == _serialize_entry_code(entry)))
            .scalars()
            .one_or_none()
        )

    details_headers = ["Field", "Value"]
    details_rows = [
        ("Entry Code", serialized_code),
        ("Date", entry.date.strftime("%Y-%m-%d")),
        ("RM Type", entry.rm_type),
        ("Supplier", entry.supplier),
        ("Challan No", entry.challan_no),
        ("Vehicle No", entry.vehicle_no),
        ("Total Weight", entry.total_weight),
        ("Remarks", entry.remarks or ""),
        ("Created At", dt(entry.created_at) or ""),
        ("Last Modified At", dt(entry.last_modified_at) or ""),
    ]

    is_maize_entry = str(entry.rm_type or "").strip().lower() == "maize"
    if report:
        basic_lab_rows = [
            ("Protein", report.protein if report.protein is not None else ""),
            ("Fat", report.fat if report.fat is not None else ""),
            ("Fiber", report.fiber if report.fiber is not None else ""),
            ("Ash", report.ash if report.ash is not None else ""),
            ("Calcium", report.calcium if report.calcium is not None else ""),
            ("Phosphorus", report.phosphorus if report.phosphorus is not None else ""),
            ("Salt", report.salt if report.salt is not None else ""),
            ("Moisture", report.moisture if report.moisture is not None else ""),
        ]
        maize_only_lab_rows = [
            ("Fungus", report.fungus or ""),
            ("Broke", report.broke or ""),
            ("Water Damage", report.water_damage or ""),
            ("Small", report.small or ""),
            ("Dunkey", report.dunkey or ""),
            ("FM", report.fm or ""),
            ("Maize Count", report.maize_count or ""),
            ("Colour", report.colour or ""),
            ("Smell", report.smell or ""),
        ]
        lab_rows = basic_lab_rows + (maize_only_lab_rows if is_maize_entry else [])
    else:
        lab_rows = [("Lab Report", "Not available")]

    sections = [
        {
            "title": "Raw Material Entry Details",
            "headers": details_headers,
            "rows": details_rows,
            "sheet_name": "Entry Details",
        },
        {
            "title": "Lab Report",
            "headers": ["Parameter", "Value"],
            "rows": lab_rows,
            "sheet_name": "Lab Report",
        },
    ]

    filename = f"raw_material_entry_{serialized_code}_report"
    if file_format in ("excel", "xlsx"):
        return Response(
            export_raw_material_entry_report_excel(sections),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}.xlsx"})
    return Response(
        export_raw_material_entry_report_pdf(sections),
        mimetype="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}.pdf"})


