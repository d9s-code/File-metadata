"""The weekly progress update: what happened in the 7 days up to a date, for
a section's morning brief — the current MDF's progress, the Emitter work,
the testing and what's next. The app draws it as one 16:9 slide (an image);
this gathers the numbers. Read-only, from the audit trail and the records."""

from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.enums import AuditAction, AuditEntityType, TestScopeType
from app.models.audit_log import AuditLog
from app.models.emitter import Emitter
from app.models.mdf_plan import MdfLogEntry
from app.models.scenario import ScenarioEmitter, ScenarioReport
from app.models.task import Task
from app.models.test_record import PlatformTest, TestRecord
from app.services import dashboard_service, statuses

DAYS = 7
DONE = "validated"
REWORK = "deprecated"
# How many of a list the slide has room for.
LIST_LIMIT = 6


def period(end: date) -> tuple[date, date, datetime, datetime]:
    """The 7 days up to and including `end`: first and last day, and the
    times from the start of the first to the end of the last (UTC)."""
    start = end - timedelta(days=DAYS - 1)
    return (
        start,
        end,
        datetime.combine(start, time.min, tzinfo=timezone.utc),
        datetime.combine(end + timedelta(days=1), time.min, tzinfo=timezone.utc),
    )


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _reasons(e: dict, label) -> list[tuple[int, str]]:
    """Why an Emitter isn't done, worst first — as the dashboard's Next up
    (frontend releaseProgress.ts) says it."""
    out: list[tuple[int, str]] = []
    sim = e.get("sim") or {}
    lines = sim.get("line_count") or 0
    o = sim.get("line_outcomes") or {}
    wrong = (o.get("fail") or 0) + (o.get("partial") or 0)
    if wrong:
        out.append((0, f"{_plural(wrong, 'SIM Test Line')} missed or partial"))
    if e.get("status") == REWORK:
        out.append((0, label(REWORK)))
    if not lines:
        out.append((2, "No SIM Test Lines"))
    elif not sim.get("last_validated_at"):
        out.append((1, "Never simulation-tested"))
    elif sim.get("changed_since_validation"):
        out.append((1, "Changed since its last SIM run"))
    if e.get("latest_version") and e["latest_version"] > e["pinned_version"]:
        out.append((1, f"Pinned v{e['pinned_version']}, v{e['latest_version']} saved"))
    if not out and e.get("status") != DONE:
        out.append((3, f"{label(e.get('status') or 'draft')}, not Operational yet"))
    return sorted(out)


def _status_moves(db: Session, since: datetime, until: datetime) -> list[AuditLog]:
    return (
        db.query(AuditLog)
        .filter(
            AuditLog.action == AuditAction.status_change,
            AuditLog.entity_type == AuditEntityType.emitter.value,
            AuditLog.created_at >= since,
            AuditLog.created_at < until,
        )
        .order_by(AuditLog.created_at)
        .all()
    )


def _mdf(db: Session, end: date, since: datetime, until: datetime, moves: list[AuditLog], label) -> dict | None:
    release = dashboard_service.release_section(db)
    mdf = release["mdf"]
    if mdf is None:
        return None
    emitters = release["emitters"]
    ids = {e["emitter_id"] for e in emitters}
    by_status = Counter(e.get("status") or "draft" for e in emitters)
    sim = Counter()
    for e in emitters:
        o = (e.get("sim") or {}).get("line_outcomes") or {}
        sim["pass"] += o.get("pass", 0)
        sim["partial"] += o.get("partial", 0)
        sim["fail"] += o.get("fail", 0)
        sim["untested"] += o.get("untested", 0) + o.get("inconclusive", 0) + o.get("outdated", 0)
    # Operational a week ago: now, less those that got there this week, plus those that left.
    gained = {str(m.entity_id) for m in moves if str(m.entity_id) in ids and (m.changes or {}).get("status", {}).get("new") == DONE}
    lost = {str(m.entity_id) for m in moves if str(m.entity_id) in ids and (m.changes or {}).get("status", {}).get("old") == DONE}
    operational = by_status.get(DONE, 0)
    not_done = sorted(
        ((e, r) for e in emitters if (r := _reasons(e, label))),
        key=lambda x: (x[1][0][0], -len(x[1]), x[0]["name"].lower()),
    )
    log = (
        db.query(MdfLogEntry)
        .filter(MdfLogEntry.mdf_id == UUID(mdf["id"]), MdfLogEntry.created_at >= since, MdfLogEntry.created_at < until)
        .order_by(MdfLogEntry.created_at)
        .all()
    )
    due = date.fromisoformat(mdf["due_date"]) if mdf["due_date"] else None
    order = [d.key for d in statuses.definitions(db, "emitter")]
    colors = {d.key: d.color for d in statuses.definitions(db, "emitter")}
    return {
        "name": mdf["name"],
        "status": statuses.label(db, "mdf", mdf["status"]),
        "customer": mdf["customer"],
        "due_date": mdf["due_date"],
        "days_left": (due - end).days if due else None,
        "emitters": len(emitters),
        "operational": operational,
        "operational_week_ago": operational - len(gained - lost) + len(lost - gained),
        "by_status": [
            {"key": k, "label": label(k), "color": colors.get(k, "grey"), "count": by_status[k]}
            for k in sorted(by_status, key=lambda k: order.index(k) if k in order else len(order))
        ],
        "sim": dict(sim),
        "not_done": len(not_done),
        "next_up": [{"name": e["name"], "reason": r[0][1], "more": len(r) - 1, "assignee": e.get("assignee")} for e, r in not_done[:LIST_LIMIT]],
        "log": [
            {"date": x.created_at.date().isoformat(), "kind": x.kind, "body": x.body, "author": x.author.username if x.author else None}
            for x in log
        ],
    }


def _emitter_work(db: Session, since: datetime, until: datetime, moves: list[AuditLog], label) -> dict:
    names = dict(db.query(Emitter.id, Emitter.name).all())
    deleted = {i for (i,) in db.query(Emitter.id).filter(Emitter.is_deleted.is_(True)).all()}
    status_moves = [
        {
            "emitter": names.get(m.entity_id, "(deleted)"),
            "from": label((m.changes or {}).get("status", {}).get("old")),
            "to": label((m.changes or {}).get("status", {}).get("new")),
            "to_key": (m.changes or {}).get("status", {}).get("new"),
            "date": m.created_at.date().isoformat(),
        }
        for m in moves
        if m.entity_id not in deleted
    ]
    mode_rows = (
        db.query(AuditLog.emitter_id, AuditLog.action)
        .filter(
            AuditLog.entity_type == AuditEntityType.mode.value,
            AuditLog.action.in_([AuditAction.create, AuditAction.update, AuditAction.delete]),
            AuditLog.created_at >= since,
            AuditLog.created_at < until,
        )
        .all()
    )
    per = defaultdict(Counter)
    for emitter_id, action in mode_rows:
        if emitter_id is not None and emitter_id not in deleted:
            per[emitter_id][action.value] += 1
    totals = Counter()
    for c in per.values():
        totals.update(c)
    versions = (
        db.query(AuditLog)
        .filter(
            AuditLog.action == AuditAction.commit,
            AuditLog.entity_type == AuditEntityType.emitter.value,
            AuditLog.created_at >= since,
            AuditLog.created_at < until,
        )
        .order_by(AuditLog.created_at)
        .all()
    )
    versions = [v for v in versions if (v.changes or {}).get("version_number") is not None and v.entity_id not in deleted]
    busiest = sorted(per.items(), key=lambda kv: (-sum(kv[1].values()), names.get(kv[0], "").lower()))
    return {
        "status_moves": status_moves,
        "to_operational": sum(1 for m in status_moves if m["to_key"] == DONE),
        "to_rework": sum(1 for m in status_moves if m["to_key"] == REWORK),
        "modes": {"added": totals["create"], "changed": totals["update"], "removed": totals["delete"]},
        "emitters_touched": len(per),
        "busiest": [
            {"emitter": names.get(eid, "(deleted)"), "added": c["create"], "changed": c["update"], "removed": c["delete"]}
            for eid, c in busiest[:LIST_LIMIT]
        ],
        "versions": [
            {"emitter": names.get(v.entity_id, "(deleted)"), "version": v.changes["version_number"], "date": v.created_at.date().isoformat()}
            for v in versions
        ],
        "needs_rework": db.query(Emitter).filter(Emitter.is_deleted.is_(False), Emitter.status == REWORK).count(),
    }


def _testing(db: Session, start: date, end: date) -> dict:
    runs = (
        db.query(TestRecord)
        .filter(TestRecord.test_date >= start, TestRecord.test_date <= end, TestRecord.platform_test_id.is_(None))
        .all()
    )
    emitter_runs = [r for r in runs if r.scope_type == TestScopeType.emitter]
    mdf_runs = [r for r in runs if r.scope_type == TestScopeType.mdf]
    platform_tests = db.query(PlatformTest).filter(PlatformTest.test_date >= start, PlatformTest.test_date <= end).all()
    pt_ids = [p.id for p in platform_tests]
    mdf_ids = [r.id for r in mdf_runs]
    mixups = 0
    if pt_ids or mdf_ids:
        q = db.query(ScenarioReport).join(ScenarioEmitter, ScenarioReport.scenario_emitter_id == ScenarioEmitter.id)
        mixups = q.filter(
            (ScenarioEmitter.platform_test_id.in_(pt_ids or [None])) | (ScenarioEmitter.mdf_test_record_id.in_(mdf_ids or [None]))
        ).count()

    def results(rs) -> dict:
        c = Counter(getattr(r.result, "value", r.result) for r in rs)
        return {k: c.get(k, 0) for k in ("pass", "partial", "fail", "inconclusive")}

    # A Platform test's result is the worst of its Emitters' records.
    pt_results = Counter()
    for p in platform_tests:
        rs = [getattr(r.result, "value", r.result) for r in p.records]
        worst = next((k for k in ("fail", "partial", "inconclusive", "pass") if k in rs), "inconclusive")
        pt_results[worst] += 1
    return {
        "emitter_runs": len(emitter_runs),
        "emitter_results": results(emitter_runs),
        "platform_tests": len(platform_tests),
        "platform_results": {k: pt_results.get(k, 0) for k in ("pass", "partial", "fail", "inconclusive")},
        "mdf_tests": len(mdf_runs),
        "mdf_results": results(mdf_runs),
        "mixups": mixups,
    }


def _outlook(db: Session, end: date) -> dict:
    open_tasks = db.query(Task).filter(Task.done_at.is_(None))
    return {
        "open_tasks": open_tasks.count(),
        "overdue_tasks": open_tasks.filter(Task.due_date.isnot(None), Task.due_date < end).count(),
        "unassigned_tasks": open_tasks.filter(Task.assignee_id.is_(None)).count(),
    }


def weekly_update(db: Session, end: date) -> dict:
    start, end, since, until = period(end)
    moves = _status_moves(db, since, until)
    labels = statuses.labels(db, "emitter")

    def label(key: str | None) -> str:
        return "" if key is None else labels.get(key, key.replace("_", " ").capitalize())

    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "mdf": _mdf(db, end, since, until, moves, label),
        "emitters": _emitter_work(db, since, until, moves, label),
        "testing": _testing(db, start, end),
        "outlook": _outlook(db, end),
    }
