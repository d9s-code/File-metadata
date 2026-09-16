from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CommitVersionRequest(BaseModel):
    # Shared by Platform and MDF commits, which have no equivalent checkout
    # workflow forcing a summary — stays optional for those.
    change_summary: str | None = None


class CommitEmitterVersionRequest(BaseModel):
    # Required, unlike Platform/MDF commits — an Emitter commit is what
    # releases the checkout lock's changes into shared history, so it needs
    # a real "why", same reasoning as the Operational status-transition note.
    change_summary: str = Field(min_length=1)

    @field_validator("change_summary")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("change_summary can't be blank")
        return stripped


class ForkRequest(BaseModel):
    new_name: str = Field(min_length=1)


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


class EmitterDiffEntry(BaseModel):
    scope: str
    label: str
    kind: str
    old_value: object | None = None
    new_value: object | None = None


class EmitterDiffOut(BaseModel):
    entries: list[EmitterDiffEntry]
    identical: bool


class StatusTransitionRequest(BaseModel):
    new_status: str
    note: str | None = None
