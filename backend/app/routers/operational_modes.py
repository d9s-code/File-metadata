"""A radar's operational modes (volume search, track…), each Emitter's own,
in a tree: TRACK holds Track 1, 2, 3, and those can hold more. Its Modes are
linked to the one they're transmitted in and take its illumination time (or
the nearest one above it that has one) for the dwell planner; values set on
an operational mode are set on every Mode under it. Edited like EW Groups:
only by the editor holding the Emitter, saved with its versions."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, PriType, Role
from app.database import get_db
from app.deps import require_emitter_checkout, require_role
from app.models.emitter import Emitter
from app.models.mode import Mode
from app.models.operational_mode import OperationalMode
from app.schemas.mode import BatchModeFieldEdit, ModeBatchEditResult, check_scan_box
from app.schemas.operational_mode import (
    GenerateFromPlan,
    OperationalModeCreate,
    OperationalModeOrder,
    OperationalModeOut,
    OperationalModeSetValues,
    OperationalModeUpdate,
)
from app.services.audit_service import apply_and_diff, record_audit, snapshot
from app.services.mode_batch_service import apply_batch_edit, plan_batch_edit

router = APIRouter(prefix="/emitters/{emitter_id}/operational-modes", tags=["operational-modes"])

_FIELDS = ["name", "parent_id", "description", "illumination_time_ms", "scan_min_s", "scan_max_s", "sort_order", "plan"]


def _next_place(db: Session, emitter_id: UUID, parent_id: UUID | None) -> int:
    """After its siblings."""
    top = (
        db.query(func.max(OperationalMode.sort_order))
        .filter(
            OperationalMode.emitter_id == emitter_id,
            OperationalMode.parent_id.is_(None) if parent_id is None else OperationalMode.parent_id == parent_id,
        )
        .scalar()
    )
    return 0 if top is None else top + 1


def _emitter_or_404(db: Session, emitter_id: UUID) -> Emitter:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None or emitter.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    return emitter


def _get_or_404(db: Session, emitter_id: UUID, operational_mode_id: UUID) -> OperationalMode:
    row = db.get(OperationalMode, operational_mode_id)
    if row is None or row.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Operational mode not found")
    return row


def _with_count(db: Session, row: OperationalMode) -> OperationalMode:
    row.modes_count = db.query(func.count(Mode.id)).filter(Mode.operational_mode_id == row.id).scalar() or 0
    return row


def _check_name(db: Session, emitter_id: UUID, name: str, parent_id: UUID | None, own_id: UUID | None = None) -> str:
    """Not blank, and not a sibling's name (the same name under another parent is fine)."""
    name = name.strip()
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "An operational mode needs a name")
    clash = db.query(OperationalMode.id).filter(
        OperationalMode.emitter_id == emitter_id,
        OperationalMode.name == name,
        OperationalMode.parent_id.is_(None) if parent_id is None else OperationalMode.parent_id == parent_id,
    )
    if own_id is not None:
        clash = clash.filter(OperationalMode.id != own_id)
    if clash.first():
        where = "at the top" if parent_id is None else f"under '{db.get(OperationalMode, parent_id).name}'"
        raise HTTPException(status.HTTP_409_CONFLICT, f"There's already an operational mode called '{name}' {where}")
    return name


def _below(db: Session, emitter_id: UUID, root_id: UUID) -> list[UUID]:
    """It and every operational mode under it, at any depth."""
    children: dict[UUID | None, list[UUID]] = {}
    for row_id, parent_id in db.query(OperationalMode.id, OperationalMode.parent_id).filter(
        OperationalMode.emitter_id == emitter_id
    ):
        children.setdefault(parent_id, []).append(row_id)
    out, todo = [], [root_id]
    while todo:
        current = todo.pop()
        out.append(current)
        todo.extend(children.get(current, []))
    return out


def _check_parent(db: Session, emitter_id: UUID, parent_id: UUID | None, own_id: UUID | None = None) -> None:
    """One of this Emitter's, and — when moving one — not it or anything under it."""
    if parent_id is None:
        return
    parent = db.get(OperationalMode, parent_id)
    if parent is None or parent.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That operational mode to put it under isn't one of this Emitter's")
    if own_id is not None and parent_id in _below(db, emitter_id, own_id):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "It can't go under itself or one of its own")


@router.get("", response_model=list[OperationalModeOut])
def list_operational_modes(
    emitter_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[OperationalMode]:
    _emitter_or_404(db, emitter_id)
    counts = dict(
        db.query(Mode.operational_mode_id, func.count(Mode.id))
        .join(OperationalMode, Mode.operational_mode_id == OperationalMode.id)
        .filter(OperationalMode.emitter_id == emitter_id)
        .group_by(Mode.operational_mode_id)
        .all()
    )
    rows = (
        db.query(OperationalMode)
        .filter(OperationalMode.emitter_id == emitter_id)
        .order_by(OperationalMode.sort_order, OperationalMode.name)
        .all()
    )
    for row in rows:
        row.modes_count = counts.get(row.id, 0)
    return rows


@router.post(
    "", response_model=OperationalModeOut, status_code=status.HTTP_201_CREATED, dependencies=[Depends(verify_csrf)]
)
def create_operational_mode(
    emitter_id: UUID,
    payload: OperationalModeCreate,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> OperationalMode:
    _emitter_or_404(db, emitter_id)
    data = payload.model_dump()
    data["plan"] = payload.plan.stored() if payload.plan else None
    _check_parent(db, emitter_id, data["parent_id"])
    data["name"] = _check_name(db, emitter_id, data["name"], data["parent_id"])
    if data["sort_order"] is None:
        data["sort_order"] = _next_place(db, emitter_id, data["parent_id"])
    row = OperationalMode(emitter_id=emitter_id, **data)
    db.add(row)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.operational_mode.value,
        entity_id=row.id,
        summary=f"Created operational mode '{row.name}'",
        changes=payload.model_dump(mode="json"),
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(row)
    return _with_count(db, row)


@router.patch("/{operational_mode_id}", response_model=OperationalModeOut, dependencies=[Depends(verify_csrf)])
def update_operational_mode(
    emitter_id: UUID,
    operational_mode_id: UUID,
    payload: OperationalModeUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> OperationalMode:
    row = _get_or_404(db, emitter_id, operational_mode_id)
    data = payload.model_dump(exclude_unset=True)
    if "plan" in data:
        data["plan"] = payload.plan.stored() if payload.plan else None
    parent_id = data.get("parent_id", row.parent_id)
    if "parent_id" in data:
        _check_parent(db, emitter_id, parent_id, own_id=row.id)
    if "name" in data and data["name"] is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "An operational mode needs a name")
    if "name" in data or "parent_id" in data:
        data["name"] = _check_name(db, emitter_id, data.get("name", row.name), parent_id, own_id=row.id)
    if data.get("sort_order", 0) is None:
        data.pop("sort_order")
    if "parent_id" in data and data["parent_id"] != row.parent_id and "sort_order" not in data:
        data["sort_order"] = _next_place(db, emitter_id, data["parent_id"])
    if "scan_min_s" in data or "scan_max_s" in data:
        try:
            check_scan_box(data.get("scan_min_s", row.scan_min_s), data.get("scan_max_s", row.scan_max_s))
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))
    old_name = row.name
    changes = apply_and_diff(row, data)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.operational_mode.value,
        entity_id=row.id,
        summary=(
            f"Renamed operational mode '{old_name}' to '{row.name}'"
            if row.name != old_name
            else f"Updated operational mode '{row.name}'"
        ),
        changes=changes,
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(row)
    return _with_count(db, row)


@router.delete("/{operational_mode_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_operational_mode(
    emitter_id: UUID,
    operational_mode_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> None:
    """What was under it — its Modes and the operational modes below it —
    moves up to its parent (to none / the top when it has none)."""
    row = _get_or_404(db, emitter_id, operational_mode_id)
    linked = db.query(func.count(Mode.id)).filter(Mode.operational_mode_id == row.id).scalar() or 0
    children = db.query(OperationalMode).filter(OperationalMode.parent_id == row.id).all()
    for child in children:
        # A child whose name its new siblings already have can't move up.
        _check_name(db, emitter_id, child.name, row.parent_id, own_id=child.id)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.operational_mode.value,
        entity_id=row.id,
        summary=f"Deleted operational mode '{row.name}'"
        + (f" ({linked} Mode(s) and {len(children)} operational mode(s) moved up)" if linked or children else ""),
        changes=snapshot(row, _FIELDS),
        emitter_id=emitter_id,
    )
    db.query(Mode).filter(Mode.operational_mode_id == row.id).update(
        {Mode.operational_mode_id: row.parent_id}, synchronize_session=False
    )
    for child in children:
        child.parent_id = row.parent_id
    db.flush()
    db.delete(row)
    db.commit()


@router.post("/order", response_model=list[OperationalModeOut], dependencies=[Depends(verify_csrf)])
def order_operational_modes(
    emitter_id: UUID,
    payload: OperationalModeOrder,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> list[OperationalMode]:
    """Puts one parent's operational modes in this order (each of them, once)."""
    _emitter_or_404(db, emitter_id)
    siblings = (
        db.query(OperationalMode)
        .filter(
            OperationalMode.emitter_id == emitter_id,
            OperationalMode.parent_id.is_(None) if payload.parent_id is None else OperationalMode.parent_id == payload.parent_id,
        )
        .all()
    )
    if sorted(map(str, payload.ids)) != sorted(str(s.id) for s in siblings):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Give every one of them under that parent, each once — they changed since?"
        )
    by_id = {s.id: s for s in siblings}
    before = [s.name for s in sorted(siblings, key=lambda s: (s.sort_order, s.name))]
    for place, op_id in enumerate(payload.ids):
        by_id[op_id].sort_order = place
    after = [by_id[i].name for i in payload.ids]
    if before != after:
        parent = db.get(OperationalMode, payload.parent_id) if payload.parent_id else None
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.update,
            entity_type=AuditEntityType.operational_mode.value,
            entity_id=parent.id if parent else None,
            summary=f"Reordered the operational modes {f'under {parent.name!r}' if parent else 'at the top'}",
            changes={"order": {"old": ", ".join(before), "new": ", ".join(after)}},
            emitter_id=emitter_id,
        )
    db.commit()
    return [_with_count(db, by_id[i]) for i in payload.ids]


@router.post(
    "/{operational_mode_id}/set-values", response_model=ModeBatchEditResult, dependencies=[Depends(verify_csrf)]
)
def set_values_below(
    emitter_id: UUID,
    operational_mode_id: UUID,
    payload: OperationalModeSetValues,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> ModeBatchEditResult:
    """Sets these values on every Mode under it — it and the operational
    modes below it — all or nothing: one Mode the values don't suit (a
    stagger given a PRI range, a min above its max) refuses them all, each
    listed. Audited on each Mode."""
    row = _get_or_404(db, emitter_id, operational_mode_id)
    values = payload.given()
    if not values:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Nothing to set")
    below = _below(db, emitter_id, row.id)
    mode_ids = [m for (m,) in db.query(Mode.id).filter(Mode.operational_mode_id.in_(below))]
    if not mode_ids:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"No Modes are under '{row.name}' yet")
    planned, errors = plan_batch_edit(
        db, emitter_id=emitter_id, mode_ids=mode_ids, fields=BatchModeFieldEdit(), line_values=values
    )
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=[e.model_dump(mode="json") for e in errors])
    updated = apply_batch_edit(
        db,
        planned=planned,
        derived_from_test_record_ids=[],
        actor_id=user.id,
        emitter_id=emitter_id,
        shift_reason=f"set on operational mode '{row.name}'",
    )
    db.commit()
    return ModeBatchEditResult(updated_mode_ids=updated, count=len(updated))


@router.post(
    "/{operational_mode_id}/generate",
    response_model=ModeBatchEditResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def generate_from_plan(
    emitter_id: UUID,
    operational_mode_id: UUID,
    payload: GenerateFromPlan,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> ModeBatchEditResult:
    """A Fixed Mode for each combination given — the cartesian product of the
    values set on an operational mode — linked to it, named "<prefix> n"
    (skipping names its EW Group has), all or nothing, in one generation batch
    deletable together. The admin's Mode defaults give the deltas and
    confirmation."""
    from app.models.ew_group import EwGroup
    from app.models.mode import ModeGenerationBatch
    from app.models.source import Source
    from app.routers.modes import create_mode_record
    from app.schemas.mode import ModeCreate, ModeLineFields, validate_pri_type_fields
    from app.services import app_settings

    row = _get_or_404(db, emitter_id, operational_mode_id)
    group = db.get(EwGroup, payload.ew_group_id)
    source = db.get(Source, payload.source_id)
    if group is None or group.emitter_id != emitter_id or source is None or source.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pick an EW Group and a Source of this Emitter")
    if payload.jitter_max_us < payload.jitter_min_us:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "The jitter max is below its min")
    defaults = app_settings.mode_defaults(db)
    lines = []
    for i, c in enumerate(payload.combinations, start=1):
        try:
            if c.rf_max_mhz < c.rf_min_mhz or c.pri_max_us < c.pri_min_us or c.pw_max_us < c.pw_min_us:
                raise ValueError("a max is below its min")
            fields = ModeLineFields(
                rf_min_mhz=c.rf_min_mhz,
                rf_max_mhz=c.rf_max_mhz,
                pw_min_us=c.pw_min_us,
                pw_max_us=c.pw_max_us,
                pri_min_us=c.pri_min_us,
                pri_max_us=c.pri_max_us,
                jitter_min_us=payload.jitter_min_us,
                jitter_max_us=payload.jitter_max_us,
                rf_delta=float(defaults["rf_delta"]),
                pw_delta=float(defaults["pw_delta"]),
                pri_delta=float(defaults["pri_delta"]),
                jitter_delta=float(defaults["jitter_delta"]) or None,
                rf_range_matching=False,
                pw_range_matching=False,
                pri_range_matching=False,
            )
            validate_pri_type_fields(PriType.fixed, fields)
        except ValueError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Combination {i} can't be a Mode: {exc}")
        lines.append(fields)
    batch = ModeGenerationBatch(
        ew_group_id=group.id, source_id=source.id, name_prefix=payload.name_prefix.strip(), created_by=user.id
    )
    db.add(batch)
    db.flush()
    used = {name for (name,) in db.query(Mode.name).filter(Mode.ew_group_id == group.id)}
    counter = 1
    created = []
    for fields in lines:
        while f"{batch.name_prefix} {counter}" in used:
            counter += 1
        name = f"{batch.name_prefix} {counter}"
        used.add(name)
        counter += 1
        mode = create_mode_record(
            db,
            group,
            ModeCreate(source_id=source.id, name=name, pri_type=PriType.fixed, line=fields, operational_mode_id=row.id),
            user.id,
            generation_batch_id=batch.id,
            note=f"from the plan of operational mode '{row.name}'",
        )
        created.append(mode.id)
    db.commit()
    return ModeBatchEditResult(updated_mode_ids=created, count=len(created))
