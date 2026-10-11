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


class TestLineSyncRequest(BaseModel):
    """A revised SIM table: lines are matched to the Emitter's existing ones
    by label (ignoring case and extra spaces), so a matched line keeps its id
    and its test history."""

    lines: list[TestLineCreate]
    # When the revised SIM lines were created in the simulator: set on every
    # line in the table, new or matched.
    created_date: date
    batch_label: str | None = None
    # Delete the Emitter's lines that aren't in the table (and their results
    # in logged runs). Off by default: they're kept as they are.
    remove_missing: bool = False
    # False: only work out what would change.
    apply: bool = False


class TestLineSyncChange(BaseModel):
    id: UUID
    label: str
    # What changes on a matched line: "label", "detail", "created date", "batch", "expected Mode".
    changes: list[str] = []


class TestLineSyncMissing(BaseModel):
    id: UUID
    label: str
    # How many logged test runs have a result for it (deleted with it if removed).
    results: int


class TestLineSyncOut(BaseModel):
    added: list[str]
    updated: list[TestLineSyncChange]
    unchanged: list[str]
    missing: list[TestLineSyncMissing]
    removed: bool
    applied: bool


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
