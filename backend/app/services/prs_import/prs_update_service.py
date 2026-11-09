"""Updating existing Modes from a PRS Emitter XML file — the same file Import
from PRS reads, but each picked Mode is changed in place to its counterpart
in the file instead of a new Mode being added. The Mode keeps its id, name,
EW Group, Sources, notes, test history and intercept links, so the version
summary shows it as changed, not as one Mode removed and another added.

Pairing: each Mode picked is matched to a Mode in the file by name — the
same name in the same EW Group first, then the same name anywhere, then the
same name with the export's underscores read as spaces (the export writes
spaces as underscores) — each Mode in the file used once. The caller can
override any pair.

Values: the file holds engineered values (each range with its ± delta). By
default each Mode keeps its own deltas and the typed range is the file's
range less the delta, so a Mode that wasn't changed elsewhere comes back
exactly as it was. Where the file's range is narrower than twice the delta,
that parameter is taken as typed with delta 0 and the pair says so. Without
keep_deltas, everything is taken as typed with delta 0, as an import does.
A Stagger's frame period maps back exactly as on import.
"""

import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from app.core.enums import PriType
from app.models.ew_group import EwGroup
from app.models.mode import Mode
from app.schemas.mode import (
    ModeLineFields,
    ModeUpdate,
    require_manual_deltas,
    validate_pri_type_fields,
)
from app.services.audit_service import _json_safe
from app.services.prs_import.prs_import_service import ParsedPrsEmitter, PlannedPrsMode

_RANGES = (("rf_min_mhz", "rf_max_mhz", "rf_delta"), ("pw_min_us", "pw_max_us", "pw_delta"), ("pri_min_us", "pri_max_us", "pri_delta"))
_LABEL = {"rf_delta": "RF", "pw_delta": "PW", "pri_delta": "PRI"}
# What a pair reports as changed: the Mode's own fields and its line's.
_MODE_FIELDS = ("pri_type", "confirmation_quality", "confirmation_quantity")


def _norm(name: str) -> str:
    return " ".join(name.replace("_", " ").split()).casefold()


def emitter_modes(db: Session, emitter_id: uuid.UUID) -> list[Mode]:
    return db.query(Mode).join(EwGroup, Mode.ew_group_id == EwGroup.id).filter(EwGroup.emitter_id == emitter_id).all()


def auto_pairs(modes: list[Mode], planned: list[PlannedPrsMode]) -> dict[uuid.UUID, int | None]:
    """Each Mode's counterpart in the file (an index into planned), or None."""
    used: set[int] = set()
    out: dict[uuid.UUID, int | None] = {m.id: None for m in modes}
    rules = (
        lambda m, p: p.parsed.name == m.name and p.parsed.ew_group_name == m.ew_group.name,
        lambda m, p: p.parsed.name == m.name,
        lambda m, p: _norm(p.parsed.name) == _norm(m.name) and _norm(p.parsed.ew_group_name) == _norm(m.ew_group.name),
        lambda m, p: _norm(p.parsed.name) == _norm(m.name),
    )
    for rule in rules:
        for m in modes:
            if out[m.id] is not None:
                continue
            for i, p in enumerate(planned):
                if i not in used and rule(m, p):
                    out[m.id] = i
                    used.add(i)
                    break
    return out


def _num(v: Any) -> Any:
    v = _json_safe(v)
    return round(v, 4) if isinstance(v, float) else v


def line_for(mode: Mode, item: PlannedPrsMode, keep_deltas: bool) -> tuple[ModeLineFields, list[str]]:
    """The Mode's new line from the file, and notes on anything not kept."""
    fields = item.line_fields.model_dump()
    notes: list[str] = []
    old = mode.line
    pri_type = item.parsed.pri_type
    if keep_deltas and old is not None:
        for lo, hi, delta_key in _RANGES:
            if delta_key == "pri_delta" and pri_type != PriType.fixed:
                continue
            d = float(getattr(old, delta_key) or 0)
            if not d or fields.get(lo) is None or fields.get(hi) is None:
                continue
            new_lo, new_hi = round(fields[lo] + d, 4), round(fields[hi] - d, 4)
            if new_lo > new_hi:
                notes.append(f"{_LABEL[delta_key]} in the file is narrower than ± {d:g}: taken as typed, delta 0")
                continue
            fields[lo], fields[hi], fields[delta_key] = new_lo, new_hi, d
    if old is not None and old.type_data and pri_type == mode.pri_type:
        fields["type_data"] = old.type_data
    return ModeLineFields(**fields), notes


def _changes(mode: Mode, item: PlannedPrsMode, line: ModeLineFields) -> dict[str, dict[str, Any]]:
    changes: dict[str, dict[str, Any]] = {}
    new_mode = {
        "pri_type": item.parsed.pri_type,
        "confirmation_quality": int(item.parsed.confirmation_quality),
        "confirmation_quantity": int(item.parsed.confirmation_quantity),
    }
    for k in _MODE_FIELDS:
        a, b = _num(getattr(mode, k)), _num(new_mode[k])
        if a != b:
            changes[k] = {"old": a, "new": b}
    for k, v in line.model_dump().items():
        a = _num(getattr(mode.line, k)) if mode.line is not None else None
        b = _num(v)
        if isinstance(a, list) or isinstance(b, list):
            a = [round(float(x), 4) for x in a] if a else None
            b = [round(float(x), 4) for x in b] if b else None
        if (a or None) != (b or None) and not (a in (None, 0, 0.0) and b in (None, 0, 0.0)):
            changes[k] = {"old": a, "new": b}
    return changes


@dataclass
class UpdatePair:
    mode: Mode
    index: int | None
    match: str
    line: ModeLineFields | None = None
    changes: dict[str, dict[str, Any]] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    error: str | None = None


def plan_update(
    modes: list[Mode],
    planned: list[PlannedPrsMode],
    pairs: dict[uuid.UUID, int | None],
    keep_deltas: bool,
    auto: dict[uuid.UUID, int | None],
) -> list[UpdatePair]:
    out: list[UpdatePair] = []
    for m in modes:
        i = pairs.get(m.id)
        match = "none" if i is None else ("name" if auto.get(m.id) == i else "picked")
        pair = UpdatePair(mode=m, index=i, match=match)
        if i is not None:
            item = planned[i]
            try:
                line, notes = line_for(m, item, keep_deltas)
                validate_pri_type_fields(item.parsed.pri_type, line)
                require_manual_deltas(item.parsed.pri_type, line)
            except ValueError as exc:
                pair.error = str(exc)
            else:
                pair.line, pair.notes = line, notes
                pair.changes = _changes(m, item, line)
        out.append(pair)
    return out


def update_payload(pair: UpdatePair, planned: list[PlannedPrsMode]) -> ModeUpdate:
    item = planned[pair.index]  # type: ignore[index]
    return ModeUpdate(
        pri_type=item.parsed.pri_type,
        line=pair.line,
        confirmation_quality=int(item.parsed.confirmation_quality),
        confirmation_quantity=int(item.parsed.confirmation_quantity),
    )


def file_modes(parsed: ParsedPrsEmitter, planned: list[PlannedPrsMode]) -> list[dict[str, Any]]:
    return [
        {"index": i, "name": p.parsed.name, "ew_group_name": p.parsed.ew_group_name, "pri_type": p.parsed.pri_type.value}
        for i, p in enumerate(planned)
    ]
