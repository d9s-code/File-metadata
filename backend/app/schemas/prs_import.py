from uuid import UUID

from pydantic import BaseModel


class PrsImportIssueOut(BaseModel):
    mode_name: str
    error: str


class PrsImportResultOut(BaseModel):
    source_id: UUID
    ew_group_count: int
    created_ew_group_names: list[str]
    mode_count: int
    created_mode_ids: list[UUID]
