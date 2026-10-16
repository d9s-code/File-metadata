from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict



class MdfCreate(BaseModel):
    name: str
    description: str | None = None
    notes: str | None = None
    release_date: date | None = None
    customer_id: UUID | None = None


class MdfUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    notes: str | None = None
    release_date: date | None = None
    customer_id: UUID | None = None


class MdfOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None = None
    notes: str | None = None
    release_date: date | None = None
    customer_id: UUID | None = None
    status: str
    is_deleted: bool
    deleted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    platforms_count: int = 0


class MdfLinkCreate(BaseModel):
    platform_id: UUID
    platform_version_id: UUID


class MdfLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    mdf_id: UUID
    platform_id: UUID
    platform_version_id: UUID
    added_at: datetime
    # The pinned Platform version's number and the Platform's latest saved one;
    # the pin is outdated when the latter is higher (filled in by list_links).
    pinned_version_number: int | None = None
    latest_version_number: int | None = None
    latest_version_id: UUID | None = None


class ReadinessItem(BaseModel):
    key: str
    label: str
    # "ok", "warn" or "fail".
    status: str
    detail: str
    items: list[str] = []


class MdfReadinessOut(BaseModel):
    warnings: list[str]
