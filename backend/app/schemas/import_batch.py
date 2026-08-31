from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.mode_element import ModeElementCreate
from app.schemas.parameter_sequence import ParameterSequenceCreate


class ParametricSetImport(BaseModel):
    """One parametric set from the source XML — becomes its own Source, even
    though many parametric sets in one import typically share one document.
    """

    source_name: str
    source_description: str | None = None
    source_date: date
    elements: list[ModeElementCreate] = Field(default_factory=list)
    sequences: list[ParameterSequenceCreate] = Field(default_factory=list)

    @model_validator(mode="after")
    def check_nonempty(self) -> "ParametricSetImport":
        if not self.elements and not self.sequences:
            raise ValueError(f"Parametric set '{self.source_name}' has no elements or sequences")
        return self


class ImportPayload(BaseModel):
    document_name: str
    document_reference: str | None = None
    parametric_sets: list[ParametricSetImport]

    @model_validator(mode="after")
    def check_nonempty(self) -> "ImportPayload":
        if not self.parametric_sets:
            raise ValueError("An import must contain at least one parametric set")
        return self


class ImportFieldIssue(BaseModel):
    """One structured validation error/warning, field-path addressable (e.g.
    'parametric_sets[2].elements[0].value_min') so a remote agent can
    self-correct without re-parsing free text.
    """

    path: str
    message: str
    severity: str = "error"  # "error" | "warning" — warnings don't block commit


class ImportValidationResult(BaseModel):
    valid: bool
    issues: list[ImportFieldIssue] = Field(default_factory=list)
    parametric_set_count: int = 0
    element_count: int = 0
    sequence_count: int = 0


class ImportBatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    document_name: str
    document_reference: str | None = None
    created_by: UUID | None = None
    created_at: datetime


class ImportCommitResult(BaseModel):
    import_batch: ImportBatchOut
    created_source_ids: list[UUID]
    source_count: int
    element_count: int
    sequence_count: int
