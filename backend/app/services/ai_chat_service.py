"""A chat with the language model that can look things up — read-only.

The model isn't handed the database; it asks for what it needs, one lookup
at a time, from a fixed set: search by name, an Emitter's Modes, a Platform's
Emitters, the Modes a signal would match, an Emitter's latest ambiguity
check, an Intercept, the documentation. Each lookup's result goes back to it
and it either asks for another or answers — at most MAX_STEPS lookups a
question. Every lookup only reads, and only the engineering data: users,
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

from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.enums import AmbiguityRunStatus, AmbiguityScopeType
from app.models.ambiguity import AmbiguityFinding, AmbiguityRun
from app.models.emitter import Emitter
from app.models.ew_group import EwGroup
from app.models.intercept import Intercept, InterceptEntry, InterceptEntryMode
from app.models.mdf import Mdf, MdfPlatformLink
from app.models.mode import Mode, ModeLine
from app.models.platform import Platform, PlatformEmitterLink
from app.models.source import Source
from app.services import knowledge_service, llm_client
from app.services.ai_review_service import SEVERITY_LABELS, SEVERITY_ORDER, _finding_line, _n, unverified_numbers

MAX_STEPS = 5
# Earlier turns sent with a question, and how much of each.
HISTORY_TURNS = 10
HISTORY_CHARS = 2_000
# A lookup's result is cut here (about 3,000 tokens).
RESULT_CHARS = 12_000
# Documentation with the question, and with each search_docs.
DOCS_WITH_QUESTION = 3_000
DOCS_PER_SEARCH = 2_500
MODES_LISTED = 150

Action = Literal[
    "answer",
    "overview",
    "search",
    "get_emitter",
    "get_platform",
    "find_modes",
    "get_ambiguity",
    "get_intercept",
    "search_docs",
]


class ChatStep(BaseModel):
    action: Action = Field(description="One lookup to make next, or answer")
    query: str | None = Field(None, description="search / search_docs: the words to look for")
    target: str | None = Field(
        None, description="get_emitter / get_platform / get_ambiguity / get_intercept: a name or id"
    )
    rf_mhz: float | None = Field(None, description="find_modes: the signal's RF in MHz")
    pri_us: float | None = Field(None, description="find_modes: its PRI in µs, if known")
    pw_us: float | None = Field(None, description="find_modes: its PW in µs, if known")
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
- search (query): find Platforms, Emitters, MDFs, Modes, Intercepts and Sources by name.
- get_emitter (target): an Emitter's details and all its Modes with their values.
- get_platform (target): a Platform's Emitters, and the MDFs it's in.
- find_modes (rf_mhz, and pri_us, pw_us if known): the Modes a signal with those values would match.
- get_ambiguity (target: an Emitter): its latest ambiguity check.
- get_intercept (target): an Intercept and its entries.
- search_docs (query): more sections of the team's documentation.
Then answer (action "answer").

Rules:
- Answer from what you looked up and were given, never from memory or guesses. If a lookup found nothing, say so.
- Look up before answering any question about the library's contents; don't look up for general questions.
- Write numbers exactly as given, with their units (MHz, µs).
- Documentation sections are numbered [S1], [S2] …: cite the one a sentence relies on, like [S2], and only for \
what it says. It never overrides the library's data.
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
    """An item by id or name: (item, None), or (None, why not)."""
    if not target or not target.strip():
        return None, "Say which one (a name or id)."
    target = target.strip()
    base = select(model)
    if hasattr(model, "is_deleted"):
        base = base.where(model.is_deleted.is_(False))
    if extra is not None:
        base = base.where(extra)
    try:
        found = db.execute(base.where(model.id == uuid.UUID(target))).scalars().first()
        if found:
            return found, None
    except ValueError:
        pass
    exact = db.execute(base.where(func.lower(model.name) == target.lower())).scalars().all()
    if len(exact) == 1:
        return exact[0], None
    like = db.execute(base.where(model.name.ilike(f"%{target}%")).limit(10)).scalars().all()
    if len(like) == 1:
        return like[0], None
    if not like:
        return None, f'Nothing named "{target}".'
    return None, f'Several match "{target}": ' + "; ".join(f"{x.name} [{x.id}]" for x in like) + ". Ask by id."


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
            + ", ".join(f"{s.value} {n}" for s, n in emitters)
            + ")",
            f"Modes: {modes}",
            f"MDFs: {db.scalar(select(func.count(Mdf.id)).where(Mdf.is_deleted.is_(False)))}",
            f"Intercepts: {db.scalar(select(func.count(Intercept.id)).join(Emitter).where(Emitter.is_deleted.is_(False)))}",
        ]
    )


def search(db: Session, step: ChatStep) -> str:
    q = (step.query or "").strip()
    if not q:
        return "Say what to search for."
    like = f"%{q}%"
    out: list[str] = []

    def add(kind: str, rows: list[str]):
        if rows:
            out.append(f"{kind}:\n" + "\n".join(f"- {r}" for r in rows))

    add(
        "Platforms",
        [f"{p.name} [{p.id}]" for p in db.execute(
            select(Platform).where(Platform.is_deleted.is_(False), Platform.name.ilike(like)).limit(10)
        ).scalars()],
    )
    add(
        "Emitters",
        [f"{e.name}{f' ({e.designation})' if e.designation else ''} [{e.id}]" for e in db.execute(
            _live_emitters(db).where(or_(Emitter.name.ilike(like), Emitter.designation.ilike(like))).limit(10)
        ).scalars()],
    )
    add(
        "MDFs",
        [f"{m.name} [{m.id}]" for m in db.execute(
            select(Mdf).where(Mdf.is_deleted.is_(False), Mdf.name.ilike(like)).limit(10)
        ).scalars()],
    )
    add(
        "Modes",
        [f"{m} — Emitter {e}" for m, e in db.execute(
            select(Mode.name, Emitter.name).join(EwGroup, Mode.ew_group_id == EwGroup.id).join(Emitter)
            .where(Emitter.is_deleted.is_(False), Mode.name.ilike(like)).limit(15)
        ).all()],
    )
    add(
        "Intercepts",
        [f"{i} — Emitter {e} [{iid}]" for iid, i, e in db.execute(
            select(Intercept.id, Intercept.name, Emitter.name).join(Emitter)
            .where(Emitter.is_deleted.is_(False), Intercept.name.ilike(like)).limit(10)
        ).all()],
    )
    add(
        "Sources",
        [f"{s} — Emitter {e}" for s, e in db.execute(
            select(Source.name, Emitter.name).join(Emitter)
            .where(Emitter.is_deleted.is_(False), Source.name.ilike(like)).limit(10)
        ).all()],
    )
    return "\n".join(out) if out else f'Nothing named like "{q}".'


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
        f"Status: {emitter.status.value}",
    ]
    if emitter.description:
        lines.append(f"Description: {emitter.description.strip()[:400]}")
    lines.append("On Platforms: " + (", ".join(platforms) or "none"))
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
    lines += [f"- {n} ({s.value}, {c} Modes)" for n, s, c in emitters]
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
    rows = db.execute(
        select(Mode, ModeLine, Emitter.name).join(ModeLine, ModeLine.mode_id == Mode.id)
        .join(EwGroup, Mode.ew_group_id == EwGroup.id).join(Emitter)
        .where(
            Emitter.is_deleted.is_(False),
            ModeLine.rf_min_mhz - func.coalesce(ModeLine.rf_delta, 0) <= rf,
            ModeLine.rf_max_mhz + func.coalesce(ModeLine.rf_delta, 0) >= rf,
        )
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
    asked = ", ".join(
        f"{k} {_n(v)} {u}"
        for k, v, u in (("RF", step.rf_mhz, "MHz"), ("PRI", step.pri_us, "µs"), ("PW", step.pw_us, "µs"))
        if v is not None
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
        f"Latest ambiguity check of {emitter.name}, {run.created_at:%Y-%m-%d}: {len(findings)} findings, "
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
    "get_emitter": get_emitter,
    "get_platform": get_platform,
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
        vals = [f"{k} {_n(v)}" for k, v in (("RF", step.rf_mhz), ("PRI", step.pri_us), ("PW", step.pw_us)) if v is not None]
        return "Modes matching " + ", ".join(vals)
    kind = {"get_emitter": "Emitter", "get_platform": "Platform", "get_ambiguity": "Ambiguity check of",
            "get_intercept": "Intercept"}[step.action]
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


def chat(db: Session, messages: list[dict], page: str | None = None) -> dict:
    """Answer the last user message, looking up what's needed."""
    turns = [
        {"role": m["role"], "content": str(m["content"])[:HISTORY_CHARS]}
        for m in messages
        if m.get("role") in ("user", "assistant") and str(m.get("content") or "").strip()
    ][-HISTORY_TURNS:]
    if not turns or turns[-1]["role"] != "user":
        raise ValueError("The last message must be the user's")
    question = turns[-1]["content"]

    sources: list[knowledge_service.Source] = []
    if knowledge_service.enabled():
        knowledge_service.ensure_fresh(db)
        sources = knowledge_service.select_sections(db, _question_terms(question), [], budget=DOCS_WITH_QUESTION)

    system = SYSTEM
    where = page_context(db, page)
    if where:
        system += "\n\n" + where
    first = question
    if sources:
        first += "\n\n" + knowledge_service.background(sources)
    transcript = [*turns[:-1], {"role": "user", "content": first}]
    given = [system, first]
    steps: list[dict] = []
    totals = {"seconds": 0.0, "prompt_tokens": 0, "completion_tokens": 0}
    model = None
    answer = None

    for i in range(MAX_STEPS + 1):
        schema = FinalStep if i == MAX_STEPS else ChatStep
        reply, meta = llm_client.chat_json_messages(system, transcript, schema)
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
        else:
            result = TOOLS[reply.action](db, reply)
        result = _clip(result)
        given.append(result)
        steps.append({"action": reply.action, "label": _step_label(reply)})
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
        "model": model,
        "seconds": round(totals["seconds"], 1),
        "prompt_tokens": totals["prompt_tokens"],
        "completion_tokens": totals["completion_tokens"],
    }
