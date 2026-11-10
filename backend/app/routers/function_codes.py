"""Function codes — what kind of emitter an Emitter is — kept by Admins.
Everyone reads them (the Add Emitter form, the threat priority overview);
only Admins add, change, reorder or delete them. One in use can't be deleted
unless its Emitters are moved to another (move_to)."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, Role
from app.database import get_db
from app.deps import require_role
from app.models.emitter import Emitter
from app.models.function_code import FunctionCode
from app.schemas.function_code import (
    FunctionCodeCreate,
    FunctionCodeOut,
    FunctionCodeUpdate,
)
from app.services.audit_service import apply_and_diff, record_audit, snapshot

router = APIRouter(prefix="/function-codes", tags=["function-codes"])


def _counts(db: Session) -> dict[UUID, int]:
    return dict(
        db.query(Emitter.function_code_id, func.count(Emitter.id))
        .filter(Emitter.is_deleted.is_(False), Emitter.function_code_id.isnot(None))
        .group_by(Emitter.function_code_id)
        .all()
    )


def _out(fc: FunctionCode, counts: dict[UUID, int]) -> FunctionCodeOut:
    out = FunctionCodeOut.model_validate(fc)
    out.emitter_count = counts.get(fc.id, 0)
    return out


def _get(db: Session, code_id: UUID) -> FunctionCode:
    fc = db.get(FunctionCode, code_id)
    if fc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Function code not found")
    return fc


def _clean(text: str | None) -> str | None:
    return text.strip() if text is not None else None


def _check_code_free(db: Session, code: str, except_id: UUID | None = None) -> None:
    q = db.query(FunctionCode.id).filter(func.lower(FunctionCode.code) == code.lower())
    if except_id:
        q = q.filter(FunctionCode.id != except_id)
    if q.first():
        raise HTTPException(status.HTTP_409_CONFLICT, f"There's already a function code '{code}'")


@router.get("", response_model=list[FunctionCodeOut])
def list_function_codes(db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))) -> list[FunctionCodeOut]:
    counts = _counts(db)
    codes = db.query(FunctionCode).order_by(FunctionCode.sort_order, func.lower(FunctionCode.code)).all()
    return [_out(fc, counts) for fc in codes]


@router.post("", response_model=FunctionCodeOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)])
def create_function_code(
    payload: FunctionCodeCreate, db: Session = Depends(get_db), user=Depends(require_role(Role.admin))
) -> FunctionCodeOut:
    code, name = _clean(payload.code), _clean(payload.name)
    if not code or not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A function code needs a code and a name")
    _check_code_free(db, code)
    last = db.query(func.max(FunctionCode.sort_order)).scalar()
    fc = FunctionCode(
        code=code,
        name=name,
        description=_clean(payload.description) or None,
        sort_order=payload.sort_order if payload.sort_order is not None else (last or 0) + 1,
    )
    db.add(fc)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.function_code.value,
        entity_id=fc.id,
        summary=f"Added function code '{fc.code}' ({fc.name})",
        changes=snapshot(fc, ["code", "name", "description", "sort_order"]),
    )
    db.commit()
    db.refresh(fc)
    return _out(fc, _counts(db))


@router.patch("/{code_id}", response_model=FunctionCodeOut, dependencies=[Depends(verify_csrf)])
def update_function_code(
    code_id: UUID, payload: FunctionCodeUpdate, db: Session = Depends(get_db), user=Depends(require_role(Role.admin))
) -> FunctionCodeOut:
    fc = _get(db, code_id)
    data = payload.model_dump(exclude_unset=True)
    for key in ("code", "name"):
        if key in data:
            data[key] = _clean(data[key])
            if not data[key]:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"A function code needs a {key}")
    if "description" in data:
        data["description"] = _clean(data["description"]) or None
    if "sort_order" in data and data["sort_order"] is None:
        del data["sort_order"]
    if "code" in data:
        _check_code_free(db, data["code"], except_id=fc.id)
    old_code = fc.code
    changes = apply_and_diff(fc, data)
    if changes:
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.update,
            entity_type=AuditEntityType.function_code.value,
            entity_id=fc.id,
            summary=f"Updated function code '{old_code}'" + (f" (now '{fc.code}')" if fc.code != old_code else ""),
            changes=changes,
        )
        db.commit()
        db.refresh(fc)
    return _out(fc, _counts(db))


@router.delete("/{code_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_function_code(
    code_id: UUID,
    move_to: UUID | None = None,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.admin)),
) -> None:
    """Refused while Emitters (deleted ones too) have it — unless move_to
    names another function code, which they're moved to first."""
    fc = _get(db, code_id)
    users = db.query(Emitter).filter(Emitter.function_code_id == fc.id).all()
    moved_to = None
    if users:
        if move_to is None:
            live = sum(1 for e in users if not e.is_deleted)
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{live or len(users)} Emitter(s) have function code '{fc.code}' — move them to another first",
            )
        if move_to == fc.id:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Move them to another function code")
        moved_to = _get(db, move_to)
        for e in users:
            e.function_code_id = moved_to.id
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.function_code.value,
        entity_id=fc.id,
        summary=f"Deleted function code '{fc.code}' ({fc.name})"
        + (f", moving {len(users)} Emitter(s) to '{moved_to.code}'" if moved_to else ""),
        changes=snapshot(fc, ["code", "name", "description", "sort_order"]),
    )
    db.flush()
    db.delete(fc)
    db.commit()
