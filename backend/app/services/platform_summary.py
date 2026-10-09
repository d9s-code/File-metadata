"""What the Platforms list shows about each Platform: its pinned Emitters
(how many, the worst status among them, how many pins have a newer saved
version), the Modes those pinned versions hold, the MDFs it's in, its latest
saved version, and what its latest ambiguity check found between Emitters."""

from uuid import UUID

from sqlalchemy import bindparam, func, text
from sqlalchemy.dialects.postgresql import ARRAY, UUID as PG_UUID
from sqlalchemy.orm import Session

from app.core.enums import AmbiguityRunStatus, AmbiguityScopeType, EmitterStatus
from app.models.ambiguity import AmbiguityFinding, AmbiguityRun
from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.mdf import Mdf, MdfPlatformLink
from app.models.platform import Platform, PlatformEmitterLink, PlatformVersion

# Worst first: an Emitter that needs rework holds the Platform back the most.
STATUS_SEVERITY = [EmitterStatus.deprecated, EmitterStatus.draft, EmitterStatus.in_review, EmitterStatus.validated]

_MODE_COUNTS = text(
    """
    SELECT ev.id, (
        SELECT coalesce(sum(jsonb_array_length(g -> 'modes')), 0)
        FROM jsonb_array_elements(coalesce(ev.snapshot -> 'ew_groups', '[]'::jsonb)) AS g
    ) AS modes
    FROM emitter_versions ev
    WHERE ev.id = ANY(:ids)
    """
).bindparams(bindparam("ids", type_=ARRAY(PG_UUID(as_uuid=True))))


def _blank() -> dict:
    return {
        "emitter_count": 0,
        "status_counts": {s.value: 0 for s in EmitterStatus},
        "worst_status": None,
        "outdated_pins": 0,
        "mode_count": 0,
        "mdf_count": 0,
        "latest_version_number": None,
        "latest_version_at": None,
        "ambiguity_checked_at": None,
        "ambiguous_emitters": None,
        "open_ambiguities": None,
    }


def platform_summaries(db: Session, platforms: list[Platform]) -> dict[UUID, dict]:
    ids = [p.id for p in platforms]
    out = {pid: _blank() for pid in ids}
    if not ids:
        return out

    links = db.query(PlatformEmitterLink).filter(PlatformEmitterLink.platform_id.in_(ids)).all()
    emitter_ids = {link.emitter_id for link in links}
    statuses = dict(
        db.query(Emitter.id, Emitter.status).filter(Emitter.id.in_(emitter_ids), Emitter.is_deleted.is_(False)).all()
    ) if emitter_ids else {}
    latest_number = dict(
        db.query(EmitterVersion.emitter_id, func.max(EmitterVersion.version_number))
        .filter(EmitterVersion.emitter_id.in_(emitter_ids))
        .group_by(EmitterVersion.emitter_id)
        .all()
    ) if emitter_ids else {}
    pinned_ids = [link.emitter_version_id for link in links]
    pinned_number = dict(
        db.query(EmitterVersion.id, EmitterVersion.version_number).filter(EmitterVersion.id.in_(pinned_ids)).all()
    ) if pinned_ids else {}
    modes = dict(db.execute(_MODE_COUNTS, {"ids": pinned_ids}).all()) if pinned_ids else {}

    for link in links:
        s = out[link.platform_id]
        status = statuses.get(link.emitter_id)
        if status is None:
            continue  # The Emitter was deleted since it was pinned.
        s["emitter_count"] += 1
        s["status_counts"][status.value] += 1
        pinned = pinned_number.get(link.emitter_version_id)
        latest = latest_number.get(link.emitter_id)
        if pinned is not None and latest is not None and latest > pinned:
            s["outdated_pins"] += 1
        s["mode_count"] += int(modes.get(link.emitter_version_id) or 0)
    for s in out.values():
        s["worst_status"] = next((st.value for st in STATUS_SEVERITY if s["status_counts"][st.value]), None)

    for pid, count in (
        db.query(MdfPlatformLink.platform_id, func.count(func.distinct(MdfPlatformLink.mdf_id)))
        .join(Mdf, Mdf.id == MdfPlatformLink.mdf_id)
        .filter(MdfPlatformLink.platform_id.in_(ids), Mdf.is_deleted.is_(False))
        .group_by(MdfPlatformLink.platform_id)
    ):
        out[pid]["mdf_count"] = count

    latest_versions = (
        db.query(PlatformVersion.platform_id, PlatformVersion.version_number, PlatformVersion.created_at)
        .filter(PlatformVersion.platform_id.in_(ids))
        .order_by(PlatformVersion.platform_id, PlatformVersion.version_number.desc())
        .distinct(PlatformVersion.platform_id)
    )
    for pid, number, created_at in latest_versions:
        out[pid]["latest_version_number"] = number
        out[pid]["latest_version_at"] = created_at

    # The latest finished ambiguity check of each Platform: which Emitters it
    # found could be taken for another, and how many of those findings are open.
    runs = (
        db.query(AmbiguityRun.scope_id, AmbiguityRun.id, AmbiguityRun.created_at)
        .filter(
            AmbiguityRun.scope_type == AmbiguityScopeType.platform,
            AmbiguityRun.scope_id.in_(ids),
            AmbiguityRun.status == AmbiguityRunStatus.complete,
        )
        .order_by(AmbiguityRun.scope_id, AmbiguityRun.created_at.desc())
        .distinct(AmbiguityRun.scope_id)
        .all()
    )
    run_scope = {run_id: pid for pid, run_id, _ in runs}
    for pid, _, created_at in runs:
        out[pid].update(ambiguity_checked_at=created_at, ambiguous_emitters=0, open_ambiguities=0)
    if run_scope:
        ambiguous: dict[UUID, set] = {pid: set() for pid in run_scope.values()}
        for run_id, details, reviewed_by, resolution in db.query(
            AmbiguityFinding.run_id, AmbiguityFinding.details, AmbiguityFinding.reviewed_by, AmbiguityFinding.resolution
        ).filter(AmbiguityFinding.run_id.in_(run_scope)):
            a = (details or {}).get("mode_a", {}).get("emitter_id")
            b = (details or {}).get("mode_b", {}).get("emitter_id")
            if a == b or resolution:
                continue  # Inside one Emitter (older checks), or merged away.
            pid = run_scope[run_id]
            ambiguous[pid].update((a, b))
            if reviewed_by is None:
                out[pid]["open_ambiguities"] += 1
        for pid, emitters in ambiguous.items():
            out[pid]["ambiguous_emitters"] = len(emitters)
    return out
