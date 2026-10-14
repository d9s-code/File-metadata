"""Dates in text the app writes for people — summaries, notes, search
results: day.month.year (07.10.2026), the way the frontend shows them."""

from datetime import date, datetime


def day_text(value: date | datetime | str | None) -> str:
    """07.10.2026 from a date, a datetime or an ISO string; "" for none."""
    if not value:
        return ""
    if isinstance(value, str):
        try:
            value = date.fromisoformat(value[:10])
        except ValueError:
            return value
    return f"{value:%d.%m.%Y}"
