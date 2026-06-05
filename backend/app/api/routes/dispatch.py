# Dispatch entry routes and export handlers.

from ..fastapi_compat import Blueprint, Response, jsonify, request
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..common import (
        db_session,
    error,
    json_body,
    parse_datetime,
    parse_float,
    resolve_period_range,
    required,
    dt)
from app.models.config import ProductType
from app.models.dispatch import DispatchEntry, DispatchProduct
from app.models.stock import FeedStock
from ...services.id_codes import assign_dispatch_code
from ...services.stock import rebuild_feed_stock_ledger
from ...utils.timezone import app_now
from ...utils.export import (
    export_dispatch_entry_report_excel,
    export_dispatch_entry_report_pdf,
    export_dispatch_report_excel,
    export_dispatch_report_pdf,
    export_table_to_csv)
from ...utils.invoice import generate_invoice_pdf

dispatch_bp = Blueprint("dispatch", __name__, url_prefix="/api/dispatch")

# Normalize a filter token and treat placeholders as empty.

def _normalize_filter_token(raw_value: str | None) -> str | None:
    value = str(raw_value or "").strip()
    if not value:
        return None
    if value.lower() in {"all", "any", "*", "none", "null"}:
        return None
    return value

# Normalize a dispatch code for lookups and output.

def _normalize_dispatch_code(raw_value: object) -> str:
    return str(raw_value or "").strip().upper()

# Return a stable display code for a dispatch entry.

def _serialize_dispatch_code(entry: DispatchEntry) -> str:
    if entry.dispatch_code:
        return _normalize_dispatch_code(entry.dispatch_code)
    return "DPX00000"

# Load a dispatch entry by its display code.

def _load_dispatch_entry_by_code(db, dispatch_code: str, *, with_products: bool) -> DispatchEntry | None:
    normalized = _normalize_dispatch_code(dispatch_code)
    query = select(DispatchEntry)
    if with_products:
        query = query.options(selectinload(DispatchEntry.products))

    return (
        db.execute(query.where(DispatchEntry.dispatch_code == normalized))
        .scalars()
        .one_or_none()
    )

# Serialize a dispatch entry with its products.

def _serialize_dispatch(entry: DispatchEntry) -> dict:
    dispatch_code = _serialize_dispatch_code(entry)
    return {
        "dispatch_code": dispatch_code,
        "date": dt(entry.date),
        "party_name": entry.party_name,
        "party_phone": entry.party_phone or "",
        "party_address": entry.party_address or "",
        "pincode": entry.pincode or "",
        "vehicle_no": entry.vehicle_no,
        "price": entry.price,
        "created_at": dt(entry.created_at),
        "last_modified_at": dt(entry.last_modified_at),
        "products": [
            {
                "id": p.id,
                "product_type": p.product_type,
                "num_bags": p.num_bags,
                "weight_per_bag": p.weight_per_bag,
                "total_weight": p.total_weight,
            }
            for p in entry.products
        ],
        "total_bags": sum(p.num_bags for p in entry.products),
        "total_weight": sum(p.total_weight for p in entry.products),
    }

# Return dispatch entries for the current client.

@dispatch_bp.get("")
def list_dispatch_entries():
    try:
        from_date = parse_datetime(request.args.get("from_date"), "from_date")
        to_date = parse_datetime(request.args.get("to_date"), "to_date")
    except ValueError as exc:
        return error(str(exc))
    product_type = request.args.get("product_type")
    party_name = request.args.get("party_name")

    with db_session() as db:
        query = select(DispatchEntry).options(selectinload(DispatchEntry.products))
        if from_date:
            query = query.where(DispatchEntry.date >= from_date)
        if to_date:
            query = query.where(DispatchEntry.date <= to_date)
        if product_type:
            # Filter by any product in the entry
            query = query.join(DispatchProduct).where(DispatchProduct.product_type == product_type).distinct()
        if party_name:
            query = query.where(DispatchEntry.party_name.ilike(f"%{party_name}%"))
        query = query.order_by(DispatchEntry.date.desc())
        rows = db.execute(query).scalars().all()
        for row in rows:
            if not row.dispatch_code:
                assign_dispatch_code(db, row)
    return jsonify([_serialize_dispatch(row) for row in rows])

# Return dispatch entries within a reporting period.

@dispatch_bp.get("/filtered/<period>/<path:product_type>")
def list_dispatch_entries_by_period(period: str, product_type: str):
    try:
        from_date, to_date = resolve_period_range(
            period,
            from_date_raw=request.args.get("from_date"),
            to_date_raw=request.args.get("to_date"))
    except ValueError as exc:
        return error(str(exc))
    normalized_product_type = _normalize_filter_token(product_type)
    party_name = request.args.get("party_name")

    with db_session() as db:
        query = (
            select(DispatchEntry)
            .options(selectinload(DispatchEntry.products))
            
        )
        query = query.where(DispatchEntry.date >= from_date)
        query = query.where(DispatchEntry.date <= to_date)
        if normalized_product_type:
            query = (
                query.join(DispatchProduct)
                .where(DispatchProduct.product_type == normalized_product_type)
                .distinct()
            )
        if party_name:
            query = query.where(DispatchEntry.party_name.ilike(f"%{party_name}%"))
        query = query.order_by(DispatchEntry.date.desc())
        rows = db.execute(query).scalars().all()
        for row in rows:
            if not row.dispatch_code:
                assign_dispatch_code(db, row)
    return jsonify([_serialize_dispatch(row) for row in rows])

# Return summary totals for dispatched feed.

@dispatch_bp.get("/summary/<period>/<path:product_type>")
def summarize_dispatch_by_period(period: str, product_type: str):
    try:
        from_date, to_date = resolve_period_range(
            period,
            from_date_raw=request.args.get("from_date"),
            to_date_raw=request.args.get("to_date"))
    except ValueError as exc:
        return error(str(exc))
    normalized_product_type = _normalize_filter_token(product_type)

    with db_session() as db:
        dispatch_query = (
            select(DispatchEntry)
            .options(selectinload(DispatchEntry.products))
            .where(
                DispatchEntry.date >= from_date,
                DispatchEntry.date <= to_date)
        )
        if normalized_product_type:
            dispatch_query = (
                dispatch_query.join(DispatchProduct)
                .where(DispatchProduct.product_type == normalized_product_type)
                .distinct()
            )
        dispatch_rows = db.execute(dispatch_query).scalars().all()

        if normalized_product_type:
            total_dispatched_kg = sum(
                sum(
                    float(p.total_weight or 0)
                    for p in (row.products or [])
                    if (p.product_type or "").strip() == normalized_product_type
                )
                for row in dispatch_rows
            )
        else:
            total_dispatched_kg = sum(
                sum(float(p.total_weight or 0) for p in (row.products or []))
                for row in dispatch_rows
            )

        feed_query = select(FeedStock).where(
            FeedStock.date >= from_date,
            FeedStock.date <= to_date)
        if normalized_product_type:
            feed_query = feed_query.where(FeedStock.feed_type == normalized_product_type)
        feed_rows = db.execute(feed_query).scalars().all()
        total_finished_goods_kg = sum(float(row.produced or 0) for row in feed_rows)

    return jsonify(
        {
            "period": str(period),
            "product_type": normalized_product_type or "all",
            "from_date": from_date.isoformat() + "Z",
            "to_date": to_date.isoformat() + "Z",
            "total_finished_goods_kg": total_finished_goods_kg,
            "total_dispatched_kg": total_dispatched_kg,
        }
    )

# Validate and normalize dispatch product rows.

def _parse_dispatch_products(products: object) -> list[dict]:
    if not isinstance(products, list) or len(products) == 0:
        raise ValueError("products is required and must be a non-empty list")

    parsed: list[dict] = []
    for index, item in enumerate(products, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"products[{index}] must be an object")

        raw_id = item.get("id")
        product_id: int | None = None
        if raw_id not in (None, ""):
            try:
                product_id = int(raw_id)
            except (TypeError, ValueError):
                raise ValueError(f"products[{index}].id must be an integer")
            if product_id <= 0:
                raise ValueError(f"products[{index}].id must be greater than 0")

        product_type = str(item.get("product_type") or "").strip()
        if not product_type:
            raise ValueError(f"products[{index}].product_type is required")

        try:
            num_bags = float(item.get("num_bags") or 0)
        except (TypeError, ValueError):
            raise ValueError(f"products[{index}].num_bags must be a number")
        if num_bags <= 0:
            raise ValueError(f"products[{index}].num_bags must be greater than 0")

        try:
            weight_per_bag = float(item.get("weight_per_bag") or 0)
        except (TypeError, ValueError):
            raise ValueError(f"products[{index}].weight_per_bag must be a number")
        if weight_per_bag <= 0:
            raise ValueError(f"products[{index}].weight_per_bag must be greater than 0")

        total_weight = num_bags * weight_per_bag
        parsed.append({
            "id": product_id,
            "product_type": product_type,
            "num_bags": num_bags,
            "weight_per_bag": weight_per_bag,
            "total_weight": total_weight,
        })

    return parsed

# Create a dispatch entry and update feed stock.

@dispatch_bp.post("")
def create_dispatch_entry():
    try:
        payload = json_body()
        date = parse_datetime(required(payload, "date"), "date")
        if date is None:
            raise ValueError("date is required")
        party_name = required(payload, "party_name")
        party_phone = payload.get("party_phone", "").strip() or None
        party_address = payload.get("party_address", "").strip() or None
        pincode = payload.get("pincode", "").strip() or None
        vehicle_no = required(payload, "vehicle_no")
        products = _parse_dispatch_products(payload.get("products"))
        price = parse_float(payload, "price")
    except ValueError as exc:
        return error(str(exc))

    try:
        with db_session() as db:
            # Validate all product types exist
            for prod in products:
                product_type = (
                    db.execute(
                        select(ProductType).where(
                            ProductType.name == prod["product_type"]
                        )
                    )
                    .scalars()
                    .one_or_none()
                )
                if not product_type:
                    return error(f"Invalid product type: {prod['product_type']}")
                prod["product_type"] = (product_type.name or "").strip()

            entry = DispatchEntry(
                date=date,
                party_name=party_name,
                party_phone=party_phone,
                party_address=party_address,
                pincode=pincode,
                vehicle_no=vehicle_no,
                price=price)
            db.add(entry)
            db.flush()
            assign_dispatch_code(db, entry)
            db.flush()

            # Add products
            for prod in products:
                product = DispatchProduct(
                    dispatch_entry=entry,
                    product_type=prod["product_type"],
                    num_bags=prod["num_bags"],
                    weight_per_bag=prod["weight_per_bag"],
                    total_weight=prod["total_weight"])
                db.add(product)

            db.flush()
            # Rebuild from source transactions so backdated dispatch cannot
            # desynchronize later ledger openings or current stock.
            rebuild_feed_stock_ledger(db=db)
            entry = _load_dispatch_entry_by_code(
                db,
                _serialize_dispatch_code(entry),
                with_products=True)
            if not entry:
                return error("Dispatch entry not found after create", 500)
            return jsonify(_serialize_dispatch(entry))
    except ValueError as exc:
        return error(str(exc))

# Update a dispatch entry and rebuild feed stock.

@dispatch_bp.put("/<dispatch_code>")
def update_dispatch_entry(dispatch_code: str):
    try:
        payload = json_body()
        date = parse_datetime(required(payload, "date"), "date")
        if date is None:
            raise ValueError("date is required")
        party_name = required(payload, "party_name")
        party_phone = payload.get("party_phone", "").strip() or None
        party_address = payload.get("party_address", "").strip() or None
        pincode = payload.get("pincode", "").strip() or None
        vehicle_no = required(payload, "vehicle_no")
        products = _parse_dispatch_products(payload.get("products"))
        price = parse_float(payload, "price")
    except ValueError as exc:
        return error(str(exc))

    try:
        with db_session() as db:
            entry = (
                _load_dispatch_entry_by_code(
                    db,
                    dispatch_code,
                    with_products=True)
            )
            if not entry:
                return error("Dispatch entry not found", 404)
            if not entry.dispatch_code:
                assign_dispatch_code(db, entry)
                db.flush()

            # Validate all product types exist
            for prod in products:
                product_type = (
                    db.execute(
                        select(ProductType).where(
                            ProductType.name == prod["product_type"]
                        )
                    )
                    .scalars()
                    .one_or_none()
                )
                if not product_type:
                    return error(f"Invalid product type: {prod['product_type']}")
                prod["product_type"] = (product_type.name or "").strip()

            # Update entry
            entry.date = date
            entry.party_name = party_name
            entry.party_phone = party_phone
            entry.party_address = party_address
            entry.pincode = pincode
            entry.vehicle_no = vehicle_no
            entry.price = price
            entry.last_modified_at = app_now()

            # Update products in-place to preserve IDs whenever possible.
            existing_products = sorted(list(entry.products), key=lambda row: row.id)
            existing_by_id = {row.id: row for row in existing_products}
            used_existing_ids: set[int] = set()

            for index, prod in enumerate(products):
                target_row: DispatchProduct | None = None
                incoming_id = prod.get("id")
                if isinstance(incoming_id, int):
                    candidate = existing_by_id.get(incoming_id)
                    if candidate is not None and candidate.id not in used_existing_ids:
                        target_row = candidate

                if target_row is None and index < len(existing_products):
                    candidate = existing_products[index]
                    if candidate.id not in used_existing_ids:
                        target_row = candidate

                if target_row is None:
                    for candidate in existing_products:
                        if candidate.id in used_existing_ids:
                            continue
                        target_row = candidate
                        break

                if target_row is None:
                    target_row = DispatchProduct(dispatch_entry=entry)
                    db.add(target_row)
                else:
                    used_existing_ids.add(target_row.id)

                target_row.product_type = prod["product_type"]
                target_row.num_bags = prod["num_bags"]
                target_row.weight_per_bag = prod["weight_per_bag"]
                target_row.total_weight = prod["total_weight"]

            for product in existing_products:
                if product.id in used_existing_ids:
                    continue
                db.delete(product)

            db.flush()
            rebuild_feed_stock_ledger(db=db)
            entry = _load_dispatch_entry_by_code(
                db,
                _serialize_dispatch_code(entry),
                with_products=True)
            if not entry:
                return error("Dispatch entry not found after update", 500)
            return jsonify(_serialize_dispatch(entry))
    except ValueError as exc:
        return error(str(exc))

# Delete a dispatch entry and rebuild feed stock.

@dispatch_bp.delete("/<dispatch_code>")
def delete_dispatch_entry(dispatch_code: str):
    with db_session() as db:
        entry = _load_dispatch_entry_by_code(db, dispatch_code, with_products=False)
        if not entry:
            return error("Dispatch entry not found", 404)

        serialized_code = _serialize_dispatch_code(entry)
        db.delete(entry)
        db.flush()
        rebuild_feed_stock_ledger(db=db)
        return jsonify({"dispatch_code": serialized_code, "deleted": True})

# Download dispatch entries as CSV, Excel, or PDF.

@dispatch_bp.get("/download")
def download_dispatch():
    try:
        from_date = parse_datetime(request.args.get("from_date"), "from_date")
        to_date = parse_datetime(request.args.get("to_date"), "to_date")
    except ValueError as exc:
        return error(str(exc))

    product_type = request.args.get("product_type")
    file_format = request.args.get("format", "pdf").lower()

    with db_session() as db:
        query = select(DispatchEntry).options(selectinload(DispatchEntry.products))
        if from_date:
            query = query.where(DispatchEntry.date >= from_date)
        if to_date:
            query = query.where(DispatchEntry.date <= to_date)
        if product_type:
            query = query.join(DispatchProduct).where(DispatchProduct.product_type == product_type).distinct()
        query = query.order_by(DispatchEntry.date.desc())
        rows = db.execute(query).scalars().all()
        for row in rows:
            if not row.dispatch_code:
                assign_dispatch_code(db, row)

    headers = ["Dispatch Code", "Date", "Party Name", "Vehicle No", "Product Type", "Num Bags", "Weight Per Bag", "Total Weight", "Price"]
    data_rows = []
    for row in rows:
        dispatch_code = _serialize_dispatch_code(row)
        for product in row.products:
            data_rows.append((
                dispatch_code,
                row.date.strftime("%Y-%m-%d"),
                row.party_name,
                row.vehicle_no,
                product.product_type,
                product.num_bags,
                product.weight_per_bag,
                product.total_weight,
                row.price or ""))

    if file_format == "csv":
        return Response(
            export_table_to_csv(headers, data_rows),
            mimetype="text/csv",
            headers={"Content-Disposition": "attachment; filename=dispatch_report.csv"})
    if file_format in ("excel", "xlsx"):
        return Response(
            export_dispatch_report_excel(headers, data_rows),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=dispatch_report.xlsx"})
    return Response(
        export_dispatch_report_pdf(headers, data_rows, date_column_index=1),
        mimetype="application/pdf",
        headers={"Content-Disposition": "attachment; filename=dispatch_report.pdf"})

# Download a single dispatch entry report.

@dispatch_bp.get("/<dispatch_code>/download")
def download_single_dispatch_entry(dispatch_code: str):
    file_format = request.args.get("format", "pdf").lower()

    with db_session() as db:
        row = _load_dispatch_entry_by_code(db, dispatch_code, with_products=True)

    if not row:
        return error("Dispatch entry not found", 404)

    headers = ["Dispatch Code", "Date", "Party Name", "Vehicle No", "Product Type", "Num Bags", "Weight Per Bag", "Total Weight", "Price"]
    data_rows = []
    total_bags = 0.0
    total_weight = 0.0
    serialized_code = _serialize_dispatch_code(row)
    for product in row.products:
        total_bags += float(product.num_bags or 0)
        total_weight += float(product.total_weight or 0)
        data_rows.append((
            serialized_code,
            row.date.strftime("%Y-%m-%d"),
            row.party_name,
            row.vehicle_no,
            product.product_type,
            product.num_bags,
            product.weight_per_bag,
            product.total_weight,
            row.price or ""))
    total_amount = (total_weight * float(row.price)) if row.price is not None else ""
    data_rows.append((
        "",
        "",
        "",
        "",
        "TOTAL",
        total_bags,
        "",
        total_weight,
        total_amount))

    filename = f"dispatch_{serialized_code}_report"

    if file_format == "csv":
        return Response(
            export_table_to_csv(headers, data_rows),
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}.csv"})
    if file_format in ("excel", "xlsx"):
        return Response(
            export_dispatch_entry_report_excel(headers, data_rows),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}.xlsx"})
    return Response(
        export_dispatch_entry_report_pdf(headers, data_rows),
        mimetype="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}.pdf"})

# Download an invoice PDF for a dispatch entry.

@dispatch_bp.get("/<dispatch_code>/invoice")
def download_invoice(dispatch_code: str):
    with db_session() as db:
        entry = _load_dispatch_entry_by_code(db, dispatch_code, with_products=True)
    
    if not entry:
        return error("Dispatch entry not found", 404)
    
    try:
        dispatch_code = _serialize_dispatch_code(entry)
        pdf_buffer = generate_invoice_pdf(entry, entry.products)
        return Response(
            pdf_buffer.getvalue(),
            mimetype="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=invoice_{dispatch_code}.pdf"})
    except Exception as exc:
        return error(f"Failed to generate invoice: {str(exc)}")


