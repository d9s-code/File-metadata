"""A chat with the language model that can look things up — read-only — and
propose new Modes for the user to add (it never adds them itself: see
ai_mode_proposals).

The model isn't handed the database; it asks for what it needs, one lookup
at a time, from a fixed set: search by name, lists of Emitters, an Emitter's
Modes and Sources, its tests, a Platform's Emitters, an MDF, the Modes a
signal would match, an Emitter's latest ambiguity check, an Intercept, the
documentation. Each lookup's result goes back to it and it either asks for
another or answers — at most MAX_STEPS lookups a question.

Nothing is kept on the server between questions: each answer comes back with
the lookups it made, and the next question brings them along. They're run
again (so they're current, and nothing the browser sends is taken as data)
and given to the model as what it looked up earlier — that, and the earlier
questions and answers, is the chat's memory. Every lookup only reads, and only the engineering data: users,
passwords, sessions and the audit log are out of its reach. Deleted items
are left out.

Asking is a JSON reply with structured output (as for the ambiguity drafts),
so it works on any vLLM, with or without its tool-calling options. The
answer comes back with the lookups it made, the documentation sections it
was given (and which it cited), and any number in it that wasn't in
anything it was given.
"""

import re
import uuid
from typing import Literal
from urllib.parse import quote

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.enums import (
    AmbiguityRunStatus,
    AmbiguityScopeType,
    TestScopeType,
)
from app.models.ambiguity import AmbiguityFinding, AmbiguityRun
from app.models.dwell import DwellFile, DwellStrategy
from app.models.emitter import Emitter
from app.models.ew_group import EwGroup
from app.models.intercept import Intercept, InterceptEntry, InterceptEntryMode
from app.models.mdf import Mdf, MdfPlatformLink
from app.models.mode import Mode, ModeLine
from app.models.platform import Platform, PlatformEmitterLink
from app.models.source import Source
from app.models.customer import Customer
from app.models.test_line import TestLine
from app.models.test_record import TestRecord
from app.models.user import User
from app.services import ai_mode_proposals, knowledge_service, llm_client, search_service, statuses
from app.services.pin_hygiene import mdf_readiness
from app.services.test_line_status_service import latest_line_outcomes
from app.services.ai_review_service import SEVERITY_LABELS, SEVERITY_ORDER, _finding_line, _n, unverified_numbers
from app.services.dates import day_text

MAX_STEPS = 6
# Earlier lookups run again with a question: from this many of the latest
# answers, each result cut to MEMORY_RESULT_CHARS, all to MEMORY_CHARS.
MEMORY_TURNS = 3
MEMORY_LOOKUPS = 8
MEMORY_RESULT_CHARS = 4_000
MEMORY_CHARS = 12_000
# Earlier turns sent with a question, and how much of each.
HISTORY_TURNS = 10
HISTORY_CHARS = 2_000
# A lookup's result is cut here (about 3,000 tokens).
RESULT_CHARS = 12_000
# Documentation with the question, and with each search_docs.
DOCS_WITH_QUESTION = 3_000
DOCS_PER_SEARCH = 2_500
MODES_LISTED = 150
# Rough sizes, to keep a question inside the model's context: characters per
# token for this kind of text, and what one image costs.
CHARS_PER_TOKEN = 3.5
IMAGE_TOKENS = 1_000


def estimate_tokens(text: str) -> int:
    return int(len(text) / CHARS_PER_TOKEN) + 1

Action = Literal[
    "answer",
    "overview",
    "search",
    "list_emitters",
    "get_emitter",
    "get_tests",
    "get_platform",
    "get_mdf",
    "find_modes",
    "get_ambiguity",
    "get_intercept",
    "search_docs",
    "propose_modes",
]


class ChatStep(BaseModel):
    action: Action = Field(description="One lookup to make next, or answer")
    query: str | None = Field(None, description="search / search_docs: the words to look for")
    target: str | None = Field(
        None,
        description="get_emitter / get_tests / get_platform / get_mdf / get_ambiguity / get_intercept: a name, "
        "designation or id; list_emitters: a Platform to list the Emitters of (optional)",
    )
    status: str | None = Field(
        None, description=(
            "list_emitters: only Emitters with this status, as the app names it "
            "(e.g. in progress, testing, partially operational, operational, needs rework)"
        ),
    )
    rf_mhz: float | None = Field(None, description="find_modes: the signal's RF in MHz (or the band's low end)")
    rf_max_mhz: float | None = Field(None, description="find_modes: the band's high end in MHz, for a band")
    pri_us: float | None = Field(None, description="find_modes: its PRI in µs, if known")
    pw_us: float | None = Field(None, description="find_modes: its PW in µs, if known")
    modes: list[ai_mode_proposals.ProposedMode] | None = Field(
        None, description="propose_modes: the Modes to propose, every one of them (a new proposal replaces the last)"
    )
    answer: str | None = Field(None, description="answer: the reply to the user")


class FinalStep(BaseModel):
    action: Literal["answer"]
    answer: str = Field(description="The reply to the user")


SYSTEM = """You are the assistant in an app where analysts maintain a library of radar emitters for a \
sensor. The library: Platforms (vehicles or sites) carry Emitters; an Emitter has EW groups of Modes; a Mode \
is a box in RF (MHz) × PRI (µs) × PW (µs), with a PRI type: fixed (a PRI range, with jitter), stagger (a \
sequence of PRIs repeating in a frame), CW (no pulses) or X-let. Each value has a ± margin the sensor matches \
with. MDFs are releases that bundle Platforms. Intercepts are recordings of a signal, grouped into entries. \
An ambiguity check finds pairs of Modes a signal could match both of.

You can look things up, one lookup per reply, before answering:
- overview: how much is in the library.
- search (query): find Emitters (by name or designation), Modes, Sources, Platforms, MDFs and Intercepts. Every \
word has to match; if nothing does, it says what matches some of the words, and what mentions them in notes.
- list_emitters (status, target: a Platform — both optional): Emitters with their status, Modes, assignee and \
SIM results.
- get_emitter (target): an Emitter's details, its Sources, and all its Modes with their values.
- get_tests (target: an Emitter): its SIM Test Lines and how each did last, and its latest test runs.
- get_platform (target): a Platform's Emitters, and the MDFs it's in.
- get_mdf (target): an MDF's status, customer, pinned Platforms and its readiness checklist.
- find_modes (rf_mhz, and rf_max_mhz for a band; pri_us, pw_us if known): the Modes a signal would match.
- get_ambiguity (target: an Emitter): its latest ambiguity check.
- get_intercept (target): an Intercept and its entries.
- search_docs (query): more sections of the team's documentation.
- propose_modes (modes): when the user asks you to write or create Modes, propose them: for each, the Emitter, \
one of its existing EW Groups and Sources (look them up first with get_emitter), a name, the PRI type and its \
values — RF in MHz; PRI, PW, jitter and stagger steps in µs; each range's ± margin. The app checks them and shows \
them to the user, who decides whether to add them. You can't add or change anything yourself; never say a Mode \
was added.
Then answer (action "answer").

Rules:
- Answer from what you looked up and were given, never from memory or guesses. If a lookup found nothing, say so.
- This is a conversation: a follow-up ("its PW?", "and the other one?", "them") is about what was asked and \
looked up before. What you looked up earlier is given again with the question — use it, and look up only what's \
missing.
- If a name matches several things, or nothing, search before giving up; ask the user only if it stays unclear.
- Look up before answering any question about the library's contents; don't look up for general questions.
- Write numbers exactly as given, with their units (MHz, µs).
- Documentation sections are numbered [S1], [S2] …: cite the one a sentence relies on, like [S2], and only for \
what it says. It never overrides the library's data.
- Each section is marked documentation, test result or analysis. A test result is what one test observed: say \
"in that test …", never present it as how the sensor behaves in general, and say so when one test is all \
there is. Analysis is opinion. Documentation outweighs a single test.
- Answer briefly and plainly. Short paragraphs; a list with "- " where it helps. No headings, no tables."""


def _clip(text: str, limit: int = RESULT_CHARS) -> str:
    return text if len(text) <= limit else text[:limit] + "\n… (cut short)"


def _span(lo, hi, margin=None) -> str:
    if lo is None and hi is None:
        return "—"
    text = _n(lo) if hi is None or lo == hi else f"{_n(lo)}–{_n(hi)}"
    return f"{text} ±{_n(margin)}" if margin else text


def _mode_line(mode: Mode, line: ModeLine | None) -> str:
    if line is None:
        return f"{mode.name} ({mode.pri_type.value}): no values yet"
    parts = [f"{mode.name} ({mode.pri_type.value})", f"RF {_span(line.rf_min_mhz, line.rf_max_mhz, line.rf_delta)} MHz"]
    if mode.pri_type.value == "fixed":
        parts.append(f"PRI {_span(line.pri_min_us, line.pri_max_us, line.pri_delta)} µs")
        if line.jitter_min_us is not None or line.jitter_max_us is not None:
            parts.append(f"jitter {_span(line.jitter_min_us, line.jitter_max_us)} µs")
    elif mode.pri_type.value == "stagger":
        seq = ", ".join(_n(v) for v in line.pri_stagger_values_us or [])
        parts.append(f"stagger {seq or '—'} µs")
        if line.explicit_frame_time_us is not None:
            parts.append(f"frame {_n(line.explicit_frame_time_us)} µs")
        if line.pri_range_matching:
            parts.append(f"range matching on frame ±{_n(line.frame_time_delta_us or 0)} µs")
    parts.append(f"PW {_span(line.pw_min_us, line.pw_max_us, line.pw_delta)} µs")
    text = " · ".join(parts)
    if mode.notes:
        text += f" · notes: {mode.notes.strip()[:120]}"
    return text


def _live_emitters(db: Session):
    return select(Emitter).where(Emitter.is_deleted.is_(False))


def _resolve(db: Session, model, target: str | None, extra=None):
    """An item by id, name (an Emitter also by designation), or every word of
    the name: (item, None), or (None, why not)."""
    if not target or not target.strip():
        return None, "Say which one (a name or id)."
    target = " ".join(target.split())
    base = select(model)
    if hasattr(model, "is_deleted"):
        base = base.where(model.is_deleted.is_(False))
    if extra is not None:
        base = base.where(extra)
    columns = [model.name] + ([model.designation] if model is Emitter else [])
    try:
        found = db.execute(base.where(model.id == uuid.UUID(target))).scalars().first()
        if found:
            return found, None
    except ValueError:
        pass
    for column in columns:
        exact = db.execute(base.where(func.lower(column) == target.lower())).scalars().all()
        if len(exact) == 1:
            return exact[0], None
    words = [w for w in re.split(r"[\s—–]+", target) if w and w not in ("-",)][:6]
    like = db.execute(
        base.where(*[or_(*[c.ilike(f"%{w}%") for c in columns]) for w in words]).limit(10)
    ).scalars().all()
    if len(like) == 1:
        return like[0], None
    if not like:
        return None, f'Nothing named "{target}". Try search with fewer or other words.'
    return None, f'Several match "{target}": ' + "; ".join(f"{_label(x)} [{x.id}]" for x in like) + ". Ask by id."


def _label(item) -> str:
    designation = getattr(item, "designation", None)
    return f"{designation} — {item.name}" if designation else item.name


def overview(db: Session, step: ChatStep) -> str:
    emitters = db.execute(
        select(Emitter.status, func.count()).where(Emitter.is_deleted.is_(False)).group_by(Emitter.status)
    ).all()
    modes = db.scalar(
        select(func.count(Mode.id)).join(EwGroup).join(Emitter).where(Emitter.is_deleted.is_(False))
    )
    return "\n".join(
        [
            f"Platforms: {db.scalar(select(func.count(Platform.id)).where(Platform.is_deleted.is_(False)))}",
            f"Emitters: {sum(n for _, n in emitters)} ("
            + ", ".join(f"{statuses.label(db, 'emitter', s)} {n}" for s, n in emitters)
            + ")",
            f"Modes: {modes}",
            f"MDFs: {db.scalar(select(func.count(Mdf.id)).where(Mdf.is_deleted.is_(False)))}",
            f"Intercepts: {db.scalar(select(func.count(Intercept.id)).join(Emitter).where(Emitter.is_deleted.is_(False)))}",
            f"Dwell Strategies: {db.scalar(select(func.count(DwellStrategy.id)))}",
            f"Dwell files: {db.scalar(select(func.count(DwellFile.id)))}",
        ]
    )


_SEARCH_KINDS = [
    ("emitter", "Emitters"),
    ("mode", "Modes"),
    ("source", "Sources"),
    ("platform", "Platforms"),
    ("mdf", "MDFs"),
    ("intercept", "Intercepts"),
    ("dwell_strategy", "Dwell Strategies"),
    ("dwell_file", "Dwell files"),
]


def _search_lines(db: Session, q: str) -> list[str]:
    hits = search_service.search(db, q)
    out: list[str] = []
    for kind, heading in _SEARCH_KINDS:
        rows = [h for h in hits if h["kind"] == kind]
        if rows:
            out.append(f"{heading}:\n" + "\n".join(f"- {h['title']} ({h['subtitle']}) [{h['id']}]" for h in rows))
    return out


def _mentions(db: Session, words: list[str]) -> list[str]:
    """Emitters, Modes, Sources and Platforms whose description or notes have every word."""
    found: list[str] = []

    def each(column):
        return [column.ilike(f"%{w}%") for w in words]

    for e in db.execute(_live_emitters(db).where(*each(Emitter.description)).limit(5)).scalars():
        found.append(f"- Emitter {_label(e)} [{e.id}] — description: {(e.description or '').strip()[:160]}")
    for name, notes, ename in db.execute(
        select(Mode.name, Mode.notes, Emitter.name).join(EwGroup, Mode.ew_group_id == EwGroup.id).join(Emitter)
        .where(Emitter.is_deleted.is_(False), *each(Mode.notes)).limit(5)
    ).all():
        found.append(f"- Mode {name} on {ename} — notes: {(notes or '').strip()[:160]}")
    for name, desc, ename in db.execute(
        select(Source.name, Source.description, Emitter.name).join(Emitter)
        .where(Emitter.is_deleted.is_(False), *each(Source.description)).limit(5)
    ).all():
        found.append(f"- Source {name} on {ename} — description: {(desc or '').strip()[:160]}")
    for p in db.execute(
        select(Platform).where(Platform.is_deleted.is_(False), *each(Platform.description)).limit(5)
    ).scalars():
        found.append(f"- Platform {p.name} [{p.id}] — description: {(p.description or '').strip()[:160]}")
    return found


def search(db: Session, step: ChatStep) -> str:
    """By name, every word matching (as the app's search box). Failing that:
    what mentions the words in a description or notes, then what matches the
    longer words one at a time."""
    q = " ".join((step.query or "").split())
    if not q:
        return "Say what to search for."
    out = _search_lines(db, q)
    if out:
        return "\n".join(out)
    words = [w for w in q.split() if len(w) >= 2][:6]
    mentioned = _mentions(db, words)
    if mentioned:
        return f'Nothing is named like "{q}", but these mention it:\n' + "\n".join(mentioned)
    partial: list[str] = []
    for word in sorted({w for w in words if len(w) >= 3}, key=len, reverse=True)[:3]:
        lines = _search_lines(db, word)
        if lines:
            partial.append(f'Matching "{word}":\n' + "\n".join(lines))
    if partial:
        return f'Nothing matches all of "{q}". Matches for some of the words:\n' + "\n".join(partial)
    return f'Nothing named like "{q}", and nothing mentions it.'


def get_emitter(db: Session, step: ChatStep) -> str:
    emitter, why = _resolve(db, Emitter, step.target)
    if emitter is None:
        return why
    platforms = db.execute(
        select(Platform.name).join(PlatformEmitterLink, PlatformEmitterLink.platform_id == Platform.id)
        .where(PlatformEmitterLink.emitter_id == emitter.id, Platform.is_deleted.is_(False)).distinct()
    ).scalars().all()
    rows = db.execute(
        select(EwGroup.name, Mode, ModeLine).join(Mode, Mode.ew_group_id == EwGroup.id)
        .outerjoin(ModeLine, ModeLine.mode_id == Mode.id)
        .where(EwGroup.emitter_id == emitter.id).order_by(EwGroup.sort_order, Mode.sort_order, Mode.name)
    ).all()
    lines = [
        f"Emitter {emitter.name} [{emitter.id}]" + (f", designation {emitter.designation}" if emitter.designation else ""),
        f"Status: {statuses.label(db, 'emitter', emitter.status)}",
    ]
    if emitter.description:
        lines.append(f"Description: {emitter.description.strip()[:400]}")
    lines.append("On Platforms: " + (", ".join(platforms) or "none"))
    if emitter.assignee_id:
        assignee = db.get(User, emitter.assignee_id)
        lines.append(f"Assigned to: {assignee.username if assignee else '?'}")
    sources = db.execute(
        select(Source).where(Source.emitter_id == emitter.id).order_by(Source.source_date.desc())
    ).scalars().all()
    lines.append(f"Sources ({len(sources)}):")
    for src in sources[:30]:
        bits = [f"dated {day_text(src.source_date)}"]
        if src.source_type:
            bits.append(src.source_type)
        lines.append(f"- {src.name} ({', '.join(bits)})")
    lines.append(_tests_summary(db, emitter))
    lines.append(f"Modes ({len(rows)}), by EW group:")
    group = None
    for g, mode, line in rows[:MODES_LISTED]:
        if g != group:
            lines.append(f"EW group {g}:")
            group = g
        lines.append(f"- {_mode_line(mode, line)}")
    if len(rows) > MODES_LISTED:
        lines.append(f"(and {len(rows) - MODES_LISTED} more Modes not listed)")
    return "\n".join(lines)


def _tests_summary(db: Session, emitter: Emitter) -> str:
    line_ids = db.execute(select(TestLine.id).where(TestLine.emitter_id == emitter.id)).scalars().all()
    outcomes = latest_line_outcomes(db, list(line_ids))
    correct = sum(1 for _, result, _ in outcomes.values() if result.value == "pass")
    runs = db.scalar(
        select(func.count(TestRecord.id)).where(TestRecord.scope_type == TestScopeType.emitter, TestRecord.scope_id == emitter.id)
    )
    if not line_ids:
        return f"SIM Test Lines: none. Test runs: {runs}."
    return (
        f"SIM Test Lines: {len(line_ids)}, {correct} correct in their latest run, "
        f"{len(line_ids) - len(outcomes)} never tested. Test runs: {runs} (get_tests for more)."
    )


def list_emitters(db: Session, step: ChatStep) -> str:
    """Emitters, optionally only those with a status or on a Platform."""
    query = _live_emitters(db)
    where = []
    if step.status:
        wanted = step.status.strip().lower().replace("_", " ")
        names = statuses.labels(db, "emitter")
        matches = [value for value, label in names.items() if wanted in (value.replace("_", " "), label.lower())]
        if not matches:
            return f'"{step.status}" is not a status. They are: ' + ", ".join(names.values()) + "."
        query = query.where(Emitter.status.in_(matches))
        where.append(f"status {names[matches[0]]}")
    if step.target:
        platform, why = _resolve(db, Platform, step.target)
        if platform is None:
            return why
        query = query.where(
            Emitter.id.in_(select(PlatformEmitterLink.emitter_id).where(PlatformEmitterLink.platform_id == platform.id))
        )
        where.append(f"on Platform {platform.name}")
    emitters = db.execute(query.order_by(Emitter.name)).scalars().all()
    if not emitters:
        return "No Emitters" + (f" with {' and '.join(where)}" if where else "") + "."
    modes = dict(
        db.execute(
            select(EwGroup.emitter_id, func.count(Mode.id)).join(Mode, Mode.ew_group_id == EwGroup.id)
            .where(EwGroup.emitter_id.in_([e.id for e in emitters])).group_by(EwGroup.emitter_id)
        ).all()
    )
    users = dict(
        db.execute(select(User.id, User.username).where(User.id.in_({e.assignee_id for e in emitters if e.assignee_id}))).all()
    )
    lines = [f"{len(emitters)} Emitters" + (f" ({', '.join(where)})" if where else "") + ":"]
    for e in emitters[:80]:
        bits = [statuses.label(db, "emitter", e.status), f"{modes.get(e.id, 0)} Modes"]
        if e.assignee_id:
            bits.append(f"assigned to {users.get(e.assignee_id, '?')}")
        lines.append(f"- {_label(e)} [{e.id}] · " + " · ".join(bits))
    if len(emitters) > 80:
        lines.append(f"(and {len(emitters) - 80} more)")
    return "\n".join(lines)


def get_tests(db: Session, step: ChatStep) -> str:
    """An Emitter's SIM Test Lines (each one's latest outcome) and latest test runs."""
    emitter, why = _resolve(db, Emitter, step.target)
    if emitter is None:
        return why
    lines_ = db.execute(select(TestLine).where(TestLine.emitter_id == emitter.id)).scalars().all()
    lines_.sort(key=lambda t: t.label.lower())
    outcomes = latest_line_outcomes(db, [t.id for t in lines_])
    out = [f"Tests of Emitter {_label(emitter)} [{emitter.id}]", f"SIM Test Lines ({len(lines_)}):"]
    for t in lines_[:80]:
        last = outcomes.get(t.id)
        status = f"{last[1].value} on {day_text(last[0])}" if last else "never tested"
        out.append(f"- {t.label}: {status}")
    runs = db.execute(
        select(TestRecord).where(TestRecord.scope_type == TestScopeType.emitter, TestRecord.scope_id == emitter.id)
        .order_by(TestRecord.test_date.desc(), TestRecord.created_at.desc()).limit(10)
    ).scalars().all()
    out.append(f"Latest test runs ({len(runs)}, newest first):")
    for r in runs:
        bits = [day_text(r.test_date), r.test_type.value.replace("_", " "), f"result {r.result.value}"]
        if r.emitter_version_number is not None:
            bits.append(f"version v{r.emitter_version_number}")
        if r.lines:
            counts: dict[str, int] = {}
            for line in r.lines:
                counts[line.outcome.value] = counts.get(line.outcome.value, 0) + 1
            bits.append("lines " + ", ".join(f"{n} {k}" for k, n in sorted(counts.items())))
        out.append(f"- {r.title} — " + " · ".join(bits) + (f" · notes: {r.notes.strip()[:120]}" if r.notes else ""))
    return "\n".join(out)


def get_mdf(db: Session, step: ChatStep) -> str:
    """An MDF: status, customer, release date, pinned Platforms, readiness."""
    mdf, why = _resolve(db, Mdf, step.target)
    if mdf is None:
        return why
    customer = db.get(Customer, mdf.customer_id) if mdf.customer_id else None
    out = [
        f"MDF {mdf.name} [{mdf.id}]",
        f"Status: {statuses.label(db, 'mdf', mdf.status)}",
        f"Customer: {customer.name if customer else 'none'}",
        f"Release date: {day_text(mdf.release_date) if mdf.release_date else 'not set'}",
    ]
    if mdf.description:
        out.append(f"Description: {mdf.description.strip()[:400]}")
    out.append(f"Pinned Platforms ({len(mdf.links)}):")
    for link in mdf.links:
        out.append(f"- {link.platform.name} v{link.platform_version.version_number}")
    out.append("Readiness:")
    for item in mdf_readiness(db, mdf):
        out.append(f"- [{item['status']}] {item['label']}: {item['detail']}")
        out += [f"  - {x}" for x in item["items"][:10]]
    return "\n".join(out)


def get_platform(db: Session, step: ChatStep) -> str:
    platform, why = _resolve(db, Platform, step.target)
    if platform is None:
        return why
    emitters = db.execute(
        select(Emitter.name, Emitter.status, func.count(Mode.id))
        .join(PlatformEmitterLink, PlatformEmitterLink.emitter_id == Emitter.id)
        .outerjoin(EwGroup, EwGroup.emitter_id == Emitter.id).outerjoin(Mode, Mode.ew_group_id == EwGroup.id)
        .where(PlatformEmitterLink.platform_id == platform.id, Emitter.is_deleted.is_(False))
        .group_by(Emitter.id, Emitter.name, Emitter.status).order_by(Emitter.name)
    ).all()
    mdfs = db.execute(
        select(Mdf.name).join(MdfPlatformLink, MdfPlatformLink.mdf_id == Mdf.id)
        .where(MdfPlatformLink.platform_id == platform.id, Mdf.is_deleted.is_(False)).distinct()
    ).scalars().all()
    lines = [f"Platform {platform.name} [{platform.id}]"]
    if platform.description:
        lines.append(f"Description: {platform.description.strip()[:400]}")
    lines.append(f"Emitters ({len(emitters)}):")
    lines += [f"- {n} ({statuses.label(db, 'emitter', s)}, {c} Modes)" for n, s, c in emitters]
    lines.append("In MDFs: " + (", ".join(mdfs) or "none"))
    return "\n".join(lines)


def _covers(lo, hi, margin, value) -> bool:
    if lo is None or value is None:
        return False
    m = float(margin or 0)
    return float(lo) - m <= value <= float(hi if hi is not None else lo) + m


def find_modes(db: Session, step: ChatStep) -> str:
    if step.rf_mhz is None:
        return "Give at least rf_mhz."
    rf = step.rf_mhz
    # A band: every Mode overlapping it; a value: every Mode covering it.
    rf_hi = step.rf_max_mhz if step.rf_max_mhz is not None and step.rf_max_mhz > rf else rf
    rows = db.execute(
        select(Mode, ModeLine, Emitter.name).join(ModeLine, ModeLine.mode_id == Mode.id)
        .join(EwGroup, Mode.ew_group_id == EwGroup.id).join(Emitter)
        .where(
            Emitter.is_deleted.is_(False),
            ModeLine.rf_min_mhz - func.coalesce(ModeLine.rf_delta, 0) <= rf_hi,
            ModeLine.rf_max_mhz + func.coalesce(ModeLine.rf_delta, 0) >= rf,
        )
        .order_by(Emitter.name, Mode.name)
    ).all()
    hits = []
    for mode, line, emitter in rows:
        if step.pw_us is not None and not _covers(line.pw_min_us, line.pw_max_us, line.pw_delta, step.pw_us):
            continue
        if step.pri_us is not None:
            kind = mode.pri_type.value
            if kind == "fixed" and not _covers(line.pri_min_us, line.pri_max_us, line.pri_delta, step.pri_us):
                continue
            if kind == "stagger" and not any(
                _covers(v, v, line.pri_delta, step.pri_us) for v in line.pri_stagger_values_us or []
            ):
                continue
            if kind == "cw":
                continue
        hits.append(f"- {emitter}: {_mode_line(mode, line)}")
    rf_text = f"{_n(rf)}–{_n(rf_hi)}" if rf_hi != rf else _n(rf)
    asked = ", ".join(
        [f"RF {rf_text} MHz"]
        + [f"{k} {_n(v)} {u}" for k, v, u in (("PRI", step.pri_us, "µs"), ("PW", step.pw_us, "µs")) if v is not None]
    )
    if not hits:
        return f"No Mode covers {asked} (each range widened by its margin)."
    head = f"{len(hits)} Modes cover {asked} (each range widened by its margin; a stagger matches if one step does):"
    return "\n".join([head, *hits[:40], *([f"(and {len(hits) - 40} more)"] if len(hits) > 40 else [])])


def get_ambiguity(db: Session, step: ChatStep) -> str:
    emitter, why = _resolve(db, Emitter, step.target)
    if emitter is None:
        return why
    run = db.execute(
        select(AmbiguityRun).where(
            AmbiguityRun.scope_type == AmbiguityScopeType.emitter,
            AmbiguityRun.scope_id == emitter.id,
            AmbiguityRun.status == AmbiguityRunStatus.complete,
        ).order_by(AmbiguityRun.created_at.desc()).limit(1)
    ).scalars().first()
    if run is None:
        return f"No ambiguity check has been run on {emitter.name}."
    findings = db.execute(select(AmbiguityFinding).where(AmbiguityFinding.run_id == run.id)).scalars().all()
    counts = {k: 0 for k in SEVERITY_LABELS}
    for f in findings:
        counts[f.combined_severity.value] = counts.get(f.combined_severity.value, 0) + 1
    top = sorted(findings, key=lambda f: (SEVERITY_ORDER.get(f.combined_severity.value, 9), bool(f.reviewed_by)))[:20]
    lines = [
        f"Latest ambiguity check of {emitter.name}, {day_text(run.created_at)}: {len(findings)} findings, "
        f"{sum(1 for f in findings if f.reviewed_by)} acknowledged.",
        "By severity: " + ", ".join(f"{SEVERITY_LABELS[k]} {counts[k]}" for k in SEVERITY_LABELS) + ".",
        "Most serious:",
        *(_finding_line(f) for f in top),
    ]
    return "\n".join(lines)


def get_intercept(db: Session, step: ChatStep) -> str:
    intercept, why = _resolve(
        db, Intercept, step.target, Intercept.emitter_id.in_(select(Emitter.id).where(Emitter.is_deleted.is_(False)))
    )
    if intercept is None:
        return why
    entries = db.execute(
        select(InterceptEntry).where(InterceptEntry.intercept_id == intercept.id).order_by(InterceptEntry.rf_mean_mhz)
    ).scalars().all()
    matched = dict(
        db.execute(
            select(InterceptEntryMode.intercept_entry_id, func.string_agg(Mode.name, ", "))
            .join(Mode, Mode.id == InterceptEntryMode.mode_id)
            .where(InterceptEntryMode.intercept_entry_id.in_([e.id for e in entries]))
            .group_by(InterceptEntryMode.intercept_entry_id)
        ).all()
    ) if entries else {}
    emitter = db.get(Emitter, intercept.emitter_id)
    lines = [
        f"Intercept {intercept.name} [{intercept.id}], Emitter {emitter.name if emitter else '?'}",
        f"Recorded {intercept.intercepted_on or 'on an unknown date'}"
        + (f" by {intercept.collected_by}" if intercept.collected_by else ""),
    ]
    if intercept.description:
        lines.append(f"Description: {intercept.description.strip()[:400]}")
    lines.append(f"Entries ({len(entries)}):")
    for e in entries[:60]:
        parts = [e.pri_type.value, f"RF {_n(e.rf_mean_mhz)} MHz"]
        if e.pri_mean_us is not None:
            parts.append(f"PRI {_n(e.pri_mean_us)} µs")
        if e.stagger_values:
            parts.append("stagger " + ", ".join(_n(v) for v in e.stagger_values) + " µs")
        if e.pw_mean_us is not None:
            parts.append(f"PW {_n(e.pw_mean_us)} µs")
        if e.report_count:
            parts.append(f"{e.report_count} reports")
        parts.append("Mode: " + (matched.get(e.id) or "none linked"))
        lines.append("- " + " · ".join(parts))
    if len(entries) > 60:
        lines.append(f"(and {len(entries) - 60} more entries)")
    return "\n".join(lines)


TOOLS = {
    "overview": overview,
    "search": search,
    "list_emitters": list_emitters,
    "get_emitter": get_emitter,
    "get_tests": get_tests,
    "get_platform": get_platform,
    "get_mdf": get_mdf,
    "find_modes": find_modes,
    "get_ambiguity": get_ambiguity,
    "get_intercept": get_intercept,
}


def _step_label(step: ChatStep) -> str:
    """The lookup as the user sees it under the answer."""
    if step.action == "overview":
        return "Library overview"
    if step.action in ("search", "search_docs"):
        return f'{"Searched" if step.action == "search" else "Searched the documentation for"} "{step.query or ""}"'
    if step.action == "find_modes":
        rf = f"{_n(step.rf_mhz)}–{_n(step.rf_max_mhz)}" if step.rf_max_mhz is not None else _n(step.rf_mhz)
        vals = [f"RF {rf}"] + [f"{k} {_n(v)}" for k, v in (("PRI", step.pri_us), ("PW", step.pw_us)) if v is not None]
        return "Modes matching " + ", ".join(vals)
    if step.action == "propose_modes":
        n = len(step.modes or [])
        return f"Proposed {n} Mode{'' if n == 1 else 's'} for you to add"
    if step.action == "list_emitters":
        bits = [f"status {step.status}" if step.status else "", f"on {step.target}" if step.target else ""]
        return "Emitters " + " ".join(b for b in bits if b) if any(bits) else "All Emitters"
    kind = {"get_emitter": "Emitter", "get_tests": "Tests of", "get_platform": "Platform", "get_mdf": "MDF",
            "get_ambiguity": "Ambiguity check of", "get_intercept": "Intercept"}[step.action]
    return f"{kind} {step.target or '?'}"


_PAGE = re.compile(r"^/(emitters|platforms|mdfs|intercepts|ambiguity/emitter)/([0-9a-f-]{36})")


def page_context(db: Session, page: str | None) -> str | None:
    """What the user is looking at, from the page's address."""
    m = _PAGE.match(page or "")
    if not m:
        return None
    kind, raw = m.groups()
    model, label = {
        "emitters": (Emitter, "Emitter"),
        "ambiguity/emitter": (Emitter, "the ambiguity check of Emitter"),
        "platforms": (Platform, "Platform"),
        "mdfs": (Mdf, "MDF"),
        "intercepts": (Intercept, "Intercept"),
    }[kind]
    item = db.get(model, uuid.UUID(raw))
    if item is None or getattr(item, "is_deleted", False):
        return None
    return f'The user is looking at {label} "{item.name}" [{item.id}] — "this" in a question likely means it.'


def _question_terms(text: str) -> list[str]:
    """A question's words, to find the documentation on it by."""
    words = re.findall(r"[^\W_]{2,}", text.lower())
    return [w for w in dict.fromkeys(words) if w not in knowledge_service.STOP_WORDS]


def _lookup_args(step: ChatStep) -> dict:
    """A lookup as it's sent back with the answer, to come again with the next question."""
    return step.model_dump(exclude_none=True, exclude={"answer"})


def remembered(db: Session, messages: list[dict]) -> list[str]:
    """What was looked up for the latest answers, run again now: one block
    each, newest first, within MEMORY_CHARS. Only lookups the model can ask
    for are run — what comes from the browser is a request, never data."""
    earlier: list[list] = []
    for m in reversed(messages[:-1]):
        if m.get("role") == "assistant" and m.get("lookups"):
            earlier.append(list(m["lookups"])[:MEMORY_LOOKUPS])
            if len(earlier) == MEMORY_TURNS:
                break
    blocks: list[str] = []
    seen: set[str] = set()
    used = 0
    for lookups in earlier:
        for raw in lookups:
            try:
                step = ChatStep.model_validate(raw)
            except ValidationError:
                continue
            if step.action not in TOOLS:
                continue
            key = step.model_dump_json(exclude_none=True)
            if key in seen:
                continue
            seen.add(key)
            block = f"[{_step_label(step)}]\n{_clip(TOOLS[step.action](db, step), MEMORY_RESULT_CHARS)}"
            if used + len(block) > MEMORY_CHARS:
                return blocks
            blocks.append(block)
            used += len(block)
    return blocks


_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


def answer_links(db: Session, looked_up: str, answer: str) -> list[dict]:
    """The names in the answer to make links of: what the lookups turned up
    (by the ids in them) — Emitters (also by designation), Platforms, MDFs,
    Intercepts, Sources, Modes — and the Modes of those Emitters. A name that
    could mean two different things isn't linked. Longest first."""
    ids = {uuid.UUID(x) for x in set(_UUID.findall(looked_up))}
    if not ids:
        return []
    found: dict[str, set[str]] = {}

    def add(name: str | None, url: str):
        name = (name or "").strip()
        if len(name) >= 3 and name in answer:
            found.setdefault(name, set()).add(url)

    emitter_ids = set()
    for e in db.execute(_live_emitters(db).where(Emitter.id.in_(ids))).scalars():
        emitter_ids.add(e.id)
        add(e.name, f"/emitters/{e.id}")
        add(e.designation, f"/emitters/{e.id}")
    for model, path in ((Platform, "platforms"), (Mdf, "mdfs")):
        for item in db.execute(select(model).where(model.id.in_(ids), model.is_deleted.is_(False))).scalars():
            add(item.name, f"/{path}/{item.id}")
    for iid, name in db.execute(
        select(Intercept.id, Intercept.name).join(Emitter).where(Intercept.id.in_(ids), Emitter.is_deleted.is_(False))
    ).all():
        add(name, f"/intercepts/{iid}")
    for sid, name, eid in db.execute(
        select(Source.id, Source.name, Source.emitter_id).join(Emitter)
        .where(Source.id.in_(ids), Emitter.is_deleted.is_(False))
    ).all():
        add(name, f"/emitters/{eid}?tab=setup&source={sid}")
    for name, eid in db.execute(
        select(Mode.name, EwGroup.emitter_id).join(EwGroup, Mode.ew_group_id == EwGroup.id).join(Emitter)
        .where(or_(Mode.id.in_(ids), EwGroup.emitter_id.in_(emitter_ids)), Emitter.is_deleted.is_(False))
    ).all():
        add(name, f"/emitters/{eid}?tab=modes&mode={quote(name)}")
    links = [{"text": name, "url": next(iter(urls))} for name, urls in found.items() if len(urls) == 1]
    return sorted(links, key=lambda link: -len(link["text"]))


def chat(
    db: Session,
    messages: list[dict],
    page: str | None = None,
    *,
    images: list[str] | None = None,
    summary: str | None = None,
    max_context: int | None = None,
) -> dict:
    """Answer the last user message, looking up what's needed. `images` go
    with the question (data URLs); `summary` stands for the turns compacted
    away; older turns are left out to stay inside `max_context` tokens."""
    turns = [
        {"role": m["role"], "content": str(m["content"])[:HISTORY_CHARS]}
        for m in messages
        if m.get("role") in ("user", "assistant") and str(m.get("content") or "").strip()
    ][-HISTORY_TURNS:]
    if not turns or turns[-1]["role"] != "user":
        raise ValueError("The last message must be the user's")
    question = turns[-1]["content"]
    # A follow-up ("and its PW?") says little on its own: the question before
    # it helps find the documentation too.
    asked_before = [t["content"] for t in turns[:-1] if t["role"] == "user"][-1:]

    sources: list[knowledge_service.Source] = []
    if knowledge_service.enabled():
        knowledge_service.ensure_fresh(db)
        terms = _question_terms(question) + [t for q in asked_before for t in _question_terms(q)]
        sources = knowledge_service.select_sections(db, list(dict.fromkeys(terms)), [], budget=DOCS_WITH_QUESTION)
    memory = remembered(db, messages)

    system = SYSTEM
    where = page_context(db, page)
    if where:
        system += "\n\n" + where
    if summary:
        system += "\n\nEarlier in this conversation (summarised):\n" + summary
    first = question
    if memory:
        first += (
            "\n\nWhat you looked up for your earlier answers in this conversation (as it is now):\n\n"
            + "\n\n".join(memory)
        )
    if sources:
        first += "\n\n" + knowledge_service.background(sources)
    # Inside the context: the reply's room kept free, the oldest turns left out first.
    if max_context:
        budget = max_context - llm_client.settings.llm_max_tokens
        cost = estimate_tokens(system) + estimate_tokens(first) + IMAGE_TOKENS * len(images or [])
        older = turns[:-1]
        while older and cost + sum(estimate_tokens(t["content"]) for t in older) > budget:
            older = older[1:]
        turns = [*older, turns[-1]]
    content: str | list[dict] = first
    if images:
        content = [{"type": "text", "text": first}, *({"type": "image_url", "image_url": {"url": u}} for u in images)]
    transcript = [*turns[:-1], {"role": "user", "content": content}]
    given = [system, first]
    proposals: list[dict] = []
    last_meta: llm_client.LlmReply | None = None
    steps: list[dict] = []
    totals = {"seconds": 0.0, "prompt_tokens": 0, "completion_tokens": 0}
    model = None
    answer = None

    for i in range(MAX_STEPS + 1):
        schema = FinalStep if i == MAX_STEPS else ChatStep
        reply, meta = llm_client.chat_json_messages(system, transcript, schema)
        last_meta = meta
        model = meta.model
        totals["seconds"] += meta.seconds
        totals["prompt_tokens"] += meta.prompt_tokens or 0
        totals["completion_tokens"] += meta.completion_tokens or 0
        if reply.action == "answer":
            answer = (reply.answer or "").strip()
            break
        if reply.action == "search_docs":
            if knowledge_service.enabled():
                found = knowledge_service.select_sections(
                    db, _question_terms(reply.query or ""), [], budget=DOCS_PER_SEARCH
                )
                have = {s.path for s in sources}
                new = []
                for s in found:
                    if s.path not in have:
                        s.ref = f"S{len(sources) + len(new) + 1}"
                        new.append(s)
                sources += new
                result = knowledge_service.background(new) if new else "No more documentation matched."
            else:
                result = "No documentation is set up."
        elif reply.action == "propose_modes":
            # Checked and kept for the user to see; the latest proposal replaces any before it.
            proposals = ai_mode_proposals.check(db, reply.modes or [])
            result = ai_mode_proposals.summary_for_model(proposals) if proposals else "No Modes were given."
        else:
            result = TOOLS[reply.action](db, reply)
        result = _clip(result)
        given.append(result)
        # A proposal isn't a lookup to run again with the next question.
        args = None if reply.action == "propose_modes" else _lookup_args(reply)
        steps.append({"action": reply.action, "label": _step_label(reply), "args": args})
        transcript += [
            {"role": "assistant", "content": reply.model_dump_json(exclude_none=True)},
            {"role": "user", "content": f"Result of {reply.action}:\n{result}\n\nLook up something else, or answer."},
        ]
        if i == MAX_STEPS - 1:
            transcript[-1]["content"] += " This was the last lookup: answer now."

    answer = answer or "I couldn't put an answer together — try asking more specifically."
    listed, unknown = knowledge_service.cited(sources, answer)
    return {
        "reply": answer,
        "steps": steps,
        "sources": listed,
        "unknown_citations": unknown,
        "unverified_numbers": unverified_numbers(answer, "\n".join(given + [m["content"] for m in turns])),
        "page": where is not None,
        # Names in the answer that open their page.
        "links": answer_links(db, "\n".join(given), answer),
        # What was looked up earlier and given again with this question.
        "remembered": len(memory),
        "model": model,
        "seconds": round(totals["seconds"], 1),
        "prompt_tokens": totals["prompt_tokens"],
        "completion_tokens": totals["completion_tokens"],
        # How much of the context the last step used (as the server counted it, or a guess).
        "context_tokens": (
            (last_meta.prompt_tokens or 0) + (last_meta.completion_tokens or 0)
            if last_meta and last_meta.prompt_tokens
            else sum(estimate_tokens(str(t["content"])) for t in transcript) + estimate_tokens(system)
        ),
        # Modes proposed for the user to add — never added here.
        "proposals": proposals,
    }
