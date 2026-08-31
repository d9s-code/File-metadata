from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, model_validator

from app.core.enums import ElementVariant

_STEP_VALUE_FIELDS = ("rf_mhz", "pw_us", "pri_us", "scan_value")


class ParameterSequenceStepIn(BaseModel):
    order: int
    rf_mhz: float | None = None
    pw_us: float | None = None
    pri_us: float | None = None
    scan_value: float | None = None
    dwell_s: float | None = None

    @model_validator(mode="after")
    def check_shape(self) -> "ParameterSequenceStepIn":
        if all(getattr(self, f) is None for f in _STEP_VALUE_FIELDS):
            raise ValueError("A sequence step needs at least one of rf_mhz/pw_us/pri_us/scan_value")
        return self


class ParameterSequenceCreate(BaseModel):
    label: str | None = None
    variant: ElementVariant | None = None
    steps: list[ParameterSequenceStepIn]
    sort_order: int = 0

    @model_validator(mode="after")
    def check_steps(self) -> "ParameterSequenceCreate":
        if not self.steps:
            raise ValueError("A parameter sequence needs at least one step")
        orders = [s.order for s in self.steps]
        if len(set(orders)) != len(orders):
            raise ValueError("Step 'order' values must be unique within a sequence")
        return self


class ParameterSequenceOut(ParameterSequenceCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    source_id: UUID
    created_at: datetime
