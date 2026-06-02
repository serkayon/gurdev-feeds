# Helpers for generating and backfilling display codes.


from __future__ import annotations

import random
import re
import string

from sqlalchemy import select


_RNG = random.SystemRandom()
_TOTAL_DIGITS = 5
_MAX_NUMERIC = 10 ** _TOTAL_DIGITS
_MULTIPLIER = 7919
_OFFSET = 12345


# Normalize a code string for comparison.

def _normalize_code(raw_value: object) -> str:
    return str(raw_value or "").strip().upper()


# Extract the first alphabetic character used in a code.

def _extract_letter(raw_value: object) -> str:
    for char in str(raw_value or ""):
        if char.isalpha():
            return char.upper()
    return "X"


# Check whether a code matches the expected prefix pattern.

def _is_valid_code(code: str, prefix: str) -> bool:
    normalized_prefix = re.escape(str(prefix or "").upper())
    return bool(re.fullmatch(rf"{normalized_prefix}[A-Z]\d{{{_TOTAL_DIGITS}}}", code))


# Generate the numeric suffix for a record identifier.

def _related_number(serial_id: int | None) -> str:
    if serial_id is None:
        return f"{_RNG.randrange(0, _MAX_NUMERIC):0{_TOTAL_DIGITS}d}"
    mapped_value = ((int(serial_id) * _MULTIPLIER) + _OFFSET) % _MAX_NUMERIC
    return f"{mapped_value:0{_TOTAL_DIGITS}d}"


# Return True when a generated code is already taken.

def _code_exists(db, model, column_name: str, code: str, *, exclude_id: int | None = None) -> bool:
    code_column = getattr(model, column_name)
    query = select(model.id).where(code_column == code)
    if exclude_id is not None:
        query = query.where(model.id != exclude_id)
    return db.execute(query.limit(1)).first() is not None


# Generate a unique display code for the given model.

def _generate_unique_code(
    db,
    model,
    *,
    column_name: str,
    prefix: str,
    letter_source: object,
    serial_id: int | None,
    exclude_id: int | None = None,
) -> str:
    normalized_prefix = str(prefix or "").upper().strip()
    letter = _extract_letter(letter_source)

    preferred_code = f"{normalized_prefix}{letter}{_related_number(serial_id)}"
    if not _code_exists(db, model, column_name, preferred_code, exclude_id=exclude_id):
        return preferred_code

    for _ in range(250):
        candidate = f"{normalized_prefix}{letter}{_RNG.randrange(0, _MAX_NUMERIC):0{_TOTAL_DIGITS}d}"
        if not _code_exists(db, model, column_name, candidate, exclude_id=exclude_id):
            return candidate

    for alt_letter in string.ascii_uppercase:
        for _ in range(25):
            candidate = f"{normalized_prefix}{alt_letter}{_RNG.randrange(0, _MAX_NUMERIC):0{_TOTAL_DIGITS}d}"
            if not _code_exists(db, model, column_name, candidate, exclude_id=exclude_id):
                return candidate

    raise ValueError(f"Unable to generate unique code for prefix {normalized_prefix}")


# Assign a unique dispatch code to a dispatch entry.

def assign_dispatch_code(db, entry) -> str:
    from app.models.dispatch import DispatchEntry

    code = _generate_unique_code(
        db,
        DispatchEntry,
        column_name="dispatch_code",
        prefix="DP",
        letter_source=entry.party_name,
        serial_id=entry.id,
        exclude_id=entry.id,
    )
    entry.dispatch_code = code
    return code


# Assign a unique code to a raw material entry.

def assign_raw_material_entry_code(db, entry) -> str:
    from app.models.raw_material import RawMaterialEntry

    code = _generate_unique_code(
        db,
        RawMaterialEntry,
        column_name="entry_code",
        prefix="RM",
        letter_source=entry.rm_type,
        serial_id=entry.id,
        exclude_id=entry.id,
    )
    entry.entry_code = code
    return code


# Backfill or normalize all dispatch codes.

def ensure_dispatch_codes(db) -> int:
    from app.models.dispatch import DispatchEntry

    rows = (
        db.execute(select(DispatchEntry).order_by(DispatchEntry.id.asc()))
        .scalars()
        .all()
    )
    changed = 0

    for row in rows:
        normalized = _normalize_code(row.dispatch_code)
        is_valid = _is_valid_code(normalized, "DP")
        is_unique = bool(normalized) and not _code_exists(
            db,
            DispatchEntry,
            "dispatch_code",
            normalized,
            exclude_id=row.id,
        )

        if is_valid and is_unique:
            if normalized != row.dispatch_code:
                row.dispatch_code = normalized
                changed += 1
            continue

        assign_dispatch_code(db, row)
        changed += 1

    return changed


# Backfill or normalize all raw material entry codes.

def ensure_raw_material_entry_codes(db) -> int:
    from app.models.raw_material import RawMaterialEntry

    rows = (
        db.execute(select(RawMaterialEntry).order_by(RawMaterialEntry.id.asc()))
        .scalars()
        .all()
    )
    changed = 0

    for row in rows:
        normalized = _normalize_code(row.entry_code)
        is_valid = _is_valid_code(normalized, "RM")
        is_unique = bool(normalized) and not _code_exists(
            db,
            RawMaterialEntry,
            "entry_code",
            normalized,
            exclude_id=row.id,
        )

        if is_valid and is_unique:
            if normalized != row.entry_code:
                row.entry_code = normalized
                changed += 1
            continue

        assign_raw_material_entry_code(db, row)
        changed += 1

    return changed

