"""Soft readiness signals shown before an MDF status transition — never
hard gates, just information surfaced to the person making the call.
"""

from sqlalchemy.orm import Session

from app.core.enums import TestResult, TestScopeType
from app.models.mdf import Mdf
from app.models.test_record import TestRecord


def compute_mdf_readiness_warnings(db: Session, mdf: Mdf) -> list[str]:
    warnings: list[str] = []

    referenced_emitters: dict[str, dict] = {}
    for link in mdf.links:
        for platform_link in link.platform_version.snapshot.get("links", []):
            referenced_emitters[platform_link["emitter_id"]] = platform_link

    if not referenced_emitters:
        warnings.append("This MDF has no platforms pinned yet.")
    else:
        not_validated = [
            e["emitter_name"] for e in referenced_emitters.values() if e["emitter_snapshot"]["status"] != "validated"
        ]
        if not_validated:
            names = ", ".join(sorted(not_validated))
            warnings.append(
                f"{len(not_validated)} of {len(referenced_emitters)} referenced emitter(s) are not yet "
                f"'validated' (via pinned platforms): {names}"
            )

    has_passing_test = (
        db.query(TestRecord)
        .filter(
            TestRecord.scope_type == TestScopeType.mdf,
            TestRecord.scope_id == mdf.id,
            TestRecord.result == TestResult.pass_,
        )
        .first()
        is not None
    )
    if not has_passing_test:
        warnings.append("No passing test on file for this MDF.")

    return warnings
