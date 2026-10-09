from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class PlatformCreate(BaseModel):
    name: str
    description: str | None = None


class PlatformUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class PlatformOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None = None
    is_deleted: bool
    deleted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class PlatformSummary(BaseModel):
    """What the Platforms list shows about one Platform (see platform_summary)."""

    emitter_count: int
    # Live statuses of the pinned Emitters, and the worst of them.
    status_counts: dict[str, int]
    worst_status: str | None = None
    outdated_pins: int
    # Modes in the pinned Emitter versions.
    mode_count: int
    mdf_count: int
    latest_version_number: int | None = None
    latest_version_at: datetime | None = None
    # From the latest finished ambiguity check; None when never checked.
    ambiguity_checked_at: datetime | None = None
    ambiguous_emitters: int | None = None
    open_ambiguities: int | None = None


class PlatformListItem(PlatformOut):
    summary: PlatformSummary


class PlatformLinkCreate(BaseModel):
    emitter_id: UUID
    emitter_version_id: UUID


class PlatformLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    platform_id: UUID
    emitter_id: UUID
    emitter_version_id: UUID
    added_at: datetime
    # The pinned version's number, and the Emitter's latest saved one — the pin
    # is outdated when the latter is higher (filled in by list_links).
    pinned_version_number: int | None = None
    latest_version_number: int | None = None
    latest_version_id: UUID | None = None
