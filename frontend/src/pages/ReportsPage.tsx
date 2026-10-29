import { useMemo, useState } from "react";
import { EMITTERS_SECTION, PageHeader } from "../components/common/PageHeader";
import { LoadingState } from "../components/common/LoadingState";
import { useSessionState } from "../components/common/useSessionState";
import { naturalCompare } from "../components/common/sortUtils";
import { useEmitters } from "../state/hooks/useEmitters";
import { usePlatforms } from "../state/hooks/usePlatforms";
import { reportsApi } from "../api/reports";
import { ApiRequestError } from "../api/client";

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

/** Picks the Platforms and Emitters for the Emitter report — a spreadsheet
 * line per Mode — and downloads it. */
export function ReportsPage() {
  const { data: platforms, isLoading: loadingPlatforms } = usePlatforms();
  const { data: emitters, isLoading: loadingEmitters } = useEmitters();
  const [platformIds, setPlatformIds] = useSessionState<string[]>("report.platformIds", []);
  const [emitterIds, setEmitterIds] = useSessionState<string[]>("report.emitterIds", []);
  const [platformSearch, setPlatformSearch] = useState("");
  const [emitterSearch, setEmitterSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<"report" | "analysis" | null>(null);

  const livePlatforms = useMemo(
    () => (platforms ?? []).filter((p) => !p.is_deleted).sort((a, b) => naturalCompare(a.name, b.name, "asc")),
    [platforms],
  );
  const sortedEmitters = useMemo(
    () => [...(emitters ?? [])].sort((a, b) => naturalCompare(a.name, b.name, "asc")),
    [emitters],
  );
  // Each Platform's Emitters, from the Emitters' own lists of Platforms.
  const emittersOn = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of emitters ?? []) for (const p of e.platforms ?? []) map.set(p.id, (map.get(p.id) ?? 0) + 1);
    return map;
  }, [emitters]);

  const pickedPlatforms = new Set(platformIds.filter((id) => livePlatforms.some((p) => p.id === id)));
  const pickedEmitters = new Set(emitterIds.filter((id) => sortedEmitters.some((e) => e.id === id)));
  // An Emitter on a picked Platform is in the report through it.
  const viaPlatform = (e: (typeof sortedEmitters)[number]) =>
    (e.platforms ?? []).filter((p) => pickedPlatforms.has(p.id)).map((p) => p.name);
  const inReport = sortedEmitters.filter((e) => pickedEmitters.has(e.id) || viaPlatform(e).length > 0);
  const extra = sortedEmitters.filter((e) => pickedEmitters.has(e.id) && viaPlatform(e).length === 0);

  const platformQ = platformSearch.trim().toLowerCase();
  const emitterQ = emitterSearch.trim().toLowerCase();
  const shownPlatforms = livePlatforms.filter((p) => !platformQ || p.name.toLowerCase().includes(platformQ));
  const shownEmitters = sortedEmitters.filter(
    (e) => !emitterQ || `${e.name} ${e.designation ?? ""}`.toLowerCase().includes(emitterQ),
  );

  function toggle(list: string[], set: (ids: string[]) => void, id: string) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function download(kind: "report" | "analysis") {
    setError(null);
    setDownloading(kind);
    const picks = { platform_ids: [...pickedPlatforms], emitter_ids: extra.map((e) => e.id) };
    const day = new Date().toISOString().slice(0, 10);
    try {
      if (kind === "report") downloadBlob(await reportsApi.emitters(picks), `Emitter report ${day}.xlsx`);
      else downloadBlob(await reportsApi.analysis(picks), `Analysis sheet ${day}.xlsx`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Couldn't make the spreadsheet.");
    } finally {
      setDownloading(null);
    }
  }

  if (loadingPlatforms || loadingEmitters) return <LoadingState label="Loading…" />;

  return (
    <div className="page">
      <PageHeader
        title="Report"
        section={EMITTERS_SECTION}
        info={
          <>
            A spreadsheet with a line per Mode: Platforms A–Z, each one&apos;s Emitters A–Z, each Emitter&apos;s Modes A–Z;
            then the Emitters picked on their own. A Platform&apos;s Emitters are the versions it pins; an Emitter picked
            on its own is its latest saved version. The <strong>analysis sheet</strong> is for working from: each
            Mode with its Sources and notes, and every value as typed and with its delta (shaded columns), plus sheets
            of the Sources, their Elements and the notes.
          </>
        }
      >
        <button
          type="button"
          className="button secondary"
          onClick={() => void download("analysis")}
          disabled={!!downloading || inReport.length === 0}
          title="Modes with their Sources and notes; every value as typed and with its delta"
        >
          {downloading === "analysis" ? "Making the sheet…" : "Analysis sheet (.xlsx)"}
        </button>
        <button
          type="button"
          className="button primary"
          onClick={() => void download("report")}
          disabled={!!downloading || inReport.length === 0}
        >
          {downloading === "report" ? "Making the report…" : "Download report (.xlsx)"}
        </button>
      </PageHeader>
      <p className="report-summary">
        {inReport.length === 0
          ? "Pick Platforms, Emitters or both."
          : `${pickedPlatforms.size} Platform${pickedPlatforms.size === 1 ? "" : "s"}` +
            (extra.length ? ` and ${extra.length} more Emitter${extra.length === 1 ? "" : "s"}` : "") +
            ` — ${inReport.length} Emitter${inReport.length === 1 ? "" : "s"} in the report.`}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      <div className="report-picker">
        <section className="card">
          <div className="report-picker-head">
            <h2>Platforms</h2>
            <span className="hint-text">{pickedPlatforms.size} picked</span>
            <button type="button" className="link-button" onClick={() => setPlatformIds(shownPlatforms.map((p) => p.id))}>
              All
            </button>
            <button type="button" className="link-button" onClick={() => setPlatformIds([])}>
              None
            </button>
          </div>
          <input
            type="search"
            placeholder="Search Platforms…"
            aria-label="Search Platforms"
            value={platformSearch}
            onChange={(e) => setPlatformSearch(e.target.value)}
          />
          <ul className="report-picker-list">
            {shownPlatforms.map((p) => (
              <li key={p.id}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={pickedPlatforms.has(p.id)}
                    onChange={() => toggle(platformIds, setPlatformIds, p.id)}
                  />
                  <span>{p.name}</span>
                  <span className="hint-text">
                    {emittersOn.get(p.id) ?? 0} Emitter{(emittersOn.get(p.id) ?? 0) === 1 ? "" : "s"}
                  </span>
                </label>
              </li>
            ))}
            {shownPlatforms.length === 0 && <li className="hint-text">No Platforms match.</li>}
          </ul>
        </section>

        <section className="card">
          <div className="report-picker-head">
            <h2>Emitters</h2>
            <span className="hint-text">{extra.length} picked on their own</span>
            <button type="button" className="link-button" onClick={() => setEmitterIds(shownEmitters.map((e) => e.id))}>
              All
            </button>
            <button type="button" className="link-button" onClick={() => setEmitterIds([])}>
              None
            </button>
          </div>
          <input
            type="search"
            placeholder="Search Emitters by name or designation…"
            aria-label="Search Emitters"
            value={emitterSearch}
            onChange={(e) => setEmitterSearch(e.target.value)}
          />
          <ul className="report-picker-list">
            {shownEmitters.map((e) => {
              const via = viaPlatform(e);
              return (
                <li key={e.id}>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={via.length > 0 || pickedEmitters.has(e.id)}
                      disabled={via.length > 0}
                      onChange={() => toggle(emitterIds, setEmitterIds, e.id)}
                    />
                    <span>{e.name}</span>
                    {e.designation && <span className="hint-text">{e.designation}</span>}
                    {via.length > 0 && <span className="hint-text">on {via.join(", ")}</span>}
                  </label>
                </li>
              );
            })}
            {shownEmitters.length === 0 && <li className="hint-text">No Emitters match.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
