from datetime import date, datetime
from uuid import UUID

from pydantic import AliasPath, BaseModel, ConfigDict, Field, field_validator


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
    # How many pinned Emitters (per Platform it covers) are tested, stale,
    # untested or not covered — None for default dwells or before a save.
    testing: dict[str, int] | None = None


class StrategyTestingRun(BaseModel):
    test_record_id: UUID
    title: str
    test_date: date
    result: str
    strategy_version_number: int
    emitter_version_number: int | None
    platform_test_id: UUID | None


class StrategyTestingEmitter(BaseModel):
    emitter_id: UUID
    emitter_name: str
    designation: str | None
    pinned_version_number: int
    covering_dwells: int
    # tested | stale | untested | not_covered
    state: str
    reason: str | None
    # The run it holds on (tested), or the newest that no longer does (stale).
    run: StrategyTestingRun | None


class StrategyTestingPlatform(BaseModel):
    platform_id: UUID
    platform_name: str
    emitters: list[StrategyTestingEmitter]


class StrategyTestingOut(BaseModel):
    strategy_id: UUID
    # The saved version it's judged as; None before the first save.
    version_number: int | None
    platforms: list[StrategyTestingPlatform]


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
    # Pinned into this MDF straight away (at the new file's v1).
    mdf_id: UUID | None = None


class DwellFileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
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
    # When MDFs use the file: those of its Platforms none of them pins.
    platforms_not_in_mdf: list[str] | None
    pinned_version_id: UUID
    pinned_version_number: int
    latest_version_number: int
    outdated: bool
    sort_order: int
    # The pinned version's dwells, for an overview.
    dwells: list[Dwell]


class DwellFileMdf(BaseModel):
    """An MDF using the file, and the version of it that MDF pins."""

    id: UUID
    name: str
    status: str
    pinned_version_number: int
    outdated: bool


class DwellFileOut(BaseModel):
    id: UUID
    name: str
    mdfs: list[DwellFileMdf]
    # The Platforms the MDFs using it pin (None when no MDF uses it).
    mdf_platform_ids: list[UUID] | None = None
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
    mdfs: list[DwellFileMdf]
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


class ModeDefaults(BaseModel):
    """What a new Mode gets where it isn't given one (app_settings.MODE_DEFAULTS)."""

    confirmation_quality: int = Field(ge=0, le=100)
    confirmation_quantity: int = Field(ge=1, le=1_000)
    frame_time_delta_us: float = Field(ge=0)
    rf_delta: float = Field(ge=0)
    pri_delta: float = Field(ge=0)
    pw_delta: float = Field(ge=0)


class SettingsOut(BaseModel):
    dwell_bandwidth_mhz: float
    ai_chat_max_context_tokens: int
    # What each Outline page holds, by its path (see knowledge_service.KINDS).
    outline_page_kinds: dict[str, str]
    mode_defaults: ModeDefaults


class SettingsUpdate(BaseModel):
    dwell_bandwidth_mhz: float | None = Field(default=None, gt=0)
    ai_chat_max_context_tokens: int | None = Field(default=None, ge=4_096, le=2_000_000)
    outline_page_kinds: dict[str, str] | None = None
    mode_defaults: ModeDefaults | None = None

    @field_validator("outline_page_kinds")
    @classmethod
    def known_kinds(cls, kinds: dict[str, str] | None) -> dict[str, str] | None:
        from app.services.knowledge_service import KINDS

        if kinds is None:
            return None
        if len(kinds) > 2_000:
            raise ValueError("Too many pages")
        bad = sorted({k for k in kinds.values() if k not in KINDS})
        if bad:
            raise ValueError(f"Unknown kind(s): {', '.join(bad)}")
        return {path.strip(): kind for path, kind in kinds.items() if path.strip()}


# A dwell file in an MDF


class MdfDwellPin(BaseModel):
    dwell_file_id: UUID
    # Blank: the file's latest saved version.
    dwell_file_version_id: UUID | None = None


class MdfDwellStrategy(BaseModel):
    """A Strategy as the pinned file version has it."""

    strategy_id: UUID | None
    name: str
    version_number: int | None
    latest_version_number: int | None
    outdated: bool
    platform_ids: list[UUID] = []
    platform_names: list[str]
    is_default: bool
    dwell_count: int
    cycle_ms: float
    bandwidth_mhz: float | None = None
    # The pinned version's dwells, for its chart.
    dwells: list[dict] = []


class MdfDwellOut(BaseModel):
    dwell_file_id: UUID
    name: str
    notes: str | None
    pinned_version_id: UUID
    pinned_version_number: int
    pinned_at: datetime
    pinned_version_saved_at: datetime
    latest_version_number: int | None
    latest_version_id: UUID | None
    # A newer saved version of the file than the one pinned (not flagged once the MDF is released).
    outdated: bool
    # The file has changes not saved as a version yet.
    file_changed: bool
    timeout: float
    setup_time: float
    strategies: list[MdfDwellStrategy]
    # The MDF's Platforms that no Strategy in this file covers (empty with a default dwell).
    platforms_not_covered: list[str]
    other_mdfs: list[DwellFileMdf]
