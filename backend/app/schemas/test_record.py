from datetime import date, datetime
from uuid import UUID

from pydantic import AliasPath, BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.enums import PriType, TestRecordModeLinkType, TestResult, TestScopeType, TestType

_OBSERVED_VALUE_KEYS = {
    "rf_min_mhz",
    "rf_max_mhz",
    "pw_min_us",
    "pw_max_us",
    "pri_type",
    "pri_min_us",
    "pri_max_us",
    "jitter_min_us",
    "jitter_max_us",
    "pri_stagger_values_us",
    "frame_time_us",
}


def _validate_observed_value_set(v: dict) -> dict:
    """Shape rules for one observed-values set. Only rejects genuinely
    contradictory combinations, not incompleteness — this is a lightweight
    anomaly note, not a full line re-entry (unlike ModeLineFields)."""
    unknown = set(v) - _OBSERVED_VALUE_KEYS
    if unknown:
        raise ValueError(f"Unknown observed_values key(s): {unknown}")
    cleaned = {k: val for k, val in v.items() if val is not None}
    pri_type = cleaned.get("pri_type")
    has_stagger = "pri_stagger_values_us" in cleaned
    has_jitter = "jitter_min_us" in cleaned or "jitter_max_us" in cleaned
    has_pri_range = "pri_min_us" in cleaned or "pri_max_us" in cleaned
    has_frame_time = "frame_time_us" in cleaned
    if has_stagger and (has_jitter or has_pri_range):
        raise ValueError("observed_values: pri_stagger_values_us cannot be combined with PRI min/max or jitter")
    if (has_jitter or has_stagger or has_pri_range or has_frame_time) and pri_type is None:
        raise ValueError("observed_values: pri_type is required when PRI/jitter/stagger/frame time values are given")
    if has_frame_time and pri_type != PriType.stagger.value:
        raise ValueError("observed_values: frame_time_us only applies to a stagger PRI")
    if has_frame_time and cleaned["frame_time_us"] <= 0:
        raise ValueError("observed_values: frame_time_us must be > 0")
    if pri_type == PriType.stagger.value and has_pri_range:
        raise ValueError("observed_values: pri_type 'stagger' cannot carry pri_min_us/pri_max_us")
    if pri_type in (PriType.cw.value, PriType.xlet.value) and (has_pri_range or has_jitter or has_stagger):
        raise ValueError(f"observed_values: pri_type '{pri_type}' does not carry PRI/jitter/stagger values")
    return cleaned


def _clean_observed_value_sets(v: list[dict] | None) -> list[dict] | None:
    if v is None:
        return v
    cleaned = [_validate_observed_value_set(item) for item in v]
    cleaned = [c for c in cleaned if c]
    return cleaned or None


# Other TestType values remain only on historical records.
LOGGABLE_TEST_TYPES = frozenset({TestType.simulation, TestType.intercept})


class TestRecordModeResultIn(BaseModel):
    mode_id: UUID
    result: TestResult
    notes: str | None = None
    # What was actually measured for this Mode — zero or more sets, each a
    # subset of _OBSERVED_VALUE_KEYS (e.g. one per repeated measurement/run).
    observed_values: list[dict] | None = None

    @field_validator("observed_values")
    @classmethod
    def check_observed_values(cls, v: list[dict] | None) -> list[dict] | None:
        return _clean_observed_value_sets(v)


class TestRecordLineResultIn(BaseModel):
    test_line_id: UUID
    # Reuses TestResult: pass = correctly intercepted, partial = misclassified,
    # fail = missed entirely, inconclusive = couldn't be assessed this run.
    outcome: TestResult
    # Which of this Emitter's Modes the system reported for this line — any number.
    intercepted_mode_ids: list[UUID] = []
    notes: str | None = None
    # The intercepted parameters — same shape as TestRecordModeResultIn's.
    observed_values: list[dict] | None = None

    @field_validator("observed_values")
    @classmethod
    def check_observed_values(cls, v: list[dict] | None) -> list[dict] | None:
        return _clean_observed_value_sets(v)

    @field_validator("intercepted_mode_ids")
    @classmethod
    def dedupe_modes(cls, v: list[UUID]) -> list[UUID]:
        return list(dict.fromkeys(v))


class TestRecordCreate(BaseModel):
    test_type: TestType
    title: str
    notes: str | None = None
    test_date: date
    # Required for a Simulation test — when the simulation model/scenario itself
    # was built, as distinct from test_date (when the run happened against it).
    simulation_created_date: date | None = None
    # Per-Test-Line outcome — whether the simulated signal each line describes
    # was intercepted the way it was expected to be. When given (Emitter scope
    # only), this is what the whole-test `result` derives from — see
    # _create_test_record's precedence. The simulation-centric counterpart to
    # mode_results below.
    line_results: list[TestRecordLineResultIn] = []
    # Per-Mode outcome — kept for lab-bench/live-range/field-exercise style
    # tests (and MDF scope, which has no Test Lines) where "how did our own
    # Mode behave" is what's being logged rather than intercept correctness.
    # Used to derive `result` only when line_results is empty.
    mode_results: list[TestRecordModeResultIn] = []
    # Only used (and required) when neither line_results nor mode_results is
    # given — e.g. an MDF-scoped test, or an Emitter test not tied to any
    # specific Mode/Line — where there's nothing to derive an overall result from.
    result: TestResult | None = None
    # Optional pointer to an earlier test record this one re-runs, e.g. after a
    # fix — must belong to the same scope (checked in the router).
    retests_test_record_id: UUID | None = None
    # Per-Function-Group manual override — used when the tester's judgment of
    # that Function Group's overall performance differs from the mechanical
    # worst-of-N aggregate computed from mode_results (see _create_test_record).
    # A Function Group not present here just gets its computed aggregate.
    function_group_overrides: dict[UUID, TestResult] = {}

    @field_validator("test_type")
    @classmethod
    def check_test_type(cls, v: TestType) -> TestType:
        if v not in LOGGABLE_TEST_TYPES:
            raise ValueError("Only simulation and intercept tests can be logged")
        return v

    @model_validator(mode="after")
    def check_simulation_date(self) -> "TestRecordCreate":
        if self.test_type == TestType.simulation and self.simulation_created_date is None:
            raise ValueError("simulation_created_date is required for a Simulation test")
        return self

    @model_validator(mode="after")
    def check_result(self) -> "TestRecordCreate":
        if not self.line_results and not self.mode_results and self.result is None:
            raise ValueError("result is required when no per-Line or per-Mode results are given")
        return self


class TestRecordModeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    mode_id: UUID
    mode_name: str = Field(validation_alias=AliasPath("mode", "name"))
    link_type: TestRecordModeLinkType
    result: TestResult | None = None
    notes: str | None = None
    observed_values: list[dict] | None = None


class TestRecordFunctionGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    function_group_id: UUID
    function_group_name: str = Field(validation_alias=AliasPath("function_group", "name"))
    computed_result: TestResult
    override_result: TestResult | None = None


class InterceptedModeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    mode_id: UUID
    mode_name: str = Field(validation_alias=AliasPath("mode", "name"))


class TestRecordLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    test_line_id: UUID
    test_line_label: str = Field(validation_alias=AliasPath("test_line", "label"))
    outcome: TestResult
    intercepted_modes: list[InterceptedModeOut] = []
    notes: str | None = None
    observed_values: list[dict] | None = None


class TestRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    scope_type: TestScopeType
    scope_id: UUID
    emitter_version_id: UUID | None = None
    mdf_version_id: UUID | None = None
    test_type: TestType
    result: TestResult
    title: str
    notes: str | None = None
    tested_by: UUID | None = None
    test_date: date
    simulation_created_date: date | None = None
    created_at: datetime
    retests_test_record_id: UUID | None = None
    modes: list[TestRecordModeOut] = []
    function_groups: list[TestRecordFunctionGroupOut] = []
    lines: list[TestRecordLineOut] = []
