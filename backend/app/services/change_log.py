"""The MDF change log as it's read: the change notes (change_notes) at a
level of detail, grouped by change or by Platform — as blocks the Summary
panel shows and the release-notes document writes, so the two always match.

Detail:
  * "full": as the change notes have it — each entry with what it holds or
    what changed (Modes added, removed, values changed).
  * "names": the same entries, names only.
  * "counts": how many of each kind, no names.
  * "sentences": a short paragraph in plain words.

Grouping:
  * "change": Added / Removed / Updated.
  * "platform": each Platform with what changed on it (an Emitter updated
    shows under each Platform carrying it), then the dwell files.

What counts is the change notes' (the admin's setting, or a preview's)."""

from typing import Literal

from app.services.change_notes import (
    _collect,
    _dwell_changes,
    _dwell_files,
    _emitter_label,
    _mode_changes,
    _mode_items,
    _modes,
    change_notes,
    resolve_counts,
)

Detail = Literal["full", "names", "counts", "sentences"]
Group = Literal["change", "platform"]
DETAILS: tuple[str, ...] = ("full", "names", "counts", "sentences")
GROUPS: tuple[str, ...] = ("change", "platform")
Mark = Literal["added", "removed", "updated"] | None

# Shown in a sentence before "and N more".
NAMES_IN_A_SENTENCE = 3


def _block(type_: str, text: str, mark: Mark = None, items: list[str] | None = None) -> dict:
    return {"type": type_, "text": text, "mark": mark, "items": items or []}


def _plural(n: int, word: str) -> str:
    if n == 1:
        return f"1 {word}"
    return f"{n} {word[:-1] + 'ies' if word.endswith('y') else word + 's'}"


def _names(names: list[str]) -> str:
    """"A", "A and B", "A, B and C", "A, B, C and 2 more"."""
    shown = names[:NAMES_IN_A_SENTENCE]
    rest = len(names) - len(shown)
    if rest:
        return f"{', '.join(shown)} and {rest} more"
    return shown[0] if len(shown) == 1 else f"{', '.join(shown[:-1])} and {shown[-1]}"


_KINDS = ("Platform", "Emitter", "Dwell file")


def _by_kind(entries: list[dict]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for e in entries:
        out.setdefault(e["kind"], []).append(e["name"])
    return {k: out[k] for k in _KINDS if k in out}


def _kind_word(kind: str) -> str:
    return {"Platform": "Platform", "Emitter": "Emitter", "Dwell file": "dwell file"}[kind]


def _counted(entries: list[dict]) -> str:
    """"2 Platforms, 3 Emitters"."""
    return ", ".join(_plural(len(names), _kind_word(kind)) for kind, names in _by_kind(entries).items())


def _counted_with_names(entries: list[dict]) -> str:
    """"the Platform Frigate 2118 and 3 Emitters (A, B and C)"."""
    parts = []
    for kind, names in _by_kind(entries).items():
        if len(names) == 1:
            parts.append(f"the {_kind_word(kind)} {names[0]}")
        else:
            parts.append(f"{_plural(len(names), _kind_word(kind))} ({_names(names)})")
    return _names(parts) if len(parts) <= NAMES_IN_A_SENTENCE else ", ".join(parts)


# --- Grouped by change -------------------------------------------------------------


def _by_change(notes: dict, detail: str) -> list[dict]:
    sections = (("Added", "added", notes["added"]), ("Removed", "removed", notes["removed"]), ("Updated", "updated", notes["updated"]))
    if not any(entries for _, _, entries in sections):
        return [_block("empty", "No major changes.")]
    if detail == "sentences":
        verbs = {"added": "adds", "removed": "removes", "updated": "updates"}
        said = [f"{verbs[mark]} {_counted_with_names(entries)}" for _, mark, entries in sections if entries]
        text = "This release " + (said[0] if len(said) == 1 else f"{', '.join(said[:-1])} and {said[-1]}") + "."
        return [_block("paragraph", text)]
    if detail == "counts":
        return [_block("line", f"{title}: {_counted(entries)}", mark) for title, mark, entries in sections if entries]
    blocks = []
    for title, mark, entries in sections:
        if not entries:
            continue
        blocks.append(_block("heading", title))
        for e in entries:
            if detail == "names":
                blocks.append(_block("line", f"{e['kind']} {e['name']}", mark))
            elif mark == "updated":
                blocks.append(_block("line", f"{e['kind']} {e['name']}", mark, e.get("items")))
            else:
                blocks.append(_block("line", f"{e['kind']} {e['name']}" + (f" — {e['detail']}" if e.get("detail") else ""), mark))
    return blocks


# --- Grouped by Platform -------------------------------------------------------------


def platform_changes(old: dict, new: dict, counts: dict[str, bool] | None = None) -> list[dict]:
    """Each Platform with what changed on it — added (with what it carries),
    removed (with what it carried), or still there with Emitters added,
    removed or updated on it — then the dwell files; only what counts."""
    counts = resolve_counts(counts)
    old_p, old_e, _ = _collect(old)
    new_p, new_e, _ = _collect(new)
    updates = {
        eid: m
        for eid in old_e.keys() & new_e.keys()
        if (m := _mode_changes(old_e[eid]["snapshot"], new_e[eid]["snapshot"], counts))
    }
    out = []
    for pid in sorted(old_p.keys() | new_p.keys(), key=lambda p: ((new_p.get(p) or old_p[p])["name"] or "").lower()):
        if pid in new_p and pid not in old_p:
            if not counts["platforms"]:
                continue
            p = new_p[pid]
            entries = [
                {"mark": "added", "name": _emitter_label(new_e[eid]), "detail": _plural(len(_modes(new_e[eid]["snapshot"])), "Mode"), "items": []}
                for eid in sorted(p["emitters"], key=lambda e: (p["emitters"][e] or "").lower())
                if eid in new_e
            ]
            out.append({"name": p["name"], "mark": "added", "entries": entries})
        elif pid in old_p and pid not in new_p:
            if not counts["platforms"]:
                continue
            p = old_p[pid]
            entries = [
                {"mark": "removed", "name": _emitter_label(old_e[eid]), "detail": None, "items": []}
                for eid in sorted(p["emitters"], key=lambda e: (p["emitters"][e] or "").lower())
                if eid in old_e
            ]
            out.append({"name": p["name"], "mark": "removed", "entries": entries})
        else:
            before, after = old_p[pid]["emitters"], new_p[pid]["emitters"]
            entries = []
            for eid in sorted(after.keys() - before.keys(), key=lambda e: (after[e] or "").lower()):
                new_to_mdf = eid not in old_e
                if (new_to_mdf and counts["emitters"]) or (not new_to_mdf and counts["platform_moves"]):
                    n = len(_modes(new_e[eid]["snapshot"]))
                    detail = _plural(n, "Mode") if new_to_mdf else "moved onto it"
                    entries.append({"mark": "added", "name": _emitter_label(new_e[eid]), "detail": detail, "items": []})
            for eid in sorted(before.keys() - after.keys(), key=lambda e: (before[e] or "").lower()):
                gone = eid not in new_e
                if (gone and counts["emitters"]) or (not gone and counts["platform_moves"]):
                    entries.append(
                        {"mark": "removed", "name": _emitter_label(old_e[eid]), "detail": None if gone else "moved off it", "items": []}
                    )
            for eid in sorted(before.keys() & after.keys(), key=lambda e: (after[e] or "").lower()):
                if eid in updates:
                    entries.append({"mark": "updated", "name": _emitter_label(new_e[eid]), "detail": None, "items": _mode_items(updates[eid])})
            if entries:
                out.append({"name": new_p[pid]["name"], "mark": "updated", "entries": entries})
    if counts["dwell_files"]:
        old_d, new_d = _dwell_files(old), _dwell_files(new)
        entries = [{"mark": "added", "name": new_d[f]["name"], "detail": None, "items": []} for f in new_d.keys() - old_d.keys()]
        entries += [{"mark": "removed", "name": old_d[f]["name"], "detail": None, "items": []} for f in old_d.keys() - new_d.keys()]
        for f in old_d.keys() & new_d.keys():
            items = _dwell_changes(old_d[f], new_d[f])
            if items:
                entries.append({"mark": "updated", "name": new_d[f]["name"], "detail": None, "items": items})
        if entries:
            out.append({"name": None, "mark": "dwell_files", "entries": sorted(entries, key=lambda e: e["name"].lower())})
    return out


def _platform_title(g: dict) -> str:
    if g["mark"] == "dwell_files":
        return "Dwell files"
    return f"Platform {g['name']}" + {"added": " (added)", "removed": " (removed)", "updated": ""}[g["mark"]]


def _tally(entries: list[dict], word: str) -> str:
    """"2 Emitters added, 1 removed, 3 updated"."""
    parts = []
    for mark in ("added", "removed", "updated"):
        n = sum(1 for e in entries if e["mark"] == mark)
        if n:
            parts.append(f"{_plural(n, word)} {mark}" if not parts else f"{n} {mark}")
    return ", ".join(parts)


def _named(g: dict, mark: str) -> list[str]:
    return [e["name"] for e in g["entries"] if e["mark"] == mark]


def _by_platform(groups: list[dict], detail: str) -> list[dict]:
    if not groups:
        return [_block("empty", "No major changes.")]
    blocks = []
    for g in groups:
        word = "dwell file" if g["mark"] == "dwell_files" else "Emitter"
        mark = None if g["mark"] == "dwell_files" else g["mark"]
        if detail == "sentences":
            if g["mark"] == "added":
                carried = _named(g, "added")
                text = f"{g['name']} is new" + (f", carrying {_plural(len(carried), 'Emitter')} ({_names(carried)})" if carried else "") + "."
            elif g["mark"] == "removed":
                text = f"{g['name']} is no longer included."
            else:
                said = []
                for m in ("added", "removed", "updated"):
                    n = _named(g, m)
                    if n:
                        count = _plural(len(n), word) if not said else str(len(n))
                        said.append(f"{count} {m} ({_names(n)})")
                where = "Dwell files" if g["mark"] == "dwell_files" else f"On {g['name']}"
                text = f"{where}: " + (said[0] if len(said) == 1 else f"{', '.join(said[:-1])} and {said[-1]}") + "."
            blocks.append(_block("paragraph", text))
        elif detail == "counts":
            if g["mark"] == "added":
                text = f"{g['name']} (added): carries {_plural(len(g['entries']), 'Emitter')}"
            elif g["mark"] == "removed":
                text = f"{g['name']} (removed)"
            else:
                text = f"{'Dwell files' if g['mark'] == 'dwell_files' else g['name']}: {_tally(g['entries'], word)}"
            blocks.append(_block("line", text, mark or "updated"))
        else:
            blocks.append(_block("heading", _platform_title(g)))
            for e in g["entries"]:
                if detail == "names":
                    blocks.append(_block("line", e["name"], e["mark"]))
                else:
                    text = e["name"] + (f" — {e['detail']}" if e.get("detail") else "")
                    blocks.append(_block("line", text, e["mark"], e.get("items")))
    return blocks


def change_log(old: dict, new: dict, counts: dict[str, bool] | None, detail: str = "full", group: str = "change") -> dict:
    """The change log from snapshot `old` to `new` as blocks: headings, lines
    (each marked added, removed or updated, with any items under it),
    paragraphs, and "empty" when nothing changed."""
    detail = detail if detail in DETAILS else "full"
    group = group if group in GROUPS else "change"
    if group == "platform":
        blocks = _by_platform(platform_changes(old, new, counts), detail)
    else:
        blocks = _by_change(change_notes(old, new, counts), detail)
    return {"detail": detail, "group": group, "blocks": blocks}
