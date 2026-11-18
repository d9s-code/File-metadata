"""What a Platform test or an MDF test observed, Emitter by Emitter — shared
by both: the result worked out for each Emitter, the checks on what's typed
in, and the run's three verdicts (Detection, Identification, Mix-ups)."""

from dataclasses import dataclass, field
from uuid import UUID

from app.core.enums import TestResult
from app.models.scenario import ScenarioEmitter, ScenarioReport
from app.schemas.test_record import (
    ScenarioEmitterOut,
    ScenarioObservedIn,
    ScenarioReportOut,
    ScenarioVerdictsOut,
)
from app.services.test_result_service import compute_overall_result


class ScenarioError(ValueError):
    """What's typed in doesn't fit the run — the message says why, for a person."""


@dataclass
class Candidate:
    """An Emitter that can be on the air or be reported: on which Platform,
    and its Modes' names (lowercased → as written) in the version tested."""

    emitter_id: UUID
    name: str
    platform_id: UUID | None = None
    platform_name: str | None = None
    modes: dict[str, str] = field(default_factory=dict)


def mode_names(emitter_snapshot: dict | None) -> dict[str, str]:
    """A saved Emitter version's Mode names, lowercased → as written."""
    out: dict[str, str] = {}
    for group in (emitter_snapshot or {}).get("ew_groups", []) or []:
        for mode in group.get("modes", []) or []:
            name = str(mode.get("name") or "").strip()
            if name:
                out.setdefault(name.lower(), name)
    return out


def dwell_label(dwells: list[dict], index: int) -> str:
    """"Dwell 2 · 3000 MHz" — the index-th (from 1) of a Strategy version's dwells."""
    dwell = dwells[index - 1] if 0 < index <= len(dwells) else {}
    freq = dwell.get("freq_mhz")
    return f"Dwell {index} · {float(freq):g} MHz" if freq is not None else f"Dwell {index}"


def worked_out(o: ScenarioObservedIn) -> TestResult | None:
    """An Emitter's result from what was observed: missed — fail; reported as
    itself alone — pass; as itself and something else — partial; only as
    something else — fail; detected but reported as nothing — inconclusive.
    None when detection wasn't recorded."""
    if o.detected is None:
        return None
    if o.detected is False:
        return TestResult.fail
    other = bool(o.reports) or o.reported_unknown
    if o.reported_self:
        return TestResult.partial if other else TestResult.pass_
    return TestResult.fail if other else TestResult.inconclusive


def _mode(name: str | None, modes: dict[str, str], whose: str) -> str | None:
    if not name or not name.strip():
        return None
    found = modes.get(name.strip().lower())
    if found is None:
        raise ScenarioError(f"{whose} has no Mode named '{name.strip()}' in the version tested")
    return found


def build(
    o: ScenarioObservedIn,
    *,
    emitter: Candidate,
    candidates: dict[UUID, list[Candidate]],
    dwells: list[dict] | None,
    result: TestResult | None,
    notes: str | None,
    sort_order: int,
    **owner,
) -> ScenarioEmitter:
    """The row for one Emitter on the air, checked: the dwell is one of the
    run's Strategy version's, each mix-up names an Emitter that could be
    reported (not the Emitter itself — that's reported_self), and Modes named
    are Modes of the version tested."""
    row = ScenarioEmitter(
        **owner,
        platform_id=emitter.platform_id,
        platform_name=emitter.platform_name,
        emitter_id=emitter.emitter_id,
        emitter_name=emitter.name,
        detected=o.detected,
        time_to_detect_s=o.time_to_detect_s,
        reported_self=o.reported_self,
        reported_unknown=o.reported_unknown,
        result=result.value if result else None,
        notes=(notes or "").strip() or None,
        sort_order=sort_order,
    )
    if o.dwell_index is not None:
        if not dwells:
            raise ScenarioError(f"{emitter.name}: pick the run's Dwell Strategy version to say which dwell caught it")
        if o.dwell_index > len(dwells):
            raise ScenarioError(f"{emitter.name}: the Strategy version has {len(dwells)} dwells, not {o.dwell_index}")
        row.dwell_index = o.dwell_index
        row.dwell_label = dwell_label(dwells, o.dwell_index)
    seen = set()
    for i, rep in enumerate(o.reports):
        options = candidates.get(rep.reported_emitter_id) or []
        if not options:
            raise ScenarioError(f"{emitter.name}: it can only be reported as an Emitter of the run")
        pick = next((c for c in options if c.platform_id == rep.reported_platform_id), None) if rep.reported_platform_id else None
        if pick is None:
            if rep.reported_platform_id is not None:
                raise ScenarioError(f"{emitter.name}: {options[0].name} isn't on that Platform")
            pick = options[0]
        if pick.emitter_id == emitter.emitter_id and pick.platform_id == emitter.platform_id:
            raise ScenarioError(f"{emitter.name}: reported as itself is 'Reported as itself', not a mix-up")
        expected = _mode(rep.expected_mode, emitter.modes, emitter.name)
        reported = _mode(rep.reported_mode, pick.modes, pick.name)
        key = (pick.emitter_id, pick.platform_id, expected, reported)
        if key in seen:
            continue
        seen.add(key)
        row.reports.append(
            ScenarioReport(
                reported_emitter_id=pick.emitter_id,
                reported_emitter_name=pick.name,
                reported_platform_id=pick.platform_id if len(options) > 1 or pick.platform_id else None,
                reported_platform_name=pick.platform_name,
                expected_mode=expected,
                reported_mode=reported,
                sort_order=i,
            )
        )
    return row


def out(row: ScenarioEmitter) -> ScenarioEmitterOut:
    return ScenarioEmitterOut(
        emitter_id=row.emitter_id,
        emitter_name=row.emitter_name,
        platform_id=row.platform_id,
        platform_name=row.platform_name,
        detected=row.detected,
        time_to_detect_s=float(row.time_to_detect_s) if row.time_to_detect_s is not None else None,
        dwell_index=row.dwell_index,
        dwell_label=row.dwell_label,
        reported_self=row.reported_self,
        reported_unknown=row.reported_unknown,
        result=row.result,
        notes=row.notes,
        reports=[ScenarioReportOut.model_validate(r) for r in row.reports],
    )


def _share(n: int, total: int) -> str:
    if total == 0:
        return TestResult.inconclusive.value
    return (TestResult.pass_ if n == total else TestResult.fail if n == 0 else TestResult.partial).value


def verdicts(rows: list[ScenarioEmitter]) -> ScenarioVerdictsOut | None:
    """Detection: how many on the air were detected. Identification: how many
    of those were reported as themselves. Mix-ups: none, or how many times
    one was taken for another. None when the run recorded no detection."""
    observed = [r for r in rows if r.detected is not None]
    if not observed:
        return None
    detected = [r for r in observed if r.detected]
    identified = [r for r in detected if r.reported_self]
    mixups = sum(len(r.reports) for r in detected)
    return ScenarioVerdictsOut(
        detection=_share(len(detected), len(observed)),
        identification=_share(len(identified), len(detected)),
        mixups=(TestResult.pass_ if mixups == 0 else TestResult.fail).value if detected else TestResult.inconclusive.value,
        detected=len(detected),
        observed=len(observed),
        identified=len(identified),
        mixup_count=mixups,
    )


def overall(verdict: ScenarioVerdictsOut | None, emitter_results: list[TestResult]) -> TestResult:
    """The run's result: the worst of its Emitters' and its verdicts."""
    results = list(emitter_results)
    if verdict:
        results += [TestResult(v) for v in (verdict.detection, verdict.identification, verdict.mixups) if v]
    return compute_overall_result(results)
