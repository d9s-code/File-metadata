from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class DeletedItemOut(BaseModel):
    entity_type: str
    id: UUID
    name: str
    deleted_at: datetime
    expires_at: datetime
