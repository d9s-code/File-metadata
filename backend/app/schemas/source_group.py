from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class SourceGroupCreate(BaseModel):
    name: str
    description: str | None = None


class SourceGroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class SourceGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None = None
    created_at: datetime
    updated_at: datetime
