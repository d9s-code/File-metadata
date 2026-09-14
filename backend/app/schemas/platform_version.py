from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class PlatformVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    platform_id: UUID
    version_number: int
    change_summary: str | None = None
    created_by: UUID | None = None
    created_at: datetime


class PlatformVersionDetailOut(PlatformVersionOut):
    snapshot: dict
