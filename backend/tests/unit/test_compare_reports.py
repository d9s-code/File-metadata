"""scripts/compare_reports.py: rows matched by name whatever their order,
values compared, every difference flagged."""

import csv

from app.services.emitter_report_service import HEADER, PLATFORM_HEADER, STAGGER_COLUMNS
from app.services.xlsx_writer import Sheet, write_xlsx
from scripts.compare_reports import compare_files, main, read_workbook

EMITTER_HEADER = HEADER + [f"Stagger {i} [µs]" for i in range(1, STAGGER_COLUMNS + 1)]
UNKNOWN_PLATFORM = ["Unknown", "UNKNOWN", "UNKNOWN", 0, 0, "kph"]
PLATFORM = ["dummy_platform", "UNKNOWN", "UNKNOWN", 0, 0, "kph"]
ONE = ["dummy_emitter_1", "B999N", "Mode1", "IGNORED", 15, 20, 70, 2, "Undetermined", 0, 1000, 3000, 3500, 1, 2, "Simple", 500, 1000, 0, 1]
TWO = ["dummy_emitter_2", "C222M", "Mode1", "IGNORED", 10, 10, 100, 2, "Undetermined", 0, 1000, 9000, 9600, 2, 52, "Simple", 1000, 2000, 10, 20]
STAGGERED = ["dummy_emitter_2", "C222M", "Mode2", "IGNORED", 10, 10, 100, 2, "Undetermined", 0, 1000, 9000, 9600, 2, 52,
             "Stagger", None, None, None, None, 2646, 2654, 700, 750, 1200]


def _write(path, platforms, emitters, header=EMITTER_HEADER):
    path.write_bytes(
        write_xlsx([Sheet("Platforms", [PLATFORM_HEADER, *platforms]), Sheet("Emitters", [header, *emitters])])
    )
    return str(path)


def test_the_same_rows_in_another_order_and_spelling_agree(tmp_path):
    app = _write(tmp_path / "app.xlsx", [UNKNOWN_PLATFORM, PLATFORM], [["Unknown", "UNKNOWN"], ONE, TWO, STAGGERED])
    # The other app: spaces for underscores, other case, numbers as text, rows reversed,
    # its own Unknown Emitter — and a header with plain spaces where ours has no-break ones.
    spaced = [[v.replace("_", " ") if isinstance(v, str) else v for v in row] for row in (STAGGERED, TWO, ONE)]
    spaced[1][2] = "MODE1"
    spaced[2][16] = "500.0"
    header = [h.replace(" ", " ") for h in EMITTER_HEADER]
    other = _write(
        tmp_path / "other.xlsx",
        [["dummy platform", "UNKNOWN", "UNKNOWN", 0, 0, "kph"], UNKNOWN_PLATFORM],
        [*spaced, ["Unknown", "U000A", "default", "IGNORED", 10, 1, 100, 2]],
        header,
    )
    assert compare_files(app, other) == []
    assert main([app, other]) == 0
    # The Unknown rows only count when asked for.
    unknown = compare_files(app, other, include_unknown=True)
    assert {(d["key"], d["kind"]) for d in unknown} == {
        ("Unknown / (empty)", "only in the app's report"),
        ("Unknown / default", "only in the other report"),
    }


def test_each_difference_is_flagged(tmp_path):
    app = _write(tmp_path / "app.xlsx", [PLATFORM], [ONE, TWO, STAGGERED])
    changed = list(ONE)
    changed[12] = 3600  # Frequency Max
    stagger = list(STAGGERED)
    stagger[24] = 1201  # Stagger 3
    other = _write(
        tmp_path / "other.xlsx",
        [PLATFORM, ["Extra Platform", "UNKNOWN", "UNKNOWN", 0, 0, "kph"]],
        [stagger, changed],  # TWO is missing
    )
    diffs = compare_files(app, other)
    assert [(d["sheet"], d["key"], d["column"], d["app"], d["other"], d["kind"]) for d in diffs] == [
        ("Platforms", "Extra Platform", "", "(missing)", "(row)", "only in the other report"),
        ("Emitters", "dummy_emitter_1 / Mode1", "Frequency Max [MHz]", "3500", "3600", "value differs"),
        ("Emitters", "dummy_emitter_2 / Mode1", "", "(row)", "(missing)", "only in the app's report"),
        ("Emitters", "dummy_emitter_2 / Mode2", "Stagger 3 [µs]", "1200", "1201", "value differs"),
    ]
    # Within the tolerance is the same; an empty cell never matches a value.
    assert compare_files(app, _write(tmp_path / "near.xlsx", [PLATFORM], [ONE[:12] + [3500.0004] + ONE[13:], TWO, STAGGERED])) == []
    emptied = list(ONE)
    emptied[18] = None  # Jitter Min 0 → empty
    assert [d["column"] for d in compare_files(app, _write(tmp_path / "empty.xlsx", [PLATFORM], [emptied, TWO, STAGGERED]))] == [
        "Jitter Min [µs]"
    ]

    out = tmp_path / "diffs.csv"
    assert main([app, other, "--csv", str(out), "--ignore-column", "Stagger 3 [µs]"]) == 1
    with open(out, encoding="utf-8-sig") as f:
        assert len(list(csv.DictReader(f))) == 3


def test_a_missing_sheet_or_column_is_reported_once(tmp_path):
    app = _write(tmp_path / "app.xlsx", [PLATFORM], [ONE])
    other = tmp_path / "other.xlsx"
    header = [h for h in EMITTER_HEADER if h != "Polarization"]
    row = [v for i, v in enumerate(ONE) if i != 3]
    other.write_bytes(write_xlsx([Sheet("Emitters", [header, row])]))
    diffs = compare_files(app, str(other))
    assert [(d["sheet"], d["column"], d["kind"]) for d in diffs] == [
        ("Platforms", "", "sheet missing from the other report"),
        ("Emitters", "Polarization", "column only in the app's report"),
    ]
    assert main([app, str(tmp_path / "nowhere.xlsx")]) == 2


def test_it_reads_shared_strings_as_spreadsheet_apps_write_them(tmp_path):
    """Excel keeps text in a shared table rather than inline, as our writer does."""
    import zipfile

    path = tmp_path / "shared.xlsx"
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    rel = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("xl/workbook.xml", f'<workbook {ns} {rel}><sheets><sheet name="Platforms" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr(
            "xl/_rels/workbook.xml.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Target="/xl/worksheets/sheet1.xml"/></Relationships>',
        )
        z.writestr("xl/sharedStrings.xml", f'<sst {ns}><si><t>Name</t></si><si><r><t>dummy </t></r><r><t>platform</t></r></si></sst>')
        z.writestr(
            "xl/worksheets/sheet1.xml",
            f'<worksheet {ns}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row>'
            '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="D3"><v>0</v></c></row></sheetData></worksheet>',
        )
    assert read_workbook(str(path)) == {"Platforms": [["Name"], [], ["dummy platform", None, None, 0]]}
