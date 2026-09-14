from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, ConfigDict

class SourceGroupBase(BaseModel):
    name: str
    description: str | None = None

class SourceGroupCreate(SourceGroupBase):
    pass

class SourceGroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None

class SourceGroupOut(SourceGroupBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    updated_at: datetime
