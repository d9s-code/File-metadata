from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, model_validator

from app.core.enums import ElementVariant

_STEP_VALUE_FIELDS = ("rf_mhz", "pw_us", "pri_us", "scan_value")
# A step can carry a range per parameter instead of a single value (a JSON
# import of a sequence that mixes parameter types keeps each min/max).
_STEP_RANGE_FIELDS = {
    "rf": ("rf_mhz", "rf_min_mhz", "rf_max_mhz"),
    "pw": ("pw_us", "pw_min_us", "pw_max_us"),
    "pri": ("pri_us", "pri_min_us", "pri_max_us"),
}


class ParameterSequenceStepIn(BaseModel):
    order: int
    rf_mhz: float | None = None
    pw_us: float | None = None
    pri_us: float | None = None
    scan_value: float | None = None
    dwell_s: float | None = None
    rf_min_mhz: float | None = None
    rf_max_mhz: float | None = None
    pw_min_us: float | None = None
    pw_max_us: float | None = None
    pri_min_us: float | None = None
    pri_max_us: float | None = None

    @model_validator(mode="after")
    def check_shape(self) -> "ParameterSequenceStepIn":
        has_range = False
        for name, (point, lo_field, hi_field) in _STEP_RANGE_FIELDS.items():
            lo, hi = getattr(self, lo_field), getattr(self, hi_field)
            if (lo is None) != (hi is None):
                raise ValueError(f"A sequence step's {name} range needs both {lo_field} and {hi_field}")
            if lo is None:
                continue
            if getattr(self, point) is not None:
                raise ValueError(f"A sequence step sets either {point} or a {name} range, not both")
            if lo > hi:
                raise ValueError(f"{lo_field} must be <= {hi_field}")
            has_range = True
        if not has_range and all(getattr(self, f) is None for f in _STEP_VALUE_FIELDS):
            raise ValueError("A sequence step needs at least one of rf/pw/pri/scan")
        return self


class ParameterSequenceCreate(BaseModel):
    label: str | None = None
    variant: ElementVariant | None = None
    steps: list[ParameterSequenceStepIn]
    sort_order: int = 0
    rf_delta: float | None = None
    pw_delta: float | None = None
    pri_delta: float | None = None

    @model_validator(mode="after")
    def check_steps(self) -> "ParameterSequenceCreate":
        if not self.steps:
            raise ValueError("A parameter sequence needs at least one step")
        orders = [s.order for s in self.steps]
        if len(set(orders)) != len(orders):
            raise ValueError("Step 'order' values must be unique within a sequence")
        return self


class ParameterSequenceUpdate(BaseModel):
    rf_delta: float | None = None
    pw_delta: float | None = None
    pri_delta: float | None = None


class ParameterSequenceOut(ParameterSequenceCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    source_id: UUID
    created_at: datetime
