import { useEffect, useMemo, useState, type ChangeEvent } from "react";
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
import { MAX_IMPORT_ENTRIES } from "../api/intercepts";
import { CsvFormatError, missionDay, parseInterceptCsv, type ParsedCsv } from "../components/intercepts/interceptCsv";
import { oneGroupPerReport, summarize, toEntryInput, type ReportGroup } from "../components/intercepts/interceptGroups";
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
  const { data: earlierImports } = useSourceFileImports(parsed ? fileName : "");

  // Keep the work as a draft a moment after each change, so leaving the page
  // by any route (back button, a link, a refresh) loses nothing.
  useEffect(() => {
    if (!parsed || parsed.reports.length === 0 || !fileText) return;
    const handle = window.setTimeout(() => {
      void saveImportDraft({
        fileName,
        text: fileText,
        groups,
        destination: { emitterId, target, interceptId, name, recordedOn, collectedBy, description },
        savedAt: Date.now(),
      });
    }, 800);
    return () => window.clearTimeout(handle);
  }, [parsed, fileText, fileName, groups, emitterId, target, interceptId, name, recordedOn, collectedBy, description]);

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
    try {
      const text = await file.text();
      // Let "Reading…" paint before a large file blocks the page for a moment.
      await new Promise((r) => setTimeout(r, 0));
      const result = parseInterceptCsv(text);
      if (result.reports.length === 0) {
        setFileError("No reports could be read from this file — see the skipped lines below.");
      }
      setFileText(text);
      setParsed(result);
      setGroups(oneGroupPerReport(result.reports));
      const stem = file.name.replace(/\.csv$/i, "").replace(/_EmitterTrackParameters$/i, "");
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
    } catch (err) {
      setFileError(err instanceof CsvFormatError ? err.message : `Couldn't read the file: ${(err as Error).message}`);
    } finally {
      setReading(false);
    }
  }

  async function resumeDraft(draft: ImportDraft) {
    setDraftOffer(null);
    setFileError(null);
    setReading(true);
    setFileName(draft.fileName);
    await new Promise((r) => setTimeout(r, 0));
    try {
      const result = parseInterceptCsv(draft.text);
      setFileText(draft.text);
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
  const tooMany = included.length > MAX_IMPORT_ENTRIES;
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
    const entries = included.map((g) => toEntryInput(summarize(g.lines.map((l) => byLine.get(l)!)), g.lines, fileName));
    try {
      const saved =
        target === "new"
          ? await importEntries.mutateAsync({
              target: "new",
              intercept: {
                emitter_id: emitterId,
                name: name.trim(),
                intercepted_on: recordedOn || null,
                collected_by: collectedBy.trim() || null,
                description: description.trim() || null,
              },
              entries,
            })
          : await importEntries.mutateAsync({ target: "existing", interceptId, entries });
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
      <Link to={chosenEmitter ? `/emitters/${chosenEmitter.id}?tab=intercepts` : "/intercepts"}>
        ← {chosenEmitter ? `${chosenEmitter.name} Intercepts` : "Intercepts"}
      </Link>
      <h1>Import Intercept from CSV</h1>
      <p className="hint-text">
        For an EmitterTrackParameters export. The file is read in your browser; nothing is saved until you press
        Import at the bottom.
      </p>

      <section className="card">
        <h4>1. File</h4>
        {draftOffer && !parsed && (
          <div className="import-draft">
            <span>
              <strong>Unfinished import:</strong> {draftOffer.fileName} — {draftOffer.groups.length.toLocaleString()}{" "}
              rows, last changed {new Date(draftOffer.savedAt).toLocaleString()}.
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
        <input type="file" accept=".csv,text/csv" onChange={(e) => void handleFile(e)} />
        {reading && <p className="hint-text">Reading {fileName}…</p>}
        {fileError && <div className="error-text">{fileError}</div>}
        {parsed && (
          <div className="import-file-summary">
            <p>
              <strong>{parsed.reports.length.toLocaleString()}</strong> report
              {parsed.reports.length === 1 ? "" : "s"} read from {fileName}
              {Object.keys(byType).length > 0 && (
                <span className="hint-text">
                  {" "}
                  ({Object.entries(byType)
                    .map(([t, n]) => `${n.toLocaleString()} ${TYPE_LABEL[t as keyof typeof TYPE_LABEL]}`)
                    .join(", ")}
                  )
                </span>
              )}
              . Times are converted from ns to µs; RF stays in MHz.
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
                    {i.entry_count.toLocaleString()} entries, {new Date(i.imported_at).toLocaleDateString()})
                  </span>
                ))}
                . Importing it again would add its entries a second time.
              </p>
            )}
            <p className="hint-text">
              Your grouping is kept in this browser as you work, so leaving the page loses nothing — you&apos;ll be
              offered to resume it.
            </p>
            {designationCounts.length > 0 && (
              <p className="hint-text">
                Identified by the system as:{" "}
                {designationCounts.map(([designation, n]) => `${designation} (${n.toLocaleString()})`).join(", ")}
              </p>
            )}
          </div>
        )}
      </section>

      {parsed && parsed.reports.length > 0 && (
        <>
          <section className="card">
            <h4>2. Save to</h4>
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
                  <p className="hint-text">
                    Note: {chosenEmitter.name}&apos;s designation ({chosenEmitter.designation ?? "none"}) isn&apos;t what
                    the system identified these reports as.
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
                      <input type="date" className="edit-input" value={recordedOn} onChange={(e) => setRecordedOn(e.target.value)} />
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
                  <p className="hint-text">Name and date are taken from the file name and the earliest report; change them as you like.</p>
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
            {tooMany && (
              <p className="error-text">
                One import takes at most {MAX_IMPORT_ENTRIES.toLocaleString()} entries — group or exclude reports first.
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
