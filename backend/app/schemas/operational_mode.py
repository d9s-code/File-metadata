from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.emitter import IlluminationTimeMs


class OperationalModeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    illumination_time_ms: IlluminationTimeMs | None = None
    sort_order: int = 0


class OperationalModeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    # Null clears it: its Modes then take the Emitter's.
    illumination_time_ms: IlluminationTimeMs | None = None
    sort_order: int | None = None


class OperationalModeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    name: str
    description: str | None = None
    illumination_time_ms: float | None = None
    sort_order: int
    # How many of the Emitter's Modes are linked to it.
    modes_count: int = 0
    created_at: datetime
    updated_at: datetime
