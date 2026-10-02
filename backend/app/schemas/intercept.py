from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from pydantic import AliasPath, BaseModel, ConfigDict, Field, model_validator

from app.core.enums import PriType


class InterceptEntryFields(BaseModel):
    rf_min_mhz: float | None = None
    rf_max_mhz: float | None = None
    rf_mean_mhz: float
    pw_min_us: float | None = None
    pw_max_us: float | None = None
    # Required for fixed/stagger, absent for CW (see
    # validate_intercept_entry_pri_type).
    pw_mean_us: float | None = None
    # Literal PRI mean when pri_type is fixed; stagger frame-time mean
    # (same field, contextual meaning) when pri_type is stagger.
    pri_min_us: float | None = None
    pri_max_us: float | None = None
    pri_mean_us: float | None = None
    jitter_mean_us: float | None = None
    stagger_values: list[float] | None = None
    notes: str | None = None
    # What an imported entry was built from; left out for entries typed in by
    # hand, and kept as it is when an entry is corrected (see PROVENANCE_FIELDS).
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    report_count: int | None = Field(default=None, ge=1)
    tracks: list[Annotated[str, Field(max_length=50)]] | None = Field(default=None, max_length=1000)
    source_file: str | None = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def check_ranges(self) -> "InterceptEntryFields":
        if self.rf_min_mhz is not None and self.rf_max_mhz is not None and self.rf_min_mhz > self.rf_max_mhz:
            raise ValueError("rf_min_mhz must be <= rf_max_mhz")
        if self.pw_min_us is not None and self.pw_max_us is not None and self.pw_min_us > self.pw_max_us:
            raise ValueError("pw_min_us must be <= pw_max_us")
        if self.pri_min_us is not None and self.pri_max_us is not None and self.pri_min_us > self.pri_max_us:
            raise ValueError("pri_min_us must be <= pri_max_us")
        if self.first_seen_at and self.last_seen_at and self.first_seen_at > self.last_seen_at:
            raise ValueError("first_seen_at must be <= last_seen_at")
        return self


# Where an imported entry came from. A correction made by hand (PUT) sends
# the measured values again but not these, and they're kept.
PROVENANCE_FIELDS = ("first_seen_at", "last_seen_at", "report_count", "tracks", "source_file")


def validate_intercept_entry_pri_type(pri_type: PriType, fields: InterceptEntryFields) -> None:
    """Enforces which fields each PRI type takes — mirrors
    validate_pri_type_fields in schemas/mode.py, narrowed to the types an
    Intercept entry supports (fixed, stagger, CW; not X-let yet).
    """
    if pri_type in (PriType.fixed, PriType.stagger):
        if fields.pri_mean_us is None:
            raise ValueError(f"{pri_type.value.capitalize()} PRI requires pri_mean_us")
        if fields.pw_mean_us is None:
            raise ValueError(f"{pri_type.value.capitalize()} PRI requires pw_mean_us")
    if pri_type == PriType.fixed:
        if fields.jitter_mean_us is None:
            raise ValueError("Fixed PRI requires jitter_mean_us")
        if fields.stagger_values:
            raise ValueError("Fixed PRI must not set stagger_values")
    elif pri_type == PriType.stagger:
        if not fields.stagger_values or len(fields.stagger_values) < 1:
            raise ValueError("Stagger PRI requires a non-empty stagger_values sequence")
        if fields.jitter_mean_us is not None:
            raise ValueError("Stagger PRI must not set jitter_mean_us")
    elif pri_type == PriType.cw:
        # A continuous wave: RF only — no pulses, so no PRI, PW or jitter.
        pulse_fields = (
            fields.pri_min_us, fields.pri_max_us, fields.pri_mean_us,
            fields.pw_min_us, fields.pw_max_us, fields.pw_mean_us, fields.jitter_mean_us,
        )
        if any(v is not None for v in pulse_fields) or fields.stagger_values:
            raise ValueError("CW carries RF only — no PRI, PW, jitter or stagger values")
    else:
        raise ValueError("Intercept entries support fixed, stagger or CW PRI (not X-let yet)")


class InterceptEntryCreate(InterceptEntryFields):
    pri_type: PriType

    @model_validator(mode="after")
    def check_pri_type(self) -> "InterceptEntryCreate":
        validate_intercept_entry_pri_type(self.pri_type, self)
        return self


class InterceptEntryOut(InterceptEntryFields):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    intercept_id: UUID
    pri_type: PriType
    created_at: datetime
    derived_mode_ids: list[UUID] = []


class InterceptEntryBrief(BaseModel):
    """Provenance summary attached to ModeOut.derived_from_intercepts —
    mirrors TestRecordBrief's shape/purpose.
    """

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    intercept_id: UUID
    pri_type: PriType
    created_at: datetime
    rf_mean_mhz: float
    pw_mean_us: float | None = None
    pri_mean_us: float | None = None


class InterceptNoteCreate(BaseModel):
    body: str


class InterceptNoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    author_id: UUID | None = None
    author_username: str | None = Field(default=None, validation_alias=AliasPath("author", "username"))
    body: str
    created_at: datetime


class InterceptCreate(BaseModel):
    emitter_id: UUID
    name: str
    description: str | None = None
    intercepted_on: date | None = None
    collected_by: str | None = Field(default=None, max_length=200)


class InterceptUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    intercepted_on: date | None = None
    collected_by: str | None = Field(default=None, max_length=200)


# One import's worth of entries — a CSV is grouped into entries before it's
# sent, so more than this means the reports still need grouping.
MAX_IMPORT_ENTRIES = 5000


class InterceptImport(BaseModel):
    """A new Intercept and all its entries, created together or not at all —
    what the CSV import sends once the reports are grouped."""

    intercept: InterceptCreate
    entries: list[InterceptEntryCreate] = Field(min_length=1, max_length=MAX_IMPORT_ENTRIES)


class EntryIds(BaseModel):
    """Entries of one Intercept to act on together (bulk delete, merge)."""

    entry_ids: list[UUID] = Field(min_length=1, max_length=MAX_IMPORT_ENTRIES)


class MatchCounts(BaseModel):
    match: int = 0
    near: int = 0
    none: int = 0


class InterceptMatchCounts(BaseModel):
    """How an Emitter's Intercept entries compare with its Modes — the counts
    alone, so the Emitter page doesn't download every entry to show them."""

    total: MatchCounts
    by_intercept: dict[UUID, MatchCounts]


class SourceFileImport(BaseModel):
    """An Intercept that already holds entries imported from a given file."""

    intercept_id: UUID
    intercept_name: str
    emitter_id: UUID
    entry_count: int
    imported_at: datetime


class InterceptOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    name: str
    description: str | None = None
    intercepted_on: date | None = None
    collected_by: str | None = None
    created_at: datetime
    updated_at: datetime
    entry_count: int = 0
