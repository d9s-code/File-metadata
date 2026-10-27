"""Whether a Dwell Strategy has been tested for every Emitter pinned to the
Platforms it covers — testing being a by-product of Emitter testing: a
simulation run that recorded a version of the Strategy.

For each Platform the Strategy covers, each pinned Emitter (at its pinned
version) is:

- **not covered** — no dwell's band reaches its RF (the chart's "0% dwelt
  on"); testing can't fix that, the Strategy has a gap;
- **tested** — a simulation run of it recorded this Strategy and still holds:
  the dwells covering it are the same as in the latest saved version (same
  frequencies, dwell times and collect times), and it hasn't moved outside
  the RF it was tested at or grown a longer PRI / frame time since;
- **stale** — tested, but no run still holds (why, from the newest run);
- **untested** — no run of it recorded this Strategy.

A Platform test's run counts only for its own Platform; an Emitter's own run
counts on every Platform the Strategy covers. Default dwells (no Platform)
aren't judged. The Strategy is judged as of its latest saved version.
"""

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.core.enums import TestScopeType, TestType
from app.models.dwell import DwellStrategy, DwellStrategyVersion
from app.models.emitter import Emitter
from app.models.emitter_version import EmitterVersion
from app.models.platform import Platform, PlatformEmitterLink
from app.models.test_record import TestRecord
from app.services import app_settings
from app.services.dwell_service import latest_strategy_version
from app.services.platform_coverage import _mode_ranges

EPS = 1e-6
OPEN = ("untested", "stale", "not_covered")


@dataclass
class Profile:
    """What decides an Emitter's dwell testing: its Modes' RF (as typed, as the
    chart draws them) and its longest PRI or frame time."""

    spans: list[tuple[float, float]] = field(default_factory=list)
    longest_pri_us: float = 0.0


def profile(snapshot: dict) -> Profile:
    out = Profile()
    for group in snapshot.get("ew_groups", []):
        for mode in group.get("modes", []):
            ranges = _mode_ranges(mode)
            if ranges is None:
                continue
            out.spans.append(tuple(ranges["rf_raw"]))
            if ranges["pri_raw"]:
                out.longest_pri_us = max(out.longest_pri_us, ranges["pri_raw"][1])
    return out


def _bandwidth(strategy: DwellStrategy, db: Session) -> float:
    return float(strategy.bandwidth_mhz or app_settings.get_setting(db, app_settings.DWELL_BANDWIDTH_MHZ))


def covering(dwells: list[dict], spans: list[tuple[float, float]], bandwidth: float) -> list[tuple[float, float, float]]:
    """The dwells whose band (frequency ± half the bandwidth) reaches any of
    the spans: their frequency, dwell time and collect time, in order."""
    half = bandwidth / 2
    hits = []
    for d in dwells:
        f = float(d["freq_mhz"])
        if any(f - half <= hi + EPS and f + half >= lo - EPS for lo, hi in spans):
            hits.append((f, float(d["dwell_time_ms"]), float(d["collect_time_ms"])))
    return sorted(hits)


def _inside(spans: list[tuple[float, float]], tested: list[tuple[float, float]]) -> bool:
    """Every span lies within what was tested (each inside one tested span,
    or inside their union where they touch)."""
    merged: list[list[float]] = []
    for lo, hi in sorted(tested):
        if merged and lo <= merged[-1][1] + EPS:
            merged[-1][1] = max(merged[-1][1], hi)
        else:
            merged.append([lo, hi])
    return all(any(m[0] - EPS <= lo and hi <= m[1] + EPS for m in merged) for lo, hi in spans)


def why_stale(
    now_covering: list, pinned: Profile, dwells_then: list[dict], tested: Profile | None, bandwidth: float
) -> str | None:
    """None when the run still holds; else why not."""
    if covering(dwells_then, pinned.spans, bandwidth) != now_covering:
        return "the dwells covering it changed since"
    if tested is not None:
        if not _inside(pinned.spans, tested.spans):
            return "its RF moved outside what was tested"
        if pinned.longest_pri_us > tested.longest_pri_us + EPS:
            return "its longest PRI / frame time grew since"
    return None


def _runs(db: Session, strategy_id: UUID, emitter_ids: list[UUID]) -> dict[UUID, list[TestRecord]]:
    """Simulation runs of these Emitters that recorded this Strategy, newest first."""
    rows = (
        db.query(TestRecord)
        .join(DwellStrategyVersion, TestRecord.dwell_strategy_version_id == DwellStrategyVersion.id)
        .options(
            joinedload(TestRecord.dwell_strategy_version),
            joinedload(TestRecord.emitter_version),
            joinedload(TestRecord.platform_test),
        )
        .filter(
            DwellStrategyVersion.strategy_id == strategy_id,
            TestRecord.scope_type == TestScopeType.emitter,
            TestRecord.scope_id.in_(emitter_ids),
            TestRecord.test_type == TestType.simulation,
        )
        .order_by(TestRecord.test_date.desc(), TestRecord.created_at.desc())
        .all()
    )
    out: dict[UUID, list[TestRecord]] = {}
    for r in rows:
        out.setdefault(r.scope_id, []).append(r)
    return out


def _run_out(r: TestRecord) -> dict:
    return {
        "test_record_id": r.id,
        "title": r.title,
        "test_date": r.test_date,
        "result": r.result.value,
        "strategy_version_number": r.dwell_strategy_version.version_number,
        "emitter_version_number": r.emitter_version.version_number if r.emitter_version else None,
        "platform_test_id": r.platform_test_id,
    }


def strategy_testing(db: Session, strategy: DwellStrategy) -> dict:
    latest = latest_strategy_version(db, strategy.id)
    out = {"strategy_id": strategy.id, "version_number": latest.version_number if latest else None, "platforms": []}
    if latest is None or strategy.is_default:
        return out
    bandwidth = _bandwidth(strategy, db)
    dwells_now = latest.snapshot.get("dwells") or []
    platforms = (
        db.query(Platform)
        .filter(Platform.id.in_(strategy.platform_ids), Platform.is_deleted.is_(False))
        .order_by(Platform.name)
        .all()
    )
    pins = (
        db.query(PlatformEmitterLink, EmitterVersion, Emitter)
        .join(EmitterVersion, PlatformEmitterLink.emitter_version_id == EmitterVersion.id)
        .join(Emitter, PlatformEmitterLink.emitter_id == Emitter.id)
        .filter(PlatformEmitterLink.platform_id.in_([p.id for p in platforms]), Emitter.is_deleted.is_(False))
        .all()
    )
    runs = _runs(db, strategy.id, list({e.id for _l, _v, e in pins}))
    for platform in platforms:
        rows = []
        for link, version, emitter in pins:
            if link.platform_id != platform.id:
                continue
            pinned = profile(version.snapshot)
            now_covering = covering(dwells_now, pinned.spans, bandwidth)
            row = {
                "emitter_id": emitter.id,
                "emitter_name": emitter.name,
                "designation": emitter.designation,
                "pinned_version_number": version.version_number,
                "covering_dwells": len(now_covering),
                "state": "untested",
                "reason": None,
                "run": None,
            }
            # A Platform test counts only for its own Platform.
            candidates = [
                r for r in runs.get(emitter.id, []) if r.platform_test is None or r.platform_test.platform_id == platform.id
            ]
            first_reason = None
            for r in candidates:
                tested = profile(r.emitter_version.snapshot) if r.emitter_version else None
                reason = why_stale(now_covering, pinned, r.dwell_strategy_version.snapshot.get("dwells") or [], tested, bandwidth)
                if reason is None:
                    row.update(state="tested", run=_run_out(r))
                    break
                if first_reason is None:
                    first_reason = reason
                    row.update(state="stale", reason=reason, run=_run_out(r))
            if not now_covering:
                row.update(state="not_covered", reason="no dwell reaches its RF")
            rows.append(row)
        rows.sort(key=lambda x: ((x["designation"] or "￿").lower(), x["emitter_name"].lower()))
        out["platforms"].append({"platform_id": platform.id, "platform_name": platform.name, "emitters": rows})
    return out


def counts(testing: dict) -> dict[str, int]:
    """How many pinned Emitters (per Platform) are in each state."""
    totals = {"tested": 0, "stale": 0, "untested": 0, "not_covered": 0}
    for p in testing["platforms"]:
        for e in p["emitters"]:
            totals[e["state"]] += 1
    return totals
