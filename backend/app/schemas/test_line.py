from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class TestLineCreate(BaseModel):
    label: str
    expected_mode_id: UUID | None = None
    # Entirely optional free-form note — whatever the source table happens to
    # carry (frequency, PRI, whatever else). Never validated: this is
    # display-only reference detail, not a re-entry of ModeLine.
    expected_parameters: dict | None = None


class TestLineImportRequest(BaseModel):
    lines: list[TestLineCreate]
    batch_label: str | None = None


class TestLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    label: str
    expected_mode_id: UUID | None = None
    # Populated by the router (not a plain from_attributes column) since
    # expected_mode may be null — see list_test_lines/import_test_lines.
    expected_mode_name: str | None = None
    expected_parameters: dict | None = None
    import_batch_label: str | None = None
    created_at: datetime
