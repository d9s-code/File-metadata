"""Compare this app's Emitter report with the report the other app makes after
an import, and flag every difference.

    python compare_reports.py APP_REPORT.xlsx OTHER_REPORT.xlsx [options]

Both files have a "Platforms" and an "Emitters" sheet with the same headers
(the app writes its report to match). Rows are matched by their names, never
by their position, so the order Platforms, Emitters or Modes come in doesn't
matter — only their values:

  * Platforms by Name, Emitters by Emitter and Mode (the 1st and 3rd columns).
  * Names match ignoring case, extra spaces, and spaces vs. underscores
    (the export writes "dummy emitter 1" as "dummy_emitter_1").
  * Columns are matched by header text, ignoring case and extra or no-break
    spaces; a column only one side has is reported once, not per row.
  * Numbers match within a small tolerance (--abs, --rel), so 1000 and
    1000.0 and "1000" are the same; an empty cell only matches an empty one.
  * Text matches the way names do, unless --strict-text.
  * The Unknown Platform and Emitter are skipped (each app fills them with
    its own defaults) unless --include-unknown.

Prints what's only in one report and each value that differs; --csv writes
the same as a table. Exits 0 when the reports agree, 1 when they differ and
2 when a file can't be read.

Needs nothing but Python 3.9 or newer (no spreadsheet package): copy this
script together with backend/app/services/report_compare.py, keeping the
folders (scripts/ beside app/services/). The app runs the same comparison
on an MDF's Import check tab.
"""

from __future__ import annotations

import argparse
import csv
import sys
import zipfile
from pathlib import Path

# The comparison itself lives in the app (app/services/report_compare.py).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.report_compare import SHEETS, WorkbookError, compare_files, read_workbook  # noqa: E402

__all__ = ["compare_files", "main", "print_report", "read_workbook"]


def print_report(diffs: list[dict], out=sys.stdout) -> None:
    if not diffs:
        print("The reports agree.", file=out)
        return
    for sheet in SHEETS:
        mine = [d for d in diffs if d["sheet"] == sheet]
        if not mine:
            print(f"{sheet}: no differences", file=out)
            continue
        print(f"{sheet}: {len(mine)} difference(s)", file=out)
        for d in mine:
            if d["kind"] == "value differs":
                print(f"  {d['key']}  [{d['column']}]  app: {d['app']}  other: {d['other']}", file=out)
            elif d["kind"].startswith("column"):
                print(f"  {d['kind']}: {d['column']}", file=out)
            elif d["kind"].startswith("sheet"):
                print(f"  {d['kind']}", file=out)
            else:
                print(f"  {d['key']}  {d['kind']}", file=out)
    print(f"\n{len(diffs)} difference(s) in all.", file=out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("app_report", help="the report downloaded from this app (.xlsx)")
    parser.add_argument("other_report", help="the report from the other app (.xlsx)")
    parser.add_argument("--abs", type=float, default=1e-3, help="numbers this close count as equal (default 0.001)")
    parser.add_argument("--rel", type=float, default=1e-6, help="or this close relative to their size (default 1e-6)")
    parser.add_argument("--strict-text", action="store_true", help="compare text exactly (case, spaces and underscores count)")
    parser.add_argument("--include-unknown", action="store_true", help="compare the Unknown Platform and Emitter too")
    parser.add_argument("--ignore-column", action="append", default=[], metavar="HEADER", help="leave a column out (repeatable)")
    parser.add_argument("--csv", metavar="PATH", help="also write the differences to a CSV file")
    args = parser.parse_args(argv)
    try:
        diffs = compare_files(
            args.app_report,
            args.other_report,
            abs_tol=args.abs,
            rel_tol=args.rel,
            strict_text=args.strict_text,
            include_unknown=args.include_unknown,
            ignore_columns=args.ignore_column,
        )
    except (OSError, WorkbookError, zipfile.BadZipFile) as exc:
        print(f"Couldn't read the reports: {exc}", file=sys.stderr)
        return 2
    print_report(diffs)
    if args.csv:
        with open(args.csv, "w", newline="", encoding="utf-8-sig") as f:
            writer = csv.DictWriter(f, fieldnames=["sheet", "key", "column", "app", "other", "kind"], extrasaction="ignore")
            writer.writeheader()
            writer.writerows(diffs)
    return 1 if diffs else 0


if __name__ == "__main__":
    sys.exit(main())
