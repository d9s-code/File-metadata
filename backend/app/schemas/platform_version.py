from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class PlatformVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    platform_id: UUID
    version_number: int
    # "3", or "3.1" for a minor version (an Emitter repinned in v3).
    version_label: str
    major: int
    minor: int
    emitter_count: int = 0
    change_summary: str | None = None
    created_by: UUID | None = None
    created_at: datetime
    created_by_username: str | None = None


class PlatformVersionDetailOut(PlatformVersionOut):
    snapshot: dict
