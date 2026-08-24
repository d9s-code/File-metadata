from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import Role
from app.database import get_db
from app.deps import require_role
from app.models.emitter import Emitter
from app.models.source import Source
from app.schemas.source import SourceCreate, SourceOut, SourceUpdate

router = APIRouter(prefix="/emitters/{emitter_id}/sources", tags=["sources"])


def _get_emitter_or_404(db: Session, emitter_id: UUID) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return emitter


@router.get("", response_model=list[SourceOut])
def list_sources(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[Source]:
    _get_emitter_or_404(db, emitter_id)
    return db.query(Source).filter(Source.emitter_id == emitter_id).order_by(Source.name).all()


@router.post(
    "", response_model=SourceOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def create_source(
    emitter_id: UUID,
    payload: SourceCreate,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.editor)),
) -> Source:
    _get_emitter_or_404(db, emitter_id)
    source = Source(emitter_id=emitter_id, **payload.model_dump())
    db.add(source)
    db.commit()
    db.refresh(source)
    return source


@router.patch("/{source_id}", response_model=SourceOut, dependencies=[Depends(verify_csrf)])
def update_source(
    emitter_id: UUID,
    source_id: UUID,
    payload: SourceUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.editor)),
) -> Source:
    source = db.get(Source, source_id)
    if source is None or source.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(source, field, value)
    db.commit()
    db.refresh(source)
    return source


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_source(
    emitter_id: UUID,
    source_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.editor)),
) -> None:
    source = db.get(Source, source_id)
    if source is None or source.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    if source.modes:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cannot delete a Source that still has Modes")
    db.delete(source)
    db.commit()
