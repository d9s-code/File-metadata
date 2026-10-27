"""Modes the AI chat proposes, at the user's request — checked like a Mode
typed into the form, shown to the user as a preview, and only ever written
when the user adds them (see apply). The model can't write anything itself:
proposing only returns what it would be.

A proposal names its Emitter, EW Group and Source the way a person would; they
must exist (the chat doesn't create EW Groups or Sources). Each proposal keeps
what it resolved to by id, so adding it later adds exactly what was shown."""

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
    source: str | None = Field(None, description="The name of one of the Emitter's Sources (optional if it has one)")
    name: str = Field(description="The new Mode's name")
    pri_type: Literal["fixed", "stagger", "cw"]
    rf_min_mhz: float
    rf_max_mhz: float | None = Field(None, description="Leave out for a single RF")
    rf_delta: float = Field(0, description="RF ± margin, MHz")
    pw_min_us: float | None = Field(None, description="Not for CW")
    pw_max_us: float | None = None
    pw_delta: float = Field(0, description="PW ± margin, µs")
    pri_min_us: float | None = Field(None, description="fixed only")
    pri_max_us: float | None = Field(None, description="fixed only; leave out for a single PRI")
    pri_delta: float = Field(0, description="fixed only: PRI ± margin, µs")
    jitter_min_us: float = Field(0, description="fixed only: jitter range, µs")
    jitter_max_us: float = Field(0, description="fixed only")
    stagger_us: list[float] | None = Field(None, description="stagger only: the steps in µs, in order")
    frame_time_delta_us: float | None = Field(None, description="stagger only: frame time ± margin, µs (leave out for the default)")
    notes: str | None = None


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


def _line(p: ProposedMode) -> dict:
    fixed, stagger, cw = p.pri_type == "fixed", p.pri_type == "stagger", p.pri_type == "cw"
    pw_min = None if cw else p.pw_min_us
    return {
        "rf_min_mhz": p.rf_min_mhz,
        "rf_max_mhz": p.rf_max_mhz if p.rf_max_mhz is not None else p.rf_min_mhz,
        "rf_delta": p.rf_delta,
        "pw_min_us": pw_min,
        "pw_max_us": None if cw else (p.pw_max_us if p.pw_max_us is not None else pw_min),
        "pw_delta": p.pw_delta,
        "pri_min_us": p.pri_min_us if fixed else None,
        "pri_max_us": (p.pri_max_us if p.pri_max_us is not None else p.pri_min_us) if fixed else None,
        "pri_delta": p.pri_delta if fixed else None,
        "jitter_min_us": p.jitter_min_us if fixed else None,
        "jitter_max_us": p.jitter_max_us if fixed else None,
        "pri_stagger_values_us": p.stagger_us if stagger else None,
        "frame_time_delta_us": p.frame_time_delta_us if stagger else None,
        "rf_range_matching": False,
        "pw_range_matching": False,
        "pri_range_matching": False,
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
    frame_time_default = float(app_settings.mode_defaults(db)["frame_time_delta_us"])
    for p in proposed[:MAX_PROPOSED]:
        if p.frame_time_delta_us is None:
            p.frame_time_delta_us = frame_time_default
        item = {
            "id": str(uuid.uuid4()),
            "name": p.name.strip(),
            "pri_type": p.pri_type,
            "emitter_id": None,
            "emitter_name": p.emitter,
            "ew_group_id": None,
            "ew_group_name": p.ew_group,
            "source_id": None,
            "source_name": p.source,
            "notes": (p.notes or "").strip() or None,
            "line": _line(p),
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
        sources = [s for s in emitter.sources]
        if p.source:
            source = next((s for s in sources if s.name.lower() == p.source.strip().lower()), None)
        else:
            source = sources[0] if len(sources) == 1 else None
        if source is None:
            names = ", ".join(s.name for s in sources) or "none"
            item["problem"] = (
                f'{emitter.name} has no Source "{p.source}" (it has: {names})' if p.source else f"Say which Source (it has: {names})"
            )
            continue
        item["source_id"], item["source_name"] = str(source.id), source.name
        if not item["name"]:
            item["problem"] = "It needs a name"
            continue
        key = (str(group.id), item["name"].lower())
        if key in names_in_proposal or any(m.name.lower() == key[1] for m in group.modes):
            item["problem"] = f'{group.name} already has a Mode called "{item["name"]}"'
            continue
        try:
            payload = ModeCreate(
                name=item["name"], pri_type=p.pri_type, source_ids=[source.id], notes=item["notes"], line=ModeLineFields(**item["line"])
            )
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


def summary_for_model(items: list[dict]) -> str:
    """What the model is told about its proposal."""
    lines = []
    for i in items:
        where = f"{i['emitter_name']} › {i['ew_group_name']}"
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
        source = db.get(Source, uuid.UUID(item["source_id"]))
        if emitter is None or emitter.is_deleted or group is None or source is None:
            raise ApplyProblem(f'"{item["name"]}": its Emitter, EW Group or Source is gone')
        try:
            checkout_service.assert_checked_out_by(emitter, user.id)
        except checkout_service.NotCheckedOutByUser as err:
            raise ApplyProblem(f"Start editing {emitter.name} first — Modes are only added to an Emitter you're editing") from err
        if any(m.name.lower() == item["name"].lower() for m in group.modes):
            raise ApplyProblem(f'{group.name} already has a Mode called "{item["name"]}"')
        payload = ModeCreate(
            name=item["name"],
            pri_type=item["pri_type"],
            source_ids=[source.id],
            notes=item["notes"],
            line=ModeLineFields(**item["line"]),
        )
        mode = create_mode(db, group, payload, user.id)
        db.flush()
        db.refresh(group)
        created.append(mode)
        item["status"] = "added"
        item["mode_id"] = str(mode.id)
    return created
