from uuid import UUID
from datetime import date, datetime
from pydantic import BaseModel, ConfigDict

class SourceGroupBase(BaseModel):
    name: str
    description: str | None = None

class SourceGroupCreate(SourceGroupBase):
    pass

class SourceGroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None

class SourceGroupOut(SourceGroupBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime

    # Derived, read-only — rolled up across the group's current Sources/Elements
    # by source_group_service.compute_source_group_stats. Not stored columns.
    source_count: int = 0
    last_updated_source_date: date | None = None
    last_edited_at: datetime | None = None
    rf_min_mhz: float | None = None
    rf_max_mhz: float | None = None
    pw_min_us: float | None = None
    pw_max_us: float | None = None
    pri_min_us: float | None = None
    pri_max_us: float | None = None
    pri_stagger_count: int = 0
