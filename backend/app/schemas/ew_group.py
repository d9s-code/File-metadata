from datetime import datetime
from uuid import UUID

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    field_validator,
    model_validator,
)

from app.services.delta import apply_delta


def _validate_scan_delta(v: float | None) -> float | None:
    if v is not None and v < 0:
        raise ValueError("scan_delta must be >= 0")
    return v


def _validate_ageout(v: float | None) -> float | None:
    if v is not None and v < 0:
        raise ValueError("ageout must be >= 0")
    return v


class EwGroupCreate(BaseModel):
    name: str
    scan_min: float | None = None
    scan_max: float | None = None
    scan_delta: float | None = None
    threat_priority: int | None = None
    ageout: float | None = None
    # Effective radiated power, dBm — analysis only, never exported.
    erp_min_dbm: float | None = Field(default=None, ge=-100, le=200)
    erp_max_dbm: float | None = Field(default=None, ge=-100, le=200)
    sort_order: int = 0

    _validate_scan_delta = field_validator("scan_delta")(_validate_scan_delta)
    _validate_ageout = field_validator("ageout")(_validate_ageout)

    @model_validator(mode="after")
    def check_erp(self) -> "EwGroupCreate":
        check_erp(self.erp_min_dbm, self.erp_max_dbm)
        return self


def check_erp(lo: float | None, hi: float | None) -> None:
    if lo is not None and hi is not None and lo > hi:
        raise ValueError("The ERP's min can't be above its max")


class EwGroupUpdate(BaseModel):
    name: str | None = None
    scan_min: float | None = None
    scan_max: float | None = None
    scan_delta: float | None = None
    threat_priority: int | None = None
    ageout: float | None = None
    erp_min_dbm: float | None = Field(default=None, ge=-100, le=200)
    erp_max_dbm: float | None = Field(default=None, ge=-100, le=200)
    sort_order: int | None = None

    _validate_scan_delta = field_validator("scan_delta")(_validate_scan_delta)
    _validate_ageout = field_validator("ageout")(_validate_ageout)


class EwGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    name: str
    scan_min: float | None = None
    scan_max: float | None = None
    scan_delta: float | None = None
    threat_priority: int | None = None
    ageout: float | None = None
    erp_min_dbm: float | None = None
    erp_max_dbm: float | None = None
    sort_order: int
    modes_count: int = 0
    created_at: datetime
    updated_at: datetime

    @computed_field
    @property
    def engineered_scan_min(self) -> float | None:
        return apply_delta(self.scan_min, self.scan_max, self.scan_delta)[0]

    @computed_field
    @property
    def engineered_scan_max(self) -> float | None:
        return apply_delta(self.scan_min, self.scan_max, self.scan_delta)[1]


class EwGroupSuggestion(BaseModel):
    """A starting point for an Emitter's first EW Group: the scan range its
    Sources give — the shortest and longest scan time (s) among their scan
    Elements."""

    scan_min: float
    scan_max: float
    # How many scan Elements, in how many Sources, it was taken from.
    element_count: int
    source_names: list[str]
