from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.emitter import IlluminationTimeMs
from app.schemas.mode import ScanSeconds, check_scan_box

MAX_PLANNED_VALUES = 64


class PlannedValue(BaseModel):
    """One planned value of a parameter: a single value or a min–max, with a
    note — and, for a dwell & switch PRI, how long it dwells there: pulses or
    ms, not both."""

    min: float = Field(gt=0)
    max: float | None = Field(default=None, gt=0)
    note: str | None = Field(default=None, max_length=2000)
    dwell_pulses: int | None = Field(default=None, ge=1)
    dwell_ms: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def check(self) -> "PlannedValue":
        if self.max is not None and self.max < self.min:
            raise ValueError(f"A planned value's max ({self.max:g}) is below its min ({self.min:g})")
        if self.dwell_pulses is not None and self.dwell_ms is not None:
            raise ValueError("A dwell is in pulses or in ms, not both")
        return self


class OperationalModePlan(BaseModel):
    """The values planned for an operational mode, for analysis: several RF,
    PRI and PW values each. An empty list: none planned here — the one above
    it's apply. A PRI marked dwell & switch dwells on each of its PRIs in turn."""

    rf: list[PlannedValue] = Field(default_factory=list, max_length=MAX_PLANNED_VALUES)
    pri: list[PlannedValue] = Field(default_factory=list, max_length=MAX_PLANNED_VALUES)
    pri_dwell_switch: bool = False
    pw: list[PlannedValue] = Field(default_factory=list, max_length=MAX_PLANNED_VALUES)

    @model_validator(mode="after")
    def check(self) -> "OperationalModePlan":
        if self.pri_dwell_switch and len(self.pri) < 2:
            raise ValueError("A dwell & switch PRI needs 2 PRIs or more")
        if not self.pri_dwell_switch and any(v.dwell_pulses or v.dwell_ms for v in self.pri):
            raise ValueError("A PRI's dwell is for a dwell & switch — mark it as one")
        if any(v.dwell_pulses or v.dwell_ms for v in [*self.rf, *self.pw]):
            raise ValueError("Only a dwell & switch PRI has a dwell")
        return self

    def stored(self) -> dict | None:
        """As kept: None when nothing is planned."""
        data = self.model_dump(exclude_none=True)
        return data if (self.rf or self.pri or self.pw) else None


class OperationalModeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    # The one it sits under (one of the same Emitter's); None — at the top.
    parent_id: UUID | None = None
    description: str | None = None
    illumination_time_ms: IlluminationTimeMs | None = None
    # Both, or neither.
    scan_min_s: ScanSeconds | None = None
    scan_max_s: ScanSeconds | None = None
    # Its place among its siblings; None — after them.
    sort_order: int | None = None
    plan: OperationalModePlan | None = None

    @model_validator(mode="after")
    def check_scan(self) -> "OperationalModeCreate":
        check_scan_box(self.scan_min_s, self.scan_max_s)
        return self


class OperationalModeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    # Moves it (with everything under it); null — to the top.
    parent_id: UUID | None = None
    description: str | None = None
    # Null clears it: its Modes then take the Emitter's.
    illumination_time_ms: IlluminationTimeMs | None = None
    # Both together, or both null to clear it (checked against each other on save).
    scan_min_s: ScanSeconds | None = None
    scan_max_s: ScanSeconds | None = None
    sort_order: int | None = None
    # Replaces its plan (null or empty: nothing planned here).
    plan: OperationalModePlan | None = None


class OperationalModeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    parent_id: UUID | None = None
    name: str
    description: str | None = None
    illumination_time_ms: float | None = None
    scan_min_s: float | None = None
    scan_max_s: float | None = None
    plan: dict | None = None
    sort_order: int
    # How many of the Emitter's Modes are linked to it directly.
    modes_count: int = 0
    created_at: datetime
    updated_at: datetime


class OperationalModeSetValues(BaseModel):
    """Values set on every Mode under an operational mode (it and all below
    it) — e.g. the RF range Track 1, 2 and 3 share. Only the fields given are
    set; the rest of each Mode stays as it is. A PRI range or jitter is a
    Fixed PRI's: every Mode under it must be Fixed for those."""

    rf_min_mhz: float | None = Field(default=None, gt=0)
    rf_max_mhz: float | None = Field(default=None, gt=0)
    rf_delta: float | None = Field(default=None, ge=0)
    pw_min_us: float | None = Field(default=None, gt=0)
    pw_max_us: float | None = Field(default=None, gt=0)
    pw_delta: float | None = Field(default=None, ge=0)
    pri_min_us: float | None = Field(default=None, gt=0)
    pri_max_us: float | None = Field(default=None, gt=0)
    pri_delta: float | None = Field(default=None, ge=0)
    jitter_min_us: float | None = Field(default=None, ge=0)
    jitter_max_us: float | None = Field(default=None, ge=0)
    # A stagger's steps (µs) and its frame-time delta: every Mode under it must be a stagger for these.
    pri_stagger_values_us: list[Annotated[float, Field(gt=0)]] | None = Field(default=None, min_length=2, max_length=64)
    frame_time_delta_us: float | None = Field(default=None, ge=0)

    def given(self) -> dict:
        return {k: v for k, v in self.model_dump(exclude_unset=True).items() if v is not None}


class OperationalModeOrder(BaseModel):
    """Siblings in the order given — all of one parent's, each once."""

    parent_id: UUID | None = None
    ids: list[UUID] = Field(min_length=1)


class OperationalModeCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)
    # The operational mode it's about; None — the whole plan.
    operational_mode_id: UUID | None = None
    # A reply to this comment (a top-level one); it's then about what that one's about.
    parent_id: UUID | None = None


class OperationalModeCommentUpdate(BaseModel):
    # Only its author edits the text.
    body: str | None = Field(default=None, min_length=1, max_length=20_000)
    # A top-level comment, open or resolved.
    resolved: bool | None = None


class OperationalModeCommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    operational_mode_id: UUID | None = None
    operational_mode_name: str | None = None
    parent_id: UUID | None = None
    author_id: UUID | None = None
    author_username: str | None = None
    body: str
    resolved: bool
    resolved_by_username: str | None = None
    resolved_at: datetime | None = None
    edited_at: datetime | None = None
    created_at: datetime


class PlannedCombination(BaseModel):
    """One Mode to create: an RF, PRI and PW range (MHz, µs)."""

    rf_min_mhz: float = Field(gt=0)
    rf_max_mhz: float = Field(gt=0)
    pri_min_us: float = Field(gt=0)
    pri_max_us: float = Field(gt=0)
    pw_min_us: float = Field(gt=0)
    pw_max_us: float = Field(gt=0)


class GenerateFromPlan(BaseModel):
    """Modes for each of these combinations — the cartesian product of an
    operational mode's values — Fixed PRI, linked to it, in one generation
    batch (deletable together)."""

    ew_group_id: UUID
    source_id: UUID
    name_prefix: str = Field(min_length=1, max_length=150)
    combinations: list[PlannedCombination] = Field(min_length=1, max_length=1000)
    jitter_min_us: float = Field(default=0, ge=0)
    jitter_max_us: float = Field(default=0, ge=0)
