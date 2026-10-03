from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

TaskEntityType = Literal["emitter", "platform", "mdf"]


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    notes: str | None = None
    # None: anyone can pick it up.
    assignee_id: UUID | None = None
    due_date: date | None = None
    entity_type: TaskEntityType | None = None
    entity_id: UUID | None = None

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("A task needs a title")
        return v


class TaskUpdate(BaseModel):
    """Only the fields sent change; send null to clear one."""

    title: str | None = Field(default=None, min_length=1, max_length=300)
    notes: str | None = None
    assignee_id: UUID | None = None
    due_date: date | None = None
    done: bool | None = None


class TaskOut(BaseModel):
    id: UUID
    title: str
    notes: str | None = None
    assignee_id: UUID | None = None
    assignee_username: str | None = None
    created_by_id: UUID | None = None
    created_by_username: str | None = None
    due_date: date | None = None
    done_at: datetime | None = None
    done_by_username: str | None = None
    entity_type: TaskEntityType | None = None
    entity_id: UUID | None = None
    # The linked item's name; None if it's been deleted for good.
    entity_name: str | None = None
    entity_deleted: bool = False
    created_at: datetime
    updated_at: datetime


class PersonOut(BaseModel):
    """Someone tasks and Emitters can be assigned to."""

    id: UUID
    username: str
    role: str


class AssignedEmitterOut(BaseModel):
    id: UUID
    name: str
    status: str
    checked_out_by_username: str | None = None
    open_tasks: int = 0


class MyWorkOut(BaseModel):
    """The dashboard's My work strip."""

    tasks: list[TaskOut]
    emitters: list[AssignedEmitterOut]
    # Open tasks nobody has taken yet.
    unassigned_open: int


class EmitterAssign(BaseModel):
    assignee_id: UUID | None = None
