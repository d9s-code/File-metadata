from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.core.enums import SourceStatus


class SourceCreate(BaseModel):
    name: str
    description: str | None = None
    source_date: date


class SourceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    source_date: date | None = None


class SourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    name: str
    description: str | None = None
    source_date: date
    status: SourceStatus
    import_batch_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
