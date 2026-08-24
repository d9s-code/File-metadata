from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CommitVersionRequest(BaseModel):
    change_summary: str | None = None


class EmitterVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    version_number: int
    change_summary: str | None = None
    created_by: UUID | None = None
    created_at: datetime


class EmitterVersionDetailOut(EmitterVersionOut):
    snapshot: dict


class DiffEntry(BaseModel):
    path: str
    value: object | None = None
    old_value: object | None = None
    new_value: object | None = None


class DiffOut(BaseModel):
    added: list[DiffEntry]
    removed: list[DiffEntry]
    changed: list[DiffEntry]
    identical: bool


class StatusTransitionRequest(BaseModel):
    new_status: str
    note: str | None = None
