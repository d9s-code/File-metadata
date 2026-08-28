from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.emitter import Emitter
from app.models.ew_group import EwGroup
from app.models.mode import ModeElement
from app.models.source import Source
from app.schemas.mode_element import (
    CartesianProductRequest,
    CartesianProductResult,
    FrametimeResponse,
    ModeElementCreate,
    ModeElementOut,
)
from app.schemas.source import SourceCreate, SourceOut, SourceUpdate
from app.services.audit_service import record_audit
from app.services.cartesian_service import CartesianProductError, run_cartesian_product
from app.services.frametime_service import compute_frametime_us

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
    user=Depends(require_role(Role.editor)),
) -> Source:
    _get_emitter_or_404(db, emitter_id)
    source = Source(emitter_id=emitter_id, **payload.model_dump())
    db.add(source)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.source.value,
        entity_id=source.id,
        summary=f"Created Source '{source.name}'",
        changes=payload.model_dump(mode="json"),
    )
    db.commit()
    db.refresh(source)
    return source


@router.patch("/{source_id}", response_model=SourceOut, dependencies=[Depends(verify_csrf)])
def update_source(
    emitter_id: UUID,
    source_id: UUID,
    payload: SourceUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> Source:
    source = db.get(Source, source_id)
    if source is None or source.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(source, field, value)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.source.value,
        entity_id=source.id,
        summary=f"Updated Source '{source.name}'",
        changes=payload.model_dump(exclude_unset=True, mode="json"),
    )
    db.commit()
    db.refresh(source)
    return source


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_source(
    emitter_id: UUID,
    source_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> None:
    source = db.get(Source, source_id)
    if source is None or source.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    if source.modes:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cannot delete a Source that still has Modes")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.source.value,
        entity_id=source.id,
        summary=f"Deleted Source '{source.name}'",
    )
    db.delete(source)
    db.commit()


def _get_source_or_404(db: Session, emitter_id: UUID, source_id: UUID) -> Source:
    source = db.get(Source, source_id)
    if source is None or source.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    return source


@router.get("/{source_id}/elements", response_model=list[ModeElementOut])
def list_elements(
    emitter_id: UUID, source_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[ModeElement]:
    _get_source_or_404(db, emitter_id, source_id)
    return (
        db.query(ModeElement)
        .filter(ModeElement.source_id == source_id)
        .order_by(ModeElement.element_type, ModeElement.sort_order)
        .all()
    )


@router.post(
    "/{source_id}/elements",
    response_model=ModeElementOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_element(
    emitter_id: UUID,
    source_id: UUID,
    payload: ModeElementCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> ModeElement:
    source = _get_source_or_404(db, emitter_id, source_id)
    element = ModeElement(source_id=source_id, **payload.model_dump())
    db.add(element)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.mode_element.value,
        entity_id=element.id,
        summary=f"Added a {element.element_type.value.upper()} element to Source '{source.name}'",
        changes=payload.model_dump(mode="json"),
    )
    db.commit()
    db.refresh(element)
    return element


@router.delete(
    "/{source_id}/elements/{element_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(verify_csrf)],
)
def delete_element(
    emitter_id: UUID,
    source_id: UUID,
    element_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> None:
    _get_source_or_404(db, emitter_id, source_id)
    element = db.get(ModeElement, element_id)
    if element is None or element.source_id != source_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Element not found")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.mode_element.value,
        entity_id=element.id,
        summary=f"Deleted a {element.element_type.value.upper()} element",
    )
    db.delete(element)
    db.commit()


@router.get("/{source_id}/elements/{element_id}/frametime", response_model=FrametimeResponse)
def get_frametime(
    emitter_id: UUID,
    source_id: UUID,
    element_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> FrametimeResponse:
    _get_source_or_404(db, emitter_id, source_id)
    element = db.get(ModeElement, element_id)
    if element is None or element.source_id != source_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Element not found")
    if not element.stagger_values:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Frametime only applies to a Stagger PRI element")
    return FrametimeResponse(
        element_id=element.id,
        frametime_us=compute_frametime_us(element.stagger_values),
        values=element.stagger_values,
    )


@router.post(
    "/{source_id}/elements/cartesian-product",
    response_model=CartesianProductResult,
    dependencies=[Depends(verify_csrf)],
)
def cartesian_product(
    emitter_id: UUID,
    source_id: UUID,
    payload: CartesianProductRequest,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> CartesianProductResult:
    source = _get_source_or_404(db, emitter_id, source_id)
    ew_group = db.get(EwGroup, payload.ew_group_id)
    if ew_group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Target EW Group not found")
    if ew_group.emitter_id != emitter_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Target EW Group must belong to the same Emitter as the Source"
        )
    try:
        created = run_cartesian_product(
            db,
            source=source,
            ew_group_id=payload.ew_group_id,
            rf_element_ids=payload.rf_element_ids,
            pw_element_ids=payload.pw_element_ids,
            pri_element_ids=payload.pri_element_ids,
            name_prefix=payload.name_prefix,
            created_by=user.id,
        )
    except CartesianProductError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.mode_generation_batch.value,
        entity_id=created[0].generation_batch_id if created else None,
        summary=f"Generated {len(created)} Mode(s) via cartesian product on Source '{source.name}' "
        f"('{payload.name_prefix}')",
    )
    db.commit()
    return CartesianProductResult(created_mode_ids=[m.id for m in created], count=len(created))
