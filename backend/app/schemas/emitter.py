from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.core.enums import EmitterStatus


class EmitterCreate(BaseModel):
    name: str
    designation: str | None = None
    description: str | None = None


class EmitterUpdate(BaseModel):
    name: str | None = None
    designation: str | None = None
    description: str | None = None


class EmitterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    designation: str | None = None
    description: str | None = None
    status: EmitterStatus
    is_deleted: bool
    created_at: datetime
    updated_at: datetime
