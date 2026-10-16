from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.core.csrf import verify_csrf
from app.core.enums import AuditAction, AuditEntityType, PriType, Role
from app.database import get_db
from app.deps import require_emitter_checkout, require_role
from app.models.cartesian_run import CartesianRun
from app.models.emitter import Emitter
from app.models.ew_group import EwGroup
from app.models.mode import ModeElement
from app.models.parameter_sequence import ParameterSequence
from app.models.source import Source
from app.models.source_group import SourceGroup
from app.models.source_note import SourceNote
from app.schemas.mode_element import (
    CartesianProductRequest,
    CartesianProductResult,
    CartesianRunOut,
    ElementBatchCreate,
    ElementBatchResult,
    FrametimeResponse,
    ModeElementCreate,
    ModeElementOut,
)
from app.schemas.parameter_sequence import (
    ParameterSequenceCreate,
    ParameterSequenceOut,
    ParameterSequenceUpdate,
)
from app.schemas.source import SourceCreate, SourceOut, SourceUpdate
from app.schemas.source_note import SourceNoteCreate, SourceNoteOut
from app.services.cartesian_log import modes_remaining, record_cartesian_run
from app.services.mode_sources import set_mode_sources
from app.services.audit_service import apply_and_diff, record_audit, snapshot
from app.services.cartesian_service import CartesianProductError, run_cartesian_product
from app.services.combined_source import MergedPool, batch_source, resolve_selection
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
    user=Depends(require_emitter_checkout()),
) -> Source:
    _get_emitter_or_404(db, emitter_id)
    if payload.group_id is not None and db.get(SourceGroup, payload.group_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source Group not found")
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
        emitter_id=emitter_id,
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
    user=Depends(require_emitter_checkout()),
) -> Source:
    source = db.get(Source, source_id)
    if source is None or source.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    data = payload.model_dump(exclude_unset=True)
    if data.get("group_id") is not None and db.get(SourceGroup, data["group_id"]) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source Group not found")
    old_name = source.name
    if "name" in data:
        # Renaming: not blank, and not another of the Emitter's Sources' name.
        new_name = (data["name"] or "").strip()
        if not new_name:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A Source needs a name")
        if new_name != old_name and (
            db.query(Source.id)
            .filter(Source.emitter_id == emitter_id, Source.id != source.id, Source.name == new_name)
            .first()
        ):
            raise HTTPException(status.HTTP_409_CONFLICT, f"This Emitter already has a Source called '{new_name}'")
        data["name"] = new_name
    changes = apply_and_diff(source, data)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type=AuditEntityType.source.value,
        entity_id=source.id,
        summary=(
            f"Renamed Source '{old_name}' to '{source.name}'"
            if source.name != old_name
            else f"Updated Source '{source.name}'"
        ),
        changes=changes,
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(source)
    return source


@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)])
def delete_source(
    emitter_id: UUID,
    source_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> None:
    source = db.get(Source, source_id)
    if source is None or source.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    only_source = [m.name for m in source.modes if not m.extra_source_links]
    if only_source:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Cannot delete a Source that is the only Source of {len(only_source)} Mode(s): "
            + ", ".join(only_source[:5])
            + ("…" if len(only_source) > 5 else ""),
        )
    # Modes it's the first Source of keep their other Sources; the next one
    # becomes first. Its place among other Modes' extra Sources goes with it.
    for mode in list(source.modes):
        set_mode_sources(mode, mode.sources[1:])
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.source.value,
        entity_id=source.id,
        summary=f"Deleted Source '{source.name}'",
        changes=snapshot(
            source,
            ["name", "description", "rf_legacy_term", "pri_legacy_term", "source_type", "source_date", "group_id"],
        ),
        emitter_id=emitter_id,
    )
    db.delete(source)
    db.commit()


def _get_source_or_404(db: Session, emitter_id: UUID, source_id: UUID) -> Source:
    source = db.get(Source, source_id)
    if source is None or source.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Source not found")
    return source


@router.get("/{source_id}/notes", response_model=list[SourceNoteOut])
def list_source_notes(
    emitter_id: UUID, source_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[SourceNote]:
    """Newest-first analyst commentary log — see SourceNote."""
    _get_source_or_404(db, emitter_id, source_id)
    return (
        db.query(SourceNote)
        .options(joinedload(SourceNote.author))
        .filter(SourceNote.source_id == source_id)
        .order_by(SourceNote.created_at.desc())
        .all()
    )


@router.post(
    "/{source_id}/notes",
    response_model=SourceNoteOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_source_note(
    emitter_id: UUID,
    source_id: UUID,
    payload: SourceNoteCreate,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> SourceNote:
    source = _get_source_or_404(db, emitter_id, source_id)
    note = SourceNote(source_id=source_id, author_id=user.id, body=payload.body)
    db.add(note)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.source_note.value,
        entity_id=note.id,
        summary=f"Added a note to Source '{source.name}'",
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(note)
    return note


@router.delete(
    "/{source_id}/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(verify_csrf)]
)
def delete_source_note(
    emitter_id: UUID,
    source_id: UUID,
    note_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_role(Role.editor)),
) -> None:
    source = _get_source_or_404(db, emitter_id, source_id)
    note = db.get(SourceNote, note_id)
    if note is None or note.source_id != source_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Note not found")
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.source_note.value,
        entity_id=note.id,
        summary=f"Deleted a note from Source '{source.name}'",
        changes=snapshot(note, ["body"]),
        emitter_id=emitter_id,
    )
    db.delete(note)
    db.commit()


@router.get("/{source_id}/parameter-sequences", response_model=list[ParameterSequenceOut])
def list_parameter_sequences(
    emitter_id: UUID, source_id: UUID, db: Session = Depends(get_db), _=Depends(require_role(Role.viewer))
) -> list[ParameterSequence]:
    _get_source_or_404(db, emitter_id, source_id)
    return (
        db.query(ParameterSequence)
        .filter(ParameterSequence.source_id == source_id)
        .order_by(ParameterSequence.sort_order)
        .all()
    )


@router.post(
    "/{source_id}/parameter-sequences",
    response_model=ParameterSequenceOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def create_parameter_sequence(
    emitter_id: UUID,
    source_id: UUID,
    payload: ParameterSequenceCreate,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> ParameterSequence:
    source = _get_source_or_404(db, emitter_id, source_id)
    sequence = ParameterSequence(source_id=source_id, **payload.model_dump())
    db.add(sequence)
    db.flush()
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type="parameter_sequence",
        entity_id=sequence.id,
        summary=f"Created Parameter Sequence '{sequence.label}'",
        changes=payload.model_dump(mode="json"),
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(sequence)
    return sequence


@router.patch(
    "/{source_id}/parameter-sequences/{sequence_id}",
    response_model=ParameterSequenceOut,
    dependencies=[Depends(verify_csrf)],
)
def update_parameter_sequence(
    emitter_id: UUID,
    source_id: UUID,
    sequence_id: UUID,
    payload: ParameterSequenceUpdate,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> ParameterSequence:
    _get_source_or_404(db, emitter_id, source_id)
    sequence = db.query(ParameterSequence).filter(
        ParameterSequence.id == sequence_id, ParameterSequence.source_id == source_id
    ).first()
    if sequence is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sequence not found")

    changes = apply_and_diff(sequence, payload.model_dump(exclude_unset=True))
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.update,
        entity_type="parameter_sequence",
        entity_id=sequence.id,
        summary=f"Updated Parameter Sequence '{sequence.label}'",
        changes=changes,
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(sequence)
    return sequence


@router.delete(
    "/{source_id}/parameter-sequences/{sequence_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(verify_csrf)],
)
def delete_parameter_sequence(
    emitter_id: UUID,
    source_id: UUID,
    sequence_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> None:
    source = _get_source_or_404(db, emitter_id, source_id)
    sequence = db.query(ParameterSequence).filter(
        ParameterSequence.id == sequence_id, ParameterSequence.source_id == source_id
    ).first()

    if sequence is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sequence not found")

    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type="parameter_sequence",
        entity_id=sequence.id,
        summary=f"Deleted sequence '{sequence.label}'",
        changes=snapshot(sequence, ["label", "variant", "steps", "sort_order", "rf_delta", "pw_delta", "pri_delta"]),
        emitter_id=emitter_id,
    )
    db.delete(sequence)
    db.commit()


@router.delete(
    "/{source_id}/parameter-sequences/{sequence_id}/steps/{step_order}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(verify_csrf)],
)
def delete_parameter_sequence_step(
    emitter_id: UUID,
    source_id: UUID,
    sequence_id: UUID,
    step_order: int,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> None:
    source = _get_source_or_404(db, emitter_id, source_id)
    sequence = db.query(ParameterSequence).filter(
        ParameterSequence.id == sequence_id, ParameterSequence.source_id == source_id
    ).first()

    if sequence is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sequence not found")

    # Filter out the step with the matching order
    removed_step = next((s for s in sequence.steps if s.get("order") == step_order), None)
    new_steps = [s for s in sequence.steps if s.get("order") != step_order]

    if removed_step is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Step with order {step_order} not found")

    sequence.steps = new_steps
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type="parameter_sequence_step",
        entity_id=sequence.id,
        summary=f"Deleted step {step_order} from sequence '{sequence.label}'",
        changes=removed_step,
        emitter_id=emitter_id,
    )
    db.commit()


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
    user=Depends(require_emitter_checkout()),
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
        emitter_id=emitter_id,
    )
    db.commit()
    db.refresh(element)
    return element


@router.post(
    "/batch-elements",
    response_model=ElementBatchResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(verify_csrf)],
)
def batch_create_elements(
    emitter_id: UUID,
    payload: ElementBatchCreate,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> ElementBatchResult:
    """Every Element to every one of the Sources, each as its own Element,
    after the Source's existing Elements of its type — all or nothing."""
    source_ids = list(dict.fromkeys(payload.source_ids))
    sources = [_get_source_or_404(db, emitter_id, sid) for sid in source_ids]
    new_source = None
    if payload.new_source is not None:
        _get_emitter_or_404(db, emitter_id)
        if payload.new_source.group_id is not None and db.get(SourceGroup, payload.new_source.group_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Source Group not found")
        new_source = Source(emitter_id=emitter_id, **payload.new_source.model_dump())
        db.add(new_source)
        db.flush()
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.create,
            entity_type=AuditEntityType.source.value,
            entity_id=new_source.id,
            summary=f"Created Source '{new_source.name}'",
            changes=payload.new_source.model_dump(mode="json"),
            emitter_id=emitter_id,
        )
        sources.append(new_source)
    created = 0
    for source in sources:
        next_order: dict = {}
        added: list[ModeElement] = []
        for item in payload.elements:
            kind = item.element_type
            if kind not in next_order:
                last = (
                    db.query(ModeElement.sort_order)
                    .filter(ModeElement.source_id == source.id, ModeElement.element_type == kind)
                    .order_by(ModeElement.sort_order.desc())
                    .first()
                )
                next_order[kind] = (last[0] + 1) if last else 0
            element = ModeElement(source_id=source.id, **{**item.model_dump(), "sort_order": next_order[kind]})
            next_order[kind] += 1
            db.add(element)
            added.append(element)
        db.flush()
        kinds = sorted({e.element_type.value.upper() for e in added})
        record_audit(
            db,
            actor_id=user.id,
            action=AuditAction.create,
            entity_type=AuditEntityType.mode_element.value,
            entity_id=added[0].id,
            summary=f"Added {len(added)} {'/'.join(kinds)} element{'' if len(added) == 1 else 's'} to Source '{source.name}' (batch)",
            changes={"elements": [item.model_dump(mode="json") for item in payload.elements]},
            emitter_id=emitter_id,
        )
        created += len(added)
    db.commit()
    return ElementBatchResult(created=created, sources=len(sources), new_source_id=new_source.id if new_source else None)


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
    user=Depends(require_emitter_checkout()),
) -> None:
    _get_source_or_404(db, emitter_id, source_id)
    element = db.get(ModeElement, element_id)
    if element is None or element.source_id != source_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Element not found")
    summary = f"Deleted a {element.element_type.value.upper()} element"
    if element.label:
        summary += f" ('{element.label}')"
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.delete,
        entity_type=AuditEntityType.mode_element.value,
        entity_id=element.id,
        summary=summary,
        changes=snapshot(
            element,
            [
                "element_type",
                "variant",
                "value_min",
                "value_max",
                "stagger_values",
                "jitter_min",
                "jitter_max",
                "delta",
                "label",
                "details",
                "sort_order",
            ],
        ),
        emitter_id=emitter_id,
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
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Frametime only applies to a Stagger PRI element")
    return FrametimeResponse(
        element_id=element.id,
        frametime_us=compute_frametime_us(element.stagger_values),
        values=element.stagger_values,
    )


@router.get("/{source_id}/cartesian-runs", response_model=list[CartesianRunOut])
def list_cartesian_runs(
    emitter_id: UUID,
    source_id: UUID,
    db: Session = Depends(get_db),
    _=Depends(require_role(Role.viewer)),
) -> list[CartesianRunOut]:
    """The Source's generation log: every cartesian run, newest first."""
    _get_source_or_404(db, emitter_id, source_id)
    runs = (
        db.query(CartesianRun)
        .filter(CartesianRun.source_id == source_id)
        .order_by(CartesianRun.created_at.desc())
        .all()
    )
    remaining = modes_remaining(db, runs)
    return [
        CartesianRunOut(
            id=r.id,
            created_at=r.created_at,
            created_by_username=r.creator.username if r.creator else None,
            ew_group_name=r.ew_group_name,
            name_prefix=r.name_prefix,
            note=r.note,
            inputs=r.inputs,
            mode_names=r.mode_names,
            modes_remaining=remaining.get(r.batch_id, 0) if r.batch_id else 0,
        )
        for r in runs
    ]


@router.post(
    "/all-sources/cartesian-product",
    response_model=CartesianProductResult,
    dependencies=[Depends(verify_csrf)],
)
def all_sources_cartesian_product(
    emitter_id: UUID,
    payload: CartesianProductRequest,
    db: Session = Depends(get_db),
    user=Depends(require_emitter_checkout()),
) -> CartesianProductResult:
    """Modes from the merged Elements of every Source of the Emitter (All
    Sources). Any Element of a merged group picks the group; each Mode gets
    the Sources its Elements were found in, the one holding most of them as
    its main Source. Sequence steps belong to one Source and aren't taken."""
    _get_emitter_or_404(db, emitter_id)
    if payload.sequence_steps:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Sequence steps are picked on their own Source, not All Sources"
        )
    ew_group = db.get(EwGroup, payload.ew_group_id)
    if ew_group is None or ew_group.emitter_id != emitter_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Target EW Group not found on this Emitter")
    pool = MergedPool(db, emitter_id)
    try:
        rf, rf_deltas = resolve_selection(pool, payload.rf_element_ids, payload.rf_delta_overrides)
        pri, pri_deltas = resolve_selection(pool, payload.pri_element_ids, payload.pri_delta_overrides)
        pw, pw_deltas = resolve_selection(pool, payload.pw_element_ids, payload.pw_delta_overrides)
        source = batch_source(pool, [pool.representative(i) for i in [*rf, *pri, *pw]])
        # Firing positions given on any Element of a merged group belong to
        # the group's representative.
        firing_order: dict[UUID, list[int]] = {}
        for element_id, positions in (payload.pri_firing_order or {}).items():
            firing_order.setdefault(pool.representative(element_id).id, []).extend(positions)
        created = run_cartesian_product(
            db,
            source=source,
            ew_group_id=payload.ew_group_id,
            rf_element_ids=rf,
            pw_element_ids=pw,
            pri_element_ids=pri,
            name_prefix=payload.name_prefix,
            created_by=user.id,
            batch_note=payload.batch_note,
            rf_delta_overrides=rf_deltas,
            pw_delta_overrides=pw_deltas,
            pri_delta_overrides=pri_deltas,
            rf_range_matching=payload.rf_range_matching,
            pw_range_matching=payload.pw_range_matching,
            pri_range_matching=payload.pri_range_matching,
            elements_from_any_source=True,
            mode_sources=pool.sources_of,
            pri_type=PriType(payload.pri_type),
            pri_firing_order=firing_order,
        )
    except CartesianProductError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    logged = payload.model_copy(
        update={
            "rf_element_ids": rf,
            "pri_element_ids": pri,
            "pw_element_ids": pw,
            "rf_delta_overrides": rf_deltas,
            "pri_delta_overrides": pri_deltas,
            "pw_delta_overrides": pw_deltas,
            "pri_firing_order": firing_order or None,
            "batch_note": f"From All Sources. {payload.batch_note or ''}".strip(),
        }
    )
    record_cartesian_run(db, source=source, ew_group=ew_group, payload=logged, created=created, user_id=user.id)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.mode_generation_batch.value,
        entity_id=created[0].generation_batch_id if created else None,
        summary=f"Generated {len(created)} Mode(s) via cartesian product on All Sources ('{payload.name_prefix}')",
        emitter_id=emitter_id,
    )
    db.commit()
    return CartesianProductResult(created_mode_ids=[m.id for m in created], count=len(created))


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
    user=Depends(require_emitter_checkout()),
) -> CartesianProductResult:
    source = _get_source_or_404(db, emitter_id, source_id)
    ew_group = db.get(EwGroup, payload.ew_group_id)
    if ew_group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Target EW Group not found")
    if ew_group.emitter_id != emitter_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Target EW Group must belong to the same Emitter as the Source"
        )
    try:
        created = run_cartesian_product(
            db,
            source=source,
            ew_group_id=payload.ew_group_id,
            rf_element_ids=payload.rf_element_ids,
            pw_element_ids=payload.pw_element_ids,
            pri_element_ids=payload.pri_element_ids,
            sequence_steps=payload.sequence_steps or None,
            name_prefix=payload.name_prefix,
            created_by=user.id,
            batch_note=payload.batch_note,
            rf_delta_overrides=payload.rf_delta_overrides,
            pw_delta_overrides=payload.pw_delta_overrides,
            pri_delta_overrides=payload.pri_delta_overrides,
            rf_range_matching=payload.rf_range_matching,
            pw_range_matching=payload.pw_range_matching,
            pri_range_matching=payload.pri_range_matching,
            pri_type=PriType(payload.pri_type),
            pri_firing_order=payload.pri_firing_order,
        )
    except CartesianProductError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    record_cartesian_run(db, source=source, ew_group=ew_group, payload=payload, created=created, user_id=user.id)
    record_audit(
        db,
        actor_id=user.id,
        action=AuditAction.create,
        entity_type=AuditEntityType.mode_generation_batch.value,
        entity_id=created[0].generation_batch_id if created else None,
        summary=f"Generated {len(created)} Mode(s) via cartesian product on Source '{source.name}' "
        f"('{payload.name_prefix}')",
        emitter_id=emitter_id,
    )
    db.commit()
    return CartesianProductResult(created_mode_ids=[m.id for m in created], count=len(created))
