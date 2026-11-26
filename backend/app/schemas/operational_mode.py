from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.emitter import IlluminationTimeMs


class OperationalModeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    # The one it sits under (one of the same Emitter's); None — at the top.
    parent_id: UUID | None = None
    description: str | None = None
    illumination_time_ms: IlluminationTimeMs | None = None
    sort_order: int = 0


class OperationalModeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    # Moves it (with everything under it); null — to the top.
    parent_id: UUID | None = None
    description: str | None = None
    # Null clears it: its Modes then take the Emitter's.
    illumination_time_ms: IlluminationTimeMs | None = None
    sort_order: int | None = None


class OperationalModeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    parent_id: UUID | None = None
    name: str
    description: str | None = None
    illumination_time_ms: float | None = None
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

    def given(self) -> dict:
        return {k: v for k, v in self.model_dump(exclude_unset=True).items() if v is not None}
