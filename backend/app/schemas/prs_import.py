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


class PrsFileModeOut(BaseModel):
    index: int
    name: str
    ew_group_name: str
    pri_type: str


class PrsUpdatePairOut(BaseModel):
    mode_id: UUID
    mode_name: str
    ew_group_name: str
    # The Mode in the file it's updated from (an index into file_modes), or none.
    file_index: int | None
    # How the pair was made: matched by name, picked by the user, or none.
    match: str
    # field -> {old, new}: what the update changes (empty: nothing).
    changes: dict[str, dict]
    notes: list[str]
    error: str | None


class PrsUpdatePreviewOut(BaseModel):
    file_emitter_name: str
    file_modes: list[PrsFileModeOut]
    # Modes in the file that can't be used (they don't pass a Mode's checks).
    issues: list[PrsImportIssueOut]
    pairs: list[PrsUpdatePairOut]


class PrsUpdateResultOut(BaseModel):
    updated: list[str]
    unchanged: list[str]
    skipped: list[str]
