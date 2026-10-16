from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

EntityType = Literal["emitter", "platform", "mdf"]
Color = Literal["grey", "blue", "green", "yellow", "amber", "orange", "red", "purple"]


class StatusDefinitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    entity_type: str
    key: str
    label: str
    color: str
    position: int
    builtin: bool
    transitions: list[str]
    requires_note: bool
    note_prompt: str | None = None
    # How many live items are in it (a status in use can't be deleted).
    in_use: int = 0


def _clean(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if not v:
        raise ValueError("Can't be blank")
    return v


class StatusDefinitionCreate(BaseModel):
    entity_type: EntityType
    label: str = Field(min_length=1, max_length=60)
    color: Color = "grey"

    _label = field_validator("label")(_clean)


class StatusDefinitionUpdate(BaseModel):
    label: str | None = Field(default=None, max_length=60)
    color: Color | None = None
    transitions: list[str] | None = None
    requires_note: bool | None = None
    note_prompt: str | None = Field(default=None, max_length=200)

    _label = field_validator("label")(_clean)


class StatusReorder(BaseModel):
    entity_type: EntityType
    ids: list[UUID] = Field(min_length=1)


class MilestoneCreate(BaseModel):
    status_key: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None

    _title = field_validator("title")(_clean)


class MilestoneDefaultCreate(MilestoneCreate):
    entity_type: EntityType


class MilestoneUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    description: str | None = None
    status_key: str | None = Field(default=None, max_length=64)

    _title = field_validator("title")(_clean)


class MilestoneReorder(BaseModel):
    ids: list[UUID] = Field(min_length=1)


class MilestoneDefinitionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    entity_type: str
    entity_id: UUID | None = None
    status_key: str
    title: str
    description: str | None = None
    position: int


class ItemMilestoneOut(BaseModel):
    id: UUID
    status_key: str
    title: str
    description: str | None = None
    is_default: bool
    done: bool
    done_at: datetime | None = None
    done_by_username: str | None = None
    note: str | None = None


class MilestoneCheckIn(BaseModel):
    note: str | None = None
