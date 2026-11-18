from datetime import date, datetime, time
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.core.enums import PriType, TestRecordModeLinkType, TestResult, TestScopeType, TestType

# Intercepted parameters are logged as means (as measured); the min/max keys
# remain accepted for sets logged before that.
_OBSERVED_VALUE_KEYS = {
    "rf_mean_mhz",
    "pri_type",
    "pri_mean_us",
    "jitter_mean_us",
    "pri_stagger_values_us",
    "frame_time_us",
    "pw_mean_us",
    # Accepted on sets logged while it was asked per set; it's the run's now.
    "received_power_dbfs",
    # Earlier min/max form.
    "rf_min_mhz",
    "rf_max_mhz",
    "pw_min_us",
    "pw_max_us",
    "pri_min_us",
    "pri_max_us",
    "jitter_min_us",
    "jitter_max_us",
}

_FIXED_ONLY_MEAN_KEYS = ("pri_mean_us", "jitter_mean_us")


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
    has_jitter = any(k in cleaned for k in ("jitter_min_us", "jitter_max_us", "jitter_mean_us"))
    has_pri_range = any(k in cleaned for k in ("pri_min_us", "pri_max_us", "pri_mean_us"))
    has_frame_time = "frame_time_us" in cleaned
    if has_stagger and (has_jitter or has_pri_range):
        raise ValueError("observed_values: pri_stagger_values_us cannot be combined with a PRI value or jitter")
    if (has_jitter or has_stagger or has_pri_range or has_frame_time) and pri_type is None:
        raise ValueError("observed_values: pri_type is required when PRI/jitter/stagger/frame time values are given")
    fixed_only = [k for k in _FIXED_ONLY_MEAN_KEYS if k in cleaned]
    if fixed_only and pri_type != PriType.fixed.value:
        raise ValueError(f"observed_values: {', '.join(fixed_only)} only applies to a fixed PRI")
    if has_frame_time and pri_type != PriType.stagger.value:
        raise ValueError("observed_values: frame_time_us only applies to a stagger PRI")
    if has_frame_time and cleaned["frame_time_us"] <= 0:
        raise ValueError("observed_values: frame_time_us must be > 0")
    if pri_type == PriType.stagger.value and has_pri_range:
        raise ValueError("observed_values: pri_type 'stagger' cannot carry a PRI value")
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
    # Reuses TestResult: pass = correctly intercepted, partial = partly recognised (e.g. as the wrong Mode),
    # fail = missed entirely, inconclusive = couldn't be assessed this run.
    outcome: TestResult
    # Which of this Emitter's Modes the system reported for this line — any number.
    intercepted_mode_ids: list[UUID] = []
    # Reported as Default Unknown (no Mode matched) — with or without Modes.
    intercepted_as_unknown: bool = False
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


class TestRecordSignalIn(BaseModel):
    """A signal intercepted during an Intercept Test that isn't tied to a Mode."""

    observed_values: list[dict] = Field(min_length=1)
    # Reported as Default Unknown (the sensor's "no Mode matched"); else unreported.
    reported_as_unknown: bool = True
    notes: str | None = None

    @field_validator("observed_values")
    @classmethod
    def check_observed_values(cls, v: list[dict]) -> list[dict]:
        cleaned = _clean_observed_value_sets(v)
        if not cleaned:
            raise ValueError("A signal needs at least one measured value")
        return cleaned


class TestRecordCreate(BaseModel):
    test_type: TestType
    title: str
    notes: str | None = None
    test_date: date
    # When on test_date it ran (optional).
    test_time: time | None = None
    # Required for a Simulation test — when the simulation model/scenario itself
    # was built, as distinct from test_date (when the run happened against it).
    simulation_created_date: date | None = None
    # How strong the signals were received over the whole run, in dBFS — required.
    received_power_dbfs: float = Field(allow_inf_nan=False)
    # "Manual", or a value written in (e.g. "50 ms") — the dwell the whole run
    # used. Optional; blank means not recorded.
    dwell: str | None = Field(default=None, max_length=100)
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
    # Intercept Tests only: signals not tied to any of the Emitter's Modes.
    # They don't count towards the result (override it if they should).
    signals: list[TestRecordSignalIn] = []
    # Only used (and required) when neither line_results nor mode_results is
    # given — e.g. an MDF-scoped test, or an Emitter test not tied to any
    # specific Mode/Line — where there's nothing to derive an overall result from.
    # An MDF test with mdf_scenario works it out from what was observed unless given.
    result: TestResult | None = None
    # MDF tests only: the Platforms presented, the Emitters on the air with
    # each, what was observed of them, and which Platform each was intercepted as.
    mdf_scenario: "MdfScenarioIn | None" = None
    # Optional pointer to an earlier test record this one re-runs, e.g. after a
    # fix — must belong to the same scope (checked in the router).
    retests_test_record_id: UUID | None = None
    # The draft this run was filled in as, deleted once it's logged.
    draft_id: UUID | None = None
    # Emitter scope: the saved version that was tested — the latest one when
    # not given. Kept on the record, so the run always says what it tested.
    emitter_version_id: UUID | None = None
    # The saved Dwell Strategy version the run used, if any.
    dwell_strategy_version_id: UUID | None = None
    # The tester's call on the whole run, over the result worked out from the
    # lines or Modes — with why (required). Ignored if it's the same.
    result_override: TestResult | None = None
    result_override_note: str | None = Field(default=None, max_length=2000)

    @field_validator("test_type")
    @classmethod
    def check_test_type(cls, v: TestType) -> TestType:
        if v not in LOGGABLE_TEST_TYPES:
            raise ValueError("Only Simulation and Intercept Tests can be logged")
        return v

    @field_validator("dwell")
    @classmethod
    def normalize_dwell(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        v = v.strip()
        return "Manual" if v.lower() == "manual" else v

    @model_validator(mode="after")
    def check_simulation_date(self) -> "TestRecordCreate":
        if self.test_type == TestType.simulation and self.simulation_created_date is None:
            raise ValueError("simulation_created_date is required for a Simulation Test")
        return self

    @model_validator(mode="after")
    def check_signals(self) -> "TestRecordCreate":
        if self.signals and self.test_type != TestType.intercept:
            raise ValueError("Only an Intercept Test logs signals not tied to a Mode")
        return self

    @model_validator(mode="after")
    def check_override_note(self) -> "TestRecordCreate":
        if self.result_override is not None and not (self.result_override_note or "").strip():
            raise ValueError("Say why the result is overridden (result_override_note)")
        return self

    @model_validator(mode="after")
    def check_result(self) -> "TestRecordCreate":
        if not self.line_results and not self.mode_results and self.result is None and self.mdf_scenario is None:
            raise ValueError("result is required when no per-Line or per-Mode results are given")
        return self


class TestRecordModeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    mode_id: UUID
    # Its name now, or when the result was logged if it's since been deleted.
    mode_name: str = Field(validation_alias="display_mode_name")
    mode_exists: bool = True
    link_type: TestRecordModeLinkType
    result: TestResult | None = None
    notes: str | None = None
    observed_values: list[dict] | None = None


class InterceptedModeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    mode_id: UUID
    mode_name: str = Field(validation_alias="display_mode_name")
    mode_exists: bool = True


class TestRecordLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    test_line_id: UUID
    # Its label now, or when the result was logged if it's since been deleted.
    test_line_label: str = Field(validation_alias="display_test_line_label")
    outcome: TestResult
    intercepted_modes: list[InterceptedModeOut] = []
    intercepted_as_unknown: bool = False
    notes: str | None = None
    observed_values: list[dict] | None = None


class TestRecordSignalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    observed_values: list[dict]
    reported_as_unknown: bool
    notes: str | None = None


class TestRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    scope_type: TestScopeType
    scope_id: UUID
    emitter_version_id: UUID | None = None
    mdf_version_id: UUID | None = None
    test_type: TestType
    result: TestResult
    # Set when the result was overridden: what it worked out to, and why.
    computed_result: TestResult | None = None
    result_note: str | None = None
    title: str
    notes: str | None = None
    tested_by: UUID | None = None
    test_date: date
    # When on test_date it ran (optional).
    test_time: time | None = None
    simulation_created_date: date | None = None
    # None on runs logged before it was asked.
    received_power_dbfs: float | None = None
    dwell: str | None = None
    created_at: datetime
    retests_test_record_id: UUID | None = None
    # The saved Emitter version tested, by number (emitter_version_id is the version).
    emitter_version_number: int | None = None
    # The tested version's frequency range, deltas applied, and each of its
    # Modes' by Mode id (empty when no saved version was tested).
    rf_min_mhz: float | None = None
    rf_max_mhz: float | None = None
    mode_rf_mhz: dict[str, list[float | None]] = {}
    # The Dwell Strategy version the run used: the Strategy, its name then, and the version.
    dwell_strategy_version_id: UUID | None = None
    dwell_strategy_id: UUID | None = None
    dwell_strategy_name: str | None = None
    dwell_strategy_version_number: int | None = None
    # Set when this record is one Emitter's part of a Platform test.
    platform_test_id: UUID | None = None
    # That Platform test's Platform and title, to link back to it.
    platform_test_platform_id: UUID | None = None
    platform_test_title: str | None = None
    modes: list[TestRecordModeOut] = []
    lines: list[TestRecordLineOut] = []
    signals: list[TestRecordSignalOut] = []
    # An MDF test: the Platforms presented, the Emitters observed, and the verdicts.
    mdf_test_platforms: list["MdfTestPlatformOut"] = []
    scenario_emitters: list["ScenarioEmitterOut"] = []
    scenario_verdicts: "ScenarioVerdictsOut | None" = None


class TestRunDraftSave(BaseModel):
    title: str = Field(default="", max_length=500)
    test_type: TestType
    summary: str | None = Field(default=None, max_length=300)
    state: dict
    # The version this save builds on (omitted when creating).
    version: int | None = None


class TestRunDraftOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    # An Emitter's run, or a Platform test's — one of the two.
    emitter_id: UUID | None = None
    platform_id: UUID | None = None
    title: str
    test_type: str
    summary: str | None = None
    version: int
    created_at: datetime
    updated_at: datetime
    created_by_username: str | None = None
    updated_by_username: str | None = None


class TestRunDraftFull(TestRunDraftOut):
    state: dict


class TestDwellStrategyChange(BaseModel):
    """Which saved Dwell Strategy version a logged run used — set (or cleared)
    afterwards, e.g. for a run logged before Strategies were picked."""

    dwell_strategy_version_id: UUID | None = None


class TestResultChange(BaseModel):
    """Changing a logged run's overall result by hand. Setting it back to
    what it worked out to clears the override."""

    result: TestResult
    note: str | None = Field(default=None, max_length=2000)


class ScenarioReportIn(BaseModel):
    """A mix-up: the Emitter on the air reported as another one, optionally
    with which of its Modes was taken for which of the other's."""

    reported_emitter_id: UUID
    # In an MDF test: the Platform the reported Emitter is on (it may be on several).
    reported_platform_id: UUID | None = None
    expected_mode: str | None = Field(default=None, max_length=200)
    reported_mode: str | None = Field(default=None, max_length=200)


class ScenarioObservedIn(BaseModel):
    """What was observed of one Emitter on the air in a Platform or MDF test.
    All optional: a Platform test logged as before leaves them out."""

    # Null: not recorded.
    detected: bool | None = None
    time_to_detect_s: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    # The dwell of the run's Strategy version that caught it: 1 for the first.
    dwell_index: int | None = Field(default=None, ge=1)
    # Reported as itself; as Default Unknown; as other Emitters (mix-ups).
    reported_self: bool | None = None
    reported_unknown: bool = False
    reports: list[ScenarioReportIn] = Field(default=[], max_length=50)

    @model_validator(mode="after")
    def check_detected(self) -> "ScenarioObservedIn":
        if self.detected is False and (self.reported_self or self.reported_unknown or self.reports):
            raise ValueError("A missed Emitter can't have been reported as anything")
        if self.detected is not True and (self.time_to_detect_s is not None or self.dwell_index is not None):
            raise ValueError("Time to detect and the dwell that caught it are for a detected Emitter")
        return self

    def observed(self) -> bool:
        return self.detected is not None


class ScenarioEmitterOut(BaseModel):
    """One Emitter on the air in a Platform or MDF test, as it was observed."""

    model_config = ConfigDict(from_attributes=True)

    emitter_id: UUID
    emitter_name: str
    platform_id: UUID | None = None
    platform_name: str | None = None
    detected: bool | None = None
    time_to_detect_s: float | None = None
    dwell_index: int | None = None
    dwell_label: str | None = None
    reported_self: bool | None = None
    reported_unknown: bool = False
    result: str | None = None
    notes: str | None = None
    reports: list["ScenarioReportOut"] = []


class ScenarioReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    reported_emitter_id: UUID
    reported_emitter_name: str
    reported_platform_id: UUID | None = None
    reported_platform_name: str | None = None
    expected_mode: str | None = None
    reported_mode: str | None = None


ScenarioEmitterOut.model_rebuild()


class ScenarioVerdictsOut(BaseModel):
    """Three answers for a run, each a result: were they detected (Detection),
    reported as themselves (Identification), and taken for each other (Mix-ups)."""

    detection: str | None = None
    identification: str | None = None
    mixups: str | None = None
    detected: int = 0
    observed: int = 0
    identified: int = 0
    mixup_count: int = 0


class PlatformTestEmitterIn(ScenarioObservedIn):
    """One pinned Emitter's part of a Platform test — what TestRecordCreate
    takes for a single Emitter's run, minus what the whole run shares — and
    what was observed of it with the rest on the air."""

    emitter_id: UUID
    line_results: list[TestRecordLineResultIn] = []
    mode_results: list[TestRecordModeResultIn] = []
    signals: list[TestRecordSignalIn] = []
    result: TestResult | None = None
    result_override: TestResult | None = None
    result_override_note: str | None = Field(default=None, max_length=2000)
    notes: str | None = None
    # When this Emitter's simulation was built (each Emitter's SIM Test Lines
    # have their own) — or the run's when not given.
    simulation_created_date: date | None = None
    # When this redoes an earlier Platform test: the Emitter's record in it.
    retests_test_record_id: UUID | None = None


class PlatformTestCreate(BaseModel):
    test_type: TestType
    title: str
    # About the run as a whole; each Emitter's record gets its own notes, or these.
    notes: str | None = None
    test_date: date
    test_time: time | None = None
    simulation_created_date: date | None = None
    # The run's Received Power, in dBFS — required.
    received_power_dbfs: float = Field(allow_inf_nan=False)
    dwell: str | None = Field(default=None, max_length=100)
    # The saved Dwell Strategy version the run used (one of the Platform's), if any.
    dwell_strategy_version_id: UUID | None = None
    draft_id: UUID | None = None
    emitters: list[PlatformTestEmitterIn] = Field(min_length=1)

    def record_for(self, entry: PlatformTestEmitterIn) -> TestRecordCreate:
        """The Emitter's test record, as if its run had been logged on its own."""
        return TestRecordCreate(
            test_type=self.test_type,
            title=self.title,
            notes=(entry.notes or "").strip() or self.notes,
            test_date=self.test_date,
            test_time=self.test_time,
            simulation_created_date=entry.simulation_created_date or self.simulation_created_date,
            received_power_dbfs=self.received_power_dbfs,
            dwell=self.dwell,
            dwell_strategy_version_id=self.dwell_strategy_version_id,
            line_results=entry.line_results,
            mode_results=entry.mode_results,
            signals=entry.signals,
            result=entry.result,
            result_override=entry.result_override,
            result_override_note=entry.result_override_note,
            retests_test_record_id=entry.retests_test_record_id,
        )


class PlatformTestEmitterOut(BaseModel):
    test_record_id: UUID
    emitter_id: UUID
    emitter_name: str
    designation: str | None = None
    # The Emitter version tested: the one the Platform pinned.
    version_number: int | None = None
    # Its frequency range in that version, deltas applied.
    rf_min_mhz: float | None = None
    rf_max_mhz: float | None = None
    result: TestResult
    computed_result: TestResult | None = None
    lines: int = 0
    modes: int = 0
    signals: int = 0
    # How many SIM Test Lines / Modes came out each way, by result.
    line_counts: dict[str, int] = {}
    mode_counts: dict[str, int] = {}
    # The Emitter's own notes in the run (not the session notes it inherits).
    notes: str | None = None
    # When its simulation was built (or, for an Intercept Test, the intercept date).
    simulation_created_date: date | None = None
    # What was observed of it with the rest on the air (None on older runs).
    observed: ScenarioEmitterOut | None = None


class PlatformTestOut(BaseModel):
    id: UUID
    platform_id: UUID
    platform_version_number: int | None = None
    platform_version_label: str | None = None
    title: str
    test_type: str
    test_date: date
    notes: str | None = None
    tested_by_username: str | None = None
    created_at: datetime
    received_power_dbfs: float | None = None
    # The Dwell Strategy version the run used: the Strategy, its name then, and the version.
    dwell_strategy_version_id: UUID | None = None
    dwell_strategy_id: UUID | None = None
    dwell_strategy_name: str | None = None
    dwell_strategy_version_number: int | None = None
    # The worst of the Emitters' results.
    result: TestResult
    emitters: list[PlatformTestEmitterOut]
    # Detection, Identification and Mix-ups — when the run recorded what was observed.
    verdicts: ScenarioVerdictsOut | None = None


class MdfScenarioEmitterIn(ScenarioObservedIn):
    """One Emitter of a presented Platform, on the air in an MDF test."""

    emitter_id: UUID
    notes: str | None = Field(default=None, max_length=4000)


class MdfScenarioPlatformIn(BaseModel):
    """A Platform presented in an MDF test: its Emitters on the air (any of
    them), and which Platform it was intercepted as, when recorded."""

    platform_id: UUID
    intercepted_as_platform_id: UUID | None = None
    # Intercepted, but not as any of the MDF's Platforms.
    intercepted_unknown: bool = False
    notes: str | None = Field(default=None, max_length=4000)
    emitters: list[MdfScenarioEmitterIn] = Field(default=[], max_length=200)

    @model_validator(mode="after")
    def check_intercepted(self) -> "MdfScenarioPlatformIn":
        if self.intercepted_unknown and self.intercepted_as_platform_id is not None:
            raise ValueError("Intercepted as a Platform, or as none — not both")
        return self


class MdfScenarioIn(BaseModel):
    platforms: list[MdfScenarioPlatformIn] = Field(min_length=1, max_length=200)


class MdfTestPlatformOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    platform_id: UUID
    platform_name: str
    intercepted_as_platform_id: UUID | None = None
    intercepted_as_name: str | None = None
    intercepted_unknown: bool = False
    notes: str | None = None


TestRecordCreate.model_rebuild()
TestRecordOut.model_rebuild()
