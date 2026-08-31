from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, computed_field, field_validator, model_validator

from app.core.enums import ModeStatus, PriType, TestResult, TestType
from app.services.delta import apply_delta


def _validate_delta(v: float | None) -> float | None:
    if v is not None and v < 0:
        raise ValueError("delta must be >= 0")
    return v


class ModeLineFields(BaseModel):
    rf_min_mhz: float
    rf_max_mhz: float
    pw_min_us: float
    pw_max_us: float
    rf_delta: float | None = None
    pw_delta: float | None = None
    pri_delta: float | None = None
    pri_min_us: float | None = None
    pri_max_us: float | None = None
    jitter_min_us: float | None = None
    jitter_max_us: float | None = None
    pri_stagger_values_us: list[float] | None = None
    type_data: dict | None = None

    _validate_rf_delta = field_validator("rf_delta")(_validate_delta)
    _validate_pw_delta = field_validator("pw_delta")(_validate_delta)
    _validate_pri_delta = field_validator("pri_delta")(_validate_delta)

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
    elif pri_type == PriType.stagger:
        if not fields.pri_stagger_values_us or len(fields.pri_stagger_values_us) < 1:
            raise ValueError("Stagger PRI requires a non-empty pri_stagger_values_us sequence")
        if fields.pri_min_us is not None or fields.pri_max_us is not None:
            raise ValueError("Stagger PRI must not set pri_min_us/pri_max_us")
        if fields.jitter_min_us is not None or fields.jitter_max_us is not None:
            raise ValueError("Stagger PRI must not set jitter_min_us/jitter_max_us")
        if fields.pri_delta is not None:
            raise ValueError("Stagger PRI must not set pri_delta")
    elif pri_type == PriType.cw:
        if any(
            v is not None
            for v in (fields.pri_min_us, fields.pri_max_us, fields.jitter_min_us, fields.jitter_max_us)
        ) or fields.pri_stagger_values_us:
            raise ValueError("CW PRI carries no PRI/Jitter value")
        if fields.pri_delta is not None:
            raise ValueError("CW PRI must not set pri_delta")
    elif pri_type == PriType.xlet:
        if any(
            v is not None
            for v in (fields.pri_min_us, fields.pri_max_us, fields.jitter_min_us, fields.jitter_max_us)
        ) or fields.pri_stagger_values_us:
            raise ValueError("Xlet PRI has no fields defined yet")
        if fields.pri_delta is not None:
            raise ValueError("Xlet PRI must not set pri_delta")


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
    source_id: UUID
    name: str
    pri_type: PriType
    notes: str | None = None
    sort_order: int = 0
    line: ModeLineFields
    # Test Record(s) whose findings explain this Mode's values, for a Mode
    # that didn't come from the Source's data (see TestRecordModeLinkType).
    derived_from_test_record_ids: list[UUID] = []

    @model_validator(mode="after")
    def check_pri_type(self) -> "ModeCreate":
        validate_pri_type_fields(self.pri_type, self.line)
        require_manual_deltas(self.pri_type, self.line)
        return self


class ModeCreateFromDsl(BaseModel):
    source_id: UUID
    name: str
    dsl_text: str
    notes: str | None = None
    sort_order: int = 0


class ModeUpdate(BaseModel):
    name: str | None = None
    notes: str | None = None
    sort_order: int | None = None
    ew_group_id: UUID | None = None
    line: ModeLineFields | None = None


class ModeDraftCreate(BaseModel):
    """Proposes a line edit to an already-`approved` Mode. Creates a new
    `draft` Mode (same name/notes/EW-Group/Source as the original — only the
    line, and optionally the PRI Type it's expressed in, can change) that,
    once approved, supersedes the original. See ModeStatus.
    """

    pri_type: PriType
    line: ModeLineFields
    derived_from_test_record_ids: list[UUID] = []

    @model_validator(mode="after")
    def check_pri_type(self) -> "ModeDraftCreate":
        validate_pri_type_fields(self.pri_type, self.line)
        require_manual_deltas(self.pri_type, self.line)
        return self


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


class ModeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ew_group_id: UUID
    source_id: UUID
    name: str
    pri_type: PriType
    notes: str | None = None
    sort_order: int
    generation_batch_id: UUID | None = None
    status: ModeStatus
    supersedes_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
    line: ModeLineOut | None = None
    # Computed on read from test_record_modes/test_records — see
    # app.services.mode_test_status_service. Not populated on every endpoint
    # that returns a Mode; left null/empty unless the router explicitly
    # attaches it (list endpoints, where the overview value is worth the
    # extra query).
    last_tested_at: date | None = None
    last_test_result: TestResult | None = None
    last_test_record_id: UUID | None = None
    derived_from_test_records: list[TestRecordBrief] = []


class ModeGenerationBatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    ew_group_id: UUID
    source_id: UUID
    name_prefix: str
    created_at: datetime
    mode_count: int
