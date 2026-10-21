"""A small .xlsx writer: plain sheets of text and numbers, a bold header row
kept in view while scrolling, and column widths — all a report needs, from
the standard library alone (no spreadsheet package to add to the images)."""

import io
import zipfile
from dataclasses import dataclass, field
from xml.sax.saxutils import escape

Cell = str | int | float | None


@dataclass
class Sheet:
    name: str
    rows: list[list[Cell]]
    # Which row (0-based) is the header: bold, and frozen with those above it.
    header_row: int | None = 0
    # Characters per column, in order; missing ones are left to the default.
    widths: list[float] = field(default_factory=list)


def column_letter(index: int) -> str:
    """0 → A, 25 → Z, 26 → AA."""
    letters = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _clean(text: str) -> str:
    # Control characters other than tab and newlines aren't allowed in XML.
    return escape("".join(ch for ch in text if ch in "\t\n\r" or ord(ch) >= 32))


def _cell(ref: str, value: Cell, bold: bool) -> str:
    style = ' s="1"' if bold else ""
    if value is None or value == "":
        return ""
    if isinstance(value, bool):
        value = "Yes" if value else "No"
    if isinstance(value, (int, float)):
        number = int(value) if float(value).is_integer() else value
        return f'<c r="{ref}"{style}><v>{number}</v></c>'
    return f'<c r="{ref}" t="inlineStr"{style}><is><t xml:space="preserve">{_clean(str(value))}</t></is></c>'


def _sheet_xml(sheet: Sheet) -> str:
    parts = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    ]
    if sheet.header_row is not None:
        parts.append(
            f'<sheetViews><sheetView workbookViewId="0"><pane ySplit="{sheet.header_row + 1}" '
            f'topLeftCell="A{sheet.header_row + 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        )
    if sheet.widths:
        parts.append("<cols>")
        for i, width in enumerate(sheet.widths, start=1):
            parts.append(f'<col min="{i}" max="{i}" width="{width}" customWidth="1"/>')
        parts.append("</cols>")
    parts.append("<sheetData>")
    for r, row in enumerate(sheet.rows):
        bold = r == sheet.header_row
        cells = "".join(_cell(f"{column_letter(c)}{r + 1}", v, bold) for c, v in enumerate(row))
        parts.append(f'<row r="{r + 1}">{cells}</row>')
    parts.append("</sheetData></worksheet>")
    return "".join(parts)


_STYLES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    "</styleSheet>"
)

_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_SHEET_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"


def write_xlsx(sheets: list[Sheet]) -> bytes:
    """The workbook's bytes, its sheets in the order given."""
    n = len(sheets)
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/styles.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="{_SHEET_TYPE}"/>' for i in range(1, n + 1))
        + "</Types>"
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'<Relationship Id="rId1" Type="{_REL}/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="{_REL}"><sheets>'
        + "".join(
            f'<sheet name="{_clean(s.name[:31])}" sheetId="{i}" r:id="rId{i}"/>' for i, s in enumerate(sheets, start=1)
        )
        + "</sheets></workbook>"
    )
    workbook_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(
            f'<Relationship Id="rId{i}" Type="{_REL}/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, n + 1)
        )
        + f'<Relationship Id="rId{n + 1}" Type="{_REL}/styles" Target="styles.xml"/>'
        "</Relationships>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        z.writestr("xl/styles.xml", _STYLES)
        for i, sheet in enumerate(sheets, start=1):
            z.writestr(f"xl/worksheets/sheet{i}.xml", _sheet_xml(sheet))
    return buf.getvalue()
