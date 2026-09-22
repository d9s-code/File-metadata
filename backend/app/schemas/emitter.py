from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.core.enums import EmitterStatus, TestResult


class EmitterCreate(BaseModel):
    name: str
    designation: str | None = None
    description: str | None = None


class EmitterUpdate(BaseModel):
    name: str | None = None
    designation: str | None = None
    description: str | None = None


class EmitterSummary(BaseModel):
    """Read-computed, cross-Mode aggregate for one Emitter. RF/PW/PRI extremes
    are the min-of-mins/max-of-maxes across every Mode's line (PRI is
    naturally skipped for stagger/cw/xlet Modes, which carry no PRI min/max to
    aggregate). `scan_min`/`scan_max` come from a different source: the
    Emitter's EW Groups directly (scan is an EW Group-level field, not a
    per-Mode one), so they're not gated on Mode status. `modes_passing`
    counts Modes whose most recent test result is
    `pass` — deliberately NOT paired with an "Elements covered by Modes" stat:
    there's no stored link between a Mode and the Element(s) it was built
    from today, so that half of "how much of this Emitter is verified" isn't
    computable without a new data-model addition.

    rf/pw/pri_min/max_mhz|us are RAW extremes (each Mode Line's own raw
    min/max, before that line's own delta). engineered_* are the same
    extremes computed from each line's engineered (raw +/- delta) range
    instead — the true worst-case envelope once every Mode's own tolerance
    is folded in. The two commonly differ whenever any contributing Mode has
    a delta set; showing both (rather than just one) keeps that visible
    instead of silently picking a side.
    """

    rf_min_mhz: float | None = None
    rf_max_mhz: float | None = None
    pw_min_us: float | None = None
    pw_max_us: float | None = None
    pri_min_us: float | None = None
    pri_max_us: float | None = None
    engineered_rf_min_mhz: float | None = None
    engineered_rf_max_mhz: float | None = None
    engineered_pw_min_us: float | None = None
    engineered_pw_max_us: float | None = None
    engineered_pri_min_us: float | None = None
    engineered_pri_max_us: float | None = None
    scan_min: float | None = None
    scan_max: float | None = None
    mode_count: int = 0
    modes_passing: int = 0


class EmitterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    designation: str | None = None
    description: str | None = None
    status: EmitterStatus
    rework_note: str | None = None
    is_deleted: bool
    deleted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    checked_out_by_id: UUID | None = None
    # Populated by attach_emitter_summaries, not a plain from_attributes
    # column — see that function.
    checked_out_by_username: str | None = None
    checked_out_at: datetime | None = None
    forked_from_emitter_id: UUID | None = None
    forked_from_version_id: UUID | None = None
    # Versions at or below this number were copied in from the source
    # Emitter at fork time — viewable/diffable, but revert_emitter_version
    # refuses to revert to one directly (see that endpoint's docstring).
    forked_at_version_number: int | None = None
    summary: EmitterSummary = EmitterSummary()
    # Populated by attach_emitter_summaries — the Emitter-level headline: the
    # most recent Test Record that assessed this Emitter's Test Lines
    # (simulated-signal intercept correctness), replacing per-Mode "last
    # tested" as the primary read of this Emitter's validated state. None
    # until at least one Test Line has been logged against.
    last_validated_at: date | None = None
    last_validated_result: TestResult | None = None
    last_validated_test_record_id: UUID | None = None
