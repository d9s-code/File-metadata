"""Reconciles an Emitter's live rows to match a committed snapshot — the
shared engine behind both "revert to an older version" and "discard
uncommitted changes" (discard is just "reconcile to the *latest* commit"),
plus the row-cloning behind "fork".

A committed snapshot (see snapshots.py::build_emitter_snapshot) preserves the
live UUID of every EwGroup/Source/Mode/ModeElement/ParameterSequence/TestLine,
so reconciliation can match by id instead of guessing from names: a row whose
id is still in the target snapshot gets its fields overwritten in place
(preserving its id); a row absent from it gets deleted, and one in it but not
live is recreated with its id.

What hangs off those rows without being part of a version — test results,
Source notes, cartesian-run logs, generation batches, Intercept entries'
links to Modes — names them by id with no cascading foreign key, so it's
kept while the row is gone and shows again when a revert brings it back.
A Source's sequences are kept the same way, so a version saved before
snapshots held them still gets them back.

Note on fidelity: a snapshot only holds the fields snapshots.py captured when
it was saved — older snapshots lack some (scan_delta, an Element's variant,
delta and details, sequences, ...). Reconciliation only touches what the
snapshot actually recorded — any field it lacks is left exactly as it is,
since overwriting it to a default would destroy data the revert was never
asked to touch.
"""

import uuid
from datetime import date

from sqlalchemy.orm import Session

from app.core.enums import ElementType, ElementVariant, EmitterStatus, PriType
from app.models.emitter import Emitter
from app.models.ew_group import EwGroup
from app.models.mode import (
    ModeExtraSource,
    DEFAULT_CONFIRMATION_QUALITY,
    DEFAULT_CONFIRMATION_QUANTITY,
    Mode,
    ModeElement,
    ModeGenerationBatch,
    ModeLine,
)
from app.models.import_batch import ImportBatch
from app.models.intercept import Intercept
from app.models.parameter_sequence import ParameterSequence
from app.models.source import Source
from app.models.source_group import SourceGroup
from app.models.test_line import TestLine
from app.models.user import User


def _date_or_none(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def _num(value):
    return float(value) if value is not None else None


def _existing(db: Session, model, raw_id: str | None) -> uuid.UUID | None:
    """The id, if that row still exists — a link to one since deleted stays clear."""
    if not raw_id:
        return None
    row_id = uuid.UUID(raw_id)
    return row_id if db.get(model, row_id) is not None else None


def _variant(value: str | None) -> ElementVariant | None:
    return ElementVariant(value) if value else None


def reconcile_emitter_to_snapshot(db: Session, emitter: Emitter, snapshot: dict) -> None:
    emitter.name = snapshot["name"]
    emitter.designation = snapshot.get("designation")
    emitter.description = snapshot.get("description")
    # Status (and its rework note) is where the Emitter stands, not part of
    # its content: a revert or discard leaves it as it is.

    live_sources = {str(s.id): s for s in emitter.sources}
    target_sources = snapshot.get("sources", [])
    for s_snap in target_sources:
        source = live_sources.get(s_snap["id"])
        if source is None:
            source = Source(id=uuid.UUID(s_snap["id"]), emitter_id=emitter.id, source_date=date.fromisoformat(s_snap["source_date"]))
            db.add(source)
        source.name = s_snap["name"]
        source.description = s_snap.get("description")
        source.source_date = date.fromisoformat(s_snap["source_date"])
        if "source_type" in s_snap:
            source.source_type = s_snap["source_type"]
        if "intercept_id" in s_snap:
            # The Intercept may have been deleted since; then the link stays clear.
            source.intercept_id = _existing(db, Intercept, s_snap["intercept_id"])
        if "rf_legacy_term" in s_snap:
            source.rf_legacy_term = s_snap["rf_legacy_term"]
            source.pri_legacy_term = s_snap["pri_legacy_term"]
            source.group_id = _existing(db, SourceGroup, s_snap["group_id"])
            source.import_batch_id = _existing(db, ImportBatch, s_snap["import_batch_id"])
        db.flush()
        _reconcile_elements(db, source, s_snap.get("elements", []))
        if "parameter_sequences" in s_snap:
            _reconcile_sequences(db, source, s_snap["parameter_sequences"])

    live_ew_groups = {str(g.id): g for g in emitter.ew_groups}
    target_ew_groups = snapshot.get("ew_groups", [])
    for g_snap in target_ew_groups:
        group = live_ew_groups.get(g_snap["id"])
        if group is None:
            group = EwGroup(id=uuid.UUID(g_snap["id"]), emitter_id=emitter.id, name=g_snap["name"])
            db.add(group)
        group.name = g_snap["name"]
        group.scan_min = _num(g_snap.get("scan_min"))
        group.scan_max = _num(g_snap.get("scan_max"))
        if "scan_delta" in g_snap:
            group.scan_delta = _num(g_snap["scan_delta"])
        group.threat_priority = g_snap.get("threat_priority")
        group.ageout = _num(g_snap.get("ageout"))
        group.sort_order = g_snap.get("sort_order", 0)
        db.flush()
        _reconcile_modes(db, group, mode_snaps=g_snap.get("modes", []))

    # Delete Modes absent from the target first (defense in depth — deleting
    # a stale Source/EwGroup below would cascade-delete them anyway, but
    # being explicit keeps the order easy to reason about).
    target_mode_ids = {m["id"] for g_snap in target_ew_groups for m in g_snap.get("modes", [])}
    for group in list(emitter.ew_groups):
        for mode in list(group.modes):
            if str(mode.id) not in target_mode_ids:
                db.delete(mode)
    db.flush()
    # Without this, EwGroup/Source objects still hold their pre-deletion
    # `.modes`/`.elements` collections in memory, so deleting one of them
    # below re-triggers its delete-orphan cascade against Modes already
    # removed above — harmless (SQLAlchemy tolerates a 0-row DELETE) but
    # noisy (SAWarning) and wasteful. Expiring forces a fresh read of the
    # now-correct DB state before those cascades are considered.
    db.expire_all()

    target_ew_group_ids = {g["id"] for g in target_ew_groups}
    for group_id, group in live_ew_groups.items():
        if group_id not in target_ew_group_ids:
            db.delete(group)

    target_source_ids = {s["id"] for s in target_sources}
    for source_id, source in live_sources.items():
        if source_id not in target_source_ids:
            db.delete(source)

    # target_mode_ids (computed above) is exactly the set of Modes this
    # snapshot's reconciliation guarantees exist, so a Test Line's
    # expected_mode_id — always captured from the same snapshot as the Mode
    # it points at — resolves against it directly rather than a live query
    # that could race the pending group/source deletes above (not yet
    # flushed at this point).
    _reconcile_test_lines(db, emitter, snapshot.get("test_lines", []), valid_mode_ids=target_mode_ids)

    db.flush()


def _reconcile_elements(db: Session, source: Source, element_snaps: list[dict]) -> None:
    live = {str(e.id): e for e in source.elements}
    target_ids = {e["id"] for e in element_snaps}
    for e_snap in element_snaps:
        element = live.get(e_snap["id"])
        if element is None:
            element = ModeElement(
                id=uuid.UUID(e_snap["id"]), source_id=source.id, element_type=ElementType(e_snap["element_type"])
            )
            db.add(element)
        element.element_type = ElementType(e_snap["element_type"])
        element.value_min = _num(e_snap.get("value_min"))
        element.value_max = _num(e_snap.get("value_max"))
        element.stagger_values = e_snap.get("stagger_values")
        element.jitter_min = _num(e_snap.get("jitter_min"))
        element.jitter_max = _num(e_snap.get("jitter_max"))
        element.label = e_snap.get("label")
        element.sort_order = e_snap.get("sort_order", 0)
        if "variant" in e_snap:
            element.variant = _variant(e_snap["variant"])
            element.delta = _num(e_snap["delta"])
            element.details = e_snap["details"]
    for element_id, element in live.items():
        if element_id not in target_ids:
            db.delete(element)


def _reconcile_sequences(db: Session, source: Source, sequence_snaps: list[dict]) -> None:
    """Sequences aren't deleted with their Source, so one coming back with
    its id is found here, kept or brought back as the snapshot has it."""
    live = {str(q.id): q for q in db.query(ParameterSequence).filter(ParameterSequence.source_id == source.id)}
    target_ids = {q["id"] for q in sequence_snaps}
    for q_snap in sequence_snaps:
        sequence = live.get(q_snap["id"]) or db.get(ParameterSequence, uuid.UUID(q_snap["id"]))
        if sequence is None:
            sequence = ParameterSequence(id=uuid.UUID(q_snap["id"]), source_id=source.id, steps=q_snap["steps"])
            db.add(sequence)
        sequence.source_id = source.id
        sequence.label = q_snap.get("label")
        sequence.variant = _variant(q_snap.get("variant"))
        sequence.steps = q_snap["steps"]
        sequence.sort_order = q_snap.get("sort_order", 0)
        sequence.rf_delta = _num(q_snap.get("rf_delta"))
        sequence.pw_delta = _num(q_snap.get("pw_delta"))
        sequence.pri_delta = _num(q_snap.get("pri_delta"))
    for sequence_id, sequence in live.items():
        if sequence_id not in target_ids:
            db.delete(sequence)
    # The Source's (view-only) list is read again with these.
    db.flush()
    db.expire(source, ["parameter_sequences"])


def _reconcile_modes(db: Session, group: EwGroup, *, mode_snaps: list[dict]) -> None:
    live = {str(m.id): m for m in group.modes}
    for m_snap in mode_snaps:
        mode = live.get(m_snap["id"])
        if mode is None:
            mode = Mode(
                id=uuid.UUID(m_snap["id"]),
                ew_group_id=group.id,
                source_id=uuid.UUID(m_snap["source_id"]),
                name=m_snap["name"],
                pri_type=PriType(m_snap["pri_type"]),
            )
            db.add(mode)
            db.flush()
        mode.ew_group_id = group.id
        mode.source_id = uuid.UUID(m_snap["source_id"])
        mode.name = m_snap["name"]
        mode.pri_type = PriType(m_snap["pri_type"])
        mode.notes = m_snap.get("notes")
        mode.sort_order = m_snap.get("sort_order", 0)
        if "confirmation_quality" in m_snap:
            mode.confirmation_quality = m_snap["confirmation_quality"]
            mode.confirmation_quantity = m_snap["confirmation_quantity"]
        mode.extra_source_links = _extra_source_links(m_snap.get("extra_source_ids", []))
        if "generation_batch_id" in m_snap:
            mode.generation_batch_id = _existing(db, ModeGenerationBatch, m_snap["generation_batch_id"])
        _reconcile_mode_line(db, mode, m_snap.get("line"))


def _extra_source_links(source_ids: list[str]) -> list[ModeExtraSource]:
    return [ModeExtraSource(source_id=uuid.UUID(sid), sort_order=i) for i, sid in enumerate(source_ids)]


def _reconcile_mode_line(db: Session, mode: Mode, line_snap: dict | None) -> None:
    if line_snap is None:
        if mode.line is not None:
            db.delete(mode.line)
        return
    # A Mode being brought back has no line yet: its values go in before it's
    # saved (RF and PW can't be saved empty), when the Mode itself is.
    line = mode.line
    if line is None:
        line = ModeLine(mode_id=mode.id)
        mode.line = line
    line.rf_min_mhz = _num(line_snap.get("rf_min_mhz"))
    line.rf_max_mhz = _num(line_snap.get("rf_max_mhz"))
    line.pw_min_us = _num(line_snap.get("pw_min_us"))
    line.pw_max_us = _num(line_snap.get("pw_max_us"))
    line.pri_min_us = _num(line_snap.get("pri_min_us"))
    line.pri_max_us = _num(line_snap.get("pri_max_us"))
    line.jitter_min_us = _num(line_snap.get("jitter_min_us"))
    line.jitter_max_us = _num(line_snap.get("jitter_max_us"))
    line.pri_stagger_values_us = line_snap.get("pri_stagger_values_us")
    line.rf_delta = _num(line_snap.get("rf_delta"))
    line.pw_delta = _num(line_snap.get("pw_delta"))
    line.pri_delta = _num(line_snap.get("pri_delta"))
    line.frame_time_delta_us = _num(line_snap.get("frame_time_delta_us"))
    if "explicit_frame_time_us" in line_snap:
        line.explicit_frame_time_us = _num(line_snap["explicit_frame_time_us"])
    line.rf_range_matching = bool(line_snap.get("rf_range_matching"))
    line.pw_range_matching = bool(line_snap.get("pw_range_matching"))
    line.pri_range_matching = bool(line_snap.get("pri_range_matching"))
    line.type_data = line_snap.get("type_data")
    line.dsl_text = line_snap.get("dsl_text")


def _reconcile_test_lines(
    db: Session, emitter: Emitter, line_snaps: list[dict], *, valid_mode_ids: set[str]
) -> None:
    live = {str(tl.id): tl for tl in emitter.test_lines}
    target_ids = {tl["id"] for tl in line_snaps}
    for tl_snap in line_snaps:
        line = live.get(tl_snap["id"])
        if line is None:
            line = TestLine(id=uuid.UUID(tl_snap["id"]), emitter_id=emitter.id, label=tl_snap["label"])
            db.add(line)
        line.label = tl_snap["label"]
        raw_mode_id = tl_snap.get("expected_mode_id")
        # Falls back to None rather than a stale FK, in case a Test Line ever
        # ends up referencing a Mode outside this Emitter's own snapshot.
        line.expected_mode_id = uuid.UUID(raw_mode_id) if raw_mode_id in valid_mode_ids else None
        line.expected_parameters = tl_snap.get("expected_parameters")
        if "created_date" in tl_snap:
            line.created_date = _date_or_none(tl_snap["created_date"])
        if "import_batch_label" in tl_snap:
            line.import_batch_label = tl_snap["import_batch_label"]
            line.imported_by = _existing(db, User, tl_snap["imported_by"])
        line.sort_order = tl_snap.get("sort_order", 0)
    for line_id, line in live.items():
        if line_id not in target_ids:
            db.delete(line)


def build_forked_emitter(db: Session, *, source_snapshot: dict, new_name: str, created_by: uuid.UUID | None) -> Emitter:
    """Rebuilds a committed snapshot as a brand-new, fully independent
    Emitter — fresh UUIDs throughout (it must coexist with the source
    Emitter's still-live rows), remapping Mode.source_id and TestLine's
    expected_mode_id via id maps built as each row is recreated. Caller is
    responsible for flush/snapshot/commit.
    """
    new_emitter = Emitter(
        name=new_name,
        designation=source_snapshot.get("designation"),
        description=source_snapshot.get("description"),
        status=EmitterStatus.draft,
        created_by=created_by,
    )
    db.add(new_emitter)
    db.flush()

    source_id_map: dict[str, uuid.UUID] = {}
    for s_snap in source_snapshot.get("sources", []):
        new_source = Source(
            emitter_id=new_emitter.id,
            name=s_snap["name"],
            description=s_snap.get("description"),
            source_date=date.fromisoformat(s_snap["source_date"]),
            source_type=s_snap.get("source_type"),
            rf_legacy_term=s_snap.get("rf_legacy_term"),
            pri_legacy_term=s_snap.get("pri_legacy_term"),
            group_id=_existing(db, SourceGroup, s_snap.get("group_id")),
        )
        db.add(new_source)
        db.flush()
        source_id_map[s_snap["id"]] = new_source.id
        for e_snap in s_snap.get("elements", []):
            db.add(
                ModeElement(
                    source_id=new_source.id,
                    element_type=ElementType(e_snap["element_type"]),
                    value_min=_num(e_snap.get("value_min")),
                    value_max=_num(e_snap.get("value_max")),
                    stagger_values=e_snap.get("stagger_values"),
                    jitter_min=_num(e_snap.get("jitter_min")),
                    jitter_max=_num(e_snap.get("jitter_max")),
                    label=e_snap.get("label"),
                    sort_order=e_snap.get("sort_order", 0),
                    variant=_variant(e_snap.get("variant")),
                    delta=_num(e_snap.get("delta")),
                    details=e_snap.get("details"),
                )
            )
        for q_snap in s_snap.get("parameter_sequences", []):
            db.add(
                ParameterSequence(
                    source_id=new_source.id,
                    label=q_snap.get("label"),
                    variant=_variant(q_snap.get("variant")),
                    steps=q_snap["steps"],
                    sort_order=q_snap.get("sort_order", 0),
                    rf_delta=_num(q_snap.get("rf_delta")),
                    pw_delta=_num(q_snap.get("pw_delta")),
                    pri_delta=_num(q_snap.get("pri_delta")),
                )
            )

    mode_id_map: dict[str, uuid.UUID] = {}
    for g_snap in source_snapshot.get("ew_groups", []):
        new_group = EwGroup(
            emitter_id=new_emitter.id,
            name=g_snap["name"],
            scan_min=_num(g_snap.get("scan_min")),
            scan_max=_num(g_snap.get("scan_max")),
            scan_delta=_num(g_snap.get("scan_delta")),
            threat_priority=g_snap.get("threat_priority"),
            ageout=_num(g_snap.get("ageout")),
            sort_order=g_snap.get("sort_order", 0),
        )
        db.add(new_group)
        db.flush()
        for m_snap in g_snap.get("modes", []):
            new_mode = Mode(
                ew_group_id=new_group.id,
                source_id=source_id_map[m_snap["source_id"]],
                name=m_snap["name"],
                pri_type=PriType(m_snap["pri_type"]),
                notes=m_snap.get("notes"),
                sort_order=m_snap.get("sort_order", 0),
                confirmation_quality=m_snap.get("confirmation_quality", DEFAULT_CONFIRMATION_QUALITY),
                confirmation_quantity=m_snap.get("confirmation_quantity", DEFAULT_CONFIRMATION_QUANTITY),
            )
            new_mode.extra_source_links = [
                ModeExtraSource(source_id=source_id_map[sid], sort_order=i)
                for i, sid in enumerate(m_snap.get("extra_source_ids", []))
            ]
            db.add(new_mode)
            db.flush()
            mode_id_map[m_snap["id"]] = new_mode.id
            line_snap = m_snap.get("line")
            if line_snap is not None:
                db.add(
                    ModeLine(
                        mode_id=new_mode.id,
                        rf_min_mhz=_num(line_snap.get("rf_min_mhz")),
                        rf_max_mhz=_num(line_snap.get("rf_max_mhz")),
                        pw_min_us=_num(line_snap.get("pw_min_us")),
                        pw_max_us=_num(line_snap.get("pw_max_us")),
                        pri_min_us=_num(line_snap.get("pri_min_us")),
                        pri_max_us=_num(line_snap.get("pri_max_us")),
                        jitter_min_us=_num(line_snap.get("jitter_min_us")),
                        jitter_max_us=_num(line_snap.get("jitter_max_us")),
                        pri_stagger_values_us=line_snap.get("pri_stagger_values_us"),
                        rf_delta=_num(line_snap.get("rf_delta")),
                        pw_delta=_num(line_snap.get("pw_delta")),
                        pri_delta=_num(line_snap.get("pri_delta")),
                        frame_time_delta_us=_num(line_snap.get("frame_time_delta_us")),
                        explicit_frame_time_us=_num(line_snap.get("explicit_frame_time_us")),
                        rf_range_matching=bool(line_snap.get("rf_range_matching")),
                        pw_range_matching=bool(line_snap.get("pw_range_matching")),
                        pri_range_matching=bool(line_snap.get("pri_range_matching")),
                        type_data=line_snap.get("type_data"),
                        dsl_text=line_snap.get("dsl_text"),
                    )
                )

    for tl_snap in source_snapshot.get("test_lines", []):
        raw_mode_id = tl_snap.get("expected_mode_id")
        db.add(
            TestLine(
                emitter_id=new_emitter.id,
                label=tl_snap["label"],
                expected_mode_id=mode_id_map.get(raw_mode_id) if raw_mode_id else None,
                expected_parameters=tl_snap.get("expected_parameters"),
                created_date=_date_or_none(tl_snap.get("created_date")),
                import_batch_label=tl_snap.get("import_batch_label"),
                sort_order=tl_snap.get("sort_order", 0),
            )
        )

    db.flush()
    return new_emitter
