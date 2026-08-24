from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class EwGroupCreate(BaseModel):
    name: str
    scan_min: float | None = None
    scan_max: float | None = None
    threat_priority: int | None = None
    sort_order: int = 0


class EwGroupUpdate(BaseModel):
    name: str | None = None
    scan_min: float | None = None
    scan_max: float | None = None
    threat_priority: int | None = None
    sort_order: int | None = None


class EwGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    name: str
    scan_min: float | None = None
    scan_max: float | None = None
    threat_priority: int | None = None
    sort_order: int
    created_at: datetime
    updated_at: datetime
