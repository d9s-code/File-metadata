import { useMemo, useState } from "react";
import { ApiRequestError } from "../../api/client";
import type { MdfVersionSummary } from "../../api/mdfVersions";
import { reportsApi, type ReportComparison, type ReportDifference } from "../../api/reports";
import { formatDate } from "../common/dates";
import { useMdfReportDownload } from "./mdfReport";

const WHAT: Record<ReportDifference["code"], string> = {
  value: "Value differs",
  only_app: "Only in this app",
  only_other: "Only in the other app",
  column_only_app: "Column only in this app",
  column_only_other: "Column only in the other app",
  sheet_missing: "Sheet missing",
};

function csvCell(value: string) {
  return /[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function downloadCsv(result: ReportComparison, mdfName: string) {
  const lines = [
    ["Sheet", "Row", "Column", "This app", "Other app", "What"],
    ...result.differences.map((d) => [d.sheet, d.key, d.column, d.app, d.other, WHAT[d.code]]),
  ].map((row) => row.map(csvCell).join(","));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Import check ${mdfName} v${result.mdf_version}.csv`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

/** The import check: upload the report the other app made after importing
 * this MDF, and see where it differs from this app's report of a saved
 * version — rows matched by name, whatever their order. */
export function MdfImportCheckPanel({ mdf, versions }: { mdf: { id: string; name: string }; versions: MdfVersionSummary[] }) {
  const latest = versions.length ? versions[versions.length - 1].version_number : null;
  const [picked, setPicked] = useState<number | null>(null);
  const version = picked ?? latest;
  const [file, setFile] = useState<File | null>(null);
  const [includeUnknown, setIncludeUnknown] = useState(false);
  const [strictText, setStrictText] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportComparison | null>(null);
  const [sheet, setSheet] = useState("");
  const [search, setSearch] = useState("");
  const report = useMdfReportDownload();

  async function check() {
    if (!file || version == null) return;
    setError(null);
    setChecking(true);
    try {
      setResult(await reportsApi.compareMdf(mdf.id, file, { version, includeUnknown, strictText }));
      setSheet("");
      setSearch("");
    } catch (err) {
      setResult(null);
      setError(err instanceof ApiRequestError ? err.message : "Couldn't compare the reports");
    } finally {
      setChecking(false);
    }
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (result?.differences ?? []).filter(
      (d) =>
        (!sheet || d.sheet === sheet) &&
        (!q || `${d.key} ${d.column}`.toLowerCase().replace(/_/g, " ").includes(q.replace(/_/g, " "))),
    );
  }, [result, sheet, search]);

  if (latest == null) {
    return (
      <section className="card import-check">
        <h2 className="as-h4">Import check</h2>
        <p className="empty-state">
          Save a version of this MDF first. The check compares the other app&apos;s report with the report of a saved
          version, the same one its PRS export is made from.
        </p>
      </section>
    );
  }

  const platforms = result?.rows.Platforms;
  const modes = result?.rows.Emitters;
  return (
    <section className="card import-check">
      <div className="card-header">
        <h2 className="as-h4">Import check</h2>
      </div>
      <p className="hint-text">
        After importing this MDF into the other app, make its report there and upload it here. It&apos;s compared with
        this app&apos;s report of the version you exported. Rows are matched by name, so their order doesn&apos;t matter.
        Names match across case and spaces vs. underscores, and numbers match within 0.001.
      </p>
      <div className="inline-form import-check-form">
        <label>
          Version exported
          <select value={version ?? ""} onChange={(e) => setPicked(Number(e.target.value))}>
            {[...versions].reverse().map((v) => (
              <option key={v.id} value={v.version_number}>
                v{v.version_number} · {formatDate(v.created_at)}
                {v.version_number === latest ? " (latest)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          The other app&apos;s report (.xlsx)
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button type="button" className="button primary" onClick={() => void check()} disabled={!file || checking}>
          {checking ? "Comparing…" : "Compare"}
        </button>
      </div>
      <div className="import-check-options">
        <label className="checkbox-label" title="Each app fills the Unknown Platform and Emitter with its own defaults">
          <input type="checkbox" checked={includeUnknown} onChange={(e) => setIncludeUnknown(e.target.checked)} />
          Include the Unknown Platform and Emitter
        </label>
        <label className="checkbox-label" title="Case, spaces and underscores count in text">
          <input type="checkbox" checked={strictText} onChange={(e) => setStrictText(e.target.checked)} />
          Compare text exactly
        </label>
        <button
          type="button"
          className="link-button"
          onClick={() => void report.download(mdf, version ?? undefined)}
          disabled={report.downloading}
        >
          {report.downloading ? "Making the report…" : `Download this app's report for v${version}`}
        </button>
        {report.error && <span className="error-text">{report.error}</span>}
      </div>
      {error && <div className="error-text">{error}</div>}

      {result && (
        <div className="import-check-result" aria-live="polite">
          <p className={result.agrees ? "import-check-verdict ok" : "import-check-verdict differs"}>
            <span className="import-check-icon" aria-hidden="true">
              {result.agrees ? "✓" : "!"}
            </span>
            <span>
              {result.agrees ? (
                <strong>The reports agree.</strong>
              ) : (
                <strong>
                  {result.difference_count} difference{result.difference_count === 1 ? "" : "s"}
                </strong>
              )}{" "}
              <span className="hint-text">
                {result.file_name ?? "The uploaded report"} against v{result.mdf_version}
                {platforms && ` · Platforms: ${platforms.app} here, ${platforms.other} there`}
                {modes && ` · Mode lines: ${modes.app} here, ${modes.other} there`}
              </span>
            </span>
          </p>
          {!result.agrees && (
            <>
              <div className="toolbar-filters import-check-filters">
                <label>
                  Sheet
                  <select value={sheet} onChange={(e) => setSheet(e.target.value)}>
                    <option value="">Both</option>
                    <option value="Platforms">Platforms</option>
                    <option value="Emitters">Emitters</option>
                  </select>
                </label>
                <label>
                  Find
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Name or column"
                  />
                </label>
                <button type="button" className="button secondary small" onClick={() => downloadCsv(result, mdf.name)}>
                  Download differences (.csv)
                </button>
              </div>
              {result.difference_count > result.differences.length && (
                <p className="hint-text">
                  Showing the first {result.differences.length}. That many usually means the wrong report or version.
                </p>
              )}
              <div className="table-scroll">
                <table className="data-table import-check-table">
                  <thead>
                    <tr>
                      <th scope="col">Sheet</th>
                      <th scope="col">Row</th>
                      <th scope="col">Column</th>
                      <th scope="col">This app</th>
                      <th scope="col">Other app</th>
                      <th scope="col">What</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((d, i) => (
                      <tr key={i} className={`import-diff-${d.code}`}>
                        <td>{d.sheet}</td>
                        <td>{d.key || "—"}</td>
                        <td>{d.column || "—"}</td>
                        <td className="import-check-value">{d.app}</td>
                        <td className="import-check-value">{d.other}</td>
                        <td>{WHAT[d.code]}</td>
                      </tr>
                    ))}
                    {shown.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty-state">
                          No differences match.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
