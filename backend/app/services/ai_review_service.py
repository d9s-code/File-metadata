"""A language model's reading of ambiguity findings: the code finds, the
model explains.

The ambiguity check (ambiguity_service) computes every overlap exactly. The
model never does that arithmetic: it is given one finding at a time — the
two Modes involved and the computed overlap — and writes why they can't be
told apart and what might be done about it. For a whole run it gets the
counts and the most serious findings, already computed, and writes an
overview. Either way the input stays small however many Modes the scope has.

With Outline set up, the sections of the team's documentation that match
the question go with it as background (knowledge_service), numbered so the
model can cite them; the answer keeps which ones it was given and cited.

What it writes is a draft. It's kept with the finding or run, marked with
the model and who asked, and any number in it that isn't in what it was
given is listed, so a reader knows which figures to check.
"""

import re
from collections import Counter
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.enums import AmbiguityScopeType
from app.models.ambiguity import AmbiguityFinding, AmbiguityRun
from app.models.emitter import Emitter
from app.models.mdf import Mdf
from app.models.mode import Mode
from app.models.platform import Platform
from app.services import knowledge_service, llm_client

# The most serious findings a run summary is given, one line each.
SUMMARY_FINDINGS = 40

SEVERITY_LABELS = {"exact_overlap": "exact overlap", "high": "high", "medium": "medium", "low": "low"}
SEVERITY_ORDER = {"exact_overlap": 0, "high": 1, "medium": 2, "low": 3}

SYSTEM_BASE = """You help analysts maintain a library of radar emitter Modes. Each Mode is a box in \
RF (MHz) × PRI (µs) × PW (µs). Two Modes are ambiguous when an intercepted signal could match both.

Rules:
- Use only the data given. Never invent values, Modes or sources.
- Write numbers exactly as given, in the units given (MHz, µs). Don't convert units.
- Overlap percentages are already computed: the share of the narrower of the two ranges that the other covers. \
Don't recompute them.
- A margin (±) widens a Mode's range when matching; jitter is PRI variation around the nominal value.
- If the data doesn't show something, say so instead of guessing.
- Be brief and concrete. Plain English, no headings."""

SYSTEM_DOCS = """

After the data you are given background: numbered sections of the team's own documentation of how the sensor \
works. Use them to explain how the sensor treats these Modes and to back your recommendation, citing the section \
right after the sentence that relies on it, like [S2]. Cite a section only for what it actually says. The \
documentation never overrides the numbers given. Where it doesn't cover something, say so rather than guess."""

# What a question is about, as words to find the documentation sections on
# it: the PRI types involved (counted double) and what every Mode has.
PRI_TYPE_TERMS = {
    "fixed": ["fixed PRI", "constant PRI", "jitter"],
    "stagger": ["stagger", "frame time"],
    "cw": ["CW", "continuous wave"],
    "xlet": ["X-let", "xlet"],
}
PARAMETER_TERMS = {"rf": ["RF", "frequency"], "pw": ["PW", "pulse width"], "pri": ["PRI", "pulse repetition"], "jitter": ["jitter"]}
GENERAL_TERMS = ["ambiguity", "ambiguous", "margin", "tolerance", "matching", "overlap", "RF", "PW", "PRI"]


Recommendation = Literal[
    "keep_both", "tighten_ranges", "merge_modes", "add_distinguishing_parameter", "check_source_data"
]


class FindingExplanation(BaseModel):
    explanation: str = Field(
        description="2–4 sentences: why these two Modes can't be told apart, citing the values "
        "(and any background section relied on, as [S1])"
    )
    distinguishing: str = Field(description="What, if anything, in the data tells them apart; 'Nothing in the data' if so")
    recommendation: Recommendation
    recommendation_detail: str = Field(description="1–2 sentences: what exactly to change, and on which Mode")
    confidence: Literal["low", "medium", "high"]


class Priority(BaseModel):
    finding: str = Field(description="The finding's label as given, e.g. F3")
    why: str = Field(description="Under 15 words: why it matters, citing the values")
    action: Recommendation


class RunSummary(BaseModel):
    verdict: str = Field(
        description="1–2 sentences: how ambiguous this scope is and where the trouble is "
        "(cite a background section relied on as [S1])"
    )
    priorities: list[Priority] = Field(description="Up to 6 findings to look at first, most important first")
    patterns: list[str] = Field(description="Up to 3 patterns across the findings, under 12 words each")


RECOMMENDATION_LABELS = {
    "keep_both": "Keep both as they are",
    "tighten_ranges": "Tighten the ranges",
    "merge_modes": "Merge the two Modes",
    "add_distinguishing_parameter": "Add a parameter that tells them apart",
    "check_source_data": "Check the source data",
}


def _n(v) -> str:
    """A number as the model should see (and repeat) it: no trailing .0."""
    if v is None:
        return "—"
    f = float(v)
    return str(int(f)) if f == int(f) else f"{f:g}"


def _span(lo, hi, unit: str, margin=None) -> str:
    if lo is None and hi is None:
        return "not set"
    text = f"{_n(lo) if lo == hi or hi is None else f'{_n(lo)}–{_n(hi)}'} {unit}"
    if margin:
        text += f" (margin ±{_n(margin)} {unit})"
    return text


def _mode_block(label: str, side: dict, pri_type: str, notes: str | None) -> str:
    line = side.get("line") or {}
    where = f"Emitter \"{side.get('emitter_name')}\""
    if side.get("platform_name"):
        where += f" on Platform \"{side['platform_name']}\""
    parts = [
        f"{label}: \"{side.get('mode_name')}\" — {where}, EW group \"{side.get('ew_group_name')}\", "
        f"source \"{side.get('source_name')}\"",
        f"  PRI type: {pri_type}",
        f"  RF: {_span(line.get('rf_min_mhz'), line.get('rf_max_mhz'), 'MHz', line.get('rf_delta'))}",
    ]
    if pri_type == "fixed":
        parts.append(f"  PRI: {_span(line.get('pri_min_us'), line.get('pri_max_us'), 'µs', line.get('pri_delta'))}")
        if line.get("jitter_min_us") is not None or line.get("jitter_max_us") is not None:
            parts.append(f"  Jitter: {_span(line.get('jitter_min_us'), line.get('jitter_max_us'), 'µs')}")
    elif pri_type == "stagger":
        seq = ", ".join(_n(v) for v in line.get("pri_stagger_values_us") or [])
        parts.append(f"  PRI stagger sequence: {seq or 'not set'} µs")
        if line.get("explicit_frame_time_us") is not None:
            parts.append(f"  Frame time: {_n(line['explicit_frame_time_us'])} µs")
        if line.get("pri_range_matching"):
            margin = line.get("frame_time_delta_us")
            parts.append(f"  Range matching on: matched on its frame time{f' (margin ±{_n(margin)} µs)' if margin else ''}")
    else:
        parts.append("  PRI: none (no PRI for this type)")
    parts.append(f"  PW: {_span(line.get('pw_min_us'), line.get('pw_max_us'), 'µs', line.get('pw_delta'))}")
    if notes:
        parts.append(f"  Analyst notes: {notes.strip()[:600]}")
    return "\n".join(parts)


def _pri_type(side: dict, comparison: str, first: bool) -> str:
    # The run stores the pair's PRI types as "a-b", sorted; the Mode's own
    # type is in its snapshot line when it was flattened.
    explicit = side.get("pri_type")
    if explicit:
        return explicit
    line = side.get("line") or {}
    if line.get("pri_stagger_values_us"):
        return "stagger"
    if line.get("pri_min_us") is not None:
        return "fixed"
    kinds = comparison.split("-")
    return "cw" if "cw" in kinds else ("xlet" if "xlet" in kinds else kinds[0 if first else -1])


def scope_label(db: Session, run: AmbiguityRun) -> str:
    model = {AmbiguityScopeType.emitter: Emitter, AmbiguityScopeType.platform: Platform, AmbiguityScopeType.mdf: Mdf}[
        run.scope_type
    ]
    entity = db.get(model, run.scope_id)
    name = entity.name if entity else "(deleted)"
    kind = {"emitter": "Emitter", "platform": "Platform", "mdf": "MDF"}[run.scope_type.value]
    return f'{kind} "{name}"'


def finding_context(db: Session, finding: AmbiguityFinding) -> str:
    """Everything the model is told about one finding."""
    details = finding.details or {}
    a, b = details.get("mode_a") or {}, details.get("mode_b") or {}
    notes = {m.id: m.notes for m in db.query(Mode).filter(Mode.id.in_([finding.mode_id_a, finding.mode_id_b]))}
    tol = finding.run.tolerance_config or {}
    basis = {"frame_time": "frame time", "steps": "identical stagger steps", "range": "range"}.get(
        details.get("pri_basis") or "", ""
    )
    pri = (
        f"PRI {_n(finding.pri_overlap_pct)}% ({finding.pri_comparison_type}{', on ' + basis if basis else ''})"
        if finding.pri_overlap_pct is not None
        else f"PRI not compared ({finding.pri_comparison_type}: no PRI)"
    )
    if details.get("jitter_overlap_pct") is not None:
        pri += f", jitter {_n(details['jitter_overlap_pct'])}%"
    return "\n".join(
        [
            f"Ambiguity check of {scope_label(db, finding.run)}.",
            f"Severity: {SEVERITY_LABELS.get(finding.combined_severity.value, finding.combined_severity.value)} "
            f"(thresholds: low under {_n(tol.get('low_threshold'))}%, high from {_n(tol.get('high_threshold'))}%, "
            f"exact from {_n(tol.get('exact_threshold'))}% on every parameter).",
            f"Computed overlap: RF {_n(finding.rf_overlap_pct)}%, PW {_n(finding.pw_overlap_pct)}%, {pri}"
            + (
                " — on each range widened by its margin, as the sensor matches."
                if details.get("margins_applied")
                else " — on the ranges as typed, margins not included."
            ),
            "",
            _mode_block("Mode A", a, _pri_type(a, finding.pri_comparison_type, True), notes.get(finding.mode_id_a)),
            "",
            _mode_block("Mode B", b, _pri_type(b, finding.pri_comparison_type, False), notes.get(finding.mode_id_b)),
        ]
    )


def pair_label(f: AmbiguityFinding) -> str:
    d = f.details or {}
    a, b = d.get("mode_a") or {}, d.get("mode_b") or {}
    return f"{a.get('mode_name')} ({a.get('emitter_name')}) × {b.get('mode_name')} ({b.get('emitter_name')})"


def _finding_line(f: AmbiguityFinding, label: str = "-") -> str:
    pri = f"PRI {_n(f.pri_overlap_pct)}%" if f.pri_overlap_pct is not None else "no PRI compared"
    reviewed = " — reviewed" if f.reviewed_by else ""
    return (
        f"{label} {pair_label(f)}: "
        f"{SEVERITY_LABELS.get(f.combined_severity.value)}; RF {_n(f.rf_overlap_pct)}%, PW {_n(f.pw_overlap_pct)}%, {pri}"
        f"{reviewed}"
    )


def top_findings(findings: list[AmbiguityFinding]) -> list[AmbiguityFinding]:
    """The findings a summary is given, labelled F1, F2 … in this order."""
    ranked = sorted(findings, key=lambda f: (SEVERITY_ORDER.get(f.combined_severity.value, 9), bool(f.reviewed_by)))
    return ranked[:SUMMARY_FINDINGS]


def run_context(db: Session, run: AmbiguityRun, findings: list[AmbiguityFinding]) -> str:
    """The run as counts and its most serious findings — all already computed."""
    by_severity = Counter(f.combined_severity.value for f in findings)
    reviewed = sum(1 for f in findings if f.reviewed_by)
    pairs: Counter = Counter()
    for f in findings:
        if f.combined_severity.value in ("exact_overlap", "high"):
            d = f.details or {}
            names = sorted({(d.get("mode_a") or {}).get("emitter_name"), (d.get("mode_b") or {}).get("emitter_name")})
            pairs[" × ".join(n or "?" for n in names) if len(names) == 2 else f"within {names[0]}"] += 1
    top = top_findings(findings)
    lines = [
        f"Ambiguity check of {scope_label(db, run)}: {len(findings)} findings, {reviewed} already reviewed.",
        "By severity: "
        + ", ".join(f"{SEVERITY_LABELS[k]} {by_severity.get(k, 0)}" for k in ("exact_overlap", "high", "medium", "low"))
        + ".",
    ]
    if run.scope_type != AmbiguityScopeType.emitter:
        lines.append(
            "Only Modes of different Emitters were compared: the question is which Emitters could be taken for each other."
        )
    if pairs:
        lines.append("High and exact findings by Emitter (or between two Emitters):")
        lines += [f"- {k}: {v}" for k, v in pairs.most_common(12)]
    lines += ["", f"The {len(top)} most serious findings (unreviewed first within each severity), labelled:"] + [
        _finding_line(f, f"F{i}.") for i, f in enumerate(top, start=1)
    ]
    if len(findings) > len(top):
        lines.append(f"(and {len(findings) - len(top)} less serious findings not listed)")
    return "\n".join(lines)


_NUMBER = re.compile(r"(?<![\w.])-?\d[\d,]*(?:\.\d+)?")


def _numbers(text: str) -> set[float]:
    out = set()
    for m in _NUMBER.findall(text):
        try:
            out.add(round(float(m.replace(",", "")), 6))
        except ValueError:
            continue
    return out


def unverified_numbers(answer_text: str, context: str) -> list[str]:
    """Numbers in the model's answer that aren't in what it was given —
    worth checking before trusting. Small counts (0–10) are left out."""
    given = _numbers(context)
    out = []
    for m in _NUMBER.findall(answer_text):
        try:
            v = round(float(m.replace(",", "")), 6)
        except ValueError:
            continue
        if v in given or (v == int(v) and 0 <= v <= 10):
            continue
        if m not in out:
            out.append(m)
    return out


def finding_terms(db: Session, finding: AmbiguityFinding) -> tuple[list[str], list[str]]:
    """The words to find documentation on one finding by: specific (its PRI
    types, range matching) and general (the parameters, the notes)."""
    details = finding.details or {}
    a, b = details.get("mode_a") or {}, details.get("mode_b") or {}
    specific = ["ambiguity", "ambiguous"]
    for side, first in ((a, True), (b, False)):
        specific += PRI_TYPE_TERMS.get(_pri_type(side, finding.pri_comparison_type, first), [])
        if (side.get("line") or {}).get("pri_range_matching"):
            specific.append("range matching")
    general = list(GENERAL_TERMS) + PARAMETER_TERMS.get(details.get("limiting") or "", [])
    notes = db.query(Mode.notes).filter(Mode.id.in_([finding.mode_id_a, finding.mode_id_b])).all()
    general += knowledge_service.note_words([n for (n,) in notes])
    return specific, general


def run_terms(findings: list[AmbiguityFinding]) -> tuple[list[str], list[str]]:
    specific = ["ambiguity", "ambiguous"]
    for kind in sorted({k for f in findings for k in (f.pri_comparison_type or "").split("-")}):
        specific += PRI_TYPE_TERMS.get(kind, [])
    return specific, list(GENERAL_TERMS)


def _with_docs(db: Session, system: str, context: str, terms: tuple[list[str], list[str]]):
    """The documentation sections for this question added to what the model
    is given — none if Outline isn't set up or nothing matches."""
    knowledge_service.ensure_fresh(db)
    sources = knowledge_service.select_sections(db, *terms) if knowledge_service.enabled() else []
    if not sources:
        return system, context, sources
    return system + SYSTEM_DOCS, context + "\n\n" + knowledge_service.background(sources), sources


def _docs_result(db: Session, sources, answer_text: str) -> dict:
    listed, unknown = knowledge_service.cited(sources, answer_text)
    state = knowledge_service.status(db)
    return {
        "sources": listed,
        "unknown_citations": unknown,
        "documentation": (
            {"label": state["label"], "synced_at": state["synced_at"].isoformat() if state["synced_at"] else None}
            if knowledge_service.enabled()
            else None
        ),
    }


def _stamp(meta: llm_client.LlmReply, user) -> dict:
    return {
        "model": meta.model,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_by": getattr(user, "username", None),
        "seconds": meta.seconds,
        "prompt_tokens": meta.prompt_tokens,
        "completion_tokens": meta.completion_tokens,
    }


def explain_finding(db: Session, finding: AmbiguityFinding, user) -> dict:
    context = finding_context(db, finding)
    system = (
        SYSTEM_BASE
        + "\n\nYou are given one finding from an ambiguity check: two Modes and how much they overlap. "
        "Explain why they can't be told apart, say what (if anything) separates them, and recommend one action."
    )
    system, context, sources = _with_docs(db, system, context, finding_terms(db, finding))
    answer, meta = llm_client.chat_json(system, context, FindingExplanation)
    text = " ".join([answer.explanation, answer.distinguishing, answer.recommendation_detail])
    result = {
        **answer.model_dump(),
        "recommendation_label": RECOMMENDATION_LABELS[answer.recommendation],
        "unverified_numbers": unverified_numbers(text, context),
        **_docs_result(db, sources, text),
        **_stamp(meta, user),
    }
    finding.ai_explanation = result
    return result


def summary_priorities(findings: list[AmbiguityFinding], picked: list[Priority]) -> list[dict]:
    """The model's picks as rows: the pair and severity from the finding
    itself (never as the model retold them), its why and action. Picks of a
    finding it wasn't given, or of one twice, are dropped."""
    by_label = {f"F{i}": f for i, f in enumerate(top_findings(findings), start=1)}
    rows, seen = [], set()
    for p in picked:
        label = p.finding.strip().upper()
        f = by_label.get(label if label.startswith("F") else f"F{label}")
        if f is None or f.id in seen:
            continue
        seen.add(f.id)
        rows.append(
            {
                "finding_id": str(f.id),
                "label": label,
                "pair": pair_label(f),
                "severity": f.combined_severity.value,
                "why": p.why,
                "action": p.action,
                "action_label": RECOMMENDATION_LABELS[p.action],
            }
        )
    return rows[:6]


def summarise_run(db: Session, run: AmbiguityRun, user) -> dict:
    findings = db.query(AmbiguityFinding).filter(AmbiguityFinding.run_id == run.id).all()
    context = run_context(db, run, findings)
    system = (
        SYSTEM_BASE
        + "\n\nYou are given the results of an ambiguity check: counts, and its most serious findings, each "
        "labelled F1, F2 …. Give a short verdict, then pick the findings to look at first — by their label — "
        "each with why and one action, then any patterns. Keep every item short."
    )
    system, context, sources = _with_docs(db, system, context, run_terms(findings))
    answer, meta = llm_client.chat_json(system, context, RunSummary)
    priorities = summary_priorities(findings, answer.priorities)
    patterns = answer.patterns[:3]
    text = " ".join([answer.verdict, *(p["why"] for p in priorities), *patterns])
    result = {
        "verdict": answer.verdict,
        "priorities": priorities,
        "patterns": patterns,
        "findings_given": min(len(findings), SUMMARY_FINDINGS),
        "findings_total": len(findings),
        "unverified_numbers": unverified_numbers(text, context),
        **_docs_result(db, sources, text),
        **_stamp(meta, user),
    }
    run.ai_summary = result
    return result
