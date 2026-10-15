from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class MergedDwell(BaseModel):
    """One Merged Mode dwell: where the receiver sits, and for how long."""

    freq_mhz: float = Field(gt=0)
    dwell_time_ms: float = Field(gt=0)
    collect_time_ms: float = Field(default=50, ge=0)


class DwellFileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    mdf_id: UUID | None = None


class DwellFileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    mdf_id: UUID | None = None
    timeout: float | None = Field(default=None, ge=0)
    setup_time: float | None = Field(default=None, ge=0)
    # None clears it: the app-wide default applies again.
    bandwidth_mhz: float | None = Field(default=None, gt=0)
    notes: str | None = None


class DwellStrategyCreate(BaseModel):
    platform_id: UUID | None = None


class DwellStrategyUpdate(BaseModel):
    platform_id: UUID | None = None
    manual_collect_time_ms: float | None = Field(default=None, ge=0)
    merged_mode: list[MergedDwell] | None = Field(default=None, max_length=500)
    sort_order: int | None = None


class DwellStrategyOut(BaseModel):
    id: UUID
    platform_id: UUID | None
    platform_name: str | None
    # False when the file is for an MDF that doesn't pin this Platform.
    platform_in_mdf: bool | None
    sort_order: int
    manual_collect_time_ms: float
    merged_mode: list[MergedDwell]
    rapid_df: dict | None
    split_mode: list | None


class DwellFileOut(BaseModel):
    id: UUID
    name: str
    mdf_id: UUID | None
    mdf_name: str | None
    timeout: float
    setup_time: float
    bandwidth_mhz: float | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
    strategies: list[DwellStrategyOut]


class DwellFileSummary(BaseModel):
    id: UUID
    name: str
    mdf_id: UUID | None
    mdf_name: str | None
    strategy_count: int
    platform_names: list[str]
    dwell_count: int
    updated_at: datetime


class SettingsOut(BaseModel):
    dwell_bandwidth_mhz: float


class SettingsUpdate(BaseModel):
    dwell_bandwidth_mhz: float | None = Field(default=None, gt=0)
