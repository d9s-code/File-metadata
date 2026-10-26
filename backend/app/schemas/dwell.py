from datetime import date, datetime
from uuid import UUID

from pydantic import AliasPath, BaseModel, ConfigDict, Field


class Dwell(BaseModel):
    """One dwell: where the receiver sits (MHz), and for how long (ms)."""

    freq_mhz: float = Field(gt=0)
    dwell_time_ms: float = Field(gt=0)
    collect_time_ms: float = Field(default=50, ge=0)


# Strategies


class DwellStrategyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    # The Platforms it covers; none makes it a default dwell.
    platform_ids: list[UUID] = Field(default_factory=list, max_length=200)
    # One Platform (older callers); added to platform_ids.
    platform_id: UUID | None = None
    description: str | None = Field(default=None, max_length=2000)
    # Start from another Strategy's dwells and settings (a copy).
    copy_from_id: UUID | None = None


class DwellStrategyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    # Replaces the Platforms it covers; [] makes it a default dwell.
    platform_ids: list[UUID] | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    manual_collect_time_ms: float | None = Field(default=None, ge=0)
    dwells: list[Dwell] | None = Field(default=None, max_length=500)
    # None clears it: the app-wide default applies again.
    bandwidth_mhz: float | None = Field(default=None, gt=0)
    # Also save the result as a new version (when it differs from the latest).
    save_version: bool = False
    change_summary: str | None = Field(default=None, max_length=2000)


class StrategyUse(BaseModel):
    """A dwell file a Strategy is in, and which of its versions."""

    link_id: UUID
    file_id: UUID
    file_name: str
    pinned_version_number: int
    outdated: bool


class StrategyTestUse(BaseModel):
    """A test run that recorded this Strategy."""

    kind: str  # "emitter", "mdf" (a record's scope) or "platform" (a Platform test)
    id: UUID
    owner_id: UUID
    title: str
    test_date: date
    version_number: int


class DwellStrategySummary(BaseModel):
    id: UUID
    name: str
    platform_ids: list[UUID]
    platform_names: list[str]
    # Tied to no Platform.
    is_default: bool
    description: str | None
    dwell_count: int
    cycle_ms: float
    lowest_mhz: float | None
    highest_mhz: float | None
    latest_version_number: int | None
    # For pinning the latest version (e.g. on a test run).
    latest_version_id: UUID | None
    unsaved: bool
    used_in: list[str]
    updated_at: datetime


class DwellStrategyOut(BaseModel):
    id: UUID
    name: str
    platform_ids: list[UUID]
    platform_names: list[str]
    is_default: bool
    description: str | None
    manual_collect_time_ms: float
    dwells: list[Dwell]
    rapid_df: dict | None
    split_mode: list | None
    bandwidth_mhz: float | None
    latest_version_number: int | None
    unsaved: bool
    used_in: list[StrategyUse]
    tests: list[StrategyTestUse]
    created_at: datetime
    updated_at: datetime


# Dwell files


class DwellFileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    mdf_id: UUID | None = None


class DwellFileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    mdf_id: UUID | None = None
    timeout: float | None = Field(default=None, ge=0)
    setup_time: float | None = Field(default=None, ge=0)
    notes: str | None = None


class PinStrategy(BaseModel):
    strategy_id: UUID
    # Blank: the Strategy's latest saved version.
    strategy_version_id: UUID | None = None


class DwellFileLinkUpdate(BaseModel):
    strategy_version_id: UUID | None = None
    sort_order: int | None = None


class DwellFileLinkOut(BaseModel):
    id: UUID
    strategy_id: UUID
    strategy_name: str
    platform_ids: list[UUID]
    platform_names: list[str]
    is_default: bool
    # When the file is for an MDF: those of its Platforms the MDF doesn't pin.
    platforms_not_in_mdf: list[str] | None
    pinned_version_id: UUID
    pinned_version_number: int
    latest_version_number: int
    outdated: bool
    sort_order: int
    # The pinned version's dwells, for an overview.
    dwells: list[Dwell]


class DwellFileOut(BaseModel):
    id: UUID
    name: str
    mdf_id: UUID | None
    mdf_name: str | None
    timeout: float
    setup_time: float
    notes: str | None
    latest_version_number: int | None
    unsaved: bool
    links: list[DwellFileLinkOut]
    created_at: datetime
    updated_at: datetime


class DwellFileSummary(BaseModel):
    id: UUID
    name: str
    mdf_id: UUID | None
    mdf_name: str | None
    strategy_count: int
    platform_names: list[str]
    outdated_count: int
    latest_version_number: int | None
    unsaved: bool
    updated_at: datetime


# Versions (both kinds)


class DwellVersionOut(BaseModel):
    id: UUID
    version_number: int
    change_summary: str | None
    created_by: UUID | None
    created_by_username: str | None
    created_at: datetime


class DwellVersionDetailOut(DwellVersionOut):
    snapshot: dict


class DwellDiffEntry(BaseModel):
    scope: str
    label: str
    kind: str
    old_value: str | None = None
    new_value: str | None = None


class DwellDiffOut(BaseModel):
    entries: list[DwellDiffEntry]
    identical: bool


class CommitDwellVersion(BaseModel):
    change_summary: str | None = Field(default=None, max_length=2000)


# Notes


class DwellStrategyNoteCreate(BaseModel):
    body: str = Field(min_length=1)


class DwellStrategyNoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    author_id: UUID | None = None
    author_username: str | None = Field(default=None, validation_alias=AliasPath("author", "username"))
    body: str
    created_at: datetime


# Settings


class SettingsOut(BaseModel):
    dwell_bandwidth_mhz: float
    ai_chat_max_context_tokens: int


class SettingsUpdate(BaseModel):
    dwell_bandwidth_mhz: float | None = Field(default=None, gt=0)
    ai_chat_max_context_tokens: int | None = Field(default=None, ge=4_096, le=2_000_000)
