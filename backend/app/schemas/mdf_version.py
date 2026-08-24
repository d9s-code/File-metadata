from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class MdfVersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    mdf_id: UUID
    version_number: int
    change_summary: str | None = None
    created_by: UUID | None = None
    created_at: datetime


class MdfVersionDetailOut(MdfVersionOut):
    snapshot: dict


class MdfStatusTransitionOut(MdfVersionOut):
    warnings: list[str] = []
