from sqlalchemy import MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import get_settings

settings = get_settings()

connect_args = {}
if settings.database_url.startswith("postgresql"):
    connect_args["options"] = f"-csearch_path={settings.db_schema} -ctimezone={settings.timezone}"

engine = create_engine(
    settings.database_url,
    echo=settings.debug,
    connect_args=connect_args,
)
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    bind=engine,
)


class Base(DeclarativeBase):
    metadata = MetaData(schema=settings.db_schema)


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
