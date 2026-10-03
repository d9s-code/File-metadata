import { useState } from "react";
import { platformsApi } from "../../api/platforms";
import { mdfsApi } from "../../api/mdfs";
import { ApiRequestError } from "../../api/client";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Downloads a saved Platform or MDF version as the PRS-format ZIP package. */
export async function downloadPrs(kind: "platform" | "mdf", id: string, versionNumber: number) {
  const blob = kind === "platform" ? await platformsApi.exportPrs(id, versionNumber) : await mdfsApi.exportPrs(id, versionNumber);
  downloadBlob(blob, `${kind}_${id}_v${versionNumber}_prs.zip`);
}

/** Exports a committed Platform or MDF version to the real PRS-format ZIP
 * package the target system actually consumes — distinct from the
 * placeholder "Export XML" button, which uses this app's own legacy
 * single-file format. See docs/XML_IMPORT_BRIEF.md. */
export function ExportPrsButton({
  kind,
  id,
  versionNumber,
}: {
  kind: "platform" | "mdf";
  id: string;
  versionNumber: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function handleExport() {
    setError(null);
    setDownloading(true);
    try {
      await downloadPrs(kind, id, versionNumber);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to export PRS package");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <span>
      <button className="button secondary small" onClick={() => void handleExport()} disabled={downloading}>
        {downloading ? "Exporting…" : `Export v${versionNumber} PRS`}
      </button>
      {error && <span className="error-text"> {error}</span>}
    </span>
  );
}
