from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CommitVersionRequest(BaseModel):
    # Shared by Platform and MDF commits too (see app/routers/platforms.py,
    # mdfs.py) — stays optional for those. Emitter commits use
    # CommitEmitterVersionRequest below instead, which requires it.
    change_summary: str | None = None


class CommitEmitterVersionRequest(BaseModel):
    # Required, unlike Platform/MDF commits — see docs/FEATURES.md's Emitter
    # versioning section for why.
    change_summary: str = Field(min_length=1)

    @field_validator("change_summary")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("change_summary can't be blank")
        return stripped


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


class ForkRequest(BaseModel):
    new_name: str = Field(min_length=1)
