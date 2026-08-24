from uuid import UUID

from pydantic import BaseModel, ConfigDict, computed_field, model_validator

from app.core.enums import ElementType
from app.services.delta import apply_delta


class ModeElementCreate(BaseModel):
    element_type: ElementType
    value_min: float | None = None
    value_max: float | None = None
    stagger_values: list[float] | None = None
    jitter_min: float | None = None
    jitter_max: float | None = None
    delta: float | None = None
    label: str | None = None
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
            if has_stagger and self.delta is not None:
                raise ValueError("Delta only applies to a Fixed-style PRI range element, not a stagger sequence")
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
        return self


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


class CartesianProductRequest(BaseModel):
    ew_group_id: UUID
    rf_element_ids: list[UUID]
    pw_element_ids: list[UUID]
    pri_element_ids: list[UUID]
    name_prefix: str = "Mode"


class CartesianProductResult(BaseModel):
    created_mode_ids: list[UUID]
    count: int


class FrametimeResponse(BaseModel):
    element_id: UUID
    frametime_us: float
    values: list[float]
