from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.core.enums import EmitterStatus


class EmitterCreate(BaseModel):
    name: str
    designation: str | None = None
    description: str | None = None


class EmitterUpdate(BaseModel):
    name: str | None = None
    designation: str | None = None
    description: str | None = None


class EmitterSummary(BaseModel):
    """Read-computed, cross-Mode aggregate for one Emitter — scoped to its
    `approved` Modes only (the same "live" set ambiguity checks/snapshots use),
    so a pending draft or rejected Mode never skews it. RF/PW/PRI extremes are
    the min-of-mins/max-of-maxes across every approved Mode's line (PRI is
    naturally skipped for stagger/cw/xlet Modes, which carry no PRI min/max to
    aggregate). `scan_min`/`scan_max` come from a different source: the
    Emitter's EW Groups directly (scan is an EW Group-level field, not a
    per-Mode one), so they're not gated on Mode status. `modes_passing`
    counts Modes whose most recent test result is
    `pass` — deliberately NOT paired with an "Elements covered by Modes" stat:
    there's no stored link between a Mode and the Element(s) it was built
    from today, so that half of "how much of this Emitter is verified" isn't
    computable without a new data-model addition.
    """

    rf_min_mhz: float | None = None
    rf_max_mhz: float | None = None
    pw_min_us: float | None = None
    pw_max_us: float | None = None
    pri_min_us: float | None = None
    pri_max_us: float | None = None
    scan_min: float | None = None
    scan_max: float | None = None
    mode_count: int = 0
    modes_passing: int = 0


class EmitterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    designation: str | None = None
    description: str | None = None
    status: EmitterStatus
    rework_note: str | None = None
    is_deleted: bool
    created_at: datetime
    updated_at: datetime
    summary: EmitterSummary = EmitterSummary()
