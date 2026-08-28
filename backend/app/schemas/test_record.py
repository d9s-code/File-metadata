from datetime import date, datetime
from uuid import UUID

from pydantic import AliasPath, BaseModel, ConfigDict, Field, model_validator

from app.core.enums import TestResult, TestScopeType, TestType


class TestRecordCreate(BaseModel):
    test_type: TestType
    result: TestResult
    title: str
    notes: str | None = None
    test_date: date
    # Required for a Simulation test — when the simulation model/scenario itself
    # was built, as distinct from test_date (when the run happened against it).
    simulation_created_date: date | None = None
    mode_ids: list[UUID] = []

    @model_validator(mode="after")
    def check_simulation_date(self) -> "TestRecordCreate":
        if self.test_type == TestType.simulation and self.simulation_created_date is None:
            raise ValueError("simulation_created_date is required for a Simulation test")
        return self


class TestRecordModeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    mode_id: UUID
    mode_name: str = Field(validation_alias=AliasPath("mode", "name"))


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
    simulation_created_date: date | None = None
    created_at: datetime
    modes: list[TestRecordModeOut] = []
