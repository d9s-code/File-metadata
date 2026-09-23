from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.core.enums import SourceStatus


class SourceCreate(BaseModel):
    name: str
    description: str | None = None
    rf_legacy_term: str | None = None
    pri_legacy_term: str | None = None
    source_type: str | None = None
    source_date: date
    group_id: UUID | None = None


class SourceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    rf_legacy_term: str | None = None
    pri_legacy_term: str | None = None
    source_type: str | None = None
    source_date: date | None = None
    group_id: UUID | None = None


class SourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    name: str
    description: str | None = None
    rf_legacy_term: str | None = None
    pri_legacy_term: str | None = None
    source_type: str | None = None
    source_date: date
    status: SourceStatus
    rejection_reason: str | None = None
    import_batch_id: UUID | None = None
    group_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class SourceRejectRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    reason: str = Field(min_length=1, max_length=2000)
