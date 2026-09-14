from typing import Literal

from pydantic import BaseModel

from app.schemas.audit_log import AuditLogOut


class NeedsAttentionItem(BaseModel):
    message: str
    entity_type: Literal["emitter", "mdf"]
    entity_id: str


class PendingApprovalItem(BaseModel):
    message: str
    kind: Literal["source", "mode"]
    emitter_id: str


class NeedsRedoTestItem(BaseModel):
    entity_type: Literal["emitter", "mdf"]
    entity_id: str
    entity_name: str
    test_record_id: str
    title: str
    result: str
    test_date: str


class ActivityTrendPoint(BaseModel):
    date: str
    count: int


class DashboardOut(BaseModel):
    emitter_status_counts: dict[str, int]
    mdf_status_counts: dict[str, int]
    needs_attention: list[NeedsAttentionItem]
    pending_approvals: list[PendingApprovalItem]
    modes_passing_total: int
    modes_total: int
    test_result_counts: dict[str, int]
    needs_redo: list[NeedsRedoTestItem]
    recent_activity: list[AuditLogOut]
    activity_trend: list[ActivityTrendPoint]
