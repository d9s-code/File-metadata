"""An Emitter's scans. Each pattern takes its own values (``params``); the
illumination time and revisit are worked out from them in the app
(frontend/src/components/scans/scanPatterns.ts), so here they're only
checked to be ones the pattern takes, and sensible numbers. Any value can
carry a ± ("period_s_delta")."""

import math
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Each pattern and the values it takes.
SCAN_PATTERNS: dict[str, tuple[str, ...]] = {
    "circular": ("period_s",),
    "sector_uni": ("sector_deg", "sweep_s", "flyback_s"),
    "sector_bi": ("sector_deg", "sweep_s"),
    "raster": ("sector_deg", "bars", "bar_spacing_deg", "frame_s"),
    "helical": ("period_s", "levels"),
    "spiral": ("cone_deg", "turns", "frame_s"),
    "palmer": ("period_s", "nutation_deg", "nutation_hz"),
    "palmer_raster": ("sector_deg", "bars", "bar_spacing_deg", "frame_s", "nutation_deg", "nutation_hz"),
    "conical": ("rate_hz",),
    "lobe_switching": ("rate_hz",),
    "steady": (),
    "esa": ("pulses", "dwell_ms", "revisit_s"),
    "other": ("revisit_s",),
}
MAX_VALUE = 1_000_000_000
MAX_BLANKED = 16


class BlankedSector(BaseModel):
    """A sector the scan doesn't transmit in, as the scan measures azimuth:
    from_deg to to_deg (on a circular scan it can wrap past 360, 350 → 10)."""

    from_deg: float = Field(ge=0, le=360)
    to_deg: float = Field(ge=0, le=360)

    @model_validator(mode="after")
    def check(self) -> "BlankedSector":
        if self.from_deg == self.to_deg:
            raise ValueError("A blanked sector needs a width")
        return self


def check_params(pattern: str, params: dict[str, float] | None) -> dict[str, float] | None:
    """Only the pattern's values (and their ±), each a number ≥ 0; None when empty."""
    if pattern not in SCAN_PATTERNS:
        raise ValueError(f"Unknown scan pattern '{pattern}'")
    if not params:
        return None
    allowed = set(SCAN_PATTERNS[pattern]) | {f"{k}_delta" for k in SCAN_PATTERNS[pattern]}
    out = {}
    for key, value in params.items():
        if key not in allowed:
            raise ValueError(f"A {pattern} scan doesn't take '{key}'")
        if value is None:
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"'{key}' must be a number")
        if value < 0 or value > MAX_VALUE:
            raise ValueError(f"'{key}' must be between 0 and {MAX_VALUE:,}")
        out[key] = float(value)
    return out or None



class EmitterScanCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    pattern: str
    params: dict[str, float | None] | None = None
    beam_az_deg: float | None = Field(default=None, gt=0, le=360)
    beam_el_deg: float | None = Field(default=None, gt=0, le=180)
    illumination_ms: float | None = Field(default=None, gt=0, le=3_600_000)
    blanked_sectors: list[BlankedSector] | None = Field(default=None, max_length=MAX_BLANKED)
    description: str | None = None
    # Its place in the list; None — last.
    sort_order: int | None = None

    @model_validator(mode="after")
    def check(self) -> "EmitterScanCreate":
        self.params = check_params(self.pattern, self.params)
        return self


class EmitterScanUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    pattern: str | None = None
    # Replaces its values (checked against its pattern on save).
    params: dict[str, float | None] | None = None
    beam_az_deg: float | None = Field(default=None, gt=0, le=360)
    beam_el_deg: float | None = Field(default=None, gt=0, le=180)
    # Null clears it: the worked-out one applies.
    illumination_ms: float | None = Field(default=None, gt=0, le=3_600_000)
    # Replaces them (null or empty: none).
    blanked_sectors: list[BlankedSector] | None = Field(default=None, max_length=MAX_BLANKED)
    description: str | None = None
    sort_order: int | None = None

    @field_validator("pattern")
    @classmethod
    def known(cls, v: str | None) -> str | None:
        if v is not None and v not in SCAN_PATTERNS:
            raise ValueError(f"Unknown scan pattern '{v}'")
        return v


class EmitterScanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    emitter_id: UUID
    name: str
    pattern: str
    params: dict | None = None
    beam_az_deg: float | None = None
    beam_el_deg: float | None = None
    illumination_ms: float | None = None
    blanked_sectors: list | None = None
    description: str | None = None
    sort_order: int
    # What uses it directly: operational modes and Modes.
    operational_modes_count: int = 0
    modes_count: int = 0
    created_at: datetime
    updated_at: datetime
