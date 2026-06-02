# Current-stock, ledger, and report download routes.


from ..fastapi_compat import Blueprint, Response, jsonify, request
from sqlalchemy import select

from ..common import (
        db_session,
    dt,
    error,
    parse_datetime,
    resolve_period_range)
from app.models.config import ProductType
from app.models.raw_material import RawMaterialType
from app.models.stock import FeedStock, FeedStockCurrent, RMStockLedger, RawMaterialStock
from ...utils.export import (
    export_feed_individual_stock_report_excel,
    export_feed_individual_stock_report_pdf,
    export_feed_stock_report_excel,
    export_feed_stock_report_pdf,
    export_overall_stock_report_excel,
    export_overall_stock_report_pdf,
    export_rm_individual_stock_report_excel,
    export_rm_individual_stock_report_pdf,
    export_rm_stock_report_excel,
    export_rm_stock_report_pdf,
    export_table_to_csv)

stock_bp = Blueprint("stock", __name__, url_prefix="/api/stock")


# Convert grams to kilograms for display.

def _bag_weight_kg(bag_weight_grams: int | None) -> float | None:
    if bag_weight_grams in (None, 0):
        return None
    return round(float(bag_weight_grams) / 1000.0, 3)


# Build a readable feed variant label.

def _feed_variant_name(feed_type: str, bag_weight_grams: int | None) -> str:
    bag_kg = _bag_weight_kg(bag_weight_grams)
    if bag_kg is None:
        return feed_type
    return f"{feed_type} ({bag_kg:g}kg/bag)"


# Normalize common stock period aliases.

def _normalize_stock_period(period: str | None) -> str:
    normalized = str(period or "").strip().lower()
    if normalized == "last_7_days":
        return "last_7"
    if normalized == "last_15_days":
        return "last_15"
    if normalized == "last_30_days":
        return "last_30"
    return normalized


# Build the current raw material stock payload.

def _current_rm_stock_payload(db) -> list[dict]:
    rm_types = (
        db.execute(select(RawMaterialType).order_by(RawMaterialType.name.asc()))
        .scalars()
        .all()
    )
    current_rows = (
        db.execute(
            select(RawMaterialStock)
            
            .order_by(
                RawMaterialStock.rm_name.asc(),
                RawMaterialStock.last_modified_at.desc().nullslast(),
                RawMaterialStock.id.desc())
        )
        .scalars()
        .all()
    )

    latest_by_name: dict[str, RawMaterialStock] = {}
    for row in current_rows:
        key = str(row.rm_name or "").strip()
        if not key or key in latest_by_name:
            continue
        latest_by_name[key] = row

    ordered_names = [item.name for item in rm_types]
    known_names = set(ordered_names)
    for rm_name in latest_by_name:
        if rm_name not in known_names:
            ordered_names.append(rm_name)

    payload = []
    for name in ordered_names:
        row = latest_by_name.get(name)
        quantity = float(row.quantity or 0) if row else 0
        payload.append(
            {
                "date": dt(row.last_modified_at or row.created_at) if row else None,
                "rm_name": name,
                "quantity": quantity,
                "closing_stock": quantity,
                "opening_stock": 0,
                "received": 0,
                "consumption": 0,
            }
        )
    return payload


# Build the current feed stock payload.

def _current_feed_stock_payload(db) -> list[dict]:
    feed_types = (
        db.execute(select(ProductType).order_by(ProductType.name.asc()))
        .scalars()
        .all()
    )
    current_rows = (
        db.execute(
            select(FeedStockCurrent)
            
            .order_by(
                FeedStockCurrent.feed_type.asc(),
                FeedStockCurrent.bag_weight_grams.asc(),
                FeedStockCurrent.last_modified_at.desc().nullslast(),
                FeedStockCurrent.id.desc())
        )
        .scalars()
        .all()
    )

    latest_by_variant: dict[tuple[str, int | None], FeedStockCurrent] = {}
    for row in current_rows:
        feed_type = str(row.feed_type or "").strip()
        if not feed_type:
            continue
        key = (feed_type, row.bag_weight_grams)
        if key in latest_by_variant:
            continue
        latest_by_variant[key] = row

    ordered_feed_types = [item.name for item in feed_types]
    known_feed_types = set(ordered_feed_types)
    present_feed_types: set[str] = set()

    payload = []
    for (feed_type, bag_weight_grams), row in latest_by_variant.items():
        quantity = float(row.quantity or 0)
        present_feed_types.add(feed_type)
        if feed_type not in known_feed_types:
            ordered_feed_types.append(feed_type)
            known_feed_types.add(feed_type)
        payload.append(
            {
                "date": dt(row.last_modified_at or row.created_at) if row else None,
                "feed_type": feed_type,
                "bag_weight_kg": _bag_weight_kg(bag_weight_grams),
                "feed_variant": _feed_variant_name(feed_type, bag_weight_grams),
                "quantity": quantity,
                "closing_stock": quantity,
            }
        )

    for feed_type in ordered_feed_types:
        if feed_type in present_feed_types:
            continue
        payload.append(
            {
                "date": None,
                "feed_type": feed_type,
                "bag_weight_kg": None,
                "feed_variant": _feed_variant_name(feed_type, None),
                "quantity": 0.0,
                "closing_stock": 0.0,
            }
        )
    return payload


# Return the live raw material stock snapshot.

@stock_bp.get("/rm")
def get_rm_stock():
    with db_session() as db:
        return jsonify(_current_rm_stock_payload(db))


# Return raw material ledger rows for a period.

@stock_bp.get("/rm/filtered/<period>")
def get_rm_stock_by_period(period: str):
    try:
        from_date, to_date = resolve_period_range(
            _normalize_stock_period(period),
            from_date_raw=request.args.get("from_date"),
            to_date_raw=request.args.get("to_date"))
    except ValueError as exc:
        return error(str(exc))

    with db_session() as db:
        rows = (
            db.execute(
                select(RMStockLedger)
                
                .where(RMStockLedger.date >= from_date)
                .where(RMStockLedger.date <= to_date)
                .order_by(RMStockLedger.date.desc(), RMStockLedger.id.desc())
            )
            .scalars()
            .all()
        )
    return jsonify(
        [
            {
                "date": dt(row.date),
                "rm_name": row.rm_name,
                "opening_stock": row.opening_stock,
                "received": row.received,
                "consumption": row.consumption,
                "closing_stock": row.closing_stock,
            }
            for row in rows
        ]
    )


# Return the current raw material summary.

@stock_bp.get("/rm/summary")
def rm_summary():
    with db_session() as db:
        payload = _current_rm_stock_payload(db)
    return jsonify(
        [{"rm_name": row["rm_name"], "quantity": row["quantity"]} for row in payload]
    )


# Return the live feed stock snapshot.

@stock_bp.get("/feed")
def get_feed_stock():
    with db_session() as db:
        return jsonify(_current_feed_stock_payload(db))


# Return feed ledger rows for a period.

@stock_bp.get("/feed/filtered/<period>")
def get_feed_stock_by_period(period: str):
    try:
        from_date, to_date = resolve_period_range(
            _normalize_stock_period(period),
            from_date_raw=request.args.get("from_date"),
            to_date_raw=request.args.get("to_date"))
    except ValueError as exc:
        return error(str(exc))

    with db_session() as db:
        rows = (
            db.execute(
                select(FeedStock)
                
                .where(FeedStock.date >= from_date)
                .where(FeedStock.date <= to_date)
                .order_by(FeedStock.date.desc(), FeedStock.id.desc())
            )
            .scalars()
            .all()
        )
    return jsonify(
        [
            {
                "date": dt(row.date),
                "feed_type": row.feed_type,
                "bag_weight_kg": _bag_weight_kg(row.bag_weight_grams),
                "feed_variant": _feed_variant_name(row.feed_type, row.bag_weight_grams),
                "opening_stock": row.opening_stock,
                "produced": row.produced,
                "dispatched": row.dispatched,
                "closing_stock": row.closing_stock,
            }
            for row in rows
        ]
    )


# Return the current feed summary.

@stock_bp.get("/feed/summary")
def feed_summary():
    with db_session() as db:
        return jsonify(_current_feed_stock_payload(db))


# Download raw material stock history.

@stock_bp.get("/download/rm")
def download_rm_stock():
    try:
        from_date = parse_datetime(request.args.get("from_date"), "from_date")
        to_date = parse_datetime(request.args.get("to_date"), "to_date")
    except ValueError as exc:
        return error(str(exc))

    if from_date and to_date and from_date > to_date:
        return error("from_date cannot be after to_date")

    file_format = request.args.get("format", "pdf").lower()
    with db_session() as db:
        query = select(RMStockLedger)
        if from_date:
            query = query.where(RMStockLedger.date >= from_date)
        if to_date:
            query = query.where(RMStockLedger.date <= to_date)
        rows = db.execute(query.order_by(RMStockLedger.date.desc())).scalars().all()

    headers = ["Date", "RM Name", "Opening", "Received", "Consumption", "Closing"]
    data_rows = [
        (
            row.date.strftime("%Y-%m-%d"),
            row.rm_name,
            row.opening_stock,
            row.received,
            row.consumption,
            row.closing_stock)
        for row in rows
    ]

    if file_format == "csv":
        return Response(
            export_table_to_csv(headers, data_rows),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=rm_stock.csv"})
    if file_format in ("excel", "xlsx"):
        return Response(
            export_rm_stock_report_excel(headers, data_rows),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=rm_stock.xlsx"})
    return Response(
        export_rm_stock_report_pdf(headers, data_rows),
        mimetype="application/pdf",
        headers={"Content-Disposition": "attachment; filename=rm_stock.pdf"})


# Download the raw material stock summary.

@stock_bp.get("/download/rm-summary")
def download_rm_stock_summary():
    file_format = request.args.get("format", "pdf").lower()

    with db_session() as db:
        payload = _current_rm_stock_payload(db)

    headers = ["RM Type", "Current Stock (kg)"]
    data_rows = [(row["rm_name"], row["quantity"]) for row in payload]

    if file_format == "csv":
        return Response(
            export_table_to_csv(headers, data_rows),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=rm_individual_stock.csv"})
    if file_format in ("excel", "xlsx"):
        return Response(
            export_rm_individual_stock_report_excel(headers, data_rows),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=rm_individual_stock.xlsx"})
    return Response(
        export_rm_individual_stock_report_pdf(headers, data_rows),
        mimetype="application/pdf",
        headers={"Content-Disposition": "attachment; filename=rm_individual_stock.pdf"})


# Download the feed stock summary.

@stock_bp.get("/download/feed-summary")
def download_feed_stock_summary():
    file_format = request.args.get("format", "pdf").lower()

    with db_session() as db:
        rows = _current_feed_stock_payload(db)

    grouped: dict[str, dict] = {}
    for row in rows:
        feed_name = str(row.get("feed_type") or "").strip()
        if not feed_name:
            continue
        qty = float(row.get("quantity") or 0)
        bag_kg = row.get("bag_weight_kg")

        if feed_name not in grouped:
            grouped[feed_name] = {"total": 0.0, "mix": []}
        grouped[feed_name]["total"] += qty
        if bag_kg is not None and bag_kg > 0:
            grouped[feed_name]["mix"].append((bag_kg, qty))

    # Format bag-size-wise quantity splits into a compact report label.

    def _mix_label(mix_rows: list[tuple[float, float]]) -> str:
        if not mix_rows:
            return "N/A"
        chunks: list[str] = []
        for bag_kg, qty in sorted(mix_rows, key=lambda item: item[0]):
            bags = qty / bag_kg if bag_kg > 0 else 0.0
            chunks.append(f"{bag_kg:g}kg: {bags:.2f} bags ({qty:.2f} kg)")
        return " | ".join(chunks)

    headers = ["Feed Type", "Bag Size Mix", "Available Stock (kg)"]
    data_rows = [
        (
            feed_name,
            _mix_label(grouped[feed_name]["mix"]),
            round(float(grouped[feed_name]["total"]), 3))
        for feed_name in sorted(grouped.keys())
    ]

    if file_format == "csv":
        return Response(
            export_table_to_csv(headers, data_rows),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=feed_individual_stock.csv"})
    if file_format in ("excel", "xlsx"):
        return Response(
            export_feed_individual_stock_report_excel(headers, data_rows),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=feed_individual_stock.xlsx"})
    return Response(
        export_feed_individual_stock_report_pdf(headers, data_rows),
        mimetype="application/pdf",
        headers={"Content-Disposition": "attachment; filename=feed_individual_stock.pdf"})


# Download feed stock history.

@stock_bp.get("/download/feed")
def download_feed_stock():
    try:
        from_date = parse_datetime(request.args.get("from_date"), "from_date")
        to_date = parse_datetime(request.args.get("to_date"), "to_date")
    except ValueError as exc:
        return error(str(exc))

    if from_date and to_date and from_date > to_date:
        return error("from_date cannot be after to_date")

    file_format = request.args.get("format", "pdf").lower()
    with db_session() as db:
        query = select(FeedStock)
        if from_date:
            query = query.where(FeedStock.date >= from_date)
        if to_date:
            query = query.where(FeedStock.date <= to_date)
        rows = db.execute(query.order_by(FeedStock.date.desc())).scalars().all()

    headers = ["Date", "Feed Type", "Bag Weight (kg)", "Variant", "Opening", "Produced", "Dispatched", "Closing"]
    data_rows = [
        (
            row.date.strftime("%Y-%m-%d"),
            row.feed_type,
            _bag_weight_kg(row.bag_weight_grams) or "",
            _feed_variant_name(row.feed_type, row.bag_weight_grams),
            row.opening_stock,
            row.produced,
            row.dispatched,
            row.closing_stock)
        for row in rows
    ]

    if file_format == "csv":
        return Response(
            export_table_to_csv(headers, data_rows),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=feed_stock.csv"})
    if file_format in ("excel", "xlsx"):
        return Response(
            export_feed_stock_report_excel(headers, data_rows),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=feed_stock.xlsx"})
    return Response(
        export_feed_stock_report_pdf(headers, data_rows),
        mimetype="application/pdf",
        headers={"Content-Disposition": "attachment; filename=feed_stock.pdf"})


# Download a combined raw material and feed stock report.

@stock_bp.get("/download/overall")
def download_overall_stock():
    file_format = request.args.get("format", "pdf").lower()
    if file_format not in ("pdf", "excel", "xlsx"):
        return error("format must be one of: pdf, excel, xlsx")

    with db_session() as db:
        rm_payload = _current_rm_stock_payload(db)
        feed_payload = _current_feed_stock_payload(db)

    rm_headers = ["RM Type", "Available Stock (kg)"]
    rm_data_rows = [(row["rm_name"], row["closing_stock"]) for row in rm_payload]

    feed_available_by_type: dict[str, float] = {}
    for row in feed_payload:
        normalized_feed_type = str(row.get("feed_type") or "").strip()
        if not normalized_feed_type:
            continue
        feed_available_by_type[normalized_feed_type] = (
            feed_available_by_type.get(normalized_feed_type, 0.0) + float(row.get("quantity") or 0)
        )

    feed_headers = ["Feed Type", "Available Stock (kg)"]
    feed_data_rows = [
        (feed_type, round(feed_available_by_type[feed_type], 3))
        for feed_type in sorted(feed_available_by_type.keys())
    ]

    sections = [
        {
            "title": "Raw Material Available Stock",
            "headers": rm_headers,
            "rows": rm_data_rows,
            "sheet_name": "RM Available",
        },
        {
            "title": "Feed Available Stock",
            "headers": feed_headers,
            "rows": feed_data_rows,
            "sheet_name": "Feed Available",
        },
    ]

    if file_format in ("excel", "xlsx"):
        return Response(
            export_overall_stock_report_excel(sections),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=overall_stock_report.xlsx"})
    return Response(
        export_overall_stock_report_pdf(sections),
        mimetype="application/pdf",
        headers={"Content-Disposition": "attachment; filename=overall_stock_report.pdf"})

