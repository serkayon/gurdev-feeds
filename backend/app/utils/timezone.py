from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.config import get_settings


def get_app_timezone():
    timezone_name = str(get_settings().timezone or "Asia/Kolkata").strip() or "Asia/Kolkata"
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        if timezone_name in {"IST", "Asia/Calcutta"}:
            return timezone(timedelta(hours=5, minutes=30), name="IST")
        return ZoneInfo("Asia/Kolkata")


APP_TIMEZONE = get_app_timezone()


def app_now() -> datetime:
    return datetime.now(APP_TIMEZONE).replace(tzinfo=None)


def app_now_aware() -> datetime:
    return datetime.now(APP_TIMEZONE)


def as_app_time(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=APP_TIMEZONE)
    return value.astimezone(APP_TIMEZONE)


def to_db_time(value: datetime) -> datetime:
    return as_app_time(value).replace(tzinfo=None)
