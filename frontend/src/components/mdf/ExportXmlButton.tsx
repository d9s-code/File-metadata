import { useState } from "react";
import { ApiRequestError } from "../../api/client";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function ExportXmlButton({ mdfId, versionNumber }: { mdfId: string; versionNumber: number }) {
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  async function handleExport() {
    setError(null);
    setDownloading(true);
    try {
      const resp = await fetch(`${API_BASE_URL}/mdfs/${mdfId}/versions/${versionNumber}/export.xml`, {
        credentials: "include",
        headers: { "x-csrf-token": readCookie("csrf_token") ?? "" },
      });
      if (!resp.ok) {
        throw new ApiRequestError(resp.status, `Export failed (${resp.status})`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mdf_${mdfId}_v${versionNumber}.xml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Failed to export XML");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <span>
      <button className="status-transition-button" onClick={() => void handleExport()} disabled={downloading}>
        {downloading ? "Exporting…" : `Export v${versionNumber} XML`}
      </button>
      {error && <span className="error-text"> {error}</span>}
    </span>
  );
}
