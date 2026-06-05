from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def get_database_timezone():
    timezone_name = str(os.getenv("APP_TIMEZONE", os.getenv("TIMEZONE", "Asia/Kolkata"))).strip()
    timezone_name = timezone_name or "Asia/Kolkata"
    try:
        return ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        if timezone_name in {"IST", "Asia/Calcutta"}:
            return timezone(timedelta(hours=5, minutes=30), name="IST")
        return ZoneInfo("Asia/Kolkata")


DATABASE_TIMEZONE = get_database_timezone()


def app_now() -> datetime:
    return datetime.now(DATABASE_TIMEZONE).replace(tzinfo=None)
