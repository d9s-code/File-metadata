"""The Platforms and Emitters tables of the release notes: one row per
Platform and per Emitter in the later version, each with the values its
columns can show, marked added or updated (as the change log counts them).

Values are as exported: RF, PRI and PW with their deltas applied, exactly the
ranges the PRS XML export writes — the lowest and highest across the
Emitter's Modes. Which columns show, and whether every row or only those
added or updated, is picked when the document is made (see table_block)."""

from app.services.change_notes import _emitter_label, _mode_changes, resolve_counts
from app.services.delta import apply_delta
from app.services.mdf_compare import _collect
from app.services.prs_export.serializer import base_value, hostility_value

# Each table's columns, in the order they show, by key: their heading.
PLATFORM_COLUMNS: dict[str, str] = {
    "platform": "Platform",
    "version": "Version",
    "status": "Status",
    "hostility": "Hostility",
    "base": "Base",
    "speed": "Speed",
    "emitters": "Emitters",
    "change": "Change",
}
EMITTER_COLUMNS: dict[str, str] = {
    "designation": "Designation",
    "emitter": "Emitter",
    "version": "Version",
    "status": "Status",
    "platforms": "Platforms",
    "ew_groups": "EW Groups",
    "modes": "Modes",
    "rf": "RF (MHz)",
    "pri": "PRI (µs)",
    "pw": "PW (µs)",
    "priority": "Priority",
    "ageout": "Ageout (s)",
    "change": "Change",
}
PLATFORM_DEFAULT = ("platform", "version", "status", "emitters")
EMITTER_DEFAULT = ("designation", "emitter", "version", "status", "modes", "rf", "pri", "pw")
ROWS = ("all", "changed")

_ORDER = {"added": 0, "updated": 1, None: 2}
_CHANGE = {"added": "Added", "updated": "Updated", None: ""}


def _num(v: float) -> str:
    return f"{v:,.4f}".rstrip("0").rstrip(".")


def _span(lo: float | None, hi: float | None) -> str:
    if lo is None or hi is None:
        return "—"
    return _num(lo) if lo == hi else f"{_num(lo)}–{_num(hi)}"


def _extent(pairs: list[tuple]) -> str:
    """The lowest and highest of several (min, max) ranges."""
    pairs = [(lo, hi) for lo, hi in pairs if lo is not None and hi is not None]
    if not pairs:
        return "—"
    return _span(min(float(lo) for lo, _ in pairs), max(float(hi) for _, hi in pairs))


def _values_of(values: list) -> str:
    values = sorted({float(v) for v in values if v is not None})
    return "—" if not values else _span(values[0], values[-1])


def emitter_values(snapshot: dict) -> dict[str, str]:
    """An Emitter's RF, PRI and PW (as exported), EW Groups, Modes, priority and ageout."""
    rf, pw, pri = [], [], []
    for group in snapshot.get("ew_groups", []):
        for mode in group.get("modes", []):
            line = mode.get("line") or {}
            rf.append(apply_delta(line.get("rf_min_mhz"), line.get("rf_max_mhz"), line.get("rf_delta")))
            pw.append(apply_delta(line.get("pw_min_us"), line.get("pw_max_us"), line.get("pw_delta")))
            if mode.get("pri_type") == "fixed":
                pri.append(apply_delta(line.get("pri_min_us"), line.get("pri_max_us"), line.get("pri_delta")))
            elif mode.get("pri_type") == "stagger":
                levels = [v for v in line.get("pri_stagger_values_us") or [] if v is not None]
                if levels:
                    pri.append((min(levels), max(levels)))
    groups = snapshot.get("ew_groups", [])
    return {
        "ew_groups": str(len(groups)),
        "modes": str(sum(len(g.get("modes", [])) for g in groups)),
        "rf": _extent(rf),
        "pri": _extent(pri),
        "pw": _extent(pw),
        "priority": _values_of([g.get("threat_priority") for g in groups]),
        "ageout": _values_of([g.get("ageout") for g in groups]),
    }


def _speed(p: dict) -> str:
    lo, hi = p.get("speed_min"), p.get("speed_max")
    if lo is None and hi is None:
        return "—"
    unit = "knots" if p.get("speed_unit") == "knots" else "km/h"
    return f"{_span(float(lo if lo is not None else hi), float(hi if hi is not None else lo))} {unit}"


def release_tables(
    old: dict,
    new: dict,
    counts: dict[str, bool] | None,
    platform_status: dict[str, str],
    emitter_status: dict[str, str],
) -> dict[str, list[dict]]:
    """Every Platform and Emitter in `new`, each {"mark", "values"} — mark
    "added", "updated" or None against `old` — added first, then updated,
    then the rest, by name."""
    counts = resolve_counts(counts)
    old_p, old_e, _ = _collect(old)
    new_p, new_e, _ = _collect(new)
    updated = {
        eid
        for eid in old_e.keys() & new_e.keys()
        if _mode_changes(old_e[eid]["snapshot"], new_e[eid]["snapshot"], counts) is not None
    }
    snapshots = {link["platform_id"]: link.get("platform_snapshot") or {} for link in new.get("links", [])}
    old_snapshots = {link["platform_id"]: link.get("platform_snapshot") or {} for link in old.get("links", [])}

    emitters = []
    for eid, e in new_e.items():
        snap = e["snapshot"]
        mark = "added" if eid not in old_e else "updated" if eid in updated else None
        emitters.append({
            "mark": mark,
            "values": {
                "designation": snap.get("designation") or "—",
                "emitter": e["name"],
                "version": f"v{e['version']}",
                "status": emitter_status.get(snap.get("status") or "", snap.get("status") or "—"),
                "platforms": ", ".join(sorted(e["platforms"], key=str.lower)),
                **emitter_values(snap),
                "change": _CHANGE[mark],
            },
        })  # fmt: skip

    def exported(p: dict) -> tuple:
        return (p.get("name"), hostility_value(p.get("hostility"), p.get("allegiance")), base_value(p.get("base")), _speed(p))

    platforms = []
    for pid, p in new_p.items():
        snap = snapshots.get(pid, {})
        if pid not in old_p:
            mark = "added"
        else:
            carried_changed = set(old_p[pid]["emitters"]) != set(p["emitters"]) or any(e in updated for e in p["emitters"])
            mark = "updated" if carried_changed or exported(old_snapshots.get(pid, {})) != exported(snap) else None
        platforms.append({
            "mark": mark,
            "values": {
                "platform": p["name"],
                "version": f"v{p['label']}",
                "status": platform_status.get(snap.get("status") or "", snap.get("status") or "—"),
                "hostility": hostility_value(snap.get("hostility"), snap.get("allegiance")).capitalize(),
                "base": base_value(snap.get("base")).capitalize(),
                "speed": _speed(snap),
                "emitters": ", ".join(
                    sorted((_emitter_label(new_e[e]) for e in p["emitters"] if e in new_e), key=str.lower)
                ) or "—",
                "change": _CHANGE[mark],
            },
        })  # fmt: skip

    def order(rows: list[dict], key: str) -> list[dict]:
        return sorted(rows, key=lambda r: (_ORDER[r["mark"]], r["values"][key].lower()))

    return {"platforms": order(platforms, "platform"), "emitters": order(emitters, "emitter")}


# The page's text width in characters of 10.5 pt text, roughly (A4, 2 cm margins).
LINE_CHARS = 92


def font_pt(columns: int) -> float:
    """A table's text size: smaller as it gets wider, so its words fit."""
    return 10.5 if columns <= 6 else 9 if columns <= 9 else 8


def _widths(head: list[str], rows: list[list[str]], mark_column: int | None, pt: float) -> list[float]:
    """Each column's share of the width: first room for its longest word
    (bold in the headings and the Change column, and each cell has its
    padding), so no word is broken where it can fit; what's left goes to
    the columns with more text."""
    least, more = [], []
    for i, h in enumerate(head):
        cells = [r[i] or "" for r in rows]
        bold = 1.15 if i == mark_column else 1.0
        longest = max([len(w) * 1.35 for w in h.split()] + [len(w) * bold for c in cells for w in c.split()] + [1])
        typical = sum(len(c) for c in cells) / max(len(cells), 1)
        least.append(longest + 2.5)
        more.append(max(typical - longest, 0) + 0.5)
    spare = LINE_CHARS * 10.5 / pt - sum(least)
    if spare <= 0:
        return [round(w, 1) for w in least]
    return [round(w + spare * m / sum(more), 1) for w, m in zip(least, more, strict=True)]


def table_block(rows: list[dict], columns: dict[str, str], shown: list[str], which: str) -> dict | None:
    """One of the tables as the document writes it: the columns asked for
    (in their own order), every row or only those added or updated, each
    row marked to be tinted — and, with a Change column, that cell coloured.
    None when no row is left."""
    keys = [k for k in columns if k in shown] or list(columns)[:2]
    rows = [r for r in rows if which == "all" or r["mark"]]
    if not rows:
        return None
    head = [columns[k] for k in keys]
    cells = [[r["values"][k] for k in keys] for r in rows]
    mark_column = keys.index("change") if "change" in keys else None
    pt = font_pt(len(keys))
    return {
        "columns": head,
        "rows": cells,
        "marks": [r["mark"] for r in rows],
        "mark_column": mark_column,
        "widths": _widths(head, cells, mark_column, pt),
        "font_pt": pt,
    }

