"""Release notes in plain words: a language model rewrites an MDF summary's
release notes and change notes for a reader who isn't technical — a draft,
shown to be edited before anything uses it. It's given only the summary,
and told to add nothing."""

from datetime import datetime, timezone

from pydantic import BaseModel, Field

from app.services import llm_client
from app.services.ai_review_service import unverified_numbers

SYSTEM = """You write release notes for a customer who is not technical. You are given an MDF's \
release: its name, the versions it spans, the release notes the team wrote, and the change notes \
(what was added, removed and updated).

Write the release notes again in plain words:
- Use only what you are given. Never add changes, reasons, benefits, dates or numbers that aren't there.
- Keep every name exactly as written (Platforms, Emitters, dwell files). Don't explain what they are.
- Say what changed, not how: leave out Mode names, parameter names (RF, PRI, PW, jitter, stagger) and values \
unless the release notes the team wrote say they matter.
- Group it: what's new, what's no longer included, what was updated. Leave out a group with nothing in it.
- Short sentences. Two to four short paragraphs, separated by a blank line. No headings, no lists, no markdown.
- If nothing changed and there are no release notes, say so in one sentence."""


class PlainDraft(BaseModel):
    text: str = Field(description="The release notes in plain words: short paragraphs separated by a blank line")


def context_of(s: dict) -> str:
    """What the model is given: the summary, as text."""
    m = s["mdf"]
    if s.get("from_mdf"):
        span = f"Since {s['from_mdf']['name']} v{s['from_mdf']['version']}, up to v{s['to_version']}"
    elif s.get("from_version"):
        span = f"From v{s['from_version']} to v{s['to_version']}"
    else:
        span = f"Everything up to v{s['to_version']}"
    lines = [f"MDF: {m['name']}", f"Customer: {m['customer'] or '—'}", f"Span: {span}", "", "Release notes the team wrote:"]
    written = [v for v in s["versions"] if v.get("release_notes")]
    lines += [f"v{v['version_number']}: {v['release_notes']}" for v in written] or ["(none)"]
    lines += ["", "Change notes:"]
    for b in s["change_log"]["blocks"]:
        if b["type"] == "heading":
            lines.append(f"{b['text']}:")
        elif b["type"] in ("line", "paragraph", "empty"):
            lines.append(f"- {b['text']}" + (f": {'; '.join(b['items'])}" if b.get("items") else ""))
    return "\n".join(lines)


def plain_draft(s: dict, user) -> dict:
    """A plain-language draft of the summary's release notes (`s`: build_summary's, full detail)."""
    context = context_of(s)
    answer, meta = llm_client.chat_json(SYSTEM, context, PlainDraft)
    text = answer.text.strip()
    return {
        "text": text,
        # Numbers it wrote that it wasn't given — worth checking.
        "unverified_numbers": unverified_numbers(text, context),
        "model": meta.model,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_by": getattr(user, "username", None),
    }
