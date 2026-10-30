"""Two Emitters side by side, each as of a saved version: what each covers
(the same ranges the Platform charts draw) and every pair of their Modes the
ambiguity check would flag — only pairs across the two, never inside one.

Or one Emitter against another version of itself: what each version covers,
and what changed from the older to the newer — an unchanged Mode overlapping
its own earlier self says nothing, so there are no findings then."""

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.services import statuses
from app.services.ambiguity_service import compute_pairwise_findings, flatten_emitter_snapshot
from app.services.emitter_diff_service import compute_emitter_diff
from app.services.platform_coverage import emitter_coverage


def _version(db: Session, emitter_id: UUID, version_number: int | None) -> tuple[Emitter, EmitterVersion]:
    emitter = db.get(Emitter, emitter_id)
    if emitter is None or emitter.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Emitter not found")
    q = db.query(EmitterVersion).filter(EmitterVersion.emitter_id == emitter_id)
    version = (
        q.filter(EmitterVersion.version_number == version_number).first()
        if version_number is not None
        else q.order_by(EmitterVersion.version_number.desc()).first()
    )
    if version is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"'{emitter.name}' has no saved version"
            + (f" {version_number}" if version_number is not None else "")
            + " — comparisons use saved versions",
        )
    return emitter, version


def compare_emitters(
    db: Session, a_id: UUID, b_id: UUID, a_version: int | None = None, b_version: int | None = None
) -> dict:
    sides = [_version(db, a_id, a_version), _version(db, b_id, b_version)]
    if a_id == b_id and sides[0][1].version_number == sides[1][1].version_number:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick another version on one side to compare the Emitter with itself"
        )
    coverage = [
        emitter_coverage(
            v.snapshot, emitter_id=e.id, emitter_name=e.name, designation=e.designation, version_number=v.version_number
        )
        for e, v in sides
    ]
    if a_id == b_id:
        return {"a": coverage[0], "b": coverage[1], "findings": [], **_version_changes(db, sides[0][1], sides[1][1])}
    lines = [
        line
        for e, v in sides
        for line in flatten_emitter_snapshot(v.snapshot, emitter_id=str(e.id), emitter_name=e.name)
    ]
    findings = compute_pairwise_findings(lines, across_emitters_only=True)
    # Mode A always from the first Emitter, Mode B from the second.
    for f in findings:
        if f["details"]["mode_a"]["emitter_id"] != str(a_id):
            f["mode_id_a"], f["mode_id_b"] = f["mode_id_b"], f["mode_id_a"]
            d = f["details"]
            d["mode_a"], d["mode_b"] = d["mode_b"], d["mode_a"]
            d["compared"] = {"mode_a": d["compared"]["mode_b"], "mode_b": d["compared"]["mode_a"]}
    return {"a": coverage[0], "b": coverage[1], "findings": findings, "same_emitter": False}


def _mode_key(mode: dict) -> dict:
    """A Mode as compared between versions — its place in the list aside."""
    return {k: v for k, v in mode.items() if k != "sort_order"}


def _version_changes(db: Session, a: EmitterVersion, b: EmitterVersion) -> dict:
    """What changed from the older of two versions to the newer (whichever
    side each is on), and the Modes that differ — added, removed or changed."""
    older, newer = sorted((a, b), key=lambda v: v.version_number)
    modes = [
        {m["id"]: (g["id"], _mode_key(m)) for g in v.snapshot.get("ew_groups", []) for m in g.get("modes", [])}
        for v in (older, newer)
    ]
    differ = {i for i in modes[0].keys() | modes[1].keys() if modes[0].get(i) != modes[1].get(i)}
    return {
        "same_emitter": True,
        "from_version": older.version_number,
        "to_version": newer.version_number,
        "changes": compute_emitter_diff(older.snapshot, newer.snapshot, statuses.labels(db, "emitter")),
        "changed_mode_ids": sorted(differ),
    }
