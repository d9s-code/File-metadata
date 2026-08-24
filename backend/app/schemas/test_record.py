from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.core.enums import TestResult, TestScopeType, TestType


class TestRecordCreate(BaseModel):
    test_type: TestType
    result: TestResult
    title: str
    notes: str | None = None
    test_date: date
    mode_ids: list[UUID] = []


class TestRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    scope_type: TestScopeType
    scope_id: UUID
    emitter_version_id: UUID | None = None
    mdf_version_id: UUID | None = None
    test_type: TestType
    result: TestResult
    title: str
    notes: str | None = None
    tested_by: UUID | None = None
    test_date: date
    created_at: datetime
