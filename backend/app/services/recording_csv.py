"""Reads an EmitterTrackParameters CSV the way the browser's import does
(frontend/src/components/intercepts/interceptCsv.ts) — the same columns, the
same rules, the same units (times in the file are ns, stored in µs; RF in
MHz) — but a line at a time, so a 100 MB recording needn't fit in memory."""

from __future__ import annotations

import csv
import io
import math
import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from datetime import datetime, timezone

COL = {
    "mission_time": "MissionTime",
    "track": "TrackNumber",
    "mode_track": "ModeTrackNumber",
    "ambiguity_count": "ModeAmbiguityCount",
    "mode_name": "ModeIdAmbiguities_0_ModeName",
    "power": "ReceivedPower",
    "rf": "Parameters_RF",
    "pri_class": "Parameters_PRIClass",
    "base_pri": "Parameters_BasePRI",
    "pw": "Parameters_PulseWidth",
    "jitter": "Parameters_Parameters_Simple_Jitter",
    "stagger_count": "Parameters_Parameters_Stagger_Count",
}
REQUIRED = [COL["rf"], COL["pri_class"], COL["base_pri"], COL["pw"]]
FIRST_CANDIDATE_PREFIX = "ModeIdAmbiguities_0_"
_TIME = re.compile(r"^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(\.\d+)?")


class CsvFormatError(ValueError):
    """Not an EmitterTrackParameters export."""


@dataclass
class Report:
    file_line: int
    mission_time: datetime | None
    track: str | None
    mode_track: str | None
    power: float | None
    designation: str | None
    mode_name: str | None
    ambiguity_count: int | None
    pri_type: str  # "fixed" | "stagger" | "cw"
    rf_mhz: float
    pri_us: float | None
    pw_us: float | None
    jitter_us: float | None
    stagger_us: list[float] | None


@dataclass
class Skipped:
    count: int = 0
    sample: list[str] = field(default_factory=list)

    def add(self, line: int, reason: str) -> None:
        self.count += 1
        if len(self.sample) < 50:
            self.sample.append(f"{line}: {reason}")


def _clean(v: str | None) -> str | None:
    t = (v or "").strip()
    return None if t == "" or t.upper() == "<EMPTY>" else t


def _number(v: str | None) -> float | None:
    if v is None:
        return None
    try:
        n = float(v)
    except ValueError:
        return None
    return n if math.isfinite(n) else None


def _ns_to_us(ns: float) -> float:
    return round(ns) / 1000


def mission_time(text: str | None) -> datetime | None:
    """"20251201-111008.902000" → that moment, read as UTC (as the browser does)."""
    m = _TIME.match(text or "")
    if not m:
        return None
    frac = m.group(7)
    micro = round(float(frac) * 1_000_000) if frac else 0
    try:
        return datetime(
            int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5)), int(m.group(6)),
            min(micro, 999_999), tzinfo=timezone.utc,
        )
    except ValueError:
        return None


def read_reports(lines: Iterable[str], skipped: Skipped) -> Iterator[Report]:
    """Each readable row as a Report; unreadable ones are counted in `skipped`."""
    reader = csv.reader(lines)
    try:
        header = [h.strip().lstrip("﻿") for h in next(reader)]
    except StopIteration as err:
        raise CsvFormatError("The file is empty.") from err
    missing = [c for c in REQUIRED if c not in header]
    if missing:
        raise CsvFormatError(
            "This doesn't look like an EmitterTrackParameters export — missing column"
            f"{'' if len(missing) == 1 else 's'} {', '.join(missing)}."
        )
    index = {h: i for i, h in enumerate(header)}
    designation_col = next((h for h in header if h.startswith(FIRST_CANDIDATE_PREFIX) and h != COL["mode_name"]), None)
    positions = [index.get(f"Parameters_Parameters_Stagger_Position{i}") for i in range(64)]

    for n, cells in enumerate(reader):
        line = n + 2
        if not any(_clean(c) for c in cells):
            continue

        def get(column: str | None) -> str | None:
            at = index.get(column) if column else None
            return _clean(cells[at]) if at is not None and at < len(cells) else None

        rf = _number(get(COL["rf"]))
        if rf is None:
            skipped.add(line, "No RF value")
            continue
        pri_class = (get(COL["pri_class"]) or "").lower()
        base_pri = _number(get(COL["base_pri"]))
        pw = _number(get(COL["pw"]))
        amb = _number(get(COL["ambiguity_count"]))
        common = dict(
            file_line=line,
            mission_time=mission_time(get(COL["mission_time"])),
            track=(get(COL["track"]) or None) and get(COL["track"])[:50],
            mode_track=(get(COL["mode_track"]) or None) and get(COL["mode_track"])[:50],
            power=_number(get(COL["power"])),
            designation=(get(designation_col) or None) and get(designation_col)[:200],
            mode_name=(get(COL["mode_name"]) or None) and get(COL["mode_name"])[:200],
            ambiguity_count=int(amb) if amb is not None else None,
            rf_mhz=rf,
        )
        if pri_class == "cw":
            yield Report(**common, pri_type="cw", pri_us=None, pw_us=None, jitter_us=None, stagger_us=None)
        elif pri_class == "simple":
            if base_pri is None or base_pri <= 0 or pw is None or pw <= 0:
                skipped.add(line, "Fixed PRI without a PRI or pulse width")
                continue
            jitter = _number(get(COL["jitter"]))
            yield Report(
                **common, pri_type="fixed", pri_us=_ns_to_us(base_pri), pw_us=_ns_to_us(pw),
                jitter_us=None if jitter is None else _ns_to_us(jitter), stagger_us=None,
            )
        elif pri_class == "stagger":
            count = int(_number(get(COL["stagger_count"])) or 0)
            values: list[float] = []
            for p in range(count):
                at = positions[p] if p < len(positions) else None
                v = _number(_clean(cells[at])) if at is not None and at < len(cells) else None
                if v is None or v <= 0:
                    break
                values.append(_ns_to_us(v))
            if not values or len(values) != count:
                skipped.add(line, f"Stagger with {count} position{'' if count == 1 else 's'} but values missing")
                continue
            if pw is None or pw <= 0:
                skipped.add(line, "Stagger without a pulse width")
                continue
            frame = _ns_to_us(base_pri) if base_pri is not None and base_pri > 0 else round(sum(values) * 1000) / 1000
            yield Report(**common, pri_type="stagger", pri_us=frame, pw_us=_ns_to_us(pw), jitter_us=None, stagger_us=values)
        elif pri_class == "xlet":
            skipped.add(line, "X-let isn't supported yet")
        else:
            skipped.add(line, f'Unknown PRI class "{get(COL["pri_class"])}"' if pri_class else "No PRI class")


def text_lines(raw: io.BufferedReader) -> Iterator[str]:
    """The file's lines as text (UTF-8, a BOM allowed), newlines kept for csv."""
    yield from io.TextIOWrapper(raw, encoding="utf-8-sig", errors="replace", newline="")
