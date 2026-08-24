from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, model_validator

from app.core.enums import PriType


class ModeLineFields(BaseModel):
    rf_min_mhz: float
    rf_max_mhz: float
    pw_min_us: float
    pw_max_us: float
    pri_min_us: float | None = None
    pri_max_us: float | None = None
    jitter_min_us: float | None = None
    jitter_max_us: float | None = None
    pri_stagger_values_us: list[float] | None = None
    type_data: dict | None = None

    @model_validator(mode="after")
    def check_ranges(self) -> "ModeLineFields":
        if self.rf_min_mhz > self.rf_max_mhz:
            raise ValueError("rf_min_mhz must be <= rf_max_mhz")
        if self.pw_min_us > self.pw_max_us:
            raise ValueError("pw_min_us must be <= pw_max_us")
        if self.pri_min_us is not None and self.pri_max_us is not None and self.pri_min_us > self.pri_max_us:
            raise ValueError("pri_min_us must be <= pri_max_us")
        if (
            self.jitter_min_us is not None
            and self.jitter_max_us is not None
            and self.jitter_min_us > self.jitter_max_us
        ):
            raise ValueError("jitter_min_us must be <= jitter_max_us")
        return self


def validate_pri_type_fields(pri_type: PriType, fields: ModeLineFields) -> None:
    """Enforces which line fields a given PRI Type requires vs. forbids."""
    if pri_type == PriType.fixed:
        if fields.pri_min_us is None or fields.pri_max_us is None:
            raise ValueError("Fixed PRI requires pri_min_us and pri_max_us")
        if fields.jitter_min_us is None or fields.jitter_max_us is None:
            raise ValueError("Fixed PRI requires jitter_min_us and jitter_max_us")
        if fields.pri_stagger_values_us:
            raise ValueError("Fixed PRI must not set pri_stagger_values_us")
    elif pri_type == PriType.stagger:
        if not fields.pri_stagger_values_us or len(fields.pri_stagger_values_us) < 1:
            raise ValueError("Stagger PRI requires a non-empty pri_stagger_values_us sequence")
        if fields.pri_min_us is not None or fields.pri_max_us is not None:
            raise ValueError("Stagger PRI must not set pri_min_us/pri_max_us")
        if fields.jitter_min_us is not None or fields.jitter_max_us is not None:
            raise ValueError("Stagger PRI must not set jitter_min_us/jitter_max_us")
    elif pri_type == PriType.cw:
        if any(
            v is not None
            for v in (fields.pri_min_us, fields.pri_max_us, fields.jitter_min_us, fields.jitter_max_us)
        ) or fields.pri_stagger_values_us:
            raise ValueError("CW PRI carries no PRI/Jitter value")
    elif pri_type == PriType.xlet:
        if any(
            v is not None
            for v in (fields.pri_min_us, fields.pri_max_us, fields.jitter_min_us, fields.jitter_max_us)
        ) or fields.pri_stagger_values_us:
            raise ValueError("Xlet PRI has no fields defined yet")


class ModeCreate(BaseModel):
    source_id: UUID
    name: str
    pri_type: PriType
    notes: str | None = None
    sort_order: int = 0
    line: ModeLineFields

    @model_validator(mode="after")
    def check_pri_type(self) -> "ModeCreate":
        validate_pri_type_fields(self.pri_type, self.line)
        return self


class ModeCreateFromDsl(BaseModel):
    source_id: UUID
    name: str
    dsl_text: str
    notes: str | None = None
    sort_order: int = 0


class ModeUpdate(BaseModel):
    name: str | None = None
    notes: str | None = None
    sort_order: int | None = None
    ew_group_id: UUID | None = None
    line: ModeLineFields | None = None


class ModeLineOut(ModeLineFields):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    mode_id: UUID
    dsl_text: str | None = None
    created_at: datetime


class ModeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ew_group_id: UUID
    source_id: UUID
    name: str
    pri_type: PriType
    notes: str | None = None
    sort_order: int
    created_at: datetime
    updated_at: datetime
    line: ModeLineOut | None = None
