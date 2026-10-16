"""Statuses of Emitters, Platforms and MDFs as Admins set them up: name,
colour, order, which moves are allowed and which ask for a note.

The built-in statuses are written the first time a type's statuses are
read (so a fresh database, or a test one, has them without a seed step).
Their keys are what the app gives meaning to — `draft` is where new items
start, `validated` (Operational) is what MDF readiness and pin checks look
for, `deprecated` (Needs rework) keeps the rework note — so they can be
renamed and recoloured but not deleted."""

import re
import uuid

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.status_definition import StatusDefinition

ENTITY_TYPES = ("emitter", "platform", "mdf")
COLORS = ("grey", "blue", "green", "yellow", "amber", "orange", "red", "purple")
INITIAL = "draft"

# key, label, colour, can move to, note prompt (None: no note asked for)
_LIFECYCLE = [
    ("draft", "In progress", "grey", ["in_review"], None),
    ("in_review", "Testing", "orange", ["validated", "partially_operational", "draft"], None),
    (
        "partially_operational",
        "Partially operational",
        "yellow",
        ["validated", "in_review", "deprecated"],
        "Which part is operational?",
    ),
    ("validated", "Operational", "green", ["deprecated", "partially_operational", "in_review"], "What was validated?"),
    ("deprecated", "Needs rework", "red", ["draft"], "What needs rework?"),
]
BUILTIN: dict[str, list[tuple]] = {
    "emitter": _LIFECYCLE,
    "platform": _LIFECYCLE,
    "mdf": [
        ("draft", "Draft", "grey", ["pending_review"], None),
        ("pending_review", "Pending review", "amber", ["approved", "draft"], None),
        ("approved", "Approved", "green", ["released", "pending_review"], None),
        ("released", "Released", "blue", ["deprecated"], None),
        ("deprecated", "Deprecated", "red", ["draft"], None),
    ],
}


class StatusError(ValueError):
    pass


def _seed(db: Session, entity_type: str) -> None:
    rows = [
        {
            "entity_type": entity_type,
            "key": key,
            "label": label,
            "color": color,
            "position": i,
            "builtin": True,
            "transitions": moves,
            "requires_note": prompt is not None,
            "note_prompt": prompt,
        }
        for i, (key, label, color, moves, prompt) in enumerate(BUILTIN[entity_type])
    ]
    for row in rows:
        row["id"] = uuid.uuid4()
    db.execute(insert(StatusDefinition).values(rows).on_conflict_do_nothing(constraint="uq_status_definition_key"))
    db.flush()


def definitions(db: Session, entity_type: str) -> list[StatusDefinition]:
    """A type's statuses in order (the built-in ones written on first use)."""
    if entity_type not in ENTITY_TYPES:
        raise StatusError(f"Unknown item type '{entity_type}'")
    rows = _query(db, entity_type)
    if not rows:
        _seed(db, entity_type)
        rows = _query(db, entity_type)
    return rows


def _query(db: Session, entity_type: str) -> list[StatusDefinition]:
    return (
        db.query(StatusDefinition)
        .filter(StatusDefinition.entity_type == entity_type)
        .order_by(StatusDefinition.position, StatusDefinition.label)
        .all()
    )


def by_key(db: Session, entity_type: str) -> dict[str, StatusDefinition]:
    return {d.key: d for d in definitions(db, entity_type)}


def labels(db: Session, entity_type: str) -> dict[str, str]:
    return {d.key: d.label for d in definitions(db, entity_type)}


def label(db: Session, entity_type: str, key: str | None) -> str:
    if key is None:
        return ""
    return labels(db, entity_type).get(key, key.replace("_", " ").capitalize())


def builtin_label(entity_type: str, key: str | None) -> str | None:
    """A built-in status's default name — for where no database is at hand
    (e.g. comparing backups)."""
    if key is None:
        return None
    for k, name, *_ in BUILTIN.get(entity_type, []):
        if k == key:
            return name
    return key.replace("_", " ").capitalize()


def severity_order(db: Session, entity_type: str) -> list[str]:
    """Worst first: Needs rework, then the rest in their order, so a
    Platform shows the furthest-behind status among its Emitters."""
    keys = [d.key for d in definitions(db, entity_type)]
    return ["deprecated", *[k for k in keys if k != "deprecated"]] if "deprecated" in keys else keys


def check_move(db: Session, entity_type: str, old: str, new: str, note: str | None) -> StatusDefinition:
    """The status moved to, once the move is allowed and has its note."""
    defs = by_key(db, entity_type)
    target = defs.get(new)
    if target is None:
        raise StatusError(f"Unknown status '{new}'")
    current = defs.get(old)
    if current is None or new not in current.transitions:
        old_name = current.label if current else old
        raise StatusTransitionNotAllowed(f"Cannot move from '{old_name}' to '{target.label}'")
    if target.requires_note and not (note or "").strip():
        prompt = target.note_prompt or "Why?"
        raise StatusNoteRequired(f"A note is required when moving to {target.label}: {prompt}")
    return target


class StatusTransitionNotAllowed(StatusError):
    pass


class StatusNoteRequired(StatusError):
    pass


def new_key(db: Session, entity_type: str, name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")[:50] or "status"
    taken = set(by_key(db, entity_type))
    key, n = base, 2
    while key in taken:
        key, n = f"{base}_{n}", n + 1
    return key
