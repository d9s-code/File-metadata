"""Compares this app's Emitter report with the report the other app makes
after an import (see emitter_report_service), and lists every difference.
Used by the MDF page's Import check (POST /reports/mdfs/{id}/compare) and by
scripts/compare_reports.py from the command line — standard library only, so
the script runs with a bare Python.

Rows are matched by their names, never by their position, so the order
Platforms, Emitters or Modes come in doesn't matter — only their values:

  * Platforms by Name, Emitters by Emitter and Mode (the 1st and 3rd columns).
  * Names match ignoring case, extra spaces, and spaces vs. underscores
    (the export writes "dummy emitter 1" as "dummy_emitter_1").
  * Columns are matched by header text, ignoring case and extra or no-break
    spaces; a column only one side has is reported once, not per row.
  * Numbers match within a small tolerance, so 1000 and 1000.0 and "1000"
    are the same; an empty cell only matches an empty one.
  * Text matches the way names do, unless strict_text.
  * The Unknown Platform and Emitter are skipped (each app fills them with
    its own defaults) unless include_unknown.
"""

from __future__ import annotations

import io
import math
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict

_NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
_M = "{%s}" % _NS["m"]
_REL_ID = "{%s}id" % _NS["r"]

SHEETS = ("Platforms", "Emitters")


# --- Reading an .xlsx -----------------------------------------------------------------


def _column_index(ref: str) -> int:
    letters = re.match(r"[A-Za-z]+", ref).group(0).upper()
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _text(element) -> str:
    """A string item's text: its <t>, or its rich-text runs' (phonetic hints left out)."""
    parts = [t.text or "" for t in element.findall("m:t", _NS)]
    parts += [t.text or "" for run in element.findall("m:r", _NS) for t in run.findall("m:t", _NS)]
    return "".join(parts)


def _cell_value(cell, shared: list[str]):
    kind = cell.get("t")
    v = cell.find("m:v", _NS)
    if kind == "inlineStr":
        is_ = cell.find("m:is", _NS)
        return _text(is_) if is_ is not None else None
    if v is None or v.text is None:
        return None
    if kind == "s":
        return shared[int(v.text)]
    if kind in ("str", "e"):
        return v.text
    if kind == "b":
        return v.text == "1"
    try:
        number = float(v.text)
    except ValueError:
        return v.text
    return int(number) if number.is_integer() else number


def _sheet_path(target: str) -> str:
    target = target.lstrip("/")
    return target if target.startswith("xl/") else "xl/" + target


class WorkbookError(ValueError):
    pass


def read_workbook(source, *, max_bytes: int | None = None) -> dict[str, list[list]]:
    """Every sheet of an .xlsx (a path, its bytes or a file), by name, as rows
    of values (None for empty). With max_bytes, a file whose parts would
    unpack to more than that is refused rather than read."""
    if isinstance(source, (bytes, bytearray)):
        source = io.BytesIO(source)
    try:
        return _read_workbook(source, max_bytes)
    except (KeyError, IndexError, ValueError, AttributeError, TypeError, zipfile.BadZipFile, ET.ParseError) as exc:
        if isinstance(exc, WorkbookError):
            raise
        raise WorkbookError("That isn't a readable .xlsx report") from exc


def _read_workbook(source, max_bytes: int | None) -> dict[str, list[list]]:
    with zipfile.ZipFile(source) as z:
        if max_bytes is not None and sum(info.file_size for info in z.infolist()) > max_bytes:
            raise WorkbookError("The report unpacks to more than the upload limit")
        names = set(z.namelist())
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            shared = [_text(si) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", _NS)]
        workbook = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        targets = {rel.get("Id"): rel.get("Target") for rel in rels}
        sheets: dict[str, list[list]] = {}
        for sheet in workbook.find("m:sheets", _NS):
            root = ET.fromstring(z.read(_sheet_path(targets[sheet.get(_REL_ID)])))
            rows: list[list] = []
            for row in root.iter(_M + "row"):
                number = int(row.get("r", len(rows) + 1))
                while len(rows) < number - 1:
                    rows.append([])
                cells: dict[int, object] = {}
                for position, cell in enumerate(row.findall("m:c", _NS)):
                    ref = cell.get("r")
                    cells[_column_index(ref) if ref else position] = _cell_value(cell, shared)
                rows.append([cells.get(i) for i in range(max(cells) + 1)] if cells else [])
            sheets[sheet.get("name")] = rows
        return sheets


# --- Normalizing ----------------------------------------------------------------------


def header_key(text) -> str:
    """A header as compared: case, no-break and repeated spaces ignored."""
    return " ".join(str(text or "").replace(" ", " ").split()).casefold()


def name_key(value) -> str:
    """A name as matched: case, extra spaces and spaces vs. underscores ignored."""
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return " ".join(str(value).replace(" ", " ").replace("_", " ").split()).casefold()


def _empty(value) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def _number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        number = float(str(value).strip().replace(",", "."))
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def same_value(a, b, *, abs_tol: float, rel_tol: float, strict_text: bool) -> bool:
    if _empty(a) or _empty(b):
        return _empty(a) and _empty(b)
    na, nb = _number(a), _number(b)
    if na is not None and nb is not None:
        return math.isclose(na, nb, rel_tol=rel_tol, abs_tol=abs_tol)
    if strict_text:
        return str(a) == str(b)
    return name_key(a) == name_key(b)


def show(value) -> str:
    if _empty(value):
        return "(empty)"
    if isinstance(value, float):
        return f"{value:.10g}"
    return str(value)


# --- Comparing ------------------------------------------------------------------------


class Table:
    """One sheet: its headers and its rows grouped by key."""

    def __init__(self, rows: list[list], key_headers: list[str], key_fallback: list[int], include_unknown: bool):
        header_row = rows[0] if rows else []
        self.headers = [h for h in header_row]
        self.columns: dict[str, int] = {}
        for i, h in enumerate(header_row):
            if not _empty(h):
                self.columns.setdefault(header_key(h), i)
        self.key_columns = [
            self.columns.get(header_key(h), fallback) for h, fallback in zip(key_headers, key_fallback)
        ]
        self.rows: dict[tuple, list[list]] = defaultdict(list)
        self.labels: dict[tuple, str] = {}
        for row in rows[1:]:
            if all(_empty(v) for v in row):
                continue
            key = tuple(name_key(row[i] if i < len(row) else None) for i in self.key_columns)
            if not include_unknown and key[0] == "unknown":
                continue
            self.rows[key].append(row)
            self.labels.setdefault(key, " / ".join(show(row[i] if i < len(row) else None) for i in self.key_columns))

    def value(self, row: list, column: str):
        i = self.columns[column]
        return row[i] if i < len(row) else None

    def header(self, column: str) -> str:
        return str(self.headers[self.columns[column]])


def compare_sheet(name: str, app: Table, other: Table, *, ignore: set[str], **tol) -> list[dict]:
    """The differences between one sheet of the two reports, as dicts of
    sheet, key, column, app value, other value and kind."""
    diffs: list[dict] = []
    key_columns = {
        c for c, i in app.columns.items() if i in app.key_columns
    }
    shared = [c for c in app.columns if c in other.columns and c not in ignore and c not in key_columns]
    for column in app.columns:
        if column not in other.columns and column not in ignore:
            # Only worth a line when the column holds something.
            if any(not _empty(app.value(r, column)) for rows in app.rows.values() for r in rows):
                diffs.append(_diff(name, "", app.header(column), "(column)", "(missing)", "column only in the app's report"))
    for column in other.columns:
        if column not in app.columns and column not in ignore:
            if any(not _empty(other.value(r, column)) for rows in other.rows.values() for r in rows):
                diffs.append(_diff(name, "", other.header(column), "(missing)", "(column)", "column only in the other report"))

    for key in sorted(set(app.rows) | set(other.rows)):
        label = app.labels.get(key) or other.labels.get(key)
        mine, theirs = list(app.rows.get(key, [])), list(other.rows.get(key, []))
        # Rows that agree completely pair off first, whatever their order.
        for row in list(mine):
            match = next((t for t in theirs if _row_diffs(row, t, app, other, shared, tol) == []), None)
            if match is not None:
                mine.remove(row)
                theirs.remove(match)
        for row, match in zip(mine, theirs):
            for column, a, b in _row_diffs(row, match, app, other, shared, tol):
                diffs.append(_diff(name, label, app.header(column), show(a), show(b), "value differs"))
        for _row in mine[len(theirs):]:
            diffs.append(_diff(name, label, "", "(row)", "(missing)", "only in the app's report"))
        for _row in theirs[len(mine):]:
            diffs.append(_diff(name, label, "", "(missing)", "(row)", "only in the other report"))
    return diffs


def _row_diffs(row, match, app: Table, other: Table, shared: list[str], tol: dict) -> list[tuple]:
    out = []
    for column in shared:
        a, b = app.value(row, column), other.value(match, column)
        if not same_value(a, b, **tol):
            out.append((column, a, b))
    return out


# What each kind of difference is, in words (the CLI's and the CSV's) and as
# a code (the API's).
CODES = {
    "value differs": "value",
    "only in the app's report": "only_app",
    "only in the other report": "only_other",
    "column only in the app's report": "column_only_app",
    "column only in the other report": "column_only_other",
    "sheet missing from the app's report": "sheet_missing",
    "sheet missing from the other report": "sheet_missing",
}


def _diff(sheet, key, column, app_value, other_value, kind) -> dict:
    return {
        "sheet": sheet,
        "key": key,
        "column": column,
        "app": app_value,
        "other": other_value,
        "kind": kind,
        "code": CODES[kind],
    }


def _find_sheet(sheets: dict[str, list[list]], name: str):
    for sheet_name, rows in sheets.items():
        if sheet_name.strip().casefold() == name.casefold():
            return rows
    return None


def compare_workbooks(
    app_book: dict[str, list[list]],
    other_book: dict[str, list[list]],
    *,
    abs_tol: float = 1e-3,
    rel_tol: float = 1e-6,
    strict_text: bool = False,
    include_unknown: bool = False,
    ignore_columns: list[str] | None = None,
) -> dict:
    """The two reports compared: "differences" (an empty list: they agree)
    and, per sheet, how many rows each side had ("rows")."""
    ignore = {header_key(c) for c in ignore_columns or []}
    tol = {"abs_tol": abs_tol, "rel_tol": rel_tol, "strict_text": strict_text}
    keys = {"Platforms": (["Name"], [0]), "Emitters": (["Emitter", "Mode"], [0, 2])}
    diffs: list[dict] = []
    rows: dict[str, dict] = {}
    for sheet in SHEETS:
        app_rows, other_rows = _find_sheet(app_book, sheet), _find_sheet(other_book, sheet)
        if app_rows is None or other_rows is None:
            where = "the app's report" if app_rows is None else "the other report"
            diffs.append(_diff(sheet, "", "", "", "", f"sheet missing from {where}"))
            continue
        key_headers, fallback = keys[sheet]
        app = Table(app_rows, key_headers, fallback, include_unknown)
        other = Table(other_rows, key_headers, fallback, include_unknown)
        rows[sheet] = {"app": sum(map(len, app.rows.values())), "other": sum(map(len, other.rows.values()))}
        diffs.extend(compare_sheet(sheet, app, other, ignore=ignore, **tol))
    return {"differences": diffs, "rows": rows}


def compare_files(app_path, other_path, **options) -> list[dict]:
    """Every difference between two report files (an empty list: they agree);
    options as compare_workbooks takes them."""
    return compare_workbooks(read_workbook(app_path), read_workbook(other_path), **options)["differences"]
