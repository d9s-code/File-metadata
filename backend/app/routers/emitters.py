from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import Role
from app.database import get_db
from app.deps import require_role
from app.models.emitter import Emitter
from app.schemas.emitter import EmitterCreate, EmitterOut, EmitterUpdate

router = APIRouter(prefix="/emitters", tags=["emitters"])


@router.get("", response_model=list[EmitterOut])
def list_emitters(
    include_deleted: bool = False,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> list[Emitter]:
    q = db.query(Emitter)
    if not include_deleted:
        q = q.filter(Emitter.is_deleted.is_(False))
    return q.order_by(Emitter.name).all()


@router.get("/{emitter_id}", response_model=EmitterOut)
def get_emitter(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return emitter


@router.post(
    "",
    response_model=EmitterOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_emitter(
    payload: EmitterCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.editor))
) -> Emitter:
    if db.query(Emitter).filter(Emitter.name == payload.name).first() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Emitter name already exists")
    emitter = Emitter(
        name=payload.name,
        designation=payload.designation,
        description=payload.description,
        created_by=user.id,
    )
    db.add(emitter)
    db.commit()
    db.refresh(emitter)
    return emitter


@router.patch("/{emitter_id}", response_model=EmitterOut, dependencies=[Depends(verify_csrf)])
def update_emitter(
    emitter_id: UUID,
    payload: EmitterUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.editor)),
) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(emitter, field, value)
    db.commit()
    db.refresh(emitter)
    return emitter


@router.delete("/{emitter_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_emitter(
    emitter_id: UUID,
    hard: bool = False,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> None:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    if hard:
        if user.role != Role.admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Hard delete requires admin role")
        db.delete(emitter)
    else:
        emitter.is_deleted = True
    db.commit()
