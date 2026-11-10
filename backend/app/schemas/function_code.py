from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class FunctionCodeCreate(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    sort_order: int | None = None


class FunctionCodeUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=32)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    sort_order: int | None = None


class FunctionCodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    name: str
    description: str | None = None
    sort_order: int
    # Emitters (not deleted) with this code.
    emitter_count: int = 0
    created_at: datetime
    updated_at: datetime
