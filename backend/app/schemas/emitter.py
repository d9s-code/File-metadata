from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.core.enums import TestResult


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
    per-Mode one), so they're not gated on Mode status. `sim_lines` is how
    many SIM Test Lines the Emitter has, `sim_lines_correct` how many of them
    were correct (pass) in the latest run that included them.

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
    sim_lines: int = 0
    sim_lines_correct: int = 0


class EmitterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    designation: str | None = None
    description: str | None = None
    status: str
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
    assignee_id: UUID | None = None
    # Populated by attach_emitter_summaries.
    assignee_username: str | None = None
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


class EmitterCheckoutOut(BaseModel):
    """One Emitter someone holds for editing — for "you're still editing
    these" reminders and the Admin's view of every edit lock."""

    emitter_id: UUID
    emitter_name: str
    checked_out_by_id: UUID
    checked_out_by_username: str | None = None
    checked_out_at: datetime | None = None
    # The holder's latest change to it since taking the lock (or when they took it).
    last_activity_at: datetime | None = None
    # Untouched for CHECKOUT_WARN_DAYS: flagged.
    stale: bool = False
    # When it will be released if still untouched (null: never).
    releases_at: datetime | None = None


class EmitterBulkAction(BaseModel):
    """One action applied to many Emitters from the list."""

    emitter_ids: list[UUID] = Field(min_length=1, max_length=500)
    # assign: to assignee_id (null: nobody); status: to new_status (with note
    # where the move needs one); pin: their latest saved version into
    # platform_id; release: their edit lock.
    action: Literal["assign", "status", "pin", "release"]
    assignee_id: UUID | None = None
    new_status: str | None = None
    note: str | None = None
    # status: move even where milestones for it aren't all met.
    confirm_unmet: bool = False
    platform_id: UUID | None = None


class EmitterBulkResult(BaseModel):
    id: UUID
    name: str
    ok: bool
    # What was done, or why it was skipped.
    message: str


class EmitterBulkOut(BaseModel):
    done: int
    skipped: int
    results: list[EmitterBulkResult]
