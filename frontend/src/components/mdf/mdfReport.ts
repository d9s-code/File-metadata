import { useState } from "react";
import { reportsApi } from "../../api/reports";
import { ApiRequestError } from "../../api/client";

/** Downloads an MDF's report for a saved version (the latest unless one is
 * given): the "Platforms" and "Emitters" sheets, laid out like the other
 * app's import report, so the two can be compared with
 * scripts/compare_reports.py. Throws (an ApiRequestError) when there's no
 * saved version or nothing to report. */
export async function downloadMdfReport(mdf: { id: string; name: string }, version?: number) {
  const blob = await reportsApi.mdf(mdf.id, version);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const which = version != null ? ` v${version}` : "";
  a.download = `MDF report ${mdf.name}${which} ${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
}

/** The report of one saved MDF version, as a button beside its PRS export. */
export function useMdfReportDownload() {
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  async function download(mdf: { id: string; name: string }, version?: number) {
    setError(null);
    setDownloading(true);
    try {
      await downloadMdfReport(mdf, version);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't make the report");
    } finally {
      setDownloading(false);
    }
  }
  return { download, downloading, error };
}
