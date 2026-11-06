from typing import Literal

from pydantic import BaseModel

from app.schemas.audit_log import AuditLogOut


class NeedsAttentionItem(BaseModel):
    message: str
    entity_type: Literal["emitter", "platform", "mdf", "intercept", "dwell_strategy"]
    entity_id: str
    # stale | rework | sim | mdf | intercepts | ambiguity | locks — for grouping on the dashboard.
    category: str


class NeedsRedoTestItem(BaseModel):
    entity_type: Literal["emitter", "mdf"]
    entity_id: str
    entity_name: str
    test_record_id: str
    title: str
    result: str
    test_date: str


class EmitterSimStatus(BaseModel):
    """How an Emitter's SIM Test Lines did in their latest run."""

    emitter_id: str
    name: str
    status: str
    line_count: int
    # Latest outcome per line: pass / partial / fail / inconclusive / untested.
    line_outcomes: dict[str, int]
    last_validated_at: str | None
    last_validated_result: str | None
    last_validated_test_record_id: str | None
    # Content was committed after the last simulation test.
    changed_since_validation: bool


class RecentTestRun(BaseModel):
    entity_type: Literal["emitter", "mdf"]
    entity_id: str
    entity_name: str
    test_record_id: str
    title: str
    test_type: str
    result: str
    test_date: str
    # SIM Test Line outcomes in this run, when it had any.
    line_outcomes: dict[str, int] | None


class DashboardOut(BaseModel):
    emitter_status_counts: dict[str, int]
    mdf_status_counts: dict[str, int]
    needs_attention: list[NeedsAttentionItem]
    sim_line_counts: dict[str, int]
    emitter_sim_status: list[EmitterSimStatus]
    recent_test_runs: list[RecentTestRun]
    needs_redo: list[NeedsRedoTestItem]
    recent_activity: list[AuditLogOut]


class OverviewOut(BaseModel):
    emitter_status_counts: dict[str, int]
    mdf_status_counts: dict[str, int]
    sim_line_counts: dict[str, int]
    emitter_sim_status: list[EmitterSimStatus]


class AttentionOut(BaseModel):
    needs_attention: list[NeedsAttentionItem]


class TestRunsOut(BaseModel):
    recent_test_runs: list[RecentTestRun]
    needs_redo: list[NeedsRedoTestItem]


class ActivityOut(BaseModel):
    recent_activity: list[AuditLogOut]


class AdminOut(BaseModel):
    failed_logins_24h: int
    recent_failed_logins: list[AuditLogOut]
    long_held_locks: list[NeedsAttentionItem]


class ReleaseMdf(BaseModel):
    id: str
    name: str
    status: str
    due_date: str | None
    customer: str | None
    # The MDF this one is the next release of, and the version it follows.
    based_on_mdf_name: str | None
    based_on_version_number: int | None
    latest_version: int | None


class ReleaseEmitter(BaseModel):
    """An Emitter on the current MDF: once, however many Platforms carry it."""

    emitter_id: str
    name: str
    designation: str | None
    status: str | None
    pinned_version: int
    latest_version: int | None
    platforms: list[str]
    assignee: str | None
    sim: EmitterSimStatus | None


class ReleaseChanges(BaseModel):
    """The current MDF's change notes, as its summary counts them by default."""

    since: str
    to_version: int
    change_notes: dict


class ReleaseOut(BaseModel):
    mdf: ReleaseMdf | None
    # An admin pinned it; otherwise it's the most recently changed unreleased MDF.
    pinned: bool
    emitters: list[ReleaseEmitter]
    changes: ReleaseChanges | None


class CurrentMdfIn(BaseModel):
    # None: unpin (the dashboard picks the most recently changed unreleased MDF).
    mdf_id: str | None


class HealthOut(BaseModel):
    """Counts of what needs a look outside the current release."""

    ambiguity: int
    intercepts: int
    held_for_editing: int
    dwell_testing: int
    # Admins only; None for everyone else.
    failed_logins_24h: int | None
