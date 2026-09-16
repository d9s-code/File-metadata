from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class FunctionGroupCreate(BaseModel):
    name: str
    sort_order: int = 0


class FunctionGroupUpdate(BaseModel):
    name: str | None = None
    sort_order: int | None = None


class FunctionGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    name: str
    sort_order: int
    modes_count: int = 0
    created_at: datetime
    updated_at: datetime
