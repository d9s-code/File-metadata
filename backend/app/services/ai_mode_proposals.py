"""Modes the AI chat proposes, at the user's request — checked like a Mode
typed into the form, shown to the user as a preview, and only ever written
when the user adds them (see apply). The model can't write anything itself:
proposing only returns what it would be.

A proposal names its Emitter, EW Group and Sources the way a person would; they
must exist (the chat doesn't create EW Groups or Sources). It can set anything
the Mode form can: every value and delta of any PRI type, range matching, an
explicit frame time, confirmation, notes, several Sources and the test runs it's
derived from. What it leaves out starts as the form does (the Admin defaults).
Each proposal keeps what it resolved to by id, so adding it later adds exactly
what was shown."""

import uuid
from typing import Literal

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dsl.exceptions import DslSyntaxError
from app.dsl.renderer import render_mode_line
from app.models.emitter import Emitter
from app.models.ew_group import EwGroup
from app.models.mode import Mode
from app.models.source import Source
from app.models.test_record import TestRecord
from app.core.enums import TestScopeType
from app.schemas.mode import ModeCreate, ModeLineFields
from app.services import app_settings, checkout_service

# At most this many Modes in one proposal.
MAX_PROPOSED = 50
# Line fields that aren't part of a DSL line (kept in sync with routers/modes.py).
_NON_DSL = {
    "type_data",
    "rf_delta",
    "pw_delta",
    "pri_delta",
    "frame_time_delta_us",
    "explicit_frame_time_us",
    "rf_range_matching",
    "pw_range_matching",
    "pri_range_matching",
}


class ProposedMode(BaseModel):
    """One Mode as the model writes it."""

    emitter: str = Field(description="The Emitter's name, designation or id")
    ew_group: str = Field(description="The name of an existing EW Group of that Emitter")
    sources: list[str] | None = Field(
        None, description="The names of the Emitter's Sources it comes from, main one first (optional if it has one)"
    )
    source: str | None = Field(None, description="One Source's name — or use sources")
    name: str = Field(description="The new Mode's name")
    pri_type: Literal["fixed", "stagger", "cw", "xlet"]
    rf_min_mhz: float
    rf_max_mhz: float | None = Field(None, description="Leave out for a single RF")
    rf_delta: float | None = Field(None, description="RF ± delta, MHz (left out: the Admin default)")
    rf_range_matching: bool = False
    pw_min_us: float | None = Field(None, description="Every PRI type has a PW, CW too")
    pw_max_us: float | None = None
    pw_delta: float | None = Field(None, description="PW ± delta, µs (left out: the Admin default)")
    pw_range_matching: bool = False
    pri_min_us: float | None = Field(None, description="fixed only")
    pri_max_us: float | None = Field(None, description="fixed only; leave out for a single PRI")
    pri_delta: float | None = Field(None, description="fixed only: PRI ± delta, µs (left out: the Admin default)")
    jitter_min_us: float = Field(0, description="fixed only: jitter range, µs")
    jitter_max_us: float = Field(0, description="fixed only")
    stagger_us: list[float] | None = Field(None, description="stagger only: the steps in µs, in order")
    frame_time_delta_us: float | None = Field(None, description="stagger only: frame time ± delta, µs (left out: the Admin default)")
    explicit_frame_time_us: float | None = Field(
        None, description="stagger only: a frame time other than the sum of the steps, µs (usually left out)"
    )
    pri_range_matching: bool = False
    confirmation_quality: int | None = Field(None, description="0–100 (left out: the Admin default)")
    confirmation_quantity: int | None = Field(None, description="1 or more (left out: the Admin default)")
    derived_from_tests: list[str] | None = Field(
        None, description="Test runs of the Emitter its values come from: their titles (or ids), as get_tests lists them"
    )
    notes: str | None = None


def resolve_sources(emitter: Emitter, names: list[str]) -> tuple[list[Source], str | None]:
    """The Emitter's Sources by name (or id), in the order given, without repeats."""
    out: list[Source] = []
    for text in names:
        t = text.strip().lower()
        found = next((s for s in emitter.sources if s.name.lower() == t or str(s.id) == t), None)
        if found is None:
            have = ", ".join(s.name for s in emitter.sources) or "none"
            return [], f'{emitter.name} has no Source "{text}" (it has: {have})'
        if found not in out:
            out.append(found)
    return out, None


def resolve_tests(db: Session, emitter: Emitter, names: list[str]) -> tuple[list[TestRecord], str | None]:
    """The Emitter's test runs by title (or id)."""
    runs = db.execute(
        select(TestRecord).where(TestRecord.scope_type == TestScopeType.emitter, TestRecord.scope_id == emitter.id)
    ).scalars().all()
    out: list[TestRecord] = []
    for text in names:
        t = text.strip().lower()
        found = [r for r in runs if str(r.id) == t] or [r for r in runs if r.title.strip().lower() == t]
        if not found:
            return [], f'{emitter.name} has no test run "{text}"'
        if len(found) > 1:
            return [], f'{emitter.name} has {len(found)} test runs called "{text}" — give its id (get_tests lists them)'
        if found[0] not in out:
            out.append(found[0])
    return out, None


def _resolve_emitter(db: Session, text: str) -> Emitter | None:
    live = select(Emitter).where(Emitter.is_deleted.is_(False))
    try:
        found = db.execute(live.where(Emitter.id == uuid.UUID(text.strip()))).scalar_one_or_none()
        if found:
            return found
    except ValueError:
        pass
    t = text.strip().lower()
    matches = db.execute(
        live.where((func.lower(Emitter.name) == t) | (func.lower(Emitter.designation) == t))
    ).scalars().all()
    return matches[0] if len(matches) == 1 else None


def _line(p: ProposedMode, defaults: dict) -> dict:
    fixed, stagger = p.pri_type == "fixed", p.pri_type == "stagger"

    def delta(v, key):
        return float(defaults[key]) if v is None else v

    return {
        "rf_min_mhz": p.rf_min_mhz,
        "rf_max_mhz": p.rf_max_mhz if p.rf_max_mhz is not None else p.rf_min_mhz,
        "rf_delta": delta(p.rf_delta, "rf_delta"),
        "pw_min_us": p.pw_min_us,
        "pw_max_us": p.pw_max_us if p.pw_max_us is not None else p.pw_min_us,
        "pw_delta": delta(p.pw_delta, "pw_delta"),
        "pri_min_us": p.pri_min_us if fixed else None,
        "pri_max_us": (p.pri_max_us if p.pri_max_us is not None else p.pri_min_us) if fixed else None,
        "pri_delta": delta(p.pri_delta, "pri_delta") if fixed else None,
        "jitter_min_us": p.jitter_min_us if fixed else None,
        "jitter_max_us": p.jitter_max_us if fixed else None,
        "pri_stagger_values_us": p.stagger_us if stagger else None,
        "frame_time_delta_us": delta(p.frame_time_delta_us, "frame_time_delta_us") if stagger else None,
        "explicit_frame_time_us": p.explicit_frame_time_us if stagger else None,
        "rf_range_matching": p.rf_range_matching,
        "pw_range_matching": p.pw_range_matching,
        "pri_range_matching": p.pri_range_matching,
    }


def _problem(err: Exception) -> str:
    if isinstance(err, ValidationError):
        first = err.errors()[0]
        return str(first.get("msg", err)).removeprefix("Value error, ")
    return str(err)


def check(db: Session, proposed: list[ProposedMode]) -> list[dict]:
    """Each proposed Mode as the user will see it: what it resolved to, its
    line, and the problem that stops it being added (None when it can be)."""
    out: list[dict] = []
    names_in_proposal: set[tuple[str, str]] = set()
    defaults = app_settings.mode_defaults(db)
    for p in proposed[:MAX_PROPOSED]:
        wanted_sources = list(p.sources or []) or ([p.source] if p.source else [])
        item = {
            "id": str(uuid.uuid4()),
            "name": p.name.strip(),
            "pri_type": p.pri_type,
            "emitter_id": None,
            "emitter_name": p.emitter,
            "ew_group_id": None,
            "ew_group_name": p.ew_group,
            "source_id": None,
            "source_name": wanted_sources[0] if wanted_sources else None,
            "source_ids": [],
            "source_names": wanted_sources,
            "confirmation_quality": p.confirmation_quality if p.confirmation_quality is not None else int(defaults["confirmation_quality"]),
            "confirmation_quantity": p.confirmation_quantity if p.confirmation_quantity is not None else int(defaults["confirmation_quantity"]),
            "derived_test_ids": [],
            "derived_test_titles": [],
            "notes": (p.notes or "").strip() or None,
            "line": _line(p, defaults),
            "dsl": None,
            "problem": None,
            "status": "proposed",
        }
        out.append(item)
        emitter = _resolve_emitter(db, p.emitter)
        if emitter is None:
            item["problem"] = f'No single Emitter called "{p.emitter}"'
            continue
        item["emitter_id"], item["emitter_name"] = str(emitter.id), emitter.name
        group = next((g for g in emitter.ew_groups if g.name.lower() == p.ew_group.strip().lower()), None)
        if group is None:
            names = ", ".join(g.name for g in emitter.ew_groups) or "none"
            item["problem"] = f'{emitter.name} has no EW Group "{p.ew_group}" (it has: {names})'
            continue
        item["ew_group_id"], item["ew_group_name"] = str(group.id), group.name
        if wanted_sources:
            sources, why = resolve_sources(emitter, wanted_sources)
        elif len(emitter.sources) == 1:
            sources, why = list(emitter.sources), None
        else:
            sources, why = [], f"Say which Source (it has: {', '.join(s.name for s in emitter.sources) or 'none'})"
        if why:
            item["problem"] = why
            continue
        item["source_ids"] = [str(s.id) for s in sources]
        item["source_names"] = [s.name for s in sources]
        item["source_id"], item["source_name"] = item["source_ids"][0], item["source_names"][0]
        if p.derived_from_tests:
            runs, why = resolve_tests(db, emitter, p.derived_from_tests)
            if why:
                item["problem"] = why
                continue
            item["derived_test_ids"] = [str(r.id) for r in runs]
            item["derived_test_titles"] = [r.title for r in runs]
        if not item["name"]:
            item["problem"] = "It needs a name"
            continue
        if p.pw_min_us is None:
            item["problem"] = "It needs a PW (every PRI type has one, CW too)"
            continue
        key = (str(group.id), item["name"].lower())
        if key in names_in_proposal or any(m.name.lower() == key[1] for m in group.modes):
            item["problem"] = f'{group.name} already has a Mode called "{item["name"]}"'
            continue
        try:
            payload = _payload(item)
        except (ValidationError, ValueError) as err:
            item["problem"] = _problem(err)
            continue
        names_in_proposal.add(key)
        item["line"] = payload.line.model_dump()
        try:
            item["dsl"] = render_mode_line(
                pri_type=payload.pri_type, **{k: v for k, v in item["line"].items() if k not in _NON_DSL}
            )
        except DslSyntaxError:
            item["dsl"] = None
    return out


def _payload(item: dict) -> ModeCreate:
    """The Mode as the form would send it."""
    # Left unset (a proposal from before these were shown), the Admin defaults fill them in.
    confirmation = {k: item[k] for k in ("confirmation_quality", "confirmation_quantity") if item.get(k) is not None}
    return ModeCreate(
        name=item["name"],
        pri_type=item["pri_type"],
        source_ids=[uuid.UUID(i) for i in item["source_ids"]],
        notes=item["notes"],
        derived_from_test_record_ids=[uuid.UUID(i) for i in item.get("derived_test_ids") or []],
        line=ModeLineFields(**item["line"]),
        **confirmation,
    )


def summary_for_model(items: list[dict]) -> str:
    """What the model is told about its proposal."""
    lines = []
    for i in items:
        where = f"{i['emitter_name']} › {i['ew_group_name']}, Sources {', '.join(i.get('source_names') or []) or '?'}"
        lines.append(f"- {i['name']} ({where}): " + (f"can't be added — {i['problem']}" if i["problem"] else f"OK — {i['dsl'] or 'valid'}"))
    ok = sum(1 for i in items if not i["problem"])
    return (
        f"Proposed {len(items)} Mode(s), {ok} valid:\n" + "\n".join(lines) + "\n\nThey're shown to the user as a "
        "preview; only the user can add them (you can't, and nothing has been added). Fix any that can't be added "
        "by proposing the whole set again, or answer: say briefly what you proposed and that they can add them."
    )


class ApplyProblem(Exception):
    """The proposal can't be added — the message says why."""


def apply(db: Session, items: list[dict], picked_ids: list[str], create_mode, user) -> list[Mode]:
    """Adds the picked proposals as Modes — all or none, each checked again
    (the library may have changed since it was proposed). Needs every Emitter
    involved checked out by the user. The caller commits."""
    by_id = {i["id"]: i for i in items}
    picked = [by_id[p] for p in dict.fromkeys(picked_ids) if p in by_id]
    if not picked or len(picked) != len(set(picked_ids)):
        raise ApplyProblem("Pick Modes from the preview to add")
    if any(i["status"] != "proposed" for i in picked):
        raise ApplyProblem("Some of these were added already")
    if any(i["problem"] for i in picked):
        raise ApplyProblem("Some of these can't be added — untick them")
    created: list[Mode] = []
    for item in picked:
        emitter = db.get(Emitter, uuid.UUID(item["emitter_id"]))
        group = db.get(EwGroup, uuid.UUID(item["ew_group_id"]))
        # Proposals from before several Sources were possible have source_id only.
        source_ids = item.get("source_ids") or [item["source_id"]]
        item["source_ids"] = source_ids
        sources = [db.get(Source, uuid.UUID(i)) for i in source_ids]
        if emitter is None or emitter.is_deleted or group is None or any(s is None for s in sources):
            raise ApplyProblem(f'"{item["name"]}": its Emitter, EW Group or a Source is gone')
        try:
            checkout_service.assert_checked_out_by(emitter, user.id)
        except checkout_service.NotCheckedOutByUser as err:
            raise ApplyProblem(f"Start editing {emitter.name} first — Modes are only added to an Emitter you're editing") from err
        if any(m.name.lower() == item["name"].lower() for m in group.modes):
            raise ApplyProblem(f'{group.name} already has a Mode called "{item["name"]}"')
        mode = create_mode(db, group, _payload(item), user.id)
        db.flush()
        db.refresh(group)
        created.append(mode)
        item["status"] = "added"
        item["mode_id"] = str(mode.id)
    return created
