"""App-wide settings an admin sets: their defaults, and reading/writing them."""

from sqlalchemy.orm import Session

from app.models.app_setting import AppSetting

# The band (MHz) drawn around each dwell's frequency in the dwell charts,
# unless a dwell file sets its own.
DWELL_BANDWIDTH_MHZ = "dwell_bandwidth_mhz"

DEFAULTS: dict[str, object] = {DWELL_BANDWIDTH_MHZ: 10.0}


def get_setting(db: Session, key: str):
    row = db.get(AppSetting, key)
    return row.value.get("value") if row is not None else DEFAULTS[key]


def all_settings(db: Session) -> dict:
    return {key: get_setting(db, key) for key in DEFAULTS}


def set_setting(db: Session, key: str, value, user_id) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value={"value": value}, updated_by=user_id))
    else:
        row.value = {"value": value}
        row.updated_by = user_id
