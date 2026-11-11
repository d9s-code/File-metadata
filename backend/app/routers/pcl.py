"""Platform confidence (experimental): what in an MDF tells its Platforms
apart. Read-only; nothing here is stored yet."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.enums import Role
from app.database import get_db
from app.deps import require_role
from app.models.mdf import Mdf, MdfVersion
from app.services.ambiguity_service import DEFAULT_TOLERANCE
from app.services.app_settings import mode_defaults
from app.services.platform_uniqueness import mdf_uniqueness

router = APIRouter(prefix="/pcl", tags=["platform-confidence"])


class UniquenessOut(BaseModel):
    mdf_id: UUID
    mdf_name: str
    # The MDF version read (its latest saved one).
    mdf_version_number: int
    # The step tolerance the Stagger steps were compared with (± µs).
    stagger_step_delta_us: float
    platforms: list[dict]


@router.get("/mdfs/{mdf_id}/uniqueness", response_model=UniquenessOut)
def get_mdf_uniqueness(mdf_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> UniquenessOut:
    """Each Platform the MDF's latest saved version pins: its Emitters, unique
    to it or shared; a unique Emitter's Modes with a unique parameter set and
    unique parameters; pairs of shared Emitters only it has together; and
    the Platforms that have everything it has."""
    mdf = db.get(Mdf, mdf_id)
    if mdf is None or getattr(mdf, "deleted_at", None) is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MDF not found")
    version = (
        db.query(MdfVersion).filter(MdfVersion.mdf_id == mdf_id).order_by(MdfVersion.version_number.desc()).first()
    )
    if version is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Save a version of this MDF first — this reads its saved Platforms")
    step = float(mode_defaults(db)["stagger_step_delta_us"])
    return UniquenessOut(
        mdf_id=mdf.id,
        mdf_name=mdf.name,
        mdf_version_number=version.version_number,
        stagger_step_delta_us=step,
        platforms=mdf_uniqueness(version.snapshot, {**DEFAULT_TOLERANCE, "stagger_step_delta_us": step}),
    )
