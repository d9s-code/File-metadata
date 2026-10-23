from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from app.core.enums import ElementType, ElementVariant
from app.schemas.source import SourceCreate
from app.services.delta import apply_delta
from app.services.frametime_service import compute_frametime_us


class ModeElementCreate(BaseModel):
    element_type: ElementType
    variant: ElementVariant | None = None
    value_min: float | None = None
    value_max: float | None = None
    stagger_values: list[float] | None = None
    jitter_min: float | None = None
    jitter_max: float | None = None
    delta: float | None = None
    label: str | None = None
    details: str | None = None
    sort_order: int = 0

    @model_validator(mode="after")
    def check_shape(self) -> "ModeElementCreate":
        if self.element_type == ElementType.pri:
            has_range = self.value_min is not None or self.value_max is not None
            has_stagger = bool(self.stagger_values)
            if has_range and has_stagger:
                raise ValueError("A PRI element is either a range (Fixed-style) or a stagger sequence, not both")
            if not has_range and not has_stagger:
                raise ValueError("A PRI element needs either value_min/value_max or stagger_values")
            if has_stagger and (self.jitter_min is not None or self.jitter_max is not None):
                raise ValueError("Jitter only applies to a Fixed-style PRI range element, not a stagger sequence")
            if has_stagger and self.delta is None:
                raise ValueError("Delta (frame time tolerance) is required for a stagger PRI sequence")
        else:
            if self.value_min is None or self.value_max is None:
                raise ValueError(f"{self.element_type.value} elements require value_min and value_max")
            if self.stagger_values or self.jitter_min is not None or self.jitter_max is not None:
                raise ValueError(f"{self.element_type.value} elements do not use stagger_values/jitter")
        if self.value_min is not None and self.value_max is not None and self.value_min > self.value_max:
            raise ValueError("value_min must be <= value_max")
        if self.jitter_min is not None and self.jitter_max is not None and self.jitter_min > self.jitter_max:
            raise ValueError("jitter_min must be <= jitter_max")
        if self.delta is not None and self.delta < 0:
            raise ValueError("delta must be >= 0")
        if self.variant == ElementVariant.analysis and not (self.details and self.details.strip()):
            raise ValueError("Selecting the 'analysis' variant requires a note in Details")
        return self


class ElementBatchCreate(BaseModel):
    """Elements added to several Sources at once — each Element to every
    Source, as its own Element (e.g. four RF values typed as a list, to three
    Sources: twelve Elements)."""

    source_ids: list[UUID] = Field(default_factory=list, max_length=200)
    elements: list[ModeElementCreate] = Field(min_length=1, max_length=200)
    # A Source to create for them in the same go — e.g. one named after the
    # test run the values were logged in.
    new_source: SourceCreate | None = None

    @model_validator(mode="after")
    def check_targets(self) -> "ElementBatchCreate":
        if not self.source_ids and self.new_source is None:
            raise ValueError("Pick at least one Source, or give a new one")
        return self


class ElementBatchResult(BaseModel):
    created: int
    sources: int
    # The Source made for them, when one was asked for.
    new_source_id: UUID | None = None


class ModeElementOut(ModeElementCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    source_id: UUID

    @computed_field
    @property
    def engineered_min(self) -> float | None:
        return apply_delta(self.value_min, self.value_max, self.delta)[0]

    @computed_field
    @property
    def engineered_max(self) -> float | None:
        return apply_delta(self.value_min, self.value_max, self.delta)[1]

    @computed_field
    @property
    def frametime_us(self) -> float | None:
        return compute_frametime_us(self.stagger_values) if self.stagger_values else None

    @computed_field
    @property
    def engineered_frame_time_min_us(self) -> float | None:
        if not self.stagger_values:
            return None
        return apply_delta(self.frametime_us, self.frametime_us, self.delta)[0]

    @computed_field
    @property
    def engineered_frame_time_max_us(self) -> float | None:
        if not self.stagger_values:
            return None
        return apply_delta(self.frametime_us, self.frametime_us, self.delta)[1]


class SequenceStepSelection(BaseModel):
    sequence_id: UUID
    order: int
    # Per-step, run-only delta override — takes precedence over the
    # sequence's own stored rf_delta/pw_delta/pri_delta for this step, for
    # this run only (mirrors rf/pw/pri_delta_overrides on Elements below).
    rf_delta: float | None = None
    pw_delta: float | None = None
    pri_delta: float | None = None


class CartesianProductRequest(BaseModel):
    ew_group_id: UUID
    rf_element_ids: list[UUID]
    pw_element_ids: list[UUID]
    pri_element_ids: list[UUID]
    # Individually-selected (sequence, step) pairs — replaces whole-sequence
    # selection. Each selected step becomes its own Mode; PRI Elements are
    # not combined with steps (mirrors the old whole-sequence behavior).
    sequence_steps: list[SequenceStepSelection] | None = None
    name_prefix: str = "Mode"
    batch_note: str | None = None
    # Per-element delta overrides — takes precedence over the element's own
    # stored `delta` for this run only (the element itself is unchanged).
    # Keyed by element id; only elements actually selected above are used.
    rf_delta_overrides: dict[UUID, float] | None = None
    pw_delta_overrides: dict[UUID, float] | None = None
    pri_delta_overrides: dict[UUID, float] | None = None
    # Applied uniformly to every Mode Line this run generates — Range
    # Matching is a per-parameter Mode Line flag, not a per-Element one, so
    # there's one choice per parameter for the whole batch rather than a
    # per-element override like the deltas above.
    rf_range_matching: bool = False
    pw_range_matching: bool = False
    pri_range_matching: bool = False
    # The PRI type of the Modes made. Fixed: one Mode per PRI Element (or
    # sequence step). Stagger: the picked PRI Elements, in their firing
    # order, become one stagger train — or each picked sequence's PRI steps
    # do, in step order — crossed with the RF and PW Elements.
    pri_type: Literal["fixed", "stagger"] = "fixed"
    # Stagger from Elements: each PRI Element's position(s) in the train,
    # 1-based; an Element can fire more than once ([1, 3]). It takes the
    # place of the PRI delta, which a stagger doesn't use: a PRI range
    # fires at its mean.
    pri_firing_order: dict[UUID, list[int]] | None = None


class ElementOccurrence(BaseModel):
    element_id: UUID
    source_id: UUID
    source_name: str
    variant: str | None = None
    label: str | None = None
    delta: float | None = None


class ElementOverviewRow(BaseModel):
    """One distinct Element (type and values) and every Source that has it."""

    element_type: str
    value_min: float | None = None
    value_max: float | None = None
    stagger_values: list[float] | None = None
    jitter_min: float | None = None
    jitter_max: float | None = None
    occurrences: list[ElementOccurrence]


class CoveredBy(BaseModel):
    """A Mode (or, for a scan, an EW Group) whose range holds some of an Element."""

    id: str
    name: str
    kind: str  # "mode" or "ew_group"


class CoverageSequence(BaseModel):
    """The Source's sequence a coverage row stands for."""

    id: str
    label: str
    steps: int


class ElementCoverageRow(ElementOverviewRow):
    # "covered", "partial" or "not_covered".
    coverage: str
    covered_by: list[CoveredBy]
    # Why it's only partly (or not) covered, when there's more to say.
    note: str | None = None
    # Set when the row is a sequence: its steps are in stagger_values (a PRI
    # sequence's stagger train, else the steps' RF or PW, in step order).
    sequence: CoverageSequence | None = None


class CoverageRange(BaseModel):
    """A Mode's (or EW Group's) range with its margin; `step` marks one step of a
    Stagger Mode's sequence."""

    id: str
    name: str
    kind: str
    group: str
    min: float
    max: float
    step: bool = False


class CoverageCounts(BaseModel):
    covered: int
    partial: int
    not_covered: int


class ElementCoverageOut(BaseModel):
    elements: list[ElementCoverageRow]
    # By Element type: rf, pri, pw, scan.
    ranges: dict[str, list[CoverageRange]]
    summary: dict[str, CoverageCounts]


class CartesianRunOut(BaseModel):
    """One entry of a Source's generation log."""

    id: UUID
    created_at: datetime
    created_by_username: str | None = None
    ew_group_name: str
    name_prefix: str
    note: str | None = None
    # {"elements": [...], "sequence_steps": [...], "range_matching": {...}}
    inputs: dict
    mode_names: list[str]
    # How many of its Modes are still there (0 once they're deleted).
    modes_remaining: int


class CartesianProductResult(BaseModel):
    created_mode_ids: list[UUID]
    count: int


class FrametimeResponse(BaseModel):
    element_id: UUID
    frametime_us: float
    values: list[float]


class ElementBulkDelete(BaseModel):
    """Elements to delete from across an Emitter's Sources — a cleanup of
    imported values that shouldn't have come in (a name, or a value, found in
    many Sources)."""

    element_ids: list[UUID] = Field(min_length=1, max_length=20_000)


class ElementBulkDeleteResult(BaseModel):
    deleted: int
    sources: int
