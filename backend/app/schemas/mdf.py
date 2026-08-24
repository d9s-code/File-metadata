from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.core.enums import MdfStatus


class MdfCreate(BaseModel):
    name: str
    description: str | None = None


class MdfUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class MdfOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None = None
    status: MdfStatus
    is_deleted: bool
    created_at: datetime
    updated_at: datetime


class MdfLinkCreate(BaseModel):
    platform_id: UUID
    platform_version_id: UUID


class MdfLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    mdf_id: UUID
    platform_id: UUID
    platform_version_id: UUID
    added_at: datetime


class MdfReadinessOut(BaseModel):
    warnings: list[str]
