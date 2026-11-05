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
    from app.services.dwell_service import mdf_dwell_links

    current = {(str(link.platform_id), str(link.platform_version_id)) for link in links} | {
        ("dwell:" + str(d.dwell_file_id), str(d.dwell_file_version_id)) for d in mdf_dwell_links(db, mdf.id)
    }
    if latest_mdf is None:
        checks.append(_item("saved", "Saved as a version", "fail", "Not saved yet — save a version to export it."))
    else:
        saved = {(sl["platform_id"], sl["platform_version_id"]) for sl in latest_mdf.snapshot.get("links", [])} | {
            ("dwell:" + d["dwell_file_id"], d["version_id"]) for d in latest_mdf.snapshot.get("dwell_files", [])
        }
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

    from app.services.pinned_changes import pins_frozen

    if pins_frozen(db, mdf.status):
        # Released (or later): its pins stay as they went out, so newer versions aren't a warning.
        kept = f"Not checked — the MDF is {statuses.label(db, 'mdf', mdf.status)}, so its pins stay as released."
        checks.append(_item("platform_pins", "Platform pins up to date", "ok", kept))
        checks.append(_item("emitter_pins", "Emitter pins up to date", "ok", kept))
    else:
        checks.extend(_pin_freshness(db, links, emitter_pins))

    if not emitters:
        none = "No Emitters in the pinned Platform versions."
        checks.append(_item("operational", "Emitters Operational", "warn", none))
        checks.append(_item("simulation", "Latest Simulation Tests passed", "warn", none))
    else:
        checks.extend(_emitter_checks(db, emitters))

    checks.append(_dwell_check(db, mdf, latest_mdf))
    _ambiguity_and_mdf_test(db, mdf, latest_mdf, checks)
    return checks


def _pin_freshness(db: Session, links: list, emitter_pins: list[tuple[str, dict]]) -> list[dict]:
    """Whether the pinned Platform versions, and the Emitter versions inside
    them, are each at their latest saved version."""
    items: list[dict] = []
    from app.services.platform_minor import version_labels

    latest_p = latest_platform_versions(db, [link.platform_id for link in links])
    label = version_labels(db, [v for _n, v in latest_p.values()])
    outdated_p = [
        f"{link.platform.name}: v{link.platform_version.version_label} pinned, v{label.get(latest_p[link.platform_id][1])} saved"
        for link in links
        if link.platform_id in latest_p and latest_p[link.platform_id][0] > link.platform_version.version_number
    ]
    items.append(
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
    items.append(
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
    return items


def _dwell_check(db: Session, mdf: Mdf, latest_mdf) -> dict:
    """Its dwell files, at the versions it pins: a newer saved version of a
    file (not flagged once the MDF is released), a file changed since it was
    saved, a pinned version with no Strategy or a Strategy with no dwells, a
    Strategy at an older version, and Platforms no dwell Strategy covers."""
    from app.services.dwell_service import file_changed, latest_file_version, latest_strategy_version, mdf_dwell_links
    from app.services.pinned_changes import pins_frozen

    links = mdf_dwell_links(db, mdf.id)
    if not links:
        return _item("dwells", "Dwell files", "ok", "No dwell file goes into this MDF.")
    frozen = pins_frozen(db, mdf.status)
    problems: list[str] = []
    covered: set[str] = set()
    has_default = False
    for link in links:
        f, pinned = link.dwell_file, link.version
        latest = latest_file_version(db, f.id)
        if not frozen and latest is not None and latest.version_number > pinned.version_number:
            problems.append(f"{f.name}: v{pinned.version_number} pinned, v{latest.version_number} saved — repin to include it")
        elif latest is not None and latest.id == pinned.id and file_changed(latest, f):
            problems.append(f"{f.name}: changed since v{latest.version_number} — save the file, then repin")
        strategies = pinned.snapshot.get("strategies") or []
        if not strategies:
            problems.append(f"{f.name} v{pinned.version_number}: no Strategy in it — its file would be empty")
        for st in strategies:
            snap = st.get("snapshot") or {}
            name = snap.get("name") or "Strategy"
            ids = snap.get("platform_ids") or []
            if not ids:
                has_default = True
            covered.update(ids)
            if not (snap.get("dwells") or []):
                problems.append(f"{f.name} → {name}: v{st.get('strategy_version_number')} has no dwells")
            newest = latest_strategy_version(db, st.get("strategy_id")) if not frozen and st.get("strategy_id") else None
            if newest and newest.version_number > (st.get("strategy_version_number") or 0):
                problems.append(
                    f"{f.name} → {name}: v{st.get('strategy_version_number')} in the pinned file, v{newest.version_number} saved"
                )
    if not has_default:
        missing = sorted(link.platform.name for link in mdf.links if str(link.platform_id) not in covered)
        if missing:
            problems.append(f"No dwell Strategy for: {', '.join(missing)}")
    return _item(
        "dwells",
        "Dwell files",
        "warn" if problems else "ok",
        f"{_plural(len(problems), 'thing')} to look at in its dwell files."
        if problems
        else f"{_plural(len(links), 'dwell file')} pinned"
        + (", covering every Platform." if frozen else ", each at its latest saved version and covering every Platform."),
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
