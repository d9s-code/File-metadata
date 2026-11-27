from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.emitter import IlluminationTimeMs
from app.schemas.mode import ScanSeconds, check_scan_box


class OperationalModeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    # The one it sits under (one of the same Emitter's); None — at the top.
    parent_id: UUID | None = None
    description: str | None = None
    illumination_time_ms: IlluminationTimeMs | None = None
    # Both, or neither.
    scan_min_s: ScanSeconds | None = None
    scan_max_s: ScanSeconds | None = None
    # Its place among its siblings; None — after them.
    sort_order: int | None = None

    @model_validator(mode="after")
    def check_scan(self) -> "OperationalModeCreate":
        check_scan_box(self.scan_min_s, self.scan_max_s)
        return self


class OperationalModeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    # Moves it (with everything under it); null — to the top.
    parent_id: UUID | None = None
    description: str | None = None
    # Null clears it: its Modes then take the Emitter's.
    illumination_time_ms: IlluminationTimeMs | None = None
    # Both together, or both null to clear it (checked against each other on save).
    scan_min_s: ScanSeconds | None = None
    scan_max_s: ScanSeconds | None = None
    sort_order: int | None = None


class OperationalModeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    parent_id: UUID | None = None
    name: str
    description: str | None = None
    illumination_time_ms: float | None = None
    scan_min_s: float | None = None
    scan_max_s: float | None = None
    sort_order: int
    # How many of the Emitter's Modes are linked to it directly.
    modes_count: int = 0
    created_at: datetime
    updated_at: datetime


class OperationalModeSetValues(BaseModel):
    """Values set on every Mode under an operational mode (it and all below
    it) — e.g. the RF range Track 1, 2 and 3 share. Only the fields given are
    set; the rest of each Mode stays as it is. A PRI range or jitter is a
    Fixed PRI's: every Mode under it must be Fixed for those."""

    rf_min_mhz: float | None = Field(default=None, gt=0)
    rf_max_mhz: float | None = Field(default=None, gt=0)
    rf_delta: float | None = Field(default=None, ge=0)
    pw_min_us: float | None = Field(default=None, gt=0)
    pw_max_us: float | None = Field(default=None, gt=0)
    pw_delta: float | None = Field(default=None, ge=0)
    pri_min_us: float | None = Field(default=None, gt=0)
    pri_max_us: float | None = Field(default=None, gt=0)
    pri_delta: float | None = Field(default=None, ge=0)
    jitter_min_us: float | None = Field(default=None, ge=0)
    jitter_max_us: float | None = Field(default=None, ge=0)
    # A stagger's steps (µs) and its frame-time delta: every Mode under it must be a stagger for these.
    pri_stagger_values_us: list[Annotated[float, Field(gt=0)]] | None = Field(default=None, min_length=2, max_length=64)
    frame_time_delta_us: float | None = Field(default=None, ge=0)

    def given(self) -> dict:
        return {k: v for k, v in self.model_dump(exclude_unset=True).items() if v is not None}


class OperationalModeOrder(BaseModel):
    """Siblings in the order given — all of one parent's, each once."""

    parent_id: UUID | None = None
    ids: list[UUID] = Field(min_length=1)
