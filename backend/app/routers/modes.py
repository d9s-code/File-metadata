from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import Role
from app.database import get_db
from app.deps import require_role
from app.dsl.exceptions import DslSyntaxError
from app.dsl.renderer import render_mode_line
from app.models.ew_group import EwGroup
from app.models.mode import Mode, ModeLine
from app.models.source import Source
from app.schemas.mode import ModeCreate, ModeCreateFromDsl, ModeOut, ModeUpdate, validate_pri_type_fields
from app.services.dsl_mode_service import create_mode_from_dsl

router = APIRouter(prefix="/ew-groups/{ew_group_id}/modes", tags=["modes"])


def _get_ew_group_or_404(db: Session, ew_group_id: UUID) -> EwGroup:
    ew_group = db.get(EwGroup, ew_group_id)
    if ew_group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "EW Group not found")
    return ew_group


@router.get("", response_model=list[ModeOut])
def list_modes(
    ew_group_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[Mode]:
    _get_ew_group_or_404(db, ew_group_id)
    return db.query(Mode).filter(Mode.ew_group_id == ew_group_id).order_by(Mode.sort_order).all()


@router.post(
    "", response_model=ModeOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def create_mode(
    ew_group_id: UUID,
    payload: ModeCreate,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.editor)),
) -> Mode:
    ew_group = _get_ew_group_or_404(db, ew_group_id)
    source = db.get(Source, payload.source_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    if source.emitter_id != ew_group.emitter_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Source and EW Group must belong to the same Emitter",
        )

    mode = Mode(
        ew_group_id=ew_group_id,
        source_id=payload.source_id,
        name=payload.name,
        pri_type=payload.pri_type,
        notes=payload.notes,
        sort_order=payload.sort_order,
    )
    db.add(mode)
    db.flush()

    line_fields = payload.line.model_dump()
    try:
        dsl_text = render_mode_line(
            pri_type=payload.pri_type, **{k: v for k, v in line_fields.items() if k != "type_data"}
        )
    except DslSyntaxError:
        dsl_text = None  # e.g. Xlet, which has no DSL line syntax yet
    line = ModeLine(mode_id=mode.id, dsl_text=dsl_text, **line_fields)
    db.add(line)
    db.commit()
    db.refresh(mode)
    return mode


@router.post(
    "/from-dsl",
    response_model=ModeOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_mode_from_dsl_text(
    ew_group_id: UUID,
    payload: ModeCreateFromDsl,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.editor)),
) -> Mode:
    """The 'write a mode line explicitly' path: parses the DSL text into a
    Mode + ModeLine directly, and derives/upserts matching elements into the
    Source's element pool — the reverse direction of the elements/cartesian
    workflow.
    """
    ew_group = _get_ew_group_or_404(db, ew_group_id)
    source = db.get(Source, payload.source_id)
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    if source.emitter_id != ew_group.emitter_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Source and EW Group must belong to the same Emitter",
        )
    try:
        return create_mode_from_dsl(
            db,
            source=source,
            ew_group_id=ew_group_id,
            name=payload.name,
            dsl_text=payload.dsl_text,
            notes=payload.notes,
            sort_order=payload.sort_order,
        )
    except DslSyntaxError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc


@router.patch("/{mode_id}", response_model=ModeOut, dependencies=[Depends(verify_csrf)])
def update_mode(
    ew_group_id: UUID,
    mode_id: UUID,
    payload: ModeUpdate,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.editor)),
) -> Mode:
    mode = db.get(Mode, mode_id)
    if mode is None or mode.ew_group_id != ew_group_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mode not found")

    data = payload.model_dump(exclude_unset=True, exclude={"line"})
    if "ew_group_id" in data:
        new_ew_group = db.get(EwGroup, data["ew_group_id"])
        if new_ew_group is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Target EW Group not found")
        if new_ew_group.emitter_id != mode.source.emitter_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Target EW Group must belong to the same Emitter as the Mode's Source",
            )
    for field, value in data.items():
        setattr(mode, field, value)

    if payload.line is not None:
        validate_pri_type_fields(mode.pri_type, payload.line)
        line_fields = payload.line.model_dump()
        for field, value in line_fields.items():
            setattr(mode.line, field, value)
        try:
            mode.line.dsl_text = render_mode_line(
                pri_type=mode.pri_type, **{k: v for k, v in line_fields.items() if k != "type_data"}
            )
        except DslSyntaxError:
            mode.line.dsl_text = None

    db.commit()
    db.refresh(mode)
    return mode


@router.delete("/{mode_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_mode(
    ew_group_id: UUID,
    mode_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.editor)),
) -> None:
    mode = db.get(Mode, mode_id)
    if mode is None or mode.ew_group_id != ew_group_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mode not found")
    db.delete(mode)
    db.commit()
