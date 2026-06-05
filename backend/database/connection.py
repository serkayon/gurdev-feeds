import os
from pathlib import Path

from sqlalchemy import MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


def _load_local_env() -> None:
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        os.environ.setdefault(key, value)


_load_local_env()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Define it in backend/database/.env or in the process environment."
    )

DB_SCHEMA = os.getenv("DB_SCHEMA", "poultry1")
APP_TIMEZONE = os.getenv("APP_TIMEZONE", os.getenv("TIMEZONE", "Asia/Kolkata"))
DEBUG = str(os.getenv("DEBUG", "false")).strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
    "dev",
    "debug",
    "development",
}

connect_args = {}
if DATABASE_URL.startswith("postgresql"):
    connect_args["options"] = f"-csearch_path={DB_SCHEMA} -ctimezone={APP_TIMEZONE}"

engine = create_engine(
    DATABASE_URL,
    echo=DEBUG,
    connect_args=connect_args,
)
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    bind=engine,
)


class Base(DeclarativeBase):
    metadata = MetaData(schema=DB_SCHEMA)


def get_db():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
