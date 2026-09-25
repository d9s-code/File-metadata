from typing import Literal

from pydantic import BaseModel

from app.schemas.audit_log import AuditLogOut


class NeedsAttentionItem(BaseModel):
    message: str
    entity_type: Literal["emitter", "mdf"]
    entity_id: str
    # stale | rework | sim | mdf — for grouping on the dashboard.
    category: str


class PendingApprovalItem(BaseModel):
    message: str
    kind: Literal["source"]
    emitter_id: str


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
    pending_approvals: list[PendingApprovalItem]
    sim_line_counts: dict[str, int]
    emitter_sim_status: list[EmitterSimStatus]
    recent_test_runs: list[RecentTestRun]
    needs_redo: list[NeedsRedoTestItem]
    recent_activity: list[AuditLogOut]
