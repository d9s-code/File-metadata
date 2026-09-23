from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.core.enums import TestResult


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
    # When these SIM Test Lines were created in the simulator — typed in by
    # the user, applied to every line in this import.
    created_date: date


class TestLineUpdate(BaseModel):
    label: str | None = None
    expected_mode_id: UUID | None = None
    expected_parameters: dict | None = None
    created_date: date | None = None


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
    created_date: date | None = None
    # This line's status: its outcome in the most recent test run that
    # included it. Populated by the router, like expected_mode_name.
    last_test_result: TestResult | None = None
    last_tested_at: date | None = None
    last_test_record_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
