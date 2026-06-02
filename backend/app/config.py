from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings


# Define Settings.

class Settings(BaseSettings):
    app_name: str = "Poultry ERP API"
    debug: bool = False
    secret_key: str = "change-in-production-use-env"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 24 hours
    # Default local PostgreSQL database named `poultry`.
    # Override via DATABASE_URL in backend/app/.env if needed.
    database_url: str = "postgresql+psycopg://postgres@localhost:5432/poultry"
    db_schema: str = "poultry1"

    # Parse debug flag.

    @field_validator("debug", mode="before")
    @classmethod
    def parse_debug_flag(cls, value):
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"1", "true", "yes", "on", "dev", "debug", "development"}:
                return True
            if normalized in {"0", "false", "no", "off", "release", "prod", "production", ""}:
                return False
        return value

    # Define Config.

    class Config:
        env_file = Path(__file__).resolve().parent / ".env"


# Get settings.

@lru_cache
def get_settings() -> Settings:
    return Settings()

