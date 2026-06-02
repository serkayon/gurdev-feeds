# Authentication, password, and token helpers.


import base64
import hashlib
import hmac
import os
from datetime import datetime, timedelta
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from app.models.user import User

settings = get_settings()
PBKDF2_ALGORITHM = "pbkdf2_sha256"
PBKDF2_ITERATIONS = 260000
PBKDF2_SALT_BYTES = 16


# Compute the legacy salted hash for backward compatibility.

def _legacy_hash(password: str) -> str:
    return hashlib.sha256((password + settings.secret_key).encode()).hexdigest()


# Store a password using PBKDF2-SHA256.

def hash_password(password: str) -> str:
    plain = str(password or "")
    salt = os.urandom(PBKDF2_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        plain.encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    salt_b64 = base64.b64encode(salt).decode("utf-8")
    digest_b64 = base64.b64encode(digest).decode("utf-8")
    return f"{PBKDF2_ALGORITHM}${PBKDF2_ITERATIONS}${salt_b64}${digest_b64}"


# Verify a password against current or legacy storage formats.

def verify_password(plain: str, stored_value: str) -> bool:
    plain_value = str(plain or "")
    db_value = str(stored_value or "")

    parts = db_value.split("$")
    if len(parts) == 4 and parts[0] == PBKDF2_ALGORITHM:
        _, iterations_raw, salt_b64, digest_b64 = parts
        try:
            iterations = int(iterations_raw)
            salt = base64.b64decode(salt_b64.encode("utf-8"))
            expected_digest = base64.b64decode(digest_b64.encode("utf-8"))
        except (TypeError, ValueError):
            return False
        computed_digest = hashlib.pbkdf2_hmac(
            "sha256",
            plain_value.encode("utf-8"),
            salt,
            iterations,
        )
        return hmac.compare_digest(computed_digest, expected_digest)

    # Backward compatibility for plain-text rows during migration.
    if plain_value == db_value:
        return True
    # Backward compatibility for legacy rows saved with salted SHA256.
    return _legacy_hash(plain_value) == db_value


# Check whether a stored password is already in the current secure format.

def is_password_hashed(stored_value: str) -> bool:
    db_value = str(stored_value or "")
    parts = db_value.split("$")
    return len(parts) == 4 and parts[0] == PBKDF2_ALGORITHM


# Create a signed JWT access token.

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    to_encode.update({"exp": datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)})
    return jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)


# Decode a JWT access token and return its payload if valid.

def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        return None


# Fetch a user row by email address.

def get_user_by_email(db: Session, email: str) -> User | None:
    return db.execute(select(User).where(User.email == email)).scalars().one_or_none()

