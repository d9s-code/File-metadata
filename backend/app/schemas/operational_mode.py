from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

MAX_TIMELINE_ITEMS = 64

MAX_PLANNED_VALUES = 64


class PlannedValue(BaseModel):
    """One planned value of a parameter: a single value or a min–max, with a
    note — and, for a dwell & switch PRI, how long it dwells there: pulses or
    ms, not both."""

    min: float = Field(gt=0)
    max: float | None = Field(default=None, gt=0)
    note: str | None = Field(default=None, max_length=2000)
    dwell_pulses: int | None = Field(default=None, ge=1)
    dwell_ms: float | None = Field(default=None, gt=0)
    # A PRI's own PW (µs), when the plan pairs them pulse to pulse.
    pw_min: float | None = Field(default=None, gt=0)
    pw_max: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def check(self) -> "PlannedValue":
        if self.max is not None and self.max < self.min:
            raise ValueError(f"A planned value's max ({self.max:g}) is below its min ({self.min:g})")
        if self.dwell_pulses is not None and self.dwell_ms is not None:
            raise ValueError("A dwell is in pulses or in ms, not both")
        if self.pw_max is not None and (self.pw_min is None or self.pw_max < self.pw_min):
            raise ValueError("A PRI's PW max needs its PW min, and can't be below it")
        return self


Step = Annotated[float, Field(gt=0)]


class PlannedStagger(BaseModel):
    """A planned stagger: its PRI steps in order (µs), the frame-time ± delta,
    a note — and, paired pulse to pulse, each step's PW."""

    steps: list[Step] = Field(min_length=2, max_length=MAX_PLANNED_VALUES)
    frame_time_delta_us: float | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=2000)
    pw_steps: list[Step] | None = None

    @model_validator(mode="after")
    def check(self) -> "PlannedStagger":
        if self.pw_steps is not None and len(self.pw_steps) != len(self.steps):
            raise ValueError(f"A stagger of {len(self.steps)} steps needs {len(self.steps)} PWs, one a step")
        return self


class OperationalModePlan(BaseModel):
    """The values planned for an operational mode, for analysis: several RF,
    PRI and PW values each. An empty list: none planned here — the one above
    it's apply. A PRI marked dwell & switch dwells on each of its PRIs in turn."""

    rf: list[PlannedValue] = Field(default_factory=list, max_length=MAX_PLANNED_VALUES)
    pri: list[PlannedValue] = Field(default_factory=list, max_length=MAX_PLANNED_VALUES)
    pri_dwell_switch: bool = False
    # PRI as staggers instead of values: each its steps in order.
    pri_stagger: list[PlannedStagger] = Field(default_factory=list, max_length=MAX_PLANNED_VALUES)
    # PW goes with PRI, pulse to pulse: each PRI value carries its PW, each
    # stagger a PW per step — and no PW is planned on its own.
    pri_pw_paired: bool = False
    pw: list[PlannedValue] = Field(default_factory=list, max_length=MAX_PLANNED_VALUES)

    @model_validator(mode="after")
    def check(self) -> "OperationalModePlan":
        if self.pri and self.pri_stagger:
            raise ValueError("A PRI is planned as values or as staggers, not both")
        if self.pri_stagger and self.pri_dwell_switch:
            raise ValueError("A stagger isn't a dwell & switch")
        if self.pri_pw_paired:
            if not (self.pri or self.pri_stagger):
                raise ValueError("Pairing PW with PRI needs a PRI planned")
            if self.pw:
                raise ValueError("Paired with PRI, PW is given with each PRI — not on its own")
            if any(v.pw_min is None for v in self.pri):
                raise ValueError("Paired with PRI, every PRI needs its PW")
            if any(s.pw_steps is None for s in self.pri_stagger):
                raise ValueError("Paired with PRI, every stagger needs a PW for each step")
        elif any(v.pw_min is not None for v in self.pri) or any(s.pw_steps for s in self.pri_stagger):
            raise ValueError("A PRI's own PW is for PW paired with PRI — mark it as such")
        if self.pri_dwell_switch and len(self.pri) < 2:
            raise ValueError("A dwell & switch PRI needs 2 PRIs or more")
        if not self.pri_dwell_switch and any(v.dwell_pulses or v.dwell_ms for v in self.pri):
            raise ValueError("A PRI's dwell is for a dwell & switch — mark it as one")
        if any(v.dwell_pulses or v.dwell_ms for v in [*self.rf, *self.pw]):
            raise ValueError("Only a dwell & switch PRI has a dwell")
        return self

    def stored(self) -> dict | None:
        """As kept: None when nothing is planned."""
        data = self.model_dump(exclude_none=True)
        return data if (self.rf or self.pri or self.pri_stagger or self.pw) else None


class EmissionItem(BaseModel):
    """One step of an operational mode's timeline: a pulse group — one of the
    Emitter's Modes for this many pulses, or for this long (ms) — or off for a time."""

    kind: Literal["group", "off"]
    mode_id: UUID | None = None
    pulses: int | None = Field(default=None, ge=1, le=1_000_000)
    ms: float | None = Field(default=None, gt=0, le=3_600_000)

    @model_validator(mode="after")
    def check(self) -> "EmissionItem":
        if self.kind == "group":
            if self.mode_id is None:
                raise ValueError("A pulse group needs its Mode")
            if (self.pulses is None) == (self.ms is None):
                raise ValueError("A pulse group is a number of pulses or a time (ms), one of the two")
        else:
            if self.ms is None or self.mode_id is not None or self.pulses is not None:
                raise ValueError("An off time is a time (ms), nothing else")
        return self


class Emission(BaseModel):
    """What an operational mode transmits over time: its timeline, repeated
    (empty: its Modes as they are), and on/off periods — on for on_s, silent
    for off_s, again and again (both or neither; the ones under it take them
    unless they have their own)."""

    timeline: list[EmissionItem] = Field(default_factory=list, max_length=MAX_TIMELINE_ITEMS)
    on_s: float | None = Field(default=None, gt=0, le=1_000_000)
    off_s: float | None = Field(default=None, ge=0, le=1_000_000)

    @model_validator(mode="after")
    def check(self) -> "Emission":
        if (self.on_s is None) != (self.off_s is None):
            raise ValueError("On/off periods need both the time on and the time off, or neither")
        if self.timeline and not any(i.kind == "group" for i in self.timeline):
            raise ValueError("A timeline needs at least one pulse group")
        return self

    def stored(self) -> dict | None:
        """As kept: None when it says nothing."""
        data = self.model_dump(mode="json", exclude_none=True)
        if not data.get("timeline"):
            data.pop("timeline", None)
        return data or None

    def mode_ids(self) -> list[UUID]:
        return [i.mode_id for i in self.timeline if i.mode_id is not None]


class OperationalModeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    # The one it sits under (one of the same Emitter's); None — at the top.
    parent_id: UUID | None = None
    description: str | None = None
    # One of its Emitter's scans; None — the one above it's.
    scan_id: UUID | None = None
    emission: Emission | None = None
    # Its place among its siblings; None — after them.
    sort_order: int | None = None
    plan: OperationalModePlan | None = None


class OperationalModeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    # Moves it (with everything under it); null — to the top.
    parent_id: UUID | None = None
    description: str | None = None
    # Null: the one above it's.
    scan_id: UUID | None = None
    # Replaces it (null or empty: its Modes as they are, always on).
    emission: Emission | None = None
    sort_order: int | None = None
    # Replaces its plan (null or empty: nothing planned here).
    plan: OperationalModePlan | None = None


class OperationalModeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    parent_id: UUID | None = None
    name: str
    description: str | None = None
    scan_id: UUID | None = None
    emission: dict | None = None
    plan: dict | None = None
    sort_order: int
    # How many of the Emitter's Modes are linked to it directly.
    modes_count: int = 0
    created_at: datetime
    updated_at: datetime


class OperationalModeSetValues(BaseModel):
    """Values set on every Mode under an operational mode (it and all below
    it) — e.g. the RF range Track 1, 2 and 3 share. Only the fields given are
    set; the rest of each Mode stays as it is. A PRI range or jitter is a
    Fixed PRI's: every Mode under it must be Fixed for those."""

    rf_min_mhz: float | None = Field(default=None, gt=0)
    rf_max_mhz: float | None = Field(default=None, gt=0)
    rf_delta: float | None = Field(default=None, ge=0)
    pw_min_us: float | None = Field(default=None, gt=0)
    pw_max_us: float | None = Field(default=None, gt=0)
    pw_delta: float | None = Field(default=None, ge=0)
    pri_min_us: float | None = Field(default=None, gt=0)
    pri_max_us: float | None = Field(default=None, gt=0)
    pri_delta: float | None = Field(default=None, ge=0)
    jitter_min_us: float | None = Field(default=None, ge=0)
    jitter_max_us: float | None = Field(default=None, ge=0)
    # A stagger's steps (µs) and its frame-time delta: every Mode under it must be a stagger for these.
    pri_stagger_values_us: list[Annotated[float, Field(gt=0)]] | None = Field(default=None, min_length=2, max_length=64)
    frame_time_delta_us: float | None = Field(default=None, ge=0)

    def given(self) -> dict:
        return {k: v for k, v in self.model_dump(exclude_unset=True).items() if v is not None}


class OperationalModeOrder(BaseModel):
    """Siblings in the order given — all of one parent's, each once."""

    parent_id: UUID | None = None
    ids: list[UUID] = Field(min_length=1)


class OperationalModeCommentCreate(BaseModel):
    body: str = Field(min_length=1, max_length=20_000)
    # The operational mode it's about; None — the whole plan.
    operational_mode_id: UUID | None = None
    # A reply to this comment (a top-level one); it's then about what that one's about.
    parent_id: UUID | None = None


class OperationalModeCommentUpdate(BaseModel):
    # Only its author edits the text.
    body: str | None = Field(default=None, min_length=1, max_length=20_000)
    # A top-level comment, open or resolved.
    resolved: bool | None = None


class OperationalModeCommentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    operational_mode_id: UUID | None = None
    operational_mode_name: str | None = None
    parent_id: UUID | None = None
    author_id: UUID | None = None
    author_username: str | None = None
    body: str
    resolved: bool
    resolved_by_username: str | None = None
    resolved_at: datetime | None = None
    edited_at: datetime | None = None
    created_at: datetime


class PlannedCombination(BaseModel):
    """One Mode to create: an RF and PW range (MHz, µs) and a PRI — a range
    (a Fixed Mode) or a stagger's steps (a Stagger Mode)."""

    rf_min_mhz: float = Field(gt=0)
    rf_max_mhz: float = Field(gt=0)
    pri_min_us: float | None = Field(default=None, gt=0)
    pri_max_us: float | None = Field(default=None, gt=0)
    pri_stagger_values_us: list[Step] | None = Field(default=None, min_length=2, max_length=MAX_PLANNED_VALUES)
    frame_time_delta_us: float | None = Field(default=None, ge=0)
    pw_min_us: float = Field(gt=0)
    pw_max_us: float = Field(gt=0)

    @model_validator(mode="after")
    def check(self) -> "PlannedCombination":
        fixed = self.pri_min_us is not None and self.pri_max_us is not None
        if fixed == bool(self.pri_stagger_values_us):
            raise ValueError("A combination's PRI is a range or a stagger's steps — one of them")
        return self


class GenerateFromPlan(BaseModel):
    """Modes for each of these combinations — the cartesian product of an
    operational mode's values — Fixed PRI, linked to it, in one generation
    batch (deletable together)."""

    ew_group_id: UUID
    source_id: UUID
    name_prefix: str = Field(min_length=1, max_length=150)
    combinations: list[PlannedCombination] = Field(min_length=1, max_length=1000)
    jitter_min_us: float = Field(default=0, ge=0)
    jitter_max_us: float = Field(default=0, ge=0)
