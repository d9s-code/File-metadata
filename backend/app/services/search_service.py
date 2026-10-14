"""Search across the repository by name, for the quick-jump box: Emitters
(name or designation), Modes, Sources, Platforms, MDFs and Intercepts. Every
word typed must appear (in any order); exact and starts-with matches come
first. Deleted things, and things on deleted Emitters, are left out."""

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.core.enums import emitter_status_label
from app.models.emitter import Emitter
from app.models.ew_group import EwGroup
from app.models.intercept import Intercept
from app.models.mdf import Mdf
from app.models.mode import Mode
from app.models.platform import Platform
from app.models.source import Source
from app.services.dates import day_text

PER_KIND = 8


def _words(q: str) -> list[str]:
    return [w for w in q.split() if w][:6]


def _all_words(words: list[str], *columns):
    """Each word in at least one of the columns."""
    return [or_(*[c.ilike(f"%{w}%") for c in columns]) for w in words]


def _rank(q: str, column):
    """Exact match, then starts with, then the rest — shortest names first, then A–Z."""
    return (
        case((func.lower(column) == q.lower(), 0), (column.ilike(f"{q}%"), 1), else_=2),
        func.length(column),
        func.lower(column),
    )


def _emitter_label(name: str, designation: str | None) -> str:
    return f"{designation} — {name}" if designation else name


def search(db: Session, q: str) -> list[dict]:
    q = " ".join(q.split())
    words = _words(q)
    if not words:
        return []
    hits: list[dict] = []

    for e in db.execute(
        select(Emitter)
        .where(Emitter.is_deleted.is_(False), *_all_words(words, Emitter.name, Emitter.designation))
        .order_by(*_rank(q, Emitter.name))
        .limit(PER_KIND)
    ).scalars():
        hits.append(
            {
                "kind": "emitter",
                "id": str(e.id),
                "title": _emitter_label(e.name, e.designation),
                "subtitle": emitter_status_label(e.status.value),
                "url": f"/emitters/{e.id}",
            }
        )

    for mode_id, name, eid, ename, edes, group in db.execute(
        select(Mode.id, Mode.name, Emitter.id, Emitter.name, Emitter.designation, EwGroup.name)
        .join(EwGroup, Mode.ew_group_id == EwGroup.id)
        .join(Emitter, EwGroup.emitter_id == Emitter.id)
        .where(Emitter.is_deleted.is_(False), *_all_words(words, Mode.name, Emitter.name, Emitter.designation))
        .order_by(*_rank(q, Mode.name))
        .limit(PER_KIND)
    ):
        hits.append(
            {
                "kind": "mode",
                "id": str(mode_id),
                "title": name,
                "subtitle": f"{_emitter_label(ename, edes)} · {group}",
                "url": f"/emitters/{eid}?tab=modes&mode={name}",
            }
        )

    for sid, name, eid, ename, edes, sdate in db.execute(
        select(Source.id, Source.name, Emitter.id, Emitter.name, Emitter.designation, Source.source_date)
        .join(Emitter, Source.emitter_id == Emitter.id)
        .where(Emitter.is_deleted.is_(False), *_all_words(words, Source.name, Emitter.name, Emitter.designation))
        .order_by(*_rank(q, Source.name))
        .limit(PER_KIND)
    ):
        hits.append(
            {
                "kind": "source",
                "id": str(sid),
                "title": name,
                "subtitle": f"{_emitter_label(ename, edes)} · {day_text(sdate)}",
                "url": f"/emitters/{eid}?tab=setup&source={sid}",
            }
        )

    for p in db.execute(
        select(Platform)
        .where(Platform.is_deleted.is_(False), *_all_words(words, Platform.name))
        .order_by(*_rank(q, Platform.name))
        .limit(PER_KIND)
    ).scalars():
        hits.append(
            {"kind": "platform", "id": str(p.id), "title": p.name, "subtitle": "Platform", "url": f"/platforms/{p.id}"}
        )

    for m in db.execute(
        select(Mdf).where(Mdf.is_deleted.is_(False), *_all_words(words, Mdf.name)).order_by(*_rank(q, Mdf.name)).limit(PER_KIND)
    ).scalars():
        status = m.status.value.replace("_", " ")
        hits.append(
            {"kind": "mdf", "id": str(m.id), "title": m.name, "subtitle": status[:1].upper() + status[1:], "url": f"/mdfs/{m.id}"}
        )

    for iid, name, ename, edes, when in db.execute(
        select(Intercept.id, Intercept.name, Emitter.name, Emitter.designation, Intercept.intercepted_on)
        .join(Emitter, Intercept.emitter_id == Emitter.id)
        .where(Emitter.is_deleted.is_(False), *_all_words(words, Intercept.name, Intercept.collected_by))
        .order_by(*_rank(q, Intercept.name))
        .limit(PER_KIND)
    ):
        hits.append(
            {
                "kind": "intercept",
                "id": str(iid),
                "title": name,
                "subtitle": _emitter_label(ename, edes) + (f" · {day_text(when)}" if when else ""),
                "url": f"/intercepts/{iid}",
            }
        )
    return hits
