"""Two Emitters side by side, each as of a saved version: what each covers
(the same ranges the Platform charts draw) and every pair of their Modes the
ambiguity check would flag — only pairs across the two, never inside one."""

from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.services.ambiguity_service import compute_pairwise_findings, flatten_emitter_snapshot
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
    if a_id == b_id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Pick two different Emitters")
    sides = [_version(db, a_id, a_version), _version(db, b_id, b_version)]
    coverage = [
        emitter_coverage(
            v.snapshot, emitter_id=e.id, emitter_name=e.name, designation=e.designation, version_number=v.version_number
        )
        for e, v in sides
    ]
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
    return {"a": coverage[0], "b": coverage[1], "findings": findings}
