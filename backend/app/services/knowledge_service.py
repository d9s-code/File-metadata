"""The documentation the language model is given as background: a copy of
the Outline pages set by OUTLINE_ROOT or OUTLINE_COLLECTION, split at their
headings, and the choice of which sections go with a question.

The copy is rebuilt from Outline when it's older than OUTLINE_SYNC_MINUTES
(or when an Admin asks), so a question never waits on more than one sync and
Outline being down only means the copy is older. If all of it fits in
OUTLINE_CONTEXT_TOKENS it goes with every question; otherwise the sections
whose words match the question best do, in reading order. The words come
from the question itself (the PRI types involved, which parameters overlap,
the analyst's notes) — the model never picks its own sources.

Each section given is numbered [S1], [S2] … and the model is asked to cite
them; the answer keeps the list, with links to the page and heading in
Outline, and which ones it did cite.

Not everything in Outline is the same kind of thing: an admin says, per page
(its sub-pages following), whether it's documentation, a test result,
analysis, or to be left out. Each section is handed over marked with its
kind, and the model told how far each can be relied on — a single test
result is what was seen that time, not proof of how the sensor behaves.
"""

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models.knowledge import KnowledgeSection, KnowledgeSync
from app.services import app_settings, outline_client

log = logging.getLogger(__name__)

# A section longer than this is handed over in parts, so one long chapter
# doesn't crowd out the rest.
PART_TOKENS = 1_200
# After a failed sync, wait this long before trying again on a question.
RETRY_AFTER = timedelta(minutes=5)
# Any two numbers, so two syncs at once don't both rebuild the copy.
_SYNC_LOCK = (73_421, 1)


def enabled() -> bool:
    return outline_client.enabled() and bool(settings.outline_root or settings.outline_collection)


def _state(db: Session) -> KnowledgeSync:
    row = db.get(KnowledgeSync, 1)
    if row is None:
        row = KnowledgeSync(id=1, pages=0, sections=0, tokens=0)
        db.add(row)
        db.flush()
    return row


def status(db: Session) -> dict:
    row = db.get(KnowledgeSync, 1)
    return {
        "enabled": enabled(),
        "label": row.label if row else None,
        "synced_at": row.synced_at if row else None,
        "pages": row.pages if row else 0,
        "sections": row.sections if row else 0,
        "tokens": row.tokens if row else 0,
        "error": row.error if row else None,
        "tried_at": row.tried_at if row else None,
    }


def _parts(body: str) -> list[str]:
    """A long section cut at paragraph breaks into pieces of about PART_TOKENS."""
    if outline_client.estimate_tokens(body) <= PART_TOKENS:
        return [body]
    parts, current = [], ""
    for para in re.split(r"\n\s*\n", body):
        if current and outline_client.estimate_tokens(current + para) > PART_TOKENS:
            parts.append(current.strip())
            current = ""
        current += para + "\n\n"
    if current.strip():
        parts.append(current.strip())
    return parts


def sync() -> dict:
    """Copy the documentation from Outline afresh. Runs in its own session;
    records an error (keeping the last good copy) and raises it."""
    with SessionLocal() as db:
        if not db.execute(select(func.pg_try_advisory_xact_lock(*_SYNC_LOCK))).scalar():
            return status(db)  # another request is syncing right now
        row = _state(db)
        row.tried_at = datetime.now(timezone.utc)
        try:
            label, docs = outline_client.scope()
        except outline_client.OutlineError as err:
            row.error = str(err)
            db.commit()
            raise
        paths = outline_client.page_paths(docs)
        order = sorted(docs, key=lambda d: paths[d.id].lower())
        db.execute(delete(KnowledgeSection))
        position = 0
        total = 0
        for doc in order:
            for path, anchor, body in outline_client.anchored_sections(doc, paths[doc.id]):
                pieces = _parts(body)
                for n, piece in enumerate(pieces, start=1):
                    tokens = outline_client.estimate_tokens(piece)
                    db.add(
                        KnowledgeSection(
                            outline_doc_id=doc.id,
                            page_path=paths[doc.id],
                            path=path if len(pieces) == 1 else f"{path} (part {n} of {len(pieces)})",
                            url=f"{doc.url}#{anchor}" if anchor else doc.url,
                            text=piece,
                            tokens=tokens,
                            position=position,
                            page_updated_at=doc.updated_at,
                        )
                    )
                    position += 1
                    total += tokens
        row.label, row.synced_at, row.error = label, row.tried_at, None
        row.pages, row.sections, row.tokens = len(docs), position, total
        db.commit()
        log.info("Copied %s sections (%s tokens) from Outline: %s", position, total, label)
        return status(db)


def ensure_fresh(db: Session) -> None:
    """Sync first if the copy is missing or older than OUTLINE_SYNC_MINUTES —
    but not again within a few minutes of a failure. Never raises: a
    question goes ahead with whatever copy there is."""
    if not enabled():
        return
    row = db.get(KnowledgeSync, 1)
    now = datetime.now(timezone.utc)
    if row and row.synced_at and now - row.synced_at < timedelta(minutes=settings.outline_sync_minutes):
        return
    if row and row.error and row.tried_at and now - row.tried_at < RETRY_AFTER:
        return
    try:
        sync()
    except Exception as err:  # noqa: BLE001 — Outline down shouldn't stop the question
        log.warning("Couldn't refresh the documentation from Outline: %s", err)
    db.expire_all()


# Words that would match nearly every section, left out of a question's words.
STOP_WORDS = set(
    "the and for with that this from are was were has have not but its into than then them they when what which "
    "who will would can could should may also only both each more most some such very just over under about "
    "mode modes".split()
)


def _term(words: str) -> str | None:
    """One search term for Postgres: each word as a prefix ("stagger" finds
    "staggered"), a phrase's words in order."""
    tokens = [w for w in re.findall(r"[^\W_]+", words.lower()) if w]
    if not tokens:
        return None
    # Short words (RF, PW, PRI, CW) as they are: "pri" as a prefix would
    # find "priority" and "principle".
    return " <-> ".join(t if len(t) <= 3 else f"{t}:*" for t in tokens)


def _query(terms: list[str]) -> str | None:
    parts = list(dict.fromkeys(t for t in (_term(x) for x in terms) if t))
    return " | ".join(f"({p})" for p in parts) if parts else None


def note_words(notes: list[str | None], limit: int = 12) -> list[str]:
    """The longer words of the analysts' notes, as extra search terms."""
    out: list[str] = []
    for note in notes:
        for w in re.findall(r"[^\W\d_]{4,}", (note or "").lower()):
            if w not in STOP_WORDS and w not in out:
                out.append(w)
    return out[:limit]


# What a page holds — set per page by an admin (its sub-pages follow), so the
# model knows how far to rely on each section. "documentation" unless set.
KINDS: dict[str, dict[str, str]] = {
    "documentation": {
        "label": "Documentation",
        "tag": "documentation",
        "meaning": "reference documentation of how the sensor and the library work",
    },
    "test_result": {
        "label": "Test result",
        "tag": "test result",
        "meaning": "a record of one test or trial — what was observed that time, under those conditions",
    },
    "analysis": {
        "label": "Analysis",
        "tag": "analysis",
        "meaning": "analysts' notes, assessments and working conclusions — opinions, not established fact",
    },
    "exclude": {"label": "Leave out", "tag": "", "meaning": "not given to the AI"},
}
DEFAULT_KIND = "documentation"


def page_kinds(db: Session) -> dict[str, str]:
    """The kinds an admin set, by page path."""
    return dict(app_settings.get_setting(db, app_settings.OUTLINE_PAGE_KINDS) or {})


def kind_of(page_path: str | None, rules: dict[str, str]) -> str:
    """A page's kind: its own, else the nearest page above it that has one."""
    if page_path:
        parts = page_path.split(" › ")
        for n in range(len(parts), 0, -1):
            kind = rules.get(" › ".join(parts[:n]))
            if kind in KINDS:
                return kind
    return DEFAULT_KIND


def pages(db: Session) -> list[dict]:
    """Every copied page, in reading order, with its sections, its tokens,
    the kind set on it (if any) and the kind it ends up with."""
    rules = page_kinds(db)
    rows = db.execute(
        select(
            KnowledgeSection.page_path,
            func.count(),
            func.sum(KnowledgeSection.tokens),
            func.min(KnowledgeSection.position),
        )
        .where(KnowledgeSection.page_path.is_not(None))
        .group_by(KnowledgeSection.page_path)
        .order_by(func.min(KnowledgeSection.position))
    ).all()
    return [
        {"path": path, "sections": n, "tokens": int(tokens or 0), "set": rules.get(path), "kind": kind_of(path, rules)}
        for path, n, tokens, _ in rows
    ]


@dataclass
class Source:
    ref: str
    path: str
    url: str
    text: str
    tokens: int
    kind: str = DEFAULT_KIND


def select_sections(db: Session, specific: list[str], general: list[str], budget: int | None = None) -> list[Source]:
    """The sections to give with a question: all of them if they fit the
    budget, else the best matches — the specific terms (what the question is
    about) counting double the general ones — in reading order."""
    budget = budget or settings.outline_context_tokens
    rules = page_kinds(db)
    # Pages left out aren't given at all.
    excluded = [p for p, k in rules.items() if k == "exclude"]
    total = db.scalar(select(func.coalesce(func.sum(KnowledgeSection.tokens), 0))) or 0
    if total == 0:
        return []
    if total <= budget:
        rows = db.execute(select(KnowledgeSection).order_by(KnowledgeSection.position)).scalars().all()
    else:
        q_specific, q_general = _query(specific), _query(general)
        if not q_specific and not q_general:
            return []
        ranked = db.execute(
            text(
                """
                SELECT id, tokens,
                       2 * coalesce(ts_rank_cd(search, to_tsquery('simple', :qs), 1), 0)
                       + coalesce(ts_rank_cd(search, to_tsquery('simple', :qg), 1), 0) AS score
                FROM knowledge_sections
                WHERE (:qs <> '' AND search @@ to_tsquery('simple', :qs))
                   OR (:qg <> '' AND search @@ to_tsquery('simple', :qg))
                ORDER BY score DESC, position
                LIMIT 200
                """
            ),
            {"qs": q_specific or "", "qg": q_general or ""},
        ).all()
        chosen, used = [], 0
        kinds = dict(db.execute(select(KnowledgeSection.id, KnowledgeSection.page_path)).all()) if excluded else {}
        for section_id, tokens, _ in ranked:
            if excluded and kind_of(kinds.get(section_id), rules) == "exclude":
                continue
            if used + tokens > budget:
                continue
            chosen.append(section_id)
            used += tokens
        if not chosen:
            return []
        rows = (
            db.execute(select(KnowledgeSection).where(KnowledgeSection.id.in_(chosen)).order_by(KnowledgeSection.position))
            .scalars()
            .all()
        )
    rows = [r for r in rows if kind_of(r.page_path, rules) != "exclude"]
    return [Source(f"S{i}", r.path, r.url, r.text, r.tokens, kind_of(r.page_path, rules)) for i, r in enumerate(rows, start=1)]


# How the model is told to weigh each kind it's given.
WEIGHING = (
    "Each section is marked with what it is: (documentation) is reference material on how the sensor and the "
    "library work; (test result) is a record of one test or trial — what was observed that time, under those "
    "conditions: report it as that test's finding, never as proof of how the sensor always behaves, and say when "
    "one test is all there is; (analysis) is analysts' notes and working conclusions — opinions, not established "
    "fact. Where they disagree, say so; documentation outweighs a single test, several consistent tests outweigh one."
)


def background(sources: list[Source]) -> str:
    """The sections as the model reads them, after the data — each marked
    with its kind, and how to weigh the kinds."""
    if not sources:
        return ""
    blocks = [f"[{s.ref}] ({KINDS.get(s.kind, KINDS[DEFAULT_KIND])['tag']}) {s.path}\n{s.text}" for s in sources]
    return (
        "Background — sections of the team's documentation, cite as [S1], [S2] …. "
        + WEIGHING
        + "\n\n"
        + "\n\n".join(blocks)
    )


CITATION = re.compile(r"\[(S\d+)\]")


def cited(sources: list[Source], answer_text: str) -> tuple[list[dict], list[str]]:
    """The sources given, each marked whether the answer cites it, and any
    citation of a section that wasn't given."""
    refs = set(CITATION.findall(answer_text))
    known = {s.ref for s in sources}
    listed = [{"ref": s.ref, "path": s.path, "url": s.url, "kind": s.kind, "cited": s.ref in refs} for s in sources]
    return listed, sorted(refs - known, key=lambda r: int(r[1:]))
