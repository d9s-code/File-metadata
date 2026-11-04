import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { uploadRecording } from "../../api/recordings";
import { ApiRequestError } from "../../api/client";

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(n >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} kB`;
  return `${n} B`;
}

/** "Upload recording": picks a whole track export (often 100 MB), sends it
 * in parts with a progress bar, then opens the recording, which shows the
 * server reading it. */
export function RecordingUploadButton({ className = "button secondary" }: { className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [sent, setSent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Leaving the page would cut the upload short.
  useEffect(() => {
    if (!file) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [file]);

  async function start(f: File) {
    setError(null);
    setFile(f);
    setSent(0);
    abort.current = new AbortController();
    try {
      const rec = await uploadRecording(f, setSent, abort.current.signal);
      qc.invalidateQueries({ queryKey: ["recordings"] });
      setFile(null);
      navigate(`/recordings/${rec.id}${rec.already_uploaded ? "?again=1" : ""}`);
    } catch (err) {
      setFile(null);
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof ApiRequestError ? err.message : `The upload failed: ${(err as Error).message}`);
    }
  }

  const pct = file ? Math.round((sent / Math.max(1, file.size)) * 100) : 0;
  return (
    <>
      <button type="button" className={className} disabled={!!file} onClick={() => input.current?.click()}>
        {file ? `Uploading… ${pct}%` : "Upload recording"}
      </button>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void start(f);
        }}
      />
      {(file || error) && (
        <div className="recording-upload-status" role="status">
          {file && (
            <>
              <div className="recording-upload-line">
                <strong>{file.name}</strong>
                <span className="hint-text">
                  {formatBytes(sent)} of {formatBytes(file.size)}
                </span>
                <button type="button" className="link-button" onClick={() => abort.current?.abort()}>
                  Cancel
                </button>
              </div>
              <progress max={100} value={pct} aria-label="Upload progress" />
              <span className="hint-text">Keep this page open until it's sent — reading it then happens on the server.</span>
            </>
          )}
          {error && <div className="error-text">{error}</div>}
        </div>
      )}
    </>
  );
}
