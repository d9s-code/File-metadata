"""A small Word (.docx) writer: headings, paragraphs, bullets and tables —
enough for release notes and change summaries, with no extra dependency.
Opens in Word, LibreOffice and Google Docs."""

import io
import zipfile
from dataclasses import dataclass, field
from xml.sax.saxutils import escape

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


@dataclass
class Block:
    """kind: title, h1, h2, p, meta (small grey), bullet, table."""

    kind: str
    text: str = ""
    rows: list[list[str]] = field(default_factory=list)
    # A table's rows after the header, each "added", "removed", "updated" or
    # None: the row tinted, and its cell in `mark_column` coloured and bold.
    marks: list[str | None] = field(default_factory=list)
    mark_column: int | None = None
    # Each column's share of the width (any numbers; they're scaled), or none: equal.
    widths: list[float] = field(default_factory=list)


# The page's width between its margins, in twentieths of a point.
TEXT_WIDTH = 11906 - 2 * 1134

# (the row's tint, the change cell's fill, its text) — green, red, amber.
MARK_COLOURS = {
    "added": ("F3FAF5", "DDF2E3", "1E7B34"),
    "removed": ("FDF3F2", "FADCD9", "B3261E"),
    "updated": ("FFFAEC", "FCEFC7", "8A5A00"),
}


def _runs(text: str, *, bold=False, color: str | None = None, size: int | None = None) -> str:
    props = ""
    if bold or color or size:
        props = "<w:rPr>" + ("<w:b/>" if bold else "") + (f'<w:color w:val="{color}"/>' if color else "")
        props += (f'<w:sz w:val="{size}"/>' if size else "") + "</w:rPr>"
    parts = []
    for i, line in enumerate((text or "").split("\n")):
        if i:
            parts.append("<w:br/>")
        parts.append(f'<w:t xml:space="preserve">{escape(line)}</w:t>')
    return f"<w:r>{props}{''.join(parts)}</w:r>"


def _para(text: str, style: str | None = None, **run) -> str:
    ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f"<w:p>{ppr}{_runs(text, **run)}</w:p>"


def _cell(text: str, fill: str | None = None, width: int | None = None, **run) -> str:
    props = (f'<w:tcW w:w="{width}" w:type="dxa"/>' if width else "") + (
        f'<w:shd w:val="clear" w:color="auto" w:fill="{fill}"/>' if fill else ""
    )
    return f"<w:tc>{f'<w:tcPr>{props}</w:tcPr>' if props else ''}<w:p>{_runs(text, **run)}</w:p></w:tc>"


def _table(rows: list[list[str]], marks: list[str | None] | None = None, mark_column: int | None = None, widths: list[float] | None = None) -> str:
    if not rows:
        return ""
    if marks:
        return _marked_table(rows, marks, mark_column, widths)
    border = '<w:{0} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
    borders = "".join(border.format(side) for side in ("top", "left", "bottom", "right", "insideH", "insideV"))
    out = [f'<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>{borders}</w:tblBorders></w:tblPr>']
    for r, row in enumerate(rows):
        out.append("<w:tr>")
        for cell in row:
            shade = '<w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="EDEFF2"/></w:tcPr>' if r == 0 else ""
            out.append(f"<w:tc>{shade}<w:p>{_runs(str(cell if cell is not None else ''), bold=r == 0)}</w:p></w:tc>")
        out.append("</w:tr>")
    out.append("</w:tbl>")
    # A table must be followed by a paragraph before the next table or the end.
    return "".join(out) + "<w:p/>"


def _marked_table(rows: list[list[str]], marks: list[str | None], mark_column: int | None, widths: list[float] | None = None) -> str:
    border = '<w:{0} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
    borders = "".join(border.format(side) for side in ("top", "left", "bottom", "right", "insideH", "insideV"))
    shares = widths if widths and len(widths) == len(rows[0]) else [1.0] * len(rows[0])
    cols = [int(TEXT_WIDTH * w / sum(shares)) for w in shares]
    out = [
        f'<w:tbl><w:tblPr><w:tblW w:w="{sum(cols)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>{borders}</w:tblBorders></w:tblPr>',
        "<w:tblGrid>" + "".join(f'<w:gridCol w:w="{w}"/>' for w in cols) + "</w:tblGrid>",
    ]
    out.append("<w:tr><w:trPr><w:tblHeader/></w:trPr>" + "".join(_cell(str(c), "EDEFF2", cols[i], bold=True) for i, c in enumerate(rows[0])) + "</w:tr>")
    for row, mark in zip(rows[1:], marks, strict=False):
        tint, fill, ink = MARK_COLOURS.get(mark or "", (None, None, None))
        cells = []
        for i, c in enumerate(row):
            # Several lines in a cell: each its own bullet.
            text = ("\n".join(f"• {x}" for x in c) if len(c) > 1 else "".join(c)) if isinstance(c, list) else str(c if c is not None else "")
            if i == mark_column and mark:
                cells.append(_cell(text, fill, cols[i], bold=True, color=ink))
            else:
                cells.append(_cell(text, tint, cols[i]))
        out.append("<w:tr><w:trPr><w:cantSplit/></w:trPr>" + "".join(cells) + "</w:tr>")
    out.append("</w:tbl>")
    return "".join(out) + "<w:p/>"


def _block(b: Block) -> str:
    if b.kind == "title":
        return _para(b.text, "Title")
    if b.kind == "h1":
        return _para(b.text, "Heading1")
    if b.kind == "h2":
        return _para(b.text, "Heading2")
    if b.kind == "meta":
        return _para(b.text, color="595959", size=18)
    if b.kind == "bullet":
        return f'<w:p><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr>{_runs("• " + b.text)}</w:p>'
    if b.kind == "table":
        return _table(b.rows, b.marks, b.mark_column, b.widths)
    return _para(b.text)


STYLES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W}">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/></w:rPr></w:rPrDefault>
  <w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style>
</w:styles>"""

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"""


def write_docx(blocks: list[Block]) -> bytes:
    body = "".join(_block(b) for b in blocks)
    document = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{W}"><w:body>{body}'
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>'
        "</w:sectPr></w:body></w:document>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", ROOT_RELS)
        z.writestr("word/_rels/document.xml.rels", DOC_RELS)
        z.writestr("word/document.xml", document)
        z.writestr("word/styles.xml", STYLES)
    return buf.getvalue()
