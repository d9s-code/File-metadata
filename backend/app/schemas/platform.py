from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

# As the PRS XML writes them.
Hostility = Literal["UNKNOWN", "FRIEND", "HOSTILE", "NEUTRAL"]
Base = Literal["SEA", "GROUND", "SUBSURFACE", "UNKNOWN", "AIR"]
SpeedUnit = Literal["kmh", "knots"]


def _check_speed(m):
    lo, hi = m.speed_min, m.speed_max
    if lo is not None and hi is not None and lo > hi:
        raise ValueError("The lowest speed can't be above the highest")
    return m


class PlatformCreate(BaseModel):
    name: str
    description: str | None = None
    hostility: Hostility = "UNKNOWN"
    base: Base = "UNKNOWN"
    speed_min: float | None = Field(default=None, ge=0, le=100_000)
    speed_max: float | None = Field(default=None, ge=0, le=100_000)
    speed_unit: SpeedUnit = "kmh"

    _speed = model_validator(mode="after")(_check_speed)


class PlatformUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    hostility: Hostility | None = None
    base: Base | None = None
    speed_min: float | None = Field(default=None, ge=0, le=100_000)
    speed_max: float | None = Field(default=None, ge=0, le=100_000)
    speed_unit: SpeedUnit | None = None

    _speed = model_validator(mode="after")(_check_speed)


class PlatformOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None = None
    status: str
    hostility: Hostility = "UNKNOWN"
    base: Base = "UNKNOWN"
    speed_min: float | None = None
    speed_max: float | None = None
    speed_unit: SpeedUnit = "kmh"
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
    # How far the pinned Emitters are towards Operational, on average, as a
    # percent (see statuses.emitter_progress_weights); None without Emitters.
    emitter_progress: int | None = None
    outdated_pins: int
    # Modes in the pinned Emitter versions.
    mode_count: int
    mdf_count: int
    latest_version_number: int | None = None
    latest_version_label: str | None = None
    latest_version_at: datetime | None = None
    # From the latest finished ambiguity check; None when never checked.
    ambiguity_checked_at: datetime | None = None
    ambiguous_emitters: int | None = None
    open_ambiguities: int | None = None


class PlatformListItem(PlatformOut):
    summary: PlatformSummary


class PlatformLinkCreate(BaseModel):
    emitter_id: UUID
    # Blank: the Emitter's latest saved version.
    emitter_version_id: UUID | None = None


class PinCandidateOut(BaseModel):
    """An Emitter as offered for pinning: its latest saved version (none: it
    can't be pinned yet) and the version this Platform pins, if any."""

    emitter_id: UUID
    name: str
    designation: str | None
    status: str
    latest_version_number: int | None
    pinned_version_number: int | None


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
    # The pinned version's frequency range, deltas applied (filled in by list_links).
    rf_min_mhz: float | None = None
    rf_max_mhz: float | None = None
