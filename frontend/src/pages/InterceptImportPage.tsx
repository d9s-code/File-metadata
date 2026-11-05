import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { BackLink } from "../components/common/BackLink";
import { formatDate, formatDateTime } from "../components/common/dates";
import { DateInput } from "../components/common/DateInput";
import { PageHeader } from "../components/common/PageHeader";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useEmitters } from "../state/hooks/useEmitters";
import { useEmitterModes } from "../state/hooks/useModes";
import {
  useImportInterceptEntries,
  useIntercept,
  useIntercepts,
  useSourceFileImports,
} from "../state/hooks/useIntercepts";
import { useConfirmDialog } from "../components/common/ConfirmDialog";
import {
  clearImportDraft,
  loadImportDraft,
  saveImportDraft,
  type ImportDraft,
} from "../components/intercepts/importDraft";
import { useHasRole } from "../auth/RequireAuth";
import { ApiRequestError } from "../api/client";
import { MAX_IMPORT_ENTRIES, MAX_IMPORT_REPORTS } from "../api/intercepts";
import { recordingsApi } from "../api/recordings";
import { describeSnip, readFilters, snipToReports } from "../components/recordings/recordingFilters";
import { CsvFormatError, missionDay, parseInterceptCsv, type ParsedCsv } from "../components/intercepts/interceptCsv";
import {
  oneGroupPerReport,
  summarize,
  toEntryInput,
  toReportsUpload,
  type ReportGroup,
} from "../components/intercepts/interceptGroups";
import { ImportGroupsPanel } from "../components/intercepts/ImportGroupsPanel";

const TYPE_LABEL = { fixed: "Fixed", stagger: "Stagger", cw: "CW" } as const;

/** Import an EmitterTrackParameters CSV as Intercept entries: read the file,
 * choose where it goes, group the reports, save. Reading happens in the
 * browser; only the grouped entries are sent. */
export function InterceptImportPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const canWrite = useHasRole("editor");
  const { data: emitters } = useEmitters();

  const presetIntercept = params.get("intercept") ?? "";
  const { data: existingIntercept } = useIntercept(presetIntercept);

  const [fileName, setFileName] = useState("");
  // The file's text, kept for the draft (see importDraft.ts).
  const [fileText, setFileText] = useState("");
  // An unfinished import from before, offered until the user resumes or discards it.
  const [draftOffer, setDraftOffer] = useState<ImportDraft | null>(null);
  const { confirmDelete: confirm, dialog } = useConfirmDialog();
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [groups, setGroups] = useState<ReportGroup[]>([]);
  const [showSkipped, setShowSkipped] = useState(false);

  const [emitterId, setEmitterId] = useState(params.get("emitter") ?? "");
  const [emitterPick, setEmitterPick] = useState<string | null>(null);
  const [target, setTarget] = useState<"new" | "existing">(presetIntercept ? "existing" : "new");
  const [interceptId, setInterceptId] = useState(presetIntercept);
  const [name, setName] = useState("");
  const [recordedOn, setRecordedOn] = useState("");
  const [collectedBy, setCollectedBy] = useState("");
  const [description, setDescription] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  // Snipped from a whole recording (the Recording page's "Group"): which, and how.
  const [recording, setRecording] = useState<{ id: string; snip: Record<string, unknown> } | null>(null);

  const { data: modes } = useEmitterModes(emitterId);
  const { data: emitterIntercepts } = useIntercepts(emitterId ? { emitterId } : undefined);
  const importEntries = useImportInterceptEntries();

  useEffect(() => {
    let live = true;
    void loadImportDraft().then((draft) => {
      if (live && draft) setDraftOffer(draft);
    });
    return () => {
      live = false;
    };
  }, []);

  // Earlier imports of this file — a second import would duplicate every entry.
  // (Snips of one recording are meant to be many.)
  const { data: earlierImports } = useSourceFileImports(parsed && !recording ? fileName : "");

  // Keep the work as a draft a moment after each change, so leaving the page
  // by any route (back button, a link, a refresh) loses nothing.
  useEffect(() => {
    if (!parsed || parsed.reports.length === 0 || (!fileText && !recording)) return;
    const handle = window.setTimeout(() => {
      void saveImportDraft({
        fileName,
        text: recording ? "" : fileText,
        ...(recording ? { recording } : {}),
        groups,
        destination: { emitterId, target, interceptId, name, recordedOn, collectedBy, description },
        savedAt: Date.now(),
      });
    }, 800);
    return () => window.clearTimeout(handle);
  }, [parsed, fileText, fileName, recording, groups, emitterId, target, interceptId, name, recordedOn, collectedBy, description]);

  // Closing or reloading the tab asks first; the draft covers everything else.
  useEffect(() => {
    if (!parsed || parsed.reports.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [parsed]);

  // Adding to an existing Intercept fixes the Emitter.
  useEffect(() => {
    if (existingIntercept) setEmitterId(existingIntercept.emitter_id);
  }, [existingIntercept]);

  const designationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of parsed?.reports ?? []) {
      const key = r.designation ?? "not identified";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [parsed]);

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDraftOffer(null);
    setFileError(null);
    setParsed(null);
    setReading(true);
    setFileName(file.name);
    setRecording(null);
    try {
      const text = await file.text();
      // Let "Reading…" paint before a large file blocks the page for a moment.
      await new Promise((r) => setTimeout(r, 0));
      const result = parseInterceptCsv(text);
      if (result.reports.length === 0) {
        setFileError("No reports could be read from this file — see the skipped lines below.");
      }
      setFileText(text);
      afterRead(result, file.name.replace(/\.csv$/i, "").replace(/_EmitterTrackParameters$/i, ""));
    } catch (err) {
      setFileError(err instanceof CsvFormatError ? err.message : `Couldn't read the file: ${(err as Error).message}`);
    } finally {
      setReading(false);
    }
  }

  /** The reports of a snip of a whole recording, fetched from the server. */
  async function readSnip(recordingId: string, snip: Record<string, unknown>) {
    const got = await recordingsApi.reports(recordingId, readFilters(snip));
    setFileText("");
    setFileName(got.recording);
    setRecording({ id: recordingId, snip });
    return { parsed: { reports: snipToReports(got), skipped: [] } as ParsedCsv, name: got.recording };
  }

  async function loadSnip(recordingId: string, snip: Record<string, unknown>) {
    setDraftOffer(null);
    setFileError(null);
    setParsed(null);
    setReading(true);
    try {
      const { parsed: result, name: recordingName } = await readSnip(recordingId, snip);
      if (result.reports.length === 0) setFileError("This snip holds no reports — go back and widen it.");
      const stem = recordingName.replace(/\.csv$/i, "").replace(/_EmitterTrackParameters$/i, "");
      afterRead(result, `${stem} · ${describeSnip(snip)}`.slice(0, 150));
    } catch (err) {
      setFileError(err instanceof ApiRequestError ? err.message : `Couldn't fetch the snip: ${(err as Error).message}`);
    } finally {
      setReading(false);
    }
  }

  // Opened from a recording's "Group": fetch that snip.
  const snipParam = params.get("recording");
  const snipQuery = params.get("snip");
  useEffect(() => {
    if (!snipParam) return;
    let snip: Record<string, unknown> = {};
    try {
      snip = JSON.parse(snipQuery ?? "{}");
    } catch {
      // A mangled address: the whole recording, which the server refuses if too big.
    }
    void loadSnip(snipParam, readFilters(snip) as Record<string, unknown>);
    // Once per recording/snip in the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snipParam, snipQuery]);

  /** A file read (or a snip fetched): one group per report to start, and the destination's defaults. */
  function afterRead(result: ParsedCsv, stem: string) {
    setParsed(result);
    setGroups(oneGroupPerReport(result.reports));
    setName((n) => n || stem);
    const days = result.reports.map((r) => missionDay(r.missionTime)).filter((d): d is string => !!d).sort();
    setRecordedOn((d) => d || days[0] || "");
    // What the system identified the reports as is an Emitter's
    // designation — pick that Emitter when exactly one matches, and say so.
    if (!emitterId && emitters) {
      const identified = new Set(result.reports.map((r) => r.designation?.toLowerCase()).filter(Boolean));
      const matching = emitters.filter((em) => em.designation && identified.has(em.designation.trim().toLowerCase()));
      if (matching.length === 1) {
        setEmitterId(matching[0].id);
        setEmitterPick(
          `Picked because its designation, ${matching[0].designation}, is what the system identified these reports as.`,
        );
      } else if (matching.length > 1) {
        setEmitterPick(
          `${matching.length} Emitters have a designation the system identified in this file — choose one.`,
        );
      }
    }
  }

  async function resumeDraft(draft: ImportDraft) {
    setDraftOffer(null);
    setFileError(null);
    setReading(true);
    setFileName(draft.fileName);
    await new Promise((r) => setTimeout(r, 0));
    try {
      const result = draft.recording
        ? (await readSnip(draft.recording.id, draft.recording.snip)).parsed
        : parseInterceptCsv(draft.text);
      if (!draft.recording) {
        setFileText(draft.text);
        setRecording(null);
      }
      setParsed(result);
      setGroups(draft.groups);
      const d = draft.destination;
      setEmitterId(d.emitterId);
      setTarget(d.target);
      setInterceptId(d.interceptId);
      setName(d.name);
      setRecordedOn(d.recordedOn);
      setCollectedBy(d.collectedBy);
      setDescription(d.description);
    } catch (err) {
      setFileError(`Couldn't resume the draft: ${(err as Error).message}`);
      void clearImportDraft();
    } finally {
      setReading(false);
    }
  }

  const byLine = useMemo(() => new Map((parsed?.reports ?? []).map((r) => [r.line, r])), [parsed]);
  const included = groups.filter((g) => !g.excluded);
  const excludedReports = groups.filter((g) => g.excluded).reduce((n, g) => n + g.lines.length, 0);
  const strayReports = groups.filter((g) => g.stray).reduce((n, g) => n + g.lines.length, 0);
  // The reports are kept with the Intercept, so a file can be at most this big.
  const tooManyReports = (parsed?.reports.length ?? 0) > MAX_IMPORT_REPORTS;
  const tooMany = included.length > MAX_IMPORT_ENTRIES || tooManyReports;
  const destinationReady =
    !!emitterId && (target === "new" ? name.trim().length > 0 : interceptId.length > 0);

  async function handleImport() {
    if (!parsed) return;
    setSaveError(null);
    if (
      earlierImports &&
      earlierImports.length > 0 &&
      !(await confirm(
        `${fileName} was imported before — into ${earlierImports
          .map((i) => `"${i.intercept_name}" (${i.entry_count.toLocaleString()} entries)`)
          .join(", ")}. Importing it again adds its entries a second time.`,
        { confirmLabel: "Import again" },
      ))
    )
      return;
    const entries = included.map((g) => {
      const groupReports = g.lines.map((l) => byLine.get(l)!);
      return toEntryInput(summarize(groupReports), groupReports, fileName, g.hypothesis ?? null);
    });
    // Every report goes too — those left out as well — so the Intercept can
    // show them and be regrouped later.
    const reports = toReportsUpload(parsed.reports, included, fileName);
    try {
      const saved =
        target === "new"
          ? await importEntries.mutateAsync({
              target: "new",
              intercept: {
                ...(recording ? { recording_id: recording.id, snip: recording.snip } : {}),
                emitter_id: emitterId,
                name: name.trim(),
                intercepted_on: recordedOn || null,
                collected_by: collectedBy.trim() || null,
                description: description.trim() || null,
              },
              entries,
              reports,
            })
          : await importEntries.mutateAsync({ target: "existing", interceptId, entries, reports });
      await clearImportDraft();
      navigate(`/intercepts/${saved.id}`);
    } catch (err) {
      setSaveError(err instanceof ApiRequestError ? err.message : "Import failed — nothing was saved.");
    }
  }

  if (!canWrite) {
    return (
      <div className="page">
        <h1>Import Intercept from CSV</h1>
        <p className="hint-text">Importing needs editor access.</p>
      </div>
    );
  }

  const chosenEmitter = emitters?.find((e) => e.id === emitterId);
  const byType = (parsed?.reports ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.priType] = (acc[r.priType] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="page">
      <BackLink to={chosenEmitter ? `/emitters/${chosenEmitter.id}?tab=intercepts` : "/intercepts"}>
        {chosenEmitter ? `${chosenEmitter.name} · Intercepts` : "Intercepts"}
      </BackLink>
      <PageHeader
        title={snipParam ? "Group a snip into an Intercept" : "Import Intercept from CSV"}
        info="For an EmitterTrackParameters export. The file is read in your browser — nothing is saved until you press Import at the bottom — and your grouping is kept in this browser as you work, so leaving the page loses nothing: you'll be offered to resume it. Times are converted from ns to µs; RF stays in MHz."
      />

      <section className="card">
        <h2 className="as-h4">1. File</h2>
        {draftOffer && !parsed && (
          <div className="import-draft">
            <span>
              <strong>Unfinished import:</strong> {draftOffer.fileName} — {draftOffer.groups.length.toLocaleString()}{" "}
              rows, last changed {formatDateTime(draftOffer.savedAt)}.
            </span>
            <span className="import-selection-actions">
              <button type="button" className="button primary small" onClick={() => void resumeDraft(draftOffer)}>
                Resume it
              </button>
              <button
                type="button"
                className="button secondary small"
                onClick={() => {
                  setDraftOffer(null);
                  void clearImportDraft();
                }}
              >
                Discard it
              </button>
            </span>
          </div>
        )}
        {recording ? (
          <p className="import-snip-source">
            A snip of the recording{" "}
            <Link to={`/recordings/${recording.id}?snip=${encodeURIComponent(JSON.stringify(recording.snip))}`}>{fileName}</Link>
            <span className="hint-text"> · {describeSnip(recording.snip)}</span>
          </p>
        ) : (
          <input type="file" accept=".csv,text/csv" onChange={(e) => void handleFile(e)} />
        )}
        {reading && <p className="hint-text">{snipParam && !parsed ? "Fetching the snip…" : `Reading ${fileName}…`}</p>}
        {fileError && <div className="error-text">{fileError}</div>}
        {parsed && (
          <div className="import-file-summary">
            <p>
              <strong>{parsed.reports.length.toLocaleString()}</strong> report
              {parsed.reports.length === 1 ? "" : "s"}
              {Object.keys(byType).length > 0 && (
                <span className="hint-text">
                  {" "}
                  ·{" "}
                  {Object.entries(byType)
                    .map(([t, n]) => `${n.toLocaleString()} ${TYPE_LABEL[t as keyof typeof TYPE_LABEL]}`)
                    .join(", ")}
                </span>
              )}
              {designationCounts.length > 0 && (
                <span className="hint-text">
                  {" "}
                  · identified as{" "}
                  {designationCounts.map(([designation, n]) => `${designation} (${n.toLocaleString()})`).join(", ")}
                </span>
              )}
            </p>
            {parsed.skipped.length > 0 && (
              <p>
                <span className="summary-bad">
                  {parsed.skipped.length.toLocaleString()} line{parsed.skipped.length === 1 ? "" : "s"} skipped
                </span>{" "}
                <button type="button" className="link-button" onClick={() => setShowSkipped((v) => !v)}>
                  {showSkipped ? "Hide" : "Show which"}
                </button>
              </p>
            )}
            {showSkipped && (
              <ul className="import-skipped">
                {parsed.skipped.slice(0, 200).map((s) => (
                  <li key={s.line}>
                    Line {s.line}: {s.reason}
                  </li>
                ))}
                {parsed.skipped.length > 200 && <li>…and {parsed.skipped.length - 200} more</li>}
              </ul>
            )}
            {earlierImports && earlierImports.length > 0 && (
              <p className="import-duplicate">
                <strong>Imported before:</strong> {fileName} is already in{" "}
                {earlierImports.map((i, k) => (
                  <span key={i.intercept_id}>
                    {k > 0 && ", "}
                    <Link to={`/intercepts/${i.intercept_id}`}>{i.intercept_name}</Link> (
                    {i.entry_count.toLocaleString()} entries, {formatDate(i.imported_at)})
                  </span>
                ))}
                . Importing it again would add its entries a second time.
              </p>
            )}
          </div>
        )}
      </section>

      {parsed && parsed.reports.length > 0 && (
        <>
          <section className="card">
            <h2 className="as-h4">2. Save to</h2>
            <div className="edit-fields">
              <label>
                Emitter
                <select
                  value={emitterId}
                  disabled={target === "existing" && !!existingIntercept}
                  onChange={(e) => {
                    setEmitterId(e.target.value);
                    setEmitterPick(null);
                    setInterceptId("");
                  }}
                >
                  <option value="">Choose an Emitter…</option>
                  {(emitters ?? []).map((em) => (
                    <option key={em.id} value={em.id}>
                      {em.name}
                      {em.designation ? ` (${em.designation})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {emitterPick && <p className="hint-text">{emitterPick}</p>}
              {chosenEmitter &&
                designationCounts.length > 0 &&
                !designationCounts.some(([e]) => e.toLowerCase() === chosenEmitter.designation?.trim().toLowerCase()) && (
                  <p className="mode-form-warning">
                    {chosenEmitter.name} is {chosenEmitter.designation ?? "without a designation"}; the reports were
                    identified as {designationCounts.map(([d]) => d).join(", ")}.
                  </p>
                )}

              <div className="theme-toggle import-target" role="group" aria-label="Intercept">
                <button type="button" aria-pressed={target === "new"} className={target === "new" ? "active" : ""} onClick={() => setTarget("new")}>
                  New Intercept
                </button>
                <button
                  type="button"
                  aria-pressed={target === "existing"}
                  className={target === "existing" ? "active" : ""}
                  onClick={() => setTarget("existing")}
                >
                  Add to an existing one
                </button>
              </div>
              {target === "new" ? (
                <>
                  <label>
                    Name
                    <input className="edit-input" value={name} onChange={(e) => setName(e.target.value)} required />
                  </label>
                  <div className="form-row">
                    <label>
                      Recorded on
                      <DateInput className="edit-input" value={recordedOn} onChange={(e) => setRecordedOn(e.target.value)} />
                    </label>
                    <label className="grow">
                      Collected by
                      <input
                        className="edit-input"
                        value={collectedBy}
                        onChange={(e) => setCollectedBy(e.target.value)}
                        placeholder="Platform, sensor or site"
                        maxLength={200}
                      />
                    </label>
                  </div>
                  <label>
                    Description
                    <textarea className="edit-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
                  </label>
                </>
              ) : (
                <label>
                  Intercept
                  <select value={interceptId} onChange={(e) => setInterceptId(e.target.value)} disabled={!emitterId}>
                    <option value="">{emitterId ? "Choose an Intercept…" : "Choose an Emitter first"}</option>
                    {(emitterIntercepts ?? []).map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} ({i.entry_count} entries)
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </section>

          <ImportGroupsPanel
            reports={parsed.reports}
            groups={groups}
            onChange={setGroups}
            modes={emitterId ? modes : undefined}
            emitterId={emitterId}
          />

          <section className="card import-footer">
            <p>
              <strong>{included.length.toLocaleString()}</strong> entr{included.length === 1 ? "y" : "ies"} from{" "}
              {(parsed.reports.length - excludedReports).toLocaleString()} reports
              {strayReports > 0 && (
                <span className="hint-text"> · {strayReports.toLocaleString()} strays held out</span>
              )}
              {excludedReports > strayReports && (
                <span className="hint-text"> · {(excludedReports - strayReports).toLocaleString()} reports excluded</span>
              )}
              {parsed.skipped.length > 0 && (
                <span className="hint-text">
                  {" "}
                  · {parsed.skipped.length.toLocaleString()} line{parsed.skipped.length === 1 ? "" : "s"} skipped
                </span>
              )}
            </p>
            {included.length > MAX_IMPORT_ENTRIES && (
              <p className="mode-form-warning">
                Group or exclude reports first — one import takes up to {MAX_IMPORT_ENTRIES.toLocaleString()} entries.
              </p>
            )}
            {tooManyReports && (
              <p className="error-text">
                One file can hold at most {MAX_IMPORT_REPORTS.toLocaleString()} reports — split it and import the
                parts into the same Intercept.
              </p>
            )}
            {!destinationReady && (
              <p className="hint-text">
                {emitterId ? (target === "new" ? "Give the Intercept a name." : "Choose the Intercept to add to.") : "Choose an Emitter."}
              </p>
            )}
            {saveError && <div className="error-text">{saveError}</div>}
            <button
              type="button"
              className="button primary"
              disabled={!destinationReady || included.length === 0 || tooMany || importEntries.isPending}
              onClick={() => void handleImport()}
            >
              {importEntries.isPending
                ? "Importing…"
                : `Import ${included.length.toLocaleString()} entr${included.length === 1 ? "y" : "ies"}`}
            </button>
          </section>
        </>
      )}
      {dialog}
    </div>
  );
}
