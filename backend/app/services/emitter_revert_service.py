"""Reconciles an Emitter's live rows to match a committed snapshot — the
shared engine behind both "revert to an older version" and "discard
uncommitted changes" (discard is just "reconcile to the *latest* commit"),
plus the row-cloning behind "fork".

A committed snapshot (see snapshots.py::build_emitter_snapshot) preserves the
live UUID of every EwGroup/Source/Mode/ModeElement/TestLine, so reconciliation
can match by id instead of guessing from names: a row whose id is still in
the target snapshot gets its fields overwritten in place (preserving its id,
and therefore any TestRecordMode/TestRecordLine FK pointing at a surviving
Mode/TestLine); a row absent from the target snapshot gets deleted — the
same cascade delete_mode already does today with zero safety checks, so this
introduces no new class of data loss, just a bulk version of it.

Note on fidelity: a snapshot only captures the fields snapshots.py chooses to
capture (e.g. EwGroup.scan_delta and ModeElement.variant/delta/details are
not part of it). Reconciliation only ever touches what the snapshot actually
recorded — any live field the snapshot doesn't capture is left exactly as it
is, since overwriting it to a default would destroy data the revert was
never asked to touch.
"""

import uuid
from datetime import date

from sqlalchemy.orm import Session

from app.core.enums import ElementType, EmitterStatus, PriType, SourceStatus
from app.models.emitter import Emitter
from app.models.ew_group import EwGroup
from app.models.function_group import FunctionGroup
from app.models.mode import Mode, ModeElement, ModeLine
from app.models.source import Source
from app.models.test_line import TestLine


def _num(value):
    return float(value) if value is not None else None


def reconcile_emitter_to_snapshot(db: Session, emitter: Emitter, snapshot: dict) -> None:
    emitter.name = snapshot["name"]
    emitter.designation = snapshot.get("designation")
    emitter.description = snapshot.get("description")
    new_status = EmitterStatus(snapshot["status"])
    # Mirrors transition_emitter_status's own rule: a rework note only makes
    # sense while sitting at Needs rework.
    if new_status != EmitterStatus.deprecated:
        emitter.rework_note = None
    emitter.status = new_status

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
        if "status" in s_snap:
            source.status = SourceStatus(s_snap["status"])
            source.rejection_reason = s_snap.get("rejection_reason")
        db.flush()
        _reconcile_elements(db, source, s_snap.get("elements", []))

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
    for element_id, element in live.items():
        if element_id not in target_ids:
            db.delete(element)


def _resolve_function_group_id(db: Session, emitter_id: uuid.UUID, raw_id: str | None) -> uuid.UUID | None:
    """FunctionGroups aren't part of the versioned snapshot tree themselves
    (only their id/name are recorded on each Mode), so a target snapshot's
    function_group_id may reference a group since deleted — fall back to
    None rather than let a stale FK 500 the request.
    """
    if raw_id is None:
        return None
    fg_id = uuid.UUID(raw_id)
    fg = db.get(FunctionGroup, fg_id)
    if fg is None or fg.emitter_id != emitter_id:
        return None
    return fg_id


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
        mode.function_group_id = _resolve_function_group_id(db, group.emitter_id, m_snap.get("function_group_id"))
        _reconcile_mode_line(db, mode, m_snap.get("line"))


def _reconcile_mode_line(db: Session, mode: Mode, line_snap: dict | None) -> None:
    if line_snap is None:
        if mode.line is not None:
            db.delete(mode.line)
        return
    line = mode.line
    if line is None:
        line = ModeLine(mode_id=mode.id)
        db.add(line)
        db.flush()
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
        # Falls back to None rather than a stale FK — same defensive
        # reasoning as _resolve_function_group_id, in case a Test Line ever
        # ends up referencing a Mode outside this Emitter's own snapshot.
        line.expected_mode_id = uuid.UUID(raw_mode_id) if raw_mode_id in valid_mode_ids else None
        line.expected_parameters = tl_snap.get("expected_parameters")
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
            status=SourceStatus(s_snap.get("status", SourceStatus.approved.value)),
            rejection_reason=s_snap.get("rejection_reason"),
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
                )
            )

    # FunctionGroups aren't part of the snapshot tree as their own entities —
    # each Mode only records the id/name of the group it belonged to — so
    # fidelity here means recreating one new FunctionGroup per distinct
    # (id, name) referenced, rather than copying rows that were never
    # snapshotted in the first place.
    function_group_id_map: dict[str, uuid.UUID] = {}
    for g_snap in source_snapshot.get("ew_groups", []):
        for m_snap in g_snap.get("modes", []):
            old_fg_id = m_snap.get("function_group_id")
            if old_fg_id is not None and old_fg_id not in function_group_id_map:
                new_fg = FunctionGroup(emitter_id=new_emitter.id, name=m_snap.get("function_group_name") or "Unnamed")
                db.add(new_fg)
                db.flush()
                function_group_id_map[old_fg_id] = new_fg.id

    mode_id_map: dict[str, uuid.UUID] = {}
    for g_snap in source_snapshot.get("ew_groups", []):
        new_group = EwGroup(
            emitter_id=new_emitter.id,
            name=g_snap["name"],
            scan_min=_num(g_snap.get("scan_min")),
            scan_max=_num(g_snap.get("scan_max")),
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
                function_group_id=function_group_id_map.get(m_snap.get("function_group_id")),
            )
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
                sort_order=tl_snap.get("sort_order", 0),
            )
        )

    db.flush()
    return new_emitter
