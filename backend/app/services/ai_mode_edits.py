"""Edits to existing Modes the AI chat proposes, at the user's request — as
with new Modes (ai_mode_proposals): checked like an edit in the Mode form,
shown to the user as a preview of each value before → after, and only ever
written when the user applies them. The model can't write anything itself.

A proposed edit names its Emitter and Mode the way a person would, and gives
only what changes — anything the Mode form can: its name, notes, Sources (all
of them, or some added or removed), EW Group, PRI type (the old type's values
make way for the new one's), every value and delta, range matching, an
explicit frame time, confirmation, and the test runs it's derived from. Each keeps what it resolved to (the Mode's id)
and the values it changes as they were, so applying it later changes exactly
what was shown — and is refused if the Mode was changed in between."""

import uuid
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from app.dsl.exceptions import DslSyntaxError
from app.dsl.renderer import render_mode_line
from app.core.enums import PriType
from app.models.emitter import Emitter
from app.models.mode import Mode
from app.schemas.mode import ModeLineFields, ModeUpdate, require_manual_deltas, validate_pri_type_fields
from app.services import app_settings, checkout_service
from app.services.ai_mode_proposals import _NON_DSL, _problem, _resolve_emitter, resolve_sources, resolve_tests

# At most this many Modes edited in one proposal.
MAX_EDITS = 50

# The line values an edit can change, in the order the preview lists them, with their labels and units.
LINE_FIELDS: dict[str, tuple[str, str]] = {
    "rf_min_mhz": ("RF min", "MHz"),
    "rf_max_mhz": ("RF max", "MHz"),
    "rf_delta": ("RF ±", "MHz"),
    "rf_range_matching": ("RF range matching", ""),
    "pri_min_us": ("PRI min", "µs"),
    "pri_max_us": ("PRI max", "µs"),
    "pri_delta": ("PRI ±", "µs"),
    "jitter_min_us": ("Jitter min", "µs"),
    "jitter_max_us": ("Jitter max", "µs"),
    "pri_stagger_values_us": ("Stagger steps", "µs"),
    "frame_time_delta_us": ("Frame time ±", "µs"),
    "explicit_frame_time_us": ("Explicit frame time", "µs"),
    "pri_range_matching": ("PRI range matching", ""),
    "pw_min_us": ("PW min", "µs"),
    "pw_max_us": ("PW max", "µs"),
    "pw_delta": ("PW ±", "µs"),
    "pw_range_matching": ("PW range matching", ""),
}
# What else an edit can change, compared as plain values.
OTHER_FIELDS: dict[str, tuple[str, str]] = {
    "name": ("Name", ""),
    "notes": ("Notes", ""),
    "pri_type": ("PRI type", ""),
    "ew_group": ("EW Group", ""),
    "sources": ("Sources", ""),
    "confirmation_quality": ("Confirmation quality", "%"),
    "confirmation_quantity": ("Confirmation quantity", ""),
}
# The values only one PRI type has.
_FIXED_ONLY = ("pri_min_us", "pri_max_us", "pri_delta", "jitter_min_us", "jitter_max_us")
_STAGGER_ONLY = ("pri_stagger_values_us", "frame_time_delta_us", "explicit_frame_time_us")


class ProposedModeEdit(BaseModel):
    """One existing Mode's edit as the model writes it: only what changes."""

    emitter: str = Field(description="The Emitter's name, designation or id")
    mode: str = Field(description="The Mode's current name (or id)")
    ew_group: str | None = Field(None, description="Its EW Group, when two of the Emitter's Modes have that name")
    reason: str | None = Field(None, description="Why, in a few words (shown to the user)")
    name: str | None = Field(None, description="A new name")
    notes: str | None = Field(None, description='New notes (replace the Mode\'s notes; "" clears them)')
    move_to_ew_group: str | None = Field(None, description="Another EW Group of the Emitter to move it to")
    sources: list[str] | None = Field(None, description="All its Sources from now on (names), main one first")
    add_sources: list[str] | None = Field(None, description="Sources to add to the ones it has")
    remove_sources: list[str] | None = Field(None, description="Sources to take off it (it keeps at least one)")
    pri_type: Literal["fixed", "stagger", "cw", "xlet"] | None = Field(
        None, description="A new PRI type — give the new type's values too (a fixed PRI range, or stagger steps)"
    )
    rf_min_mhz: float | None = None
    rf_max_mhz: float | None = None
    rf_delta: float | None = Field(None, description="RF ± delta, MHz")
    rf_range_matching: bool | None = None
    pri_min_us: float | None = Field(None, description="fixed only")
    pri_max_us: float | None = Field(None, description="fixed only")
    pri_delta: float | None = Field(None, description="fixed only: PRI ± delta, µs")
    jitter_min_us: float | None = Field(None, description="fixed only")
    jitter_max_us: float | None = Field(None, description="fixed only")
    stagger_us: list[float] | None = Field(None, description="stagger only: the whole new sequence of steps in µs, in order")
    frame_time_delta_us: float | None = Field(None, description="stagger only: frame time ± delta, µs")
    explicit_frame_time_us: float | None = Field(None, description="stagger only: a frame time other than the sum of the steps, µs")
    clear_explicit_frame_time: bool = Field(False, description="stagger only: go back to the sum of the steps")
    pri_range_matching: bool | None = None
    pw_min_us: float | None = None
    pw_max_us: float | None = None
    pw_delta: float | None = Field(None, description="PW ± delta, µs")
    pw_range_matching: bool | None = None
    confirmation_quality: int | None = Field(None, description="0–100")
    confirmation_quantity: int | None = Field(None, description="1 or more")
    derived_from_tests: list[str] | None = Field(
        None, description="Test runs of the Emitter this change comes from: their titles (or ids), as get_tests lists them"
    )


def _plain(v):
    """A stored value as JSON can keep it (numbers are Decimals in the database)."""
    if isinstance(v, bool) or v is None or isinstance(v, (str, dict)):
        return v
    if isinstance(v, (list, tuple)):
        return [_plain(x) for x in v]
    return float(v)


def _current_line(mode: Mode) -> dict:
    line = mode.line
    return {k: _plain(getattr(line, k)) for k in ModeLineFields.model_fields} if line else {}


def _same(a, b) -> bool:
    if isinstance(a, str) or isinstance(b, str):
        return (a or None) == (b or None)
    if isinstance(a, list) and a and isinstance(a[0], str) or isinstance(b, list) and b and isinstance(b[0], str):
        return list(a or []) == list(b or [])
    if isinstance(a, list) or isinstance(b, list):
        return [float(x) for x in a or []] == [float(x) for x in b or []]
    if isinstance(a, bool) or isinstance(b, bool):
        return bool(a) == bool(b)
    if a is None or b is None:
        return a is None and b is None
    return abs(float(a) - float(b)) < 1e-9


def _find_mode(emitter: Emitter, text: str, group: str | None) -> tuple[Mode | None, str | None]:
    modes = [m for g in emitter.ew_groups for m in g.modes]
    try:
        wanted = uuid.UUID(text.strip())
        found = next((m for m in modes if m.id == wanted), None)
        return (found, None) if found else (None, f"{emitter.name} has no Mode with that id")
    except ValueError:
        pass
    t = text.strip().lower()
    named = [m for m in modes if m.name.lower() == t]
    if group:
        named = [m for m in named if m.ew_group.name.lower() == group.strip().lower()]
    if len(named) == 1:
        return named[0], None
    if not named:
        return None, f'{emitter.name} has no Mode called "{text}"' + (f" in {group}" if group else "")
    return None, f'{emitter.name} has {len(named)} Modes called "{text}" — say which EW Group'


def _dsl(pri_type: str, line: dict) -> str | None:
    try:
        return render_mode_line(pri_type=pri_type, **{k: v for k, v in line.items() if k not in _NON_DSL})
    except (DslSyntaxError, TypeError, ValueError):
        return None


def check(db: Session, proposed: list[ProposedModeEdit]) -> list[dict]:
    """Each proposed edit as the user will see it: the Mode it resolved to,
    each value before → after, the line it would have, and the problem that
    stops it being applied (None when it can be)."""
    out: list[dict] = []
    seen: set[str] = set()
    for p in proposed[:MAX_EDITS]:
        item = {
            "id": str(uuid.uuid4()),
            "emitter_id": None,
            "emitter_name": p.emitter,
            "mode_id": None,
            "mode_name": p.mode,
            "ew_group_name": p.ew_group,
            "pri_type": None,
            "reason": (p.reason or "").strip() or None,
            "changes": [],
            "line": None,
            "dsl_before": None,
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
        mode, why = _find_mode(emitter, p.mode, p.ew_group)
        if mode is None:
            item["problem"] = why
            continue
        item.update(mode_id=str(mode.id), mode_name=mode.name, ew_group_name=mode.ew_group.name, pri_type=mode.pri_type.value)
        if item["mode_id"] in seen:
            item["problem"] = f"{mode.name} is edited twice in this proposal — put it in one edit"
            continue
        seen.add(item["mode_id"])

        before = _current_line(mode)
        given = p.model_dump(exclude_none=True)
        if "stagger_us" in given:
            given["pri_stagger_values_us"] = given.pop("stagger_us")
        given_line = {k: v for k, v in given.items() if k in LINE_FIELDS}
        after = {**before, **given_line}
        if p.clear_explicit_frame_time:
            after["explicit_frame_time_us"] = None
        old_type = mode.pri_type.value
        new_type = p.pri_type or old_type
        if new_type != old_type:
            # The old type's values make way; the new type's come from the edit, deltas from the defaults.
            defaults = app_settings.mode_defaults(db)
            for k in (*_FIXED_ONLY, *_STAGGER_ONLY):
                if k not in given_line:
                    after[k] = None
            if new_type == "fixed":
                if after["pri_max_us"] is None:
                    after["pri_max_us"] = after["pri_min_us"]
                for k, v in (("pri_delta", float(defaults["pri_delta"])), ("jitter_min_us", 0.0), ("jitter_max_us", 0.0)):
                    if after[k] is None:
                        after[k] = v
            if new_type == "stagger" and after["frame_time_delta_us"] is None:
                after["frame_time_delta_us"] = float(defaults["frame_time_delta_us"])
        changes = [
            {"field": k, "label": LINE_FIELDS[k][0], "unit": LINE_FIELDS[k][1], "old": before.get(k), "new": after[k]}
            for k in LINE_FIELDS
            if not _same(before.get(k), after.get(k))
        ]

        def other(field: str, old, new) -> None:
            label, unit = OTHER_FIELDS[field]
            changes.insert(0, {"field": field, "label": label, "unit": unit, "old": old, "new": new})

        problem = None
        # Sources: all of them anew, or some added or removed.
        current = list(mode.sources)
        wanted = current
        if p.sources:
            wanted, problem = resolve_sources(emitter, p.sources)
        if not problem and p.add_sources:
            added, problem = resolve_sources(emitter, p.add_sources)
            wanted = [*wanted, *(s for s in added if s not in wanted)]
        if not problem and p.remove_sources:
            removed, problem = resolve_sources(emitter, p.remove_sources)
            wanted = [s for s in wanted if s not in removed]
            if not wanted and not problem:
                problem = "A Mode keeps at least one Source"
        if problem:
            item["problem"] = problem
            continue
        if [s.id for s in wanted] != [s.id for s in current]:
            other("sources", [s.name for s in current], [s.name for s in wanted])
            item["source_ids"] = [str(s.id) for s in wanted]
        # Confirmation.
        for field, ok in (("confirmation_quantity", lambda v: v >= 1), ("confirmation_quality", lambda v: 0 <= v <= 100)):
            value = getattr(p, field)
            if value is None or value == getattr(mode, field):
                continue
            if not ok(value):
                problem = f"{OTHER_FIELDS[field][0]} {value} isn't allowed (" + ("0–100)" if field == "confirmation_quality" else "1 or more)")
                break
            other(field, getattr(mode, field), value)
        if problem:
            item["problem"] = problem
            continue
        if new_type != old_type:
            other("pri_type", old_type, new_type)
        # Another EW Group.
        target = mode.ew_group
        if p.move_to_ew_group:
            target = next((g for g in emitter.ew_groups if g.name.lower() == p.move_to_ew_group.strip().lower()), None)
            if target is None:
                names = ", ".join(g.name for g in emitter.ew_groups)
                item["problem"] = f'{emitter.name} has no EW Group "{p.move_to_ew_group}" (it has: {names})'
                continue
            if target.id != mode.ew_group_id:
                other("ew_group", mode.ew_group.name, target.name)
                item["ew_group_id"] = str(target.id)
        new_name = (p.name or "").strip() if p.name is not None else mode.name
        if not new_name:
            item["problem"] = "A Mode needs a name"
            continue
        if any(m.name.lower() == new_name.lower() and m.id != mode.id for m in target.modes):
            item["problem"] = f'{target.name} already has a Mode called "{new_name}"'
            continue
        if new_name != mode.name:
            other("name", mode.name, new_name)
        if p.notes is not None and (p.notes.strip() or None) != (mode.notes or None):
            changes.append({"field": "notes", "label": "Notes", "unit": "", "old": mode.notes, "new": p.notes.strip() or None})
        if p.derived_from_tests:
            runs, why = resolve_tests(db, emitter, p.derived_from_tests)
            if why:
                item["problem"] = why
                continue
            item["derived_test_ids"] = [str(r.id) for r in runs]
            changes.append({"field": "derived", "label": "Derived from tests", "unit": "", "old": None, "new": [r.title for r in runs]})
        item["changes"] = changes
        item["line"] = after
        item["pri_type"] = new_type
        item["dsl_before"] = _dsl(old_type, before)
        if not [c for c in changes if c["field"] != "derived"]:
            item["problem"] = "It changes nothing — every value given is the Mode's already"
            continue
        try:
            fields = ModeLineFields(**after)
            validate_pri_type_fields(PriType(new_type), fields)
            require_manual_deltas(PriType(new_type), fields)
        except (ValidationError, ValueError) as err:
            item["problem"] = _problem(err)
            continue
        item["line"] = fields.model_dump()
        item["dsl"] = _dsl(new_type, item["line"])
    return out


def summary_for_model(items: list[dict]) -> str:
    """What the model is told about its proposed edits."""
    lines = []
    for i in items:
        what = "; ".join(f"{c['label']} {c['old']} → {c['new']}" for c in i["changes"]) or "no change"
        where = f"{i['emitter_name']} › {i['mode_name']}"
        lines.append(f"- {where}: " + (f"can't be applied — {i['problem']}" if i["problem"] else what))
    ok = sum(1 for i in items if not i["problem"])
    return (
        f"Proposed edits to {len(items)} Mode(s), {ok} valid:\n" + "\n".join(lines) + "\n\nThey're shown to the user "
        "as a preview, each value before → after; only the user can apply them (you can't, and nothing has changed). "
        "Fix any that can't be applied by proposing the whole set of edits again, or answer: say briefly what you "
        "proposed to change and that they can apply it."
    )


class ApplyProblem(Exception):
    """The edits can't be applied — the message says why."""


def apply(db: Session, items: list[dict], picked_ids: list[str], update_mode, user) -> list[Mode]:
    """Applies the picked edits — all or none, each checked again, and refused
    when the Mode changed since it was proposed. Needs every Emitter involved
    checked out by the user. The caller commits."""
    by_id = {i["id"]: i for i in items}
    picked = [by_id[p] for p in dict.fromkeys(picked_ids) if p in by_id]
    if not picked or len(picked) != len(set(picked_ids)):
        raise ApplyProblem("Pick edits from the preview to apply")
    if any(i["status"] != "proposed" for i in picked):
        raise ApplyProblem("Some of these were applied already")
    if any(i["problem"] for i in picked):
        raise ApplyProblem("Some of these can't be applied — untick them")
    edited: list[Mode] = []
    for item in picked:
        mode = db.get(Mode, uuid.UUID(item["mode_id"]))
        if mode is None:
            raise ApplyProblem(f'"{item["mode_name"]}" is gone')
        emitter = mode.ew_group.emitter
        try:
            checkout_service.assert_checked_out_by(emitter, user.id)
        except checkout_service.NotCheckedOutByUser as err:
            raise ApplyProblem(f"Start editing {emitter.name} first — Modes are only changed in an Emitter you're editing") from err
        now = {
            **_current_line(mode),
            "name": mode.name,
            "notes": mode.notes,
            "pri_type": mode.pri_type.value,
            "ew_group": mode.ew_group.name,
            "sources": [s.name for s in mode.sources],
            "confirmation_quality": mode.confirmation_quality,
            "confirmation_quantity": mode.confirmation_quantity,
        }
        moved = [c["label"] for c in item["changes"] if c["field"] != "derived" and not _same(now.get(c["field"]), c["old"])]
        if moved:
            raise ApplyProblem(f"{mode.name} was changed since this was proposed ({', '.join(moved)}) — ask again")
        what: dict = {}
        for c in item["changes"]:
            if c["field"] in ("name", "notes", "pri_type", "confirmation_quality", "confirmation_quantity"):
                what[c["field"]] = c["new"]
            elif c["field"] == "sources":
                what["source_ids"] = [uuid.UUID(i) for i in item["source_ids"]]
            elif c["field"] == "ew_group":
                what["ew_group_id"] = uuid.UUID(item["ew_group_id"])
        payload = ModeUpdate(
            line=ModeLineFields(**item["line"]),
            derived_from_test_record_ids=[uuid.UUID(i) for i in item.get("derived_test_ids") or []],
            **what,
        )
        try:
            update_mode(db, mode, payload, user.id, " — proposed by the AI chat")
        except HTTPException as err:
            raise ApplyProblem(f"{mode.name}: {err.detail}") from err
        db.flush()
        edited.append(mode)
        item["status"] = "applied"
    return edited
