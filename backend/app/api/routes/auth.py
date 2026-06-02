# Authentication and PIN management routes.


import re

from ..fastapi_compat import Blueprint, jsonify
from sqlalchemy import select

from ..common import (
    current_user,
    db_session,
    error,
    json_body,
    required,
    serialize_user,
    token_response,
)
from app.models.user import User, UserRole
from ...services.auth import (
    get_user_by_email,
    hash_password,
    is_password_hashed,
    verify_password,
)

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")
PIN_RE = re.compile(r"^\d{4}$")
PIN_TYPE_FIELD_MAP = {
    "settings": "settings_pin_hash",
    "rm_entry_edit": "pin_rm_entry_edit_hash",
    "rm_lab_edit": "pin_rm_lab_edit_hash",
    "dispatch_edit": "pin_dispatch_edit_hash",
    "production_details_edit": "pin_production_details_edit_hash",
    "production_report_access": "pin_production_report_access_hash",
    "recipe_access": "pin_recipe_access_hash",
}
DEFAULT_PIN = "1234"


def _build_default_pin_hashes() -> dict[str, str]:
    return {
        "settings_pin_hash": hash_password(DEFAULT_PIN),
        "pin_rm_entry_edit_hash": hash_password(DEFAULT_PIN),
        "pin_rm_lab_edit_hash": hash_password(DEFAULT_PIN),
        "pin_dispatch_edit_hash": hash_password(DEFAULT_PIN),
        "pin_production_details_edit_hash": hash_password(DEFAULT_PIN),
        "pin_production_report_access_hash": hash_password(DEFAULT_PIN),
        "pin_recipe_access_hash": hash_password(DEFAULT_PIN),
    }


def _upgrade_user_pin_hashes(user: User) -> bool:
    changed = False
    for pin_field in PIN_TYPE_FIELD_MAP.values():
        stored_pin_value = str(getattr(user, pin_field, "") or "").strip()
        if not stored_pin_value:
            setattr(user, pin_field, hash_password(DEFAULT_PIN))
            changed = True
            continue
        if not is_password_hashed(stored_pin_value):
            setattr(user, pin_field, hash_password(stored_pin_value))
            changed = True
    return changed


# Normalize a PIN scope value into one of the supported types.

def _normalize_pin_type(raw_value: object) -> str:
    pin_type = str(raw_value or "settings").strip().lower()
    if not pin_type:
        pin_type = "settings"
    if pin_type not in PIN_TYPE_FIELD_MAP:
        raise ValueError(
            "pin_type must be one of: "
            + ", ".join(sorted(PIN_TYPE_FIELD_MAP.keys()))
        )
    return pin_type


# Resolve the user whose PIN should be checked or updated.

def _resolve_pin_user(db):
    try:
        return current_user(db)
    except PermissionError:
        return (
            db.execute(select(User).where(User.is_active.is_(True)).order_by(User.id.asc()))
            .scalars()
            .one_or_none()
        )


# Authenticate a user and return an access token.

@auth_bp.post("/login")
def auth_login():
    try:
        payload = json_body()
        email = required(payload, "email")
        password = required(payload, "password")
    except ValueError as exc:
        return error(str(exc))

    with db_session() as db:
        user = get_user_by_email(db, email)
        if not user or not verify_password(password, user.password):
            return error("Invalid email or password", 401)
        if not user.is_active:
            return error("Account disabled", 401)
        should_flush = False
        # Upgrade legacy/plain passwords to current hashed format after successful auth.
        if not is_password_hashed(user.password):
            user.password = hash_password(password)
            should_flush = True
        if _upgrade_user_pin_hashes(user):
            should_flush = True
        if should_flush:
            db.flush()
        return jsonify(token_response(user))


# Create a vendor account.

@auth_bp.post("/vendor-signup")
def vendor_signup():
    try:
        payload = json_body()
        email = required(payload, "email")
        password = required(payload, "password")
        full_name = required(payload, "full_name")
    except ValueError as exc:
        return error(str(exc))

    with db_session() as db:
        existing = get_user_by_email(db, email)
        if existing:
            return error("Email already registered")

        user = User(
            email=email,
            password=hash_password(password),
            **_build_default_pin_hashes(),
            full_name=full_name,
            role=UserRole.vendor.value,
            company_name=payload.get("company_name"),
            phone=payload.get("phone"),
            address=payload.get("address"))
        db.add(user)
        db.flush()
        db.refresh(user)
        return jsonify(serialize_user(user))


# Create a customer account on behalf of the current vendor.

@auth_bp.post("/vendor/customer-signup")
def vendor_create_customer():
    try:
        payload = json_body()
        email = required(payload, "email")
        password = required(payload, "password")
        full_name = required(payload, "full_name")
    except ValueError as exc:
        return error(str(exc))

    with db_session() as db:
        try:
            vendor = current_user(db)
        except PermissionError as exc:
            return error(str(exc), 401)
        if vendor.role != UserRole.vendor.value:
            return error("Vendor role required", 403)

        existing = get_user_by_email(db, email)
        if existing:
            return error("Email already registered")

        user = User(
            email=email,
            password=hash_password(password),
            **_build_default_pin_hashes(),
            full_name=full_name,
            role=UserRole.customer.value,
            company_name=payload.get("company_name"),
            phone=payload.get("phone"),
            address=payload.get("address"),
            created_by_id=vendor.id)
        db.add(user)
        db.flush()
        db.refresh(user)
        return jsonify(serialize_user(user))


@auth_bp.get("/profile")
def get_profile():
    with db_session() as db:
        try:
            user = current_user(db)
        except PermissionError as exc:
            return error(str(exc), 401)
        return jsonify(serialize_user(user))


@auth_bp.put("/profile")
def update_profile():
    try:
        payload = json_body()
    except ValueError as exc:
        return error(str(exc))

    with db_session() as db:
        try:
            user = current_user(db)
        except PermissionError as exc:
            return error(str(exc), 401)

        next_full_name = str(payload.get("full_name", user.full_name) or "").strip()
        next_company_name = payload.get("company_name")
        next_phone = payload.get("phone")
        next_address = payload.get("address")

        if not next_full_name:
            return error("full_name is required")

        if "email" in payload:
            next_email = str(payload.get("email") or "").strip().lower()
            if not next_email:
                return error("email is required")
            existing = db.execute(
                select(User).where(User.email == next_email, User.id != user.id)
            ).scalars().one_or_none()
            if existing:
                return error("Email already registered")
            user.email = next_email

        user.full_name = next_full_name
        user.company_name = str(next_company_name).strip() if next_company_name is not None else None
        user.phone = str(next_phone).strip() if next_phone is not None else None
        user.address = str(next_address).strip() if next_address is not None else None

        db.flush()
        db.refresh(user)
        return jsonify(serialize_user(user))


# Return the demo vendor account token.

@auth_bp.post("/demo/vendor")
def demo_vendor_login():
    with db_session() as db:
        user = get_user_by_email(db, "vendor@serkayon.com")
        if not user:
            return error("Demo vendor not found. Create a vendor account using signup.", 503)
        return jsonify(token_response(user))


# Return the demo customer account token.

@auth_bp.post("/demo/customer")
def demo_customer_login():
    with db_session() as db:
        user = get_user_by_email(db, "customer@serkayon.com")
        if not user:
            return error("Demo customer not found. Create a customer account using signup.", 503)
        return jsonify(token_response(user))


# Verify a scoped PIN for the current or fallback user.

@auth_bp.post("/pin/verify")
def verify_settings_pin():
    try:
        payload = json_body()
        pin = str(required(payload, "pin")).strip()
        pin_type = _normalize_pin_type(payload.get("pin_type"))
    except ValueError as exc:
        return error(str(exc))

    if not PIN_RE.match(pin):
        return error("PIN must be exactly 4 digits")

    with db_session() as db:
        user = _resolve_pin_user(db)
        if not user:
            return error("User not found", 404)

        pin_field = PIN_TYPE_FIELD_MAP[pin_type]
        stored_pin_value = str(getattr(user, pin_field, "") or "").strip()
        if not stored_pin_value or not verify_password(pin, stored_pin_value):
            return error("Invalid PIN", 401)
        if not is_password_hashed(stored_pin_value):
            setattr(user, pin_field, hash_password(pin))
            db.flush()
        return jsonify({"ok": True, "pin_type": pin_type})


# Change a scoped PIN after verifying the current value.

@auth_bp.post("/pin/change")
def change_settings_pin():
    try:
        payload = json_body()
        current_pin = str(required(payload, "current_pin")).strip()
        new_pin = str(required(payload, "new_pin")).strip()
        pin_type = _normalize_pin_type(payload.get("pin_type"))
    except ValueError as exc:
        return error(str(exc))

    if not PIN_RE.match(current_pin) or not PIN_RE.match(new_pin):
        return error("Current PIN and new PIN must be exactly 4 digits")
    if current_pin == new_pin:
        return error("New PIN must be different from current PIN")

    with db_session() as db:
        user = _resolve_pin_user(db)
        if not user:
            return error("User not found", 404)

        pin_field = PIN_TYPE_FIELD_MAP[pin_type]
        stored_pin_value = str(getattr(user, pin_field, "") or "").strip()
        if not stored_pin_value or not verify_password(current_pin, stored_pin_value):
            return error("Current PIN is incorrect", 401)

        setattr(user, pin_field, hash_password(new_pin))
        db.flush()
        return jsonify({"ok": True, "detail": "PIN updated successfully", "pin_type": pin_type})

