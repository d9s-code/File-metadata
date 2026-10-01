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


class SourceOverviewOut(BaseModel):
    """One Source with where it sits (group, Emitter) and when it was last
    updated — a row of the Source Groups overview."""

    id: UUID
    name: str
    status: str
    source_type: str | None = None
    # The user-entered "Date last updated" of the Source's contents.
    source_date: date
    # When the record itself was last edited here.
    updated_at: datetime
    group_id: UUID | None = None
    group_name: str | None = None
    emitter_id: UUID
    emitter_name: str
    emitter_designation: str | None = None
    element_count: int = 0
    sequence_count: int = 0
    mode_count: int = 0
