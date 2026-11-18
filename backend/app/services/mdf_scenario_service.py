"""An MDF test's scenario: the Platforms presented, the Emitters on the air
with each, what was observed of them — an Emitter can be taken for one on
another Platform — and which Platform each presented Platform was
intercepted as. Checked against the MDF's saved version."""

from uuid import UUID

from app.core.enums import TestResult
from app.models.scenario import MdfTestPlatform, ScenarioEmitter
from app.schemas.test_record import MdfScenarioIn
from app.services import scenario_service
from app.services.scenario_service import Candidate, ScenarioError


def mdf_platforms(snapshot: dict) -> dict[UUID, dict]:
    """The MDF version's Platforms: name and Emitters (name, Modes), by id."""
    out: dict[UUID, dict] = {}
    for link in snapshot.get("links", []) or []:
        snap = link.get("platform_snapshot") or {}
        pid = UUID(str(link["platform_id"]))
        emitters = {}
        for e_link in snap.get("links", []) or []:
            emitter = e_link.get("emitter_snapshot") or {}
            eid = UUID(str(e_link["emitter_id"]))
            emitters[eid] = {
                "name": e_link.get("emitter_name") or emitter.get("name") or "?",
                "modes": scenario_service.mode_names(emitter),
            }
        out[pid] = {"name": link.get("platform_name") or snap.get("name") or "?", "emitters": emitters}
    return out


def plan(snapshot: dict, scenario: MdfScenarioIn, dwell_version) -> tuple[list[MdfTestPlatform], list[ScenarioEmitter]]:
    """The rows for a scenario, checked: Platforms presented (and intercepted
    as) are the MDF's, Emitters on the air are on the Platform presented, and
    each mix-up names an Emitter of the MDF (on the Platform said, or its
    only one) — the checks shared with a Platform test included."""
    platforms = mdf_platforms(snapshot)
    candidates: dict[UUID, list[Candidate]] = {}
    for pid, p in platforms.items():
        for eid, e in p["emitters"].items():
            candidates.setdefault(eid, []).append(
                Candidate(emitter_id=eid, name=e["name"], platform_id=pid, platform_name=p["name"], modes=e["modes"])
            )
    dwells = (dwell_version.snapshot or {}).get("dwells") or [] if dwell_version else None
    platform_rows: list[MdfTestPlatform] = []
    emitter_rows: list[ScenarioEmitter] = []
    seen_platforms: set[UUID] = set()
    for i, presented in enumerate(scenario.platforms):
        p = platforms.get(presented.platform_id)
        if p is None:
            raise ScenarioError("Only the MDF's own Platforms can be presented (in its latest saved version)")
        if presented.platform_id in seen_platforms:
            raise ScenarioError(f"{p['name']} is presented twice")
        seen_platforms.add(presented.platform_id)
        intercepted = None
        if presented.intercepted_as_platform_id is not None:
            intercepted = platforms.get(presented.intercepted_as_platform_id)
            if intercepted is None:
                raise ScenarioError(f"{p['name']}: it can only be intercepted as one of the MDF's Platforms")
        platform_rows.append(
            MdfTestPlatform(
                platform_id=presented.platform_id,
                platform_name=p["name"],
                intercepted_as_platform_id=presented.intercepted_as_platform_id,
                intercepted_as_name=intercepted["name"] if intercepted else None,
                intercepted_unknown=presented.intercepted_unknown,
                notes=(presented.notes or "").strip() or None,
                sort_order=i,
            )
        )
        seen_emitters: set[UUID] = set()
        for entry in presented.emitters:
            if entry.emitter_id not in p["emitters"]:
                raise ScenarioError(f"{p['name']}: that Emitter isn't on this Platform")
            if entry.emitter_id in seen_emitters:
                raise ScenarioError(f"{p['name']}: {p['emitters'][entry.emitter_id]['name']} is listed twice")
            seen_emitters.add(entry.emitter_id)
            own = next(c for c in candidates[entry.emitter_id] if c.platform_id == presented.platform_id)
            emitter_rows.append(
                scenario_service.build(
                    entry,
                    emitter=own,
                    candidates=candidates,
                    dwells=dwells,
                    result=scenario_service.worked_out(entry),
                    notes=entry.notes,
                    sort_order=len(emitter_rows),
                )
            )
    return platform_rows, emitter_rows


def result_of(emitters: list[ScenarioEmitter]) -> TestResult:
    """The test's result: the worst of its Emitters' and its verdicts
    (inconclusive when nothing was observed)."""
    results = [TestResult(r.result) for r in emitters if r.result]
    verdict = scenario_service.verdicts(emitters)
    if not results and not verdict:
        return TestResult.inconclusive
    return scenario_service.overall(verdict, results or [TestResult.inconclusive])
