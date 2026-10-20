"""Keeping pins current: which pinned Emitter / Platform versions have a newer
saved version, repinning them all at once, and an MDF's readiness checklist —
everything that should be true before an MDF goes out, each item ok, a
warning, or a problem."""

from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.enums import (
    AmbiguityRunStatus,
    AmbiguityScopeType,
    AmbiguitySeverity,
    TestResult,
    TestScopeType,
    TestType,
)
from app.models.ambiguity import AmbiguityFinding, AmbiguityRun
from app.models.emitter_version import EmitterVersion
from app.models.dwell import DwellFile
from app.models.emitter import Emitter
from app.models.mdf import Mdf, MdfVersion
from app.models.platform import PlatformVersion
from app.models.test_record import TestRecord
from app.services import statuses
from app.services.dates import day_text


def latest_versions(db: Session, model, owner_column, owner_ids) -> dict:
    """{owner id: (latest version number, its id)} for Emitters or Platforms."""
    owner_ids = set(owner_ids)
    if not owner_ids:
        return {}
    out: dict = {}
    for owner_id, number, version_id in (
        db.query(owner_column, model.version_number, model.id)
        .filter(owner_column.in_(owner_ids))
        .order_by(owner_column, model.version_number.desc())
        .distinct(owner_column)
    ):
        out[owner_id] = (number, version_id)
    return out


def latest_emitter_versions(db: Session, emitter_ids) -> dict:
    return latest_versions(db, EmitterVersion, EmitterVersion.emitter_id, emitter_ids)


def latest_platform_versions(db: Session, platform_ids) -> dict:
    return latest_versions(db, PlatformVersion, PlatformVersion.platform_id, platform_ids)


def _item(key: str, label: str, status: str, detail: str, items: list[str] | None = None) -> dict:
    return {"key": key, "label": label, "status": status, "detail": detail, "items": items or []}


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def mdf_readiness(db: Session, mdf: Mdf) -> list[dict]:
    """The MDF's readiness checklist, from its current pins (what a new saved
    version would hold) and the Platform and Emitter versions they pin."""
    links = list(mdf.links)
    checks: list[dict] = []

    # Every Emitter reached through the pinned Platform versions.
    emitters: dict[str, dict] = {}
    emitter_pins: list[tuple[str, dict]] = []
    for link in links:
        for pl in link.platform_version.snapshot.get("links", []):
            emitter_pins.append((link.platform.name, pl))
            emitters.setdefault(pl["emitter_id"], pl)

    if not links:
        checks.append(_item("pinned", "Platforms pinned", "fail", "No Platform pinned yet."))
    else:
        checks.append(
            _item(
                "pinned",
                "Platforms pinned",
                "ok",
                f"{_plural(len(links), 'Platform')}, {_plural(len(emitters), 'Emitter')} through them.",
            )
        )

    latest_mdf = (
        db.query(MdfVersion).filter(MdfVersion.mdf_id == mdf.id).order_by(MdfVersion.version_number.desc()).first()
    )
    current = {(str(link.platform_id), str(link.platform_version_id)) for link in links}
    if latest_mdf is None:
        checks.append(_item("saved", "Saved as a version", "fail", "Not saved yet — save a version to export it."))
    else:
        saved = {(sl["platform_id"], sl["platform_version_id"]) for sl in latest_mdf.snapshot.get("links", [])}
        if saved == current:
            checks.append(_item("saved", "Saved as a version", "ok", f"The pins are saved as v{latest_mdf.version_number}."))
        else:
            checks.append(
                _item(
                    "saved",
                    "Saved as a version",
                    "warn",
                    f"The pins changed since v{latest_mdf.version_number} — save a version to include the changes.",
                )
            )

    latest_p = latest_platform_versions(db, [link.platform_id for link in links])
    outdated_p = [
        f"{link.platform.name}: v{link.platform_version.version_number} pinned, v{latest_p[link.platform_id][0]} saved"
        for link in links
        if link.platform_id in latest_p and latest_p[link.platform_id][0] > link.platform_version.version_number
    ]
    checks.append(
        _item(
            "platform_pins",
            "Platform pins up to date",
            "warn" if outdated_p else "ok",
            f"{_plural(len(outdated_p), 'Platform')} with a newer saved version." if outdated_p else "Every pinned Platform is at its latest saved version.",
            outdated_p,
        )
    )

    latest_e = latest_emitter_versions(db, {UUID(pl["emitter_id"]) for _, pl in emitter_pins})
    outdated_e = []
    for platform_name, pl in emitter_pins:
        latest = latest_e.get(UUID(pl["emitter_id"]))
        if latest and latest[0] > pl["emitter_version_number"]:
            outdated_e.append(
                f"{platform_name} → {pl['emitter_name']}: v{pl['emitter_version_number']} pinned, v{latest[0]} saved"
            )
    checks.append(
        _item(
            "emitter_pins",
            "Emitter pins up to date",
            "warn" if outdated_e else "ok",
            f"{_plural(len(outdated_e), 'Emitter pin')} inside the pinned Platform versions behind the Emitter's latest."
            if outdated_e
            else "Every Emitter pinned in those Platform versions is at its latest saved version.",
            outdated_e,
        )
    )

    if not emitters:
        none = "No Emitters in the pinned Platform versions."
        checks.append(_item("operational", "Emitters Operational", "warn", none))
        checks.append(_item("simulation", "Latest Simulation Tests passed", "warn", none))
    else:
        checks.extend(_emitter_checks(db, emitters))

    checks.append(_dwell_check(db, mdf, latest_mdf))
    _ambiguity_and_mdf_test(db, mdf, latest_mdf, checks)
    return checks


def _dwell_check(db: Session, mdf: Mdf, latest_mdf) -> dict:
    """Its dwell files: changed since saved (saved with the next MDF version),
    saved since the latest MDF version (not in it yet), a Strategy pinned at
    a version with no dwells, or one with a newer saved version."""
    from app.services.dwell_service import file_snapshot, latest_file_version, latest_strategy_version

    files = db.query(DwellFile).filter(DwellFile.mdf_id == mdf.id).order_by(DwellFile.name).all()
    if not files:
        return _item("dwells", "Dwell files", "ok", "No dwell file goes into this MDF.")
    in_mdf = {d["dwell_file_id"]: d["version_number"] for d in (latest_mdf.snapshot.get("dwell_files", []) if latest_mdf else [])}
    problems: list[str] = []
    warn = False
    for f in files:
        latest = latest_file_version(db, f.id)
        if latest is None or latest.snapshot != file_snapshot(f):
            problems.append(f"{f.name}: changed since it was saved — saving the MDF saves it too")
            warn = True
        elif latest_mdf is not None and in_mdf.get(str(f.id)) != latest.version_number:
            problems.append(f"{f.name}: v{latest.version_number} isn't in MDF v{latest_mdf.version_number} yet — save a version")
            warn = True
        if not f.links:
            problems.append(f"{f.name}: no Strategy in it — its file would be empty")
            warn = True
        for link in f.links:
            if not (link.strategy_version.snapshot.get("dwells") or []):
                problems.append(f"{f.name} → {link.strategy.name}: v{link.strategy_version.version_number} pinned has no dwells")
                warn = True
            newest = latest_strategy_version(db, link.strategy_id)
            if newest and newest.version_number > link.strategy_version.version_number:
                problems.append(
                    f"{f.name} → {link.strategy.name}: v{link.strategy_version.version_number} pinned, v{newest.version_number} saved"
                )
                warn = True
    return _item(
        "dwells",
        "Dwell files",
        "warn" if warn else "ok",
        f"{_plural(len(problems), 'thing')} to look at in its dwell files." if warn else f"{_plural(len(files), 'dwell file')}, saved and up to date.",
        problems,
    )


def _emitter_checks(db: Session, emitters: dict[str, dict]) -> list[dict]:
    checks: list[dict] = []
    # Status is where an Emitter stands now — not something its versions hold.
    now = {str(eid): st for eid, st in db.query(Emitter.id, Emitter.status).filter(Emitter.id.in_([UUID(e) for e in emitters]))}
    not_operational = sorted(
        f"{pl['emitter_name']}: {statuses.label(db, 'emitter', now.get(eid))}"
        for eid, pl in emitters.items()
        if now.get(eid) != "validated"
    )
    checks.append(
        _item(
            "operational",
            "Emitters Operational",
            "fail" if not_operational else "ok",
            f"{_plural(len(not_operational), 'Emitter')} not Operational."
            if not_operational
            else "Every Emitter is Operational.",
            not_operational,
        )
    )

    # Each Emitter's latest Simulation Test.
    ids = [UUID(e) for e in emitters]
    latest_sim: dict = {}
    if ids:
        for scope_id, result, test_date in (
            db.query(TestRecord.scope_id, TestRecord.result, TestRecord.test_date)
            .filter(
                TestRecord.scope_type == TestScopeType.emitter,
                TestRecord.scope_id.in_(ids),
                TestRecord.test_type == TestType.simulation,
            )
            .order_by(TestRecord.scope_id, TestRecord.test_date.desc(), TestRecord.created_at.desc())
            .distinct(TestRecord.scope_id)
        ):
            latest_sim[str(scope_id)] = (result, test_date)
    failing = sorted(
        f"{pl['emitter_name']}: {latest_sim[eid][0].value.capitalize()} ({day_text(latest_sim[eid][1])})"
        for eid, pl in emitters.items()
        if eid in latest_sim and latest_sim[eid][0] != TestResult.pass_
    )
    untested = sorted(pl["emitter_name"] for eid, pl in emitters.items() if eid not in latest_sim)
    status = "fail" if failing else "warn" if untested else "ok"
    detail = (
        f"{_plural(len(failing), 'Emitter')} didn't pass its latest Simulation Test"
        + (f"; {len(untested)} never simulation-tested." if untested else ".")
        if failing
        else f"{_plural(len(untested), 'Emitter')} never simulation-tested."
        if untested
        else "Every Emitter passed its latest Simulation Test."
    )
    checks.append(
        _item("simulation", "Latest Simulation Tests passed", status, detail, failing + [f"{n}: never tested" for n in untested])
    )
    return checks


def _ambiguity_and_mdf_test(db: Session, mdf: Mdf, latest_mdf: MdfVersion | None, checks: list[dict]) -> None:
    run = (
        db.query(AmbiguityRun)
        .filter(
            AmbiguityRun.scope_type == AmbiguityScopeType.mdf,
            AmbiguityRun.scope_id == mdf.id,
            AmbiguityRun.status == AmbiguityRunStatus.complete,
        )
        .order_by(AmbiguityRun.created_at.desc())
        .first()
    )
    if run is None:
        checks.append(_item("ambiguity", "Ambiguity check", "warn", "Never checked — run one on the saved MDF."))
    else:
        open_serious = (
            db.query(func.count(AmbiguityFinding.id))
            .filter(
                AmbiguityFinding.run_id == run.id,
                AmbiguityFinding.reviewed_by.is_(None),
                AmbiguityFinding.resolution.is_(None),
                AmbiguityFinding.combined_severity.in_([AmbiguitySeverity.exact_overlap, AmbiguitySeverity.high]),
            )
            .scalar()
        )
        stale = latest_mdf is not None and run.mdf_version_id != latest_mdf.id
        if open_serious:
            checks.append(
                _item(
                    "ambiguity",
                    "Ambiguity check",
                    "fail",
                    f"{_plural(open_serious, 'High or Exact finding')} still open in the latest check"
                    + (" (and the MDF was saved since)." if stale else "."),
                )
            )
        elif stale:
            checks.append(_item("ambiguity", "Ambiguity check", "warn", "The MDF was saved since the latest check — run it again."))
        else:
            checks.append(_item("ambiguity", "Ambiguity check", "ok", "No High or Exact finding open in the latest check."))

    passing_mdf_test = (
        db.query(TestRecord.id)
        .filter(
            TestRecord.scope_type == TestScopeType.mdf,
            TestRecord.scope_id == mdf.id,
            TestRecord.result == TestResult.pass_,
        )
        .first()
    )
    checks.append(
        _item(
            "mdf_test",
            "Passing MDF test on file",
            "ok" if passing_mdf_test else "warn",
            "A passing test is on file." if passing_mdf_test else "No passing test on file for this MDF.",
        )
    )
