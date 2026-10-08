from datetime import date, datetime
from uuid import UUID

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator, model_validator

from app.core.enums import PriType, TestResult, TestType
from app.models.mode import DEFAULT_CONFIRMATION_QUALITY, DEFAULT_CONFIRMATION_QUANTITY
from app.schemas.intercept import InterceptEntryBrief
from app.services.delta import apply_delta
from app.services.frametime_service import FRAME_TIME_DECIMALS, effective_frametime_us


ConfirmationQuality = Annotated[int, Field(ge=0, le=100)]
ConfirmationQuantity = Annotated[int, Field(ge=1)]


def _validate_delta(v: float | None) -> float | None:
    if v is not None and v < 0:
        raise ValueError("delta must be >= 0")
    return v


# Line fields the DSL text doesn't carry — left out when re-rendering it.
NON_DSL_LINE_FIELDS = {
    "type_data",
    "rf_delta",
    "pw_delta",
    "pri_delta",
    "frame_time_delta_us",
    "explicit_frame_time_us",
    "rf_range_matching",
    "pw_range_matching",
    "pri_range_matching",
}


class ModeLineFields(BaseModel):
    rf_min_mhz: float
    rf_max_mhz: float
    pw_min_us: float
    pw_max_us: float
    # Set per parameter, not per Mode — required on every manual line submission,
    # same as rf_min_mhz/etc.; an instant PATCH like the rest of the line,
    # gated only by the Emitter's checkout lock (see ModeUpdate/update_mode).
    rf_range_matching: bool
    pw_range_matching: bool
    pri_range_matching: bool
    rf_delta: float | None = None
    pw_delta: float | None = None
    pri_delta: float | None = None
    pri_min_us: float | None = None
    pri_max_us: float | None = None
    jitter_min_us: float | None = None
    jitter_max_us: float | None = None
    pri_stagger_values_us: list[float] | None = None
    frame_time_delta_us: float | None = None
    # Stagger only — overrides the sum of pri_stagger_values_us when set.
    explicit_frame_time_us: float | None = None
    type_data: dict | None = None

    _validate_rf_delta = field_validator("rf_delta")(_validate_delta)
    _validate_pw_delta = field_validator("pw_delta")(_validate_delta)
    _validate_pri_delta = field_validator("pri_delta")(_validate_delta)
    _validate_frame_time_delta = field_validator("frame_time_delta_us")(_validate_delta)

    @field_validator("explicit_frame_time_us")
    @classmethod
    def check_explicit_frame_time(cls, v: float | None) -> float | None:
        if v is None:
            return v
        if v <= 0:
            raise ValueError("explicit_frame_time_us must be > 0")
        return round(v, FRAME_TIME_DECIMALS)

    @model_validator(mode="after")
    def check_ranges(self) -> "ModeLineFields":
        if self.rf_min_mhz > self.rf_max_mhz:
            raise ValueError("rf_min_mhz must be <= rf_max_mhz")
        if self.pw_min_us > self.pw_max_us:
            raise ValueError("pw_min_us must be <= pw_max_us")
        if self.pri_min_us is not None and self.pri_max_us is not None and self.pri_min_us > self.pri_max_us:
            raise ValueError("pri_min_us must be <= pri_max_us")
        if (
            self.jitter_min_us is not None
            and self.jitter_max_us is not None
            and self.jitter_min_us > self.jitter_max_us
        ):
            raise ValueError("jitter_min_us must be <= jitter_max_us")
        return self


def validate_pri_type_fields(pri_type: PriType, fields: ModeLineFields) -> None:
    """Enforces which line fields a given PRI Type requires vs. forbids."""
    if pri_type == PriType.fixed:
        if fields.pri_min_us is None or fields.pri_max_us is None:
            raise ValueError("Fixed PRI requires pri_min_us and pri_max_us")
        if fields.jitter_min_us is None or fields.jitter_max_us is None:
            raise ValueError("Fixed PRI requires jitter_min_us and jitter_max_us")
        if fields.pri_stagger_values_us:
            raise ValueError("Fixed PRI must not set pri_stagger_values_us")
        if fields.frame_time_delta_us is not None:
            raise ValueError("Fixed PRI must not set frame_time_delta_us")
        if fields.explicit_frame_time_us is not None:
            raise ValueError("Fixed PRI must not set explicit_frame_time_us")
    elif pri_type == PriType.stagger:
        if not fields.pri_stagger_values_us or len(fields.pri_stagger_values_us) < 1:
            raise ValueError("Stagger PRI requires a non-empty pri_stagger_values_us sequence")
        if fields.pri_min_us is not None or fields.pri_max_us is not None:
            raise ValueError("Stagger PRI must not set pri_min_us/pri_max_us")
        if fields.jitter_min_us is not None or fields.jitter_max_us is not None:
            raise ValueError("Stagger PRI must not set jitter_min_us/jitter_max_us")
        if fields.pri_delta is not None:
            raise ValueError("Stagger PRI must not set pri_delta")
        if fields.frame_time_delta_us is None:
            raise ValueError("Stagger PRI requires frame_time_delta_us")
    elif pri_type == PriType.cw:
        if any(
            v is not None
            for v in (fields.pri_min_us, fields.pri_max_us, fields.jitter_min_us, fields.jitter_max_us)
        ) or fields.pri_stagger_values_us:
            raise ValueError("CW PRI carries no PRI/Jitter value")
        if fields.pri_delta is not None:
            raise ValueError("CW PRI must not set pri_delta")
        if fields.frame_time_delta_us is not None:
            raise ValueError("CW PRI must not set frame_time_delta_us")
        if fields.explicit_frame_time_us is not None:
            raise ValueError("CW PRI must not set explicit_frame_time_us")
    elif pri_type == PriType.xlet:
        if any(
            v is not None
            for v in (fields.pri_min_us, fields.pri_max_us, fields.jitter_min_us, fields.jitter_max_us)
        ) or fields.pri_stagger_values_us:
            raise ValueError("Xlet PRI has no fields defined yet")
        if fields.pri_delta is not None:
            raise ValueError("Xlet PRI must not set pri_delta")
        if fields.frame_time_delta_us is not None:
            raise ValueError("Xlet PRI must not set frame_time_delta_us")
        if fields.explicit_frame_time_us is not None:
            raise ValueError("Xlet PRI must not set explicit_frame_time_us")


def require_manual_deltas(pri_type: PriType, fields: ModeLineFields) -> None:
    """Manually-authored mode lines (the Mode form, and edits to one) must always
    record a delta per range parameter, so raw-vs-engineered values are derivable
    exactly like the elements pool's per-element delta and EW Group's scan_delta.
    DSL-parsed and cartesian-generated lines are exempt — see ModeLine.rf_delta.
    """
    if fields.rf_delta is None:
        raise ValueError("rf_delta is required")
    if fields.pw_delta is None:
        raise ValueError("pw_delta is required")
    if pri_type == PriType.fixed and fields.pri_delta is None:
        raise ValueError("pri_delta is required for Fixed PRI")


class ModeCreate(BaseModel):
    # Every Source the Mode comes from (one or more), or just source_id for one.
    source_id: UUID | None = None
    source_ids: list[UUID] = []
    name: str
    pri_type: PriType
    notes: str | None = None
    sort_order: int = 0
    confirmation_quality: ConfirmationQuality = DEFAULT_CONFIRMATION_QUALITY
    confirmation_quantity: ConfirmationQuantity = DEFAULT_CONFIRMATION_QUANTITY
    line: ModeLineFields
    # Test Record(s) whose findings explain this Mode's values, for a Mode
    # that didn't come from the Source's data (see TestRecordModeLinkType).
    derived_from_test_record_ids: list[UUID] = []
    # Intercept Entry/Entries this Mode's values were pre-filled from — same
    # provenance idea as derived_from_test_record_ids, see InterceptEntryMode.
    derived_from_intercept_entry_ids: list[UUID] = []

    @model_validator(mode="after")
    def check_pri_type(self) -> "ModeCreate":
        if not self.all_source_ids():
            raise ValueError("A Mode needs at least one Source")
        validate_pri_type_fields(self.pri_type, self.line)
        require_manual_deltas(self.pri_type, self.line)
        return self

    def all_source_ids(self) -> list[UUID]:
        return self.source_ids or ([self.source_id] if self.source_id else [])


# Modes created from one Intercept at once.
MAX_MODES_FROM_INTERCEPT = 1000


class ModesFromIntercept(BaseModel):
    """Modes created from an Intercept's entries in one go — one Mode per
    entry, its ranges taken from the entry, all in one generation batch (so
    the batch can be deleted together from the Modes tab)."""

    intercept_id: UUID
    entry_ids: list[UUID] = Field(min_length=1, max_length=MAX_MODES_FROM_INTERCEPT)
    source_id: UUID
    # Modes are named "<prefix> 1", "<prefix> 2", … in rising RF, skipping names already used.
    name_prefix: str = Field(min_length=1, max_length=150)
    # "measured": each entry's measured min–max (its mean where it has none);
    # "mean": a single value at the mean.
    ranges: Literal["measured", "mean"] = "measured"
    rf_delta: float = Field(default=0, ge=0)
    pw_delta: float = Field(default=0, ge=0)
    # Fixed PRI's delta, and a stagger's frame-time delta.
    pri_delta: float = Field(default=0, ge=0)
    frame_time_delta_us: float = Field(default=0, ge=0)
    # A CW entry has no pulses, but a CW Mode still carries a PW range: given here.
    cw_pw_min_us: float | None = None
    cw_pw_max_us: float | None = None
    confirmation_quality: ConfirmationQuality = DEFAULT_CONFIRMATION_QUALITY
    confirmation_quantity: ConfirmationQuantity = DEFAULT_CONFIRMATION_QUANTITY


class PlannedNewMode(BaseModel):
    """A Mode to create, its line worked out (and shown) on the planning page."""

    entry_ids: list[UUID] = Field(min_length=1)
    pri_type: PriType
    line: ModeLineFields


class PlannedWiden(BaseModel):
    """An existing Mode to widen so it covers the given entries. Only ranges can
    grow here — each given min must be at or below the Mode's, each max at or
    above, and a stagger's frame-time delta at or above — never narrower, never
    any other field."""

    mode_id: UUID
    entry_ids: list[UUID] = Field(min_length=1)
    rf_min_mhz: float | None = None
    rf_max_mhz: float | None = None
    pri_min_us: float | None = None
    pri_max_us: float | None = None
    pw_min_us: float | None = None
    pw_max_us: float | None = None
    frame_time_delta_us: float | None = Field(default=None, ge=0)


class InterceptModePlan(BaseModel):
    """What the planning page applies in one go: new Modes (one generation
    batch) and widened Modes, all or nothing."""

    intercept_id: UUID
    source_id: UUID | None = None
    # New Modes are named "<prefix> 1", "<prefix> 2", … in the order given, skipping names already used.
    name_prefix: str | None = Field(default=None, max_length=150)
    confirmation_quality: ConfirmationQuality = DEFAULT_CONFIRMATION_QUALITY
    confirmation_quantity: ConfirmationQuantity = DEFAULT_CONFIRMATION_QUANTITY
    new_modes: list[PlannedNewMode] = Field(default_factory=list, max_length=MAX_MODES_FROM_INTERCEPT)
    widen: list[PlannedWiden] = Field(default_factory=list, max_length=MAX_MODES_FROM_INTERCEPT)

    @model_validator(mode="after")
    def check_plan(self) -> "InterceptModePlan":
        if not self.new_modes and not self.widen:
            raise ValueError("The plan is empty — nothing to create or widen")
        if self.new_modes and (self.source_id is None or not (self.name_prefix or "").strip()):
            raise ValueError("New Modes need a source_id and a name_prefix")
        ids = [w.mode_id for w in self.widen]
        if len(ids) != len(set(ids)):
            raise ValueError("Each Mode can be widened once per plan — combine its entries")
        return self


class ModeCreateFromDsl(BaseModel):
    source_id: UUID
    name: str
    dsl_text: str
    notes: str | None = None
    sort_order: int = 0
    confirmation_quality: ConfirmationQuality = DEFAULT_CONFIRMATION_QUALITY
    confirmation_quantity: ConfirmationQuantity = DEFAULT_CONFIRMATION_QUANTITY


class ModeUpdate(BaseModel):
    name: str | None = None
    notes: str | None = None
    sort_order: int | None = None
    confirmation_quality: ConfirmationQuality | None = None
    confirmation_quantity: ConfirmationQuantity | None = None
    ew_group_id: UUID | None = None
    # Replaces the Mode's Sources: all of them (one or more), or source_id for just one.
    source_id: UUID | None = None
    source_ids: list[UUID] | None = Field(default=None, min_length=1)
    # Changing this requires `line` in the same request — the old PRI type's
    # fields (e.g. Fixed's pri_min_us/jitter) are meaningless under a new one
    # (e.g. Stagger's pri_stagger_values_us), so there's no partial edit that
    # makes sense here; see update_mode's own check.
    pri_type: PriType | None = None
    line: ModeLineFields | None = None
    # Test Record(s) whose findings explain this Mode's (possibly just-edited)
    # values — same meaning as ModeCreate.derived_from_test_record_ids.
    derived_from_test_record_ids: list[UUID] = []
    derived_from_intercept_entry_ids: list[UUID] = []


class BatchModeFieldEdit(BaseModel):
    """Fields settable across a batch of Modes at once. Only keys actually
    present in the request are applied (see `exclude_unset` at the call
    site) — booleans stay tri-state (unset/true/false) this way, with no
    extra plumbing needed. Deliberately excludes RF/PW/PRI min/max/stagger
    values: setting those to one literal value across many Modes would
    collapse their ranges to be identical, which isn't a meaningful batch
    operation on a per-Mode range.
    """

    ew_group_id: UUID | None = None
    # Makes this the selected Modes' only Source.
    source_id: UUID | None = None
    # Adds this Source to each selected Mode's Sources (kept if already there).
    add_source_id: UUID | None = None
    notes: str | None = None
    confirmation_quality: ConfirmationQuality | None = None
    confirmation_quantity: ConfirmationQuantity | None = None
    rf_range_matching: bool | None = None
    pw_range_matching: bool | None = None
    pri_range_matching: bool | None = None
    rf_delta: float | None = None
    pw_delta: float | None = None
    pri_delta: float | None = None
    frame_time_delta_us: float | None = None
    # "Add/remove a fixed amount" — shifts the named bound by this signed
    # amount for every selected Mode (current_value + shift; negative to
    # subtract), independently of the other bound in the same parameter.
    # Unlike the deltas above this doesn't collapse ranges to one literal
    # value, so it's meaningful as a batch operation — but precisely because
    # it silently rewrites real data across many Modes at once, using any of
    # these six fields requires `shift_reason` (see ModeBatchEditRequest).
    rf_min_shift: float | None = None
    rf_max_shift: float | None = None
    pw_min_shift: float | None = None
    pw_max_shift: float | None = None
    pri_min_shift: float | None = None
    pri_max_shift: float | None = None

    _validate_rf_delta = field_validator("rf_delta")(_validate_delta)
    _validate_pw_delta = field_validator("pw_delta")(_validate_delta)
    _validate_pri_delta = field_validator("pri_delta")(_validate_delta)
    _validate_frame_time_delta = field_validator("frame_time_delta_us")(_validate_delta)

    def has_shift(self) -> bool:
        return any(
            v is not None
            for v in (
                self.rf_min_shift,
                self.rf_max_shift,
                self.pw_min_shift,
                self.pw_max_shift,
                self.pri_min_shift,
                self.pri_max_shift,
            )
        )


class ModeBatchEditRequest(BaseModel):
    mode_ids: list[UUID]
    fields: BatchModeFieldEdit
    # Required, non-blank, whenever `fields` sets any of the six *_shift
    # fields — same "a mechanical batch rewrite needs a written why" pattern
    # as CommitEmitterVersionRequest.change_summary. Optional/unused
    # otherwise, so ordinary field/delta batch edits are unaffected.
    shift_reason: str | None = None
    # Test Record(s) whose findings explain this batch's values — applied to
    # every affected Mode, same meaning as ModeUpdate.derived_from_test_record_ids.
    derived_from_test_record_ids: list[UUID] = []
    derived_from_intercept_entry_ids: list[UUID] = []

    @model_validator(mode="after")
    def check_non_empty(self) -> "ModeBatchEditRequest":
        if not self.mode_ids:
            raise ValueError("mode_ids must not be empty")
        if self.fields.has_shift() and not (self.shift_reason or "").strip():
            raise ValueError("shift_reason is required when shifting an existing value")
        return self


class ModeBatchEditError(BaseModel):
    mode_id: UUID
    mode_name: str
    error: str


class ModeBatchEditResult(BaseModel):
    updated_mode_ids: list[UUID]
    count: int


class TestRecordBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    test_type: TestType
    result: TestResult
    test_date: date


class ModeLineOut(ModeLineFields):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    mode_id: UUID
    dsl_text: str | None = None
    created_at: datetime

    @computed_field
    @property
    def engineered_rf_min_mhz(self) -> float | None:
        return apply_delta(self.rf_min_mhz, self.rf_max_mhz, self.rf_delta)[0]

    @computed_field
    @property
    def engineered_rf_max_mhz(self) -> float | None:
        return apply_delta(self.rf_min_mhz, self.rf_max_mhz, self.rf_delta)[1]

    @computed_field
    @property
    def engineered_pw_min_us(self) -> float | None:
        return apply_delta(self.pw_min_us, self.pw_max_us, self.pw_delta)[0]

    @computed_field
    @property
    def engineered_pw_max_us(self) -> float | None:
        return apply_delta(self.pw_min_us, self.pw_max_us, self.pw_delta)[1]

    @computed_field
    @property
    def engineered_pri_min_us(self) -> float | None:
        return apply_delta(self.pri_min_us, self.pri_max_us, self.pri_delta)[0]

    @computed_field
    @property
    def engineered_pri_max_us(self) -> float | None:
        return apply_delta(self.pri_min_us, self.pri_max_us, self.pri_delta)[1]

    @computed_field
    @property
    def frame_time_us(self) -> float | None:
        return effective_frametime_us(self.pri_stagger_values_us, self.explicit_frame_time_us)

    @computed_field
    @property
    def engineered_frame_time_min_us(self) -> float | None:
        return apply_delta(self.frame_time_us, self.frame_time_us, self.frame_time_delta_us)[0]

    @computed_field
    @property
    def engineered_frame_time_max_us(self) -> float | None:
        return apply_delta(self.frame_time_us, self.frame_time_us, self.frame_time_delta_us)[1]


class ModeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ew_group_id: UUID
    # The first of source_ids.
    source_id: UUID
    # Every Source the Mode comes from, in order, with their names.
    source_ids: list[UUID] = []
    source_names: list[str] = []
    name: str
    pri_type: PriType
    notes: str | None = None
    sort_order: int
    confirmation_quality: int
    confirmation_quantity: int
    generation_batch_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
    line: ModeLineOut | None = None
    # "Last seen": computed on read from the test runs the Mode was rated in
    # or reported for a SIM line in — see
    # app.services.mode_test_status_service. Not populated on every endpoint
    # that returns a Mode; left null/empty unless the router explicitly
    # attaches it (list endpoints, where the overview value is worth the
    # extra query).
    last_tested_at: date | None = None
    last_test_result: TestResult | None = None
    last_test_record_id: UUID | None = None
    # How many test runs it was seen in, by outcome ("pass": 3, "partial": 1).
    seen_counts: dict[str, int] = {}
    derived_from_test_records: list[TestRecordBrief] = []
    derived_from_intercepts: list[InterceptEntryBrief] = []


class ModeGenerationBatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ew_group_id: UUID
    source_id: UUID
    name_prefix: str
    created_at: datetime
    mode_count: int


class InterceptModePlanResult(BaseModel):
    created: list[ModeOut]
    widened: list[ModeOut]
