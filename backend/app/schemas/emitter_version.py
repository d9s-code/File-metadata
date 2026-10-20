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
    created_by_username: str | None = None


class EmitterVersionDetailOut(EmitterVersionOut):
    snapshot: dict


class DiffEntry(BaseModel):
    path: str
    value: object | None = None
    old_value: object | None = None
    new_value: object | None = None


class EmitterDiffEntry(BaseModel):
    scope: str
    label: str
    kind: str
    old_value: object | None = None
    new_value: object | None = None


class DiffOut(BaseModel):
    added: list[DiffEntry]
    removed: list[DiffEntry]
    changed: list[DiffEntry]
    identical: bool
    # The same changes, readable — what a Platform's or MDF's history shows (see pinned_diff_service).
    entries: list[EmitterDiffEntry] = []


class EmitterDiffOut(BaseModel):
    entries: list[EmitterDiffEntry]
    identical: bool


class RevertPreviewOut(BaseModel):
    """What a revert to a version would do to the live Emitter."""

    # From the live Emitter to that version, item by item.
    entries: list[EmitterDiffEntry]
    identical: bool
    # Logged test results naming a Mode or SIM line the revert removes: they're
    # kept, and show the name with "(deleted)" until a revert brings it back.
    results_naming_removed: int
    # Changes since the last saved version that the revert throws away.
    unsaved_changes: int


class StatusTransitionRequest(BaseModel):
    new_status: str
    note: str | None = None
    # Move even though some milestones for the new status aren't met (the
    # first try without it is refused with the list).
    confirm_unmet: bool = False
