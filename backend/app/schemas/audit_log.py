from datetime import datetime
from uuid import UUID

from pydantic import AliasPath, BaseModel, ConfigDict, Field

from app.core.enums import AuditAction


class AuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    actor_id: UUID | None = None
    actor_username: str | None = Field(default=None, validation_alias=AliasPath("actor", "username"))
    action: AuditAction
    entity_type: str
    entity_id: UUID | None = None
    summary: str
    changes: dict | None = None
    created_at: datetime


class AuditLogPage(BaseModel):
    items: list[AuditLogOut]
    total: int


class AuditGroupCount(BaseModel):
    entity_type: str
    count: int


class AuditActionCount(BaseModel):
    action: AuditAction
    count: int
