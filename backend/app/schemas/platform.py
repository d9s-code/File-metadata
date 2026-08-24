from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class PlatformCreate(BaseModel):
    name: str
    description: str | None = None


class PlatformUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class PlatformOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None = None
    is_deleted: bool
    created_at: datetime
    updated_at: datetime


class PlatformLinkCreate(BaseModel):
    emitter_id: UUID
    emitter_version_id: UUID


class PlatformLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    platform_id: UUID
    emitter_id: UUID
    emitter_version_id: UUID
    added_at: datetime
