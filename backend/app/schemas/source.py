from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict



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
    import_batch_id: UUID | None = None
    group_id: UUID | None = None
    # Set when this Source stands for an Intercept.
    intercept_id: UUID | None = None
    intercept_name: str | None = None
    created_at: datetime
    updated_at: datetime

