"""App-wide settings an admin sets: their defaults, and reading/writing them."""

from sqlalchemy.orm import Session

from app.models.app_setting import AppSetting

# The band (MHz) drawn around each dwell's frequency in the dwell charts,
# unless a dwell file sets its own.
DWELL_BANDWIDTH_MHZ = "dwell_bandwidth_mhz"

# How much the AI chat may give the model at once, in tokens (its context
# window): older turns are left out, or compacted, to stay inside it.
AI_CHAT_MAX_CONTEXT = "ai_chat_max_context_tokens"

# What each Outline page holds, by its path ("Parent › Page"): documentation,
# test_result, analysis or exclude — its sub-pages follow (knowledge_service).
OUTLINE_PAGE_KINDS = "outline_page_kinds"

# What a new Mode gets where it isn't given one: its confirmation, and the
# margins the Add Mode form starts with (a stagger's frame-time margin also
# where Modes are made without a form — from Elements, a DSL line, the AI).
MODE_DEFAULTS = "mode_defaults"
MODE_DEFAULT_VALUES: dict[str, float] = {
    "confirmation_quality": 100,
    "confirmation_quantity": 2,
    "frame_time_delta_us": 3.0,
    "rf_delta": 0.0,
    "pri_delta": 0.0,
    "pw_delta": 0.0,
}

DEFAULTS: dict[str, object] = {
    DWELL_BANDWIDTH_MHZ: 10.0,
    AI_CHAT_MAX_CONTEXT: 32_768,
    OUTLINE_PAGE_KINDS: {},
    MODE_DEFAULTS: MODE_DEFAULT_VALUES,
}


def get_setting(db: Session, key: str):
    row = db.get(AppSetting, key)
    return row.value.get("value") if row is not None else DEFAULTS[key]


def mode_defaults(db: Session) -> dict:
    """The admin's Mode defaults, any not set yet at their built-in value."""
    return {**MODE_DEFAULT_VALUES, **(get_setting(db, MODE_DEFAULTS) or {})}


def fill_confirmation(db: Session, payload) -> None:
    """A request's confirmation quality / quantity that it didn't give comes
    from the Mode defaults."""
    defaults = mode_defaults(db)
    for key in ("confirmation_quality", "confirmation_quantity"):
        if key not in payload.model_fields_set:
            setattr(payload, key, int(defaults[key]))


def all_settings(db: Session) -> dict:
    return {key: get_setting(db, key) for key in DEFAULTS} | {MODE_DEFAULTS: mode_defaults(db)}


def set_setting(db: Session, key: str, value, user_id) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value={"value": value}, updated_by=user_id))
    else:
        row.value = {"value": value}
        row.updated_by = user_id
